import 'dart:convert';
import 'dart:io' show gzip;

import 'package:flutter_test/flutter_test.dart';
import 'package:recallfarm/core/api/api_client.dart';
import 'package:recallfarm/core/config/app_config.dart';
import 'package:recallfarm/core/sync/sync_engine.dart';

/// 2G transport (RG-SYN-01, EF-SYN) : measured on the emulator throttled to EDGE,
/// a push of 200 uncompressed changes never finished within the 40 s timeout.
void main() {
  group('gzip of JSON bodies', () {
    test('a push batch is compressed and round-trips exactly', () {
      final body = {
        'device_id': 'd',
        'changes': [
          for (var i = 0; i < 200; i++)
            {
              'entity': 'daily_logs',
              'op': 'upsert',
              'id': '00000000-0000-4000-8000-${i.toString().padLeft(12, '0')}',
              'client_rev': 1,
              'data': {'log_date': '2026-11-10', 'mortality': i % 3, 'feed_kg': 20, 'subject_type': 'batch'},
            }
        ],
      };
      final raw = utf8.encode(jsonEncode(body));
      final zipped = ApiClient.gzipJsonBody(body)!;
      expect(zipped.length, lessThan(raw.length ~/ 5), reason: '${raw.length} -> ${zipped.length} bytes');
      expect(jsonDecode(utf8.decode(gzip.decode(zipped))), body);
    });

    test('small bodies and non-JSON data are sent as is', () {
      expect(ApiClient.gzipJsonBody({'phone': '+237690000001'}), isNull);
      expect(ApiClient.gzipJsonBody(null), isNull);
      expect(ApiClient.gzipJsonBody('x' * 5000), isNull);
      expect(ApiClient.gzipJsonBody(utf8.encode('x' * 5000)), isNull, reason: 'already bytes (retry after 401)');
    });
  });

  group('adaptive push batch size', () {
    test('halves after a network failure, never below 25', () {
      expect(nextPushBatchSize(200, timedOut: true), 100);
      expect(nextPushBatchSize(100, timedOut: true), 50);
      expect(nextPushBatchSize(50, timedOut: true), 25);
      expect(nextPushBatchSize(25, timedOut: true), 25);
    });

    test('pull pages: same rule within their own bounds', () {
      expect(nextPageSize(500, timedOut: true, minimum: 50, maximum: AppConfig.pullLimit), 250);
      expect(nextPageSize(60, timedOut: true, minimum: 50, maximum: AppConfig.pullLimit), 50);
      expect(nextPageSize(400, timedOut: false, minimum: 50, maximum: AppConfig.pullLimit), AppConfig.pullLimit);
    });

    test('grows back after a success, never above the configured size', () {
      expect(nextPushBatchSize(25, timedOut: false), 50);
      expect(nextPushBatchSize(150, timedOut: false), AppConfig.pushBatchSize);
      expect(nextPushBatchSize(AppConfig.pushBatchSize, timedOut: false), AppConfig.pushBatchSize);
    });
  });
}
