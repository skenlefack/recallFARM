import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// JWT pair in the platform keystore (flutter_secure_storage).
class TokenStore {
  TokenStore([FlutterSecureStorage? storage])
      : _storage = storage ??
            const FlutterSecureStorage(aOptions: AndroidOptions(encryptedSharedPreferences: true));

  final FlutterSecureStorage _storage;
  String? _access;
  String? _refresh;
  bool _loaded = false;

  static const _kAccess = 'rf_access_token';
  static const _kRefresh = 'rf_refresh_token';

  Future<void> load() async {
    if (_loaded) return;
    _access = await _storage.read(key: _kAccess);
    _refresh = await _storage.read(key: _kRefresh);
    _loaded = true;
  }

  String? get accessToken => _access;
  String? get refreshToken => _refresh;
  bool get hasSession => _refresh != null;

  Future<void> save({required String access, String? refresh}) async {
    _access = access;
    await _storage.write(key: _kAccess, value: access);
    if (refresh != null) {
      _refresh = refresh;
      await _storage.write(key: _kRefresh, value: refresh);
    }
    _loaded = true;
  }

  Future<void> clear() async {
    _access = null;
    _refresh = null;
    await _storage.delete(key: _kAccess);
    await _storage.delete(key: _kRefresh);
  }
}
