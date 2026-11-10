import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:recallfarm/core/api/api_client.dart';
import 'package:recallfarm/core/api/token_store.dart';
import 'package:recallfarm/core/sync/sync_engine.dart';

/// Server answering 415 to gzip bodies (a proxy, an older API) and 200 to plain JSON.
class _GzipRefusingAdapter implements HttpClientAdapter {
  final requests = <({String? encoding, Object? body})>[];

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    final bytes = <int>[];
    if (requestStream != null) {
      await for (final chunk in requestStream) {
        bytes.addAll(chunk);
      }
    }
    final encoding = options.headers['Content-Encoding']?.toString();
    requests.add((encoding: encoding, body: encoding == 'gzip' ? null : jsonDecode(utf8.decode(bytes))));
    final status = encoding == 'gzip' ? 415 : 200;
    final payload = status == 415
        ? {'error': {'code': 'UNSUPPORTED_MEDIA_TYPE', 'message': 'gzip refuse'}}
        : {'applied': [], 'conflicts': [], 'rejected': []};
    return ResponseBody.fromString(jsonEncode(payload), status, headers: {
      Headers.contentTypeHeader: ['application/json'],
    });
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  // Review M3: a 415 on a gzip body must not end in markRejected (lost change).
  test('415 on a gzip body: re-sent once uncompressed, then gzip disabled for the client', () async {
    final api = ApiClient(tokens: TokenStore(), baseUrl: 'https://api.test/v1');
    final adapter = _GzipRefusingAdapter();
    api.dio.httpClientAdapter = adapter;
    final body = {
      'device_id': 'd',
      'changes': [for (var i = 0; i < 50; i++) {'entity': 'daily_logs', 'id': 'l$i', 'op': 'upsert', 'client_rev': 1, 'data': {'mortality': i}}],
    };

    final res = await api.post('/sync/push', body);
    expect(res['applied'], isEmpty);
    expect([for (final r in adapter.requests) r.encoding], ['gzip', null], reason: 'one gzip try, one plain retry');
    expect(adapter.requests.last.body, body, reason: 'the retried body is the original JSON');
    expect(api.gzipEnabled, isFalse);

    await api.post('/sync/push', body);
    expect(adapter.requests, hasLength(3));
    expect(adapter.requests.last.encoding, isNull, reason: 'no more gzip attempts after a 415');
  });

  // Review m6: batches shrink on a slow link or 413, not in airplane mode.
  test('batch shrinking: timeout and 413 yes, plain offline no', () {
    expect(shouldShrinkBatch(ApiException(code: 'NETWORK', message: 't', isTimeout: true)), isTrue);
    expect(shouldShrinkBatch(ApiException(code: 'PAYLOAD_TOO_LARGE', message: 'x', status: 413)), isTrue);
    expect(shouldShrinkBatch(ApiException(code: 'NETWORK', message: 'no route')), isFalse);
    expect(shouldShrinkBatch(ApiException(code: 'SERVER_ERROR', message: 'x', status: 500)), isFalse);
  });

  test('dio timeouts are flagged, connection errors are not', () {
    final o = RequestOptions(path: '/x');
    expect(ApiException.fromDio(DioException(requestOptions: o, type: DioExceptionType.receiveTimeout)).isTimeout, isTrue);
    expect(ApiException.fromDio(DioException(requestOptions: o, type: DioExceptionType.connectionTimeout)).isTimeout, isTrue);
    final offline = ApiException.fromDio(DioException(requestOptions: o, type: DioExceptionType.connectionError));
    expect(offline.isNetwork, isTrue);
    expect(offline.isTimeout, isFalse);
  });
}
