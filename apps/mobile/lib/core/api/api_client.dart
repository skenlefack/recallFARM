import 'dart:async';
import 'dart:io' show HttpDate;

import 'package:dio/dio.dart';

import '../config/app_config.dart';
import 'token_store.dart';

/// Uniform API error (`{ "error": { code, message, fields?, details? } }`, dossier 05).
class ApiException implements Exception {
  ApiException({
    required this.code,
    required this.message,
    this.status,
    this.fields = const {},
    this.details = const {},
  });

  final String code;
  final String message;
  final int? status;
  final Map<String, dynamic> fields;
  final Map<String, dynamic> details;

  /// No network / timeout: the caller should queue the operation.
  bool get isNetwork => code == 'NETWORK';
  bool get isUnauthenticated => status == 401 || code == 'UNAUTHENTICATED';
  bool get isPlanRequired => code == 'PLAN_REQUIRED';
  bool get isConflict => status == 409 || code == 'CONFLICT';

  @override
  String toString() => 'ApiException($status $code: $message)';

  static ApiException fromDio(DioException e) {
    switch (e.type) {
      case DioExceptionType.connectionError:
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
        return ApiException(code: 'NETWORK', message: e.message ?? 'network');
      default:
        break;
    }
    final res = e.response;
    final body = res?.data;
    if (body is Map && body['error'] is Map) {
      final err = body['error'] as Map;
      return ApiException(
        code: (err['code'] ?? 'SERVER_ERROR').toString(),
        message: (err['message'] ?? '').toString(),
        status: res?.statusCode,
        fields: err['fields'] is Map ? Map<String, dynamic>.from(err['fields'] as Map) : const {},
        details: err['details'] is Map ? Map<String, dynamic>.from(err['details'] as Map) : const {},
      );
    }
    if (res == null) return ApiException(code: 'NETWORK', message: e.message ?? 'network');
    return ApiException(
      code: res.statusCode == 401 ? 'UNAUTHENTICATED' : 'SERVER_ERROR',
      message: e.message ?? 'HTTP ${res.statusCode}',
      status: res.statusCode,
    );
  }
}

/// Dio client with bearer injection and single-flight token refresh.
class ApiClient {
  ApiClient({required this.tokens, String? baseUrl, this.onSessionExpired, this.onServerTime})
      : dio = Dio(BaseOptions(
          baseUrl: baseUrl ?? AppConfig.apiBaseUrl,
          connectTimeout: AppConfig.connectTimeout,
          receiveTimeout: AppConfig.receiveTimeout,
          contentType: 'application/json',
          responseType: ResponseType.json,
        )) {
    dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) {
        final t = tokens.accessToken;
        if (t != null && options.extra['noAuth'] != true) {
          options.headers['Authorization'] = 'Bearer $t';
        }
        options.headers['Accept-Language'] = language;
        handler.next(options);
      },
      onResponse: (response, handler) {
        _captureServerTime(response.headers);
        handler.next(response);
      },
      onError: (err, handler) async {
        final status = err.response?.statusCode;
        final opts = err.requestOptions;
        if (status == 401 && opts.extra['retried'] != true && opts.extra['noAuth'] != true) {
          final ok = await _refresh();
          if (ok) {
            try {
              opts.extra['retried'] = true;
              opts.headers['Authorization'] = 'Bearer ${tokens.accessToken}';
              final r = await dio.fetch<dynamic>(opts);
              handler.resolve(r);
            } on DioException catch (e) {
              handler.next(e);
            }
            return;
          }
          onSessionExpired?.call();
        }
        handler.next(err);
      },
    ));
  }

  final Dio dio;
  final TokenStore tokens;
  final void Function()? onSessionExpired;

  /// Called with the server `Date` header (clock-tampering detection, dossier 04 §4.8).
  final void Function(DateTime serverTime)? onServerTime;
  String language = 'fr';

  Completer<bool>? _refreshing;

  void _captureServerTime(Headers headers) {
    final date = headers.value('date');
    if (date == null || onServerTime == null) return;
    try {
      onServerTime!(HttpDate.parse(date));
    } catch (_) {}
  }

  Future<bool> _refresh() async {
    final existing = _refreshing;
    if (existing != null) return existing.future;
    final completer = Completer<bool>();
    _refreshing = completer;
    try {
      final rt = tokens.refreshToken;
      if (rt == null) {
        completer.complete(false);
      } else {
        final r = await dio.post<dynamic>('/auth/refresh',
            data: {'refresh_token': rt}, options: Options(extra: {'noAuth': true}));
        final body = r.data;
        if (body is Map && body['access_token'] is String) {
          await tokens.save(
            access: body['access_token'] as String,
            refresh: body['refresh_token'] as String?,
          );
          completer.complete(true);
        } else {
          completer.complete(false);
        }
      }
    } catch (_) {
      if (!completer.isCompleted) completer.complete(false);
    } finally {
      _refreshing = null;
    }
    return completer.future;
  }

  Future<T> _wrap<T>(Future<Response<dynamic>> Function() call, T Function(dynamic data) map) async {
    try {
      final r = await call();
      return map(r.data);
    } on DioException catch (e) {
      throw ApiException.fromDio(e);
    }
  }

  static Map<String, dynamic> asMap(dynamic d) =>
      d is Map ? Map<String, dynamic>.from(d) : <String, dynamic>{};

  static List<Map<String, dynamic>> asList(dynamic d) {
    final raw = d is Map && d['data'] is List ? d['data'] as List : (d is List ? d : const []);
    return [for (final e in raw) if (e is Map) Map<String, dynamic>.from(e)];
  }

  Future<Map<String, dynamic>> get(String path, {Map<String, dynamic>? query, bool noAuth = false}) =>
      _wrap(() => dio.get<dynamic>(path, queryParameters: query, options: Options(extra: {'noAuth': noAuth})),
          asMap);

  Future<List<Map<String, dynamic>>> getList(String path, {Map<String, dynamic>? query}) =>
      _wrap(() => dio.get<dynamic>(path, queryParameters: query), asList);

  Future<Map<String, dynamic>> post(String path, [Object? body, bool noAuth = false]) =>
      _wrap(() => dio.post<dynamic>(path, data: body ?? const <String, dynamic>{}, options: Options(extra: {'noAuth': noAuth})),
          asMap);

  Future<Map<String, dynamic>> patch(String path, Object? body) =>
      _wrap(() => dio.patch<dynamic>(path, data: body), asMap);

  Future<Map<String, dynamic>> delete(String path, [Object? body]) =>
      _wrap(() => dio.delete<dynamic>(path, data: body), asMap);

  /// Generic call used by the outbox to replay queued actions.
  Future<Map<String, dynamic>> send(String method, String path, [Object? body]) =>
      _wrap(() => dio.request<dynamic>(path, data: body, options: Options(method: method)), asMap);
}
