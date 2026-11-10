import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';

/// Network reachability as seen by the OS (connectivity_plus ^6: list of results).
/// A failing request can also flag the app offline via [reportFailure].
class ConnectivityService extends ChangeNotifier {
  ConnectivityService([Connectivity? connectivity]) : _connectivity = connectivity ?? Connectivity();

  final Connectivity _connectivity;
  StreamSubscription<List<ConnectivityResult>>? _sub;
  bool _osOnline = true;
  bool _apiReachable = true;
  String _kind = '';

  bool get online => _osOnline && _apiReachable;

  /// OS reports a network (the API may still be unreachable).
  bool get osOnline => _osOnline;

  /// `wifi` | `mobile` | `ethernet` | ... (display only)
  String get kind => _kind;

  Future<void> start() async {
    try {
      _apply(await _connectivity.checkConnectivity());
    } catch (_) {
      // plugin unavailable (tests): assume online
    }
    _sub = _connectivity.onConnectivityChanged.listen(_apply, onError: (_) {});
  }

  void _apply(List<ConnectivityResult> results) {
    final wasOnline = online;
    _osOnline = results.any((r) => r != ConnectivityResult.none);
    _kind = results.isEmpty ? '' : results.first.name;
    if (_osOnline) _apiReachable = true; // give the API another chance on change
    if (wasOnline != online) notifyListeners();
  }

  void reportFailure() {
    if (!_apiReachable) return;
    _apiReachable = false;
    notifyListeners();
  }

  void reportSuccess() {
    if (_apiReachable) return;
    _apiReachable = true;
    notifyListeners();
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }
}
