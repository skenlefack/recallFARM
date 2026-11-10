import 'dart:async';
import 'dart:math';

import 'package:flutter/widgets.dart';

import '../api/api_client.dart';
import '../config/app_config.dart';
import '../db/local_db.dart';
import '../entitlements/entitlements.dart';
import '../params/params_repository.dart';
import '../session/session.dart';
import 'connectivity_service.dart';

enum SyncPhase { idle, syncing, error, offline }

/// Delta sync (dossier 04 §4, 05 §20):
/// 1. push the outbox in batches of 200, parents first, idempotent by (id, client_rev);
/// 2. replay queued REST actions (confirm, snooze, ack…);
/// 3. pull changes since the last `server_version`;
/// 4. refresh the parameter manifest and entitlements.
/// Triggered on connectivity regain, every 15 min in the foreground, and manually.
class SyncEngine extends ChangeNotifier with WidgetsBindingObserver {
  SyncEngine({
    required this.db,
    required this.api,
    required this.session,
    required this.connectivity,
    required this.params,
    required this.entitlements,
  });

  final LocalDb db;
  final ApiClient api;
  final AppSession session;
  final ConnectivityService connectivity;
  final ParamsRepository params;
  final EntitlementsService entitlements;

  /// Called after each successful sync (e.g. reschedule notifications).
  VoidCallback? onSynced;

  /// Called for every pulled alert row (critical alert notification).
  void Function(Map<String, dynamic> alert)? onAlertPulled;

  SyncPhase phase = SyncPhase.idle;
  DateTime? lastSyncAt;
  String? lastError;
  int pending = 0;
  int conflictsMerged = 0;

  Timer? _timer;
  Timer? _retry;
  int _failures = 0;
  bool _running = false;
  bool _disposed = false;
  bool _wasOnline = true;
  StreamSubscription<String>? _dbSub;

  static const _kCursor = 'sync.server_version';
  static const _kLastSync = 'sync.last_at';
  static const _kLastMe = 'sync.last_me_at';
  static const _kLastManifest = 'sync.last_manifest_at';

  Future<void> start() async {
    final last = await db.getKv(_kLastSync);
    if (last != null) lastSyncAt = DateTime.tryParse(last);
    pending = await db.pendingCount();
    _wasOnline = connectivity.online;
    connectivity.addListener(_onConnectivity);
    WidgetsBinding.instance.addObserver(this);
    _dbSub = db.changes.where((t) => t == 'outbox').listen((_) => _refreshPending());
    _startTimer();
    unawaited(sync());
  }

  @override
  void dispose() {
    _disposed = true;
    _timer?.cancel();
    _retry?.cancel();
    _dbSub?.cancel();
    connectivity.removeListener(_onConnectivity);
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  void _startTimer() {
    _timer?.cancel();
    _timer = Timer.periodic(AppConfig.syncPeriod, (_) => unawaited(sync()));
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _startTimer();
      unawaited(sync());
    } else if (state == AppLifecycleState.paused) {
      _timer?.cancel();
    }
  }

  void _onConnectivity() {
    final now = connectivity.osOnline;
    if (now && !_wasOnline) unawaited(sync());
    if (!now) {
      phase = SyncPhase.offline;
      _notify();
    }
    _wasOnline = now;
  }

  Future<void> _refreshPending() async {
    final c = await db.pendingCount();
    if (c != pending) {
      pending = c;
      _notify();
    }
  }

  /// A sync still in flight when the engine is disposed (app closed, account
  /// switched) must neither notify nor schedule a retry.
  void _notify() {
    if (!_disposed) notifyListeners();
  }

  void _scheduleRetry() {
    if (_disposed) return;
    _failures++;
    final seconds = min(15 * 60, 30 * pow(2, _failures - 1).toInt());
    _retry?.cancel();
    _retry = Timer(Duration(seconds: seconds), () => unawaited(sync()));
  }

  /// Runs a full sync cycle. Safe to call concurrently (single flight).
  Future<bool> sync({bool manual = false}) async {
    if (_running) return false;
    if (!session.isAuthenticated) {
      await _refreshPending();
      return false;
    }
    if (!connectivity.osOnline) {
      phase = SyncPhase.offline;
      _notify();
      return false;
    }
    _running = true;
    phase = SyncPhase.syncing;
    _notify();
    try {
      await _push();
      await _replayActions();
      await _pull();
      await _refreshParamsAndEntitlements(force: manual);
      lastSyncAt = DateTime.now();
      await db.setKv(_kLastSync, lastSyncAt!.toUtc().toIso8601String());
      lastError = null;
      phase = SyncPhase.idle;
      _failures = 0;
      _retry?.cancel();
      connectivity.reportSuccess();
      onSynced?.call();
      return true;
    } on ApiException catch (e) {
      lastError = e.isNetwork ? null : '${e.code}: ${e.message}';
      phase = e.isNetwork ? SyncPhase.offline : SyncPhase.error;
      if (e.isNetwork) connectivity.reportFailure();
      _scheduleRetry();
      return false;
    } catch (e) {
      lastError = e.toString();
      phase = SyncPhase.error;
      _scheduleRetry();
      return false;
    } finally {
      _running = false;
      pending = await db.pendingCount();
      _notify();
    }
  }

  // ------------------------------------------------------------------ push

  Future<void> _push() async {
    while (true) {
      final all = await db.pendingChanges();
      if (all.isEmpty) return;
      final chunk = all.take(AppConfig.pushBatchSize).toList();
      final byId = {for (final e in chunk) e.entityId: e};
      final body = {
        'device_id': session.deviceId,
        'changes': [
          for (final e in chunk)
            {
              'entity': e.entity,
              'op': e.op,
              'id': e.entityId,
              'client_rev': e.clientRev,
              'data': e.payload,
            }
        ],
      };
      final res = await api.post('/sync/push', body);
      final handled = <String>{};

      final acks = <PushAck>[];
      for (final a in ApiClient.asList(res['applied'])) {
        final id = a['id']?.toString();
        final entry = byId[id];
        if (id == null || entry == null) continue;
        handled.add(id);
        acks.add(PushAck(entry.entity, id, entry.clientRev, (a['sync_version'] as num?)?.toInt() ?? 0));
      }
      await db.markPushedAll(acks); // one transaction per batch of 200
      for (final c in ApiClient.asList(res['conflicts'])) {
        final id = c['id']?.toString();
        final entry = byId[id];
        if (id == null || entry == null) continue;
        handled.add(id);
        conflictsMerged++;
        final merged = c['merged_data'] is Map
            ? Map<String, dynamic>.from(c['merged_data'] as Map)
            : (c['server_data'] is Map ? Map<String, dynamic>.from(c['server_data'] as Map) : null);
        final version = (merged?['sync_version'] as num?)?.toInt() ?? 0;
        final mergedId = merged?['id']?.toString();
        if (merged != null && mergedId != null && mergedId != id) {
          // e.g. daily_logs (subject, date) merged into an existing server row
          await db.removeLocalRow(entry.entity, id);
          await db.applyRemote(entry.entity, merged, syncVersion: version);
        } else {
          await db.markPushed(entry.entity, id, entry.clientRev, version, serverData: merged);
        }
      }
      for (final r in ApiClient.asList(res['rejected'])) {
        final id = r['id']?.toString();
        final entry = byId[id];
        if (id == null || entry == null) continue;
        handled.add(id);
        await db.markRejected(entry.seq, (r['error'] ?? 'rejected').toString());
      }
      // Anything the server did not mention: count an attempt; stop if no progress.
      final unhandled = chunk.where((e) => !handled.contains(e.entityId)).toList();
      for (final e in unhandled) {
        await db.markAttempt(e.seq, 'not acknowledged');
      }
      if (handled.isEmpty) return;
    }
  }

  // ------------------------------------------------------------------ actions

  Future<void> _replayActions() async {
    for (final a in await db.pendingActions()) {
      final method = (a.payload['method'] ?? 'POST').toString();
      final path = a.payload['path']?.toString();
      if (path == null) {
        await db.removeOutbox(a.seq);
        continue;
      }
      try {
        await api.send(method, path, a.payload['body']);
        await db.removeOutbox(a.seq);
      } on ApiException catch (e) {
        if (e.isNetwork || e.status == null || (e.status ?? 500) >= 500) rethrow;
        if (e.status == 409 || e.status == 404) {
          // already applied / no longer relevant
          await db.removeOutbox(a.seq);
        } else {
          await db.markRejected(a.seq, '${e.code}: ${e.message}');
        }
      }
    }
  }

  // ------------------------------------------------------------------ pull

  Future<void> _pull() async {
    var since = int.tryParse(await db.getKv(_kCursor) ?? '') ?? 0;
    final entities = kSyncedEntities.join(',');
    for (var page = 0; page < 50; page++) {
      final res = await api.get('/sync/pull', query: {
        'since': since,
        'entities': entities,
        'limit': AppConfig.pullLimit,
      });
      final changes = res['changes'] is List ? res['changes'] as List : const [];
      final rows = <RemoteRow>[];
      final alerts = <Map<String, dynamic>>[];
      for (final raw in changes) {
        if (raw is! Map) continue;
        final c = Map<String, dynamic>.from(raw);
        final entity = c['entity']?.toString();
        if (entity == null || !kSyncedEntities.contains(entity)) continue;
        final data = c['data'] is Map ? Map<String, dynamic>.from(c['data'] as Map) : <String, dynamic>{};
        final id = (c['id'] ?? data['id'])?.toString();
        if (id == null) continue;
        data['id'] = id;
        _normaliseMoney(data);
        final Object? version = c['sync_version'] ?? data['sync_version'];
        final deleted = c['op'] == 'delete' || data['deleted_at'] != null;
        rows.add(RemoteRow(entity, data, syncVersion: version is num ? version.toInt() : 0, deleted: deleted));
        if (entity == 'alerts' && !deleted) alerts.add(data);
      }
      await db.applyRemoteAll(rows); // one transaction per page
      alerts.forEach(onAlertPulled ?? (_) {});
      final sv = res['server_version'];
      if (sv is num) since = sv.toInt();
      if (sv is String) since = int.tryParse(sv) ?? since;
      await db.setKv(_kCursor, since.toString());
      if (res['has_more'] != true) break;
    }
  }

  /// The server pulls raw table rows (`unit_price_minor` + `currency`); the app
  /// stores money as `{amount_minor, currency}` maps (`unit_price`). Add the map
  /// form next to each `*_minor` column when it is missing.
  static void _normaliseMoney(Map<String, dynamic> data) {
    final currency = data['currency']?.toString();
    if (currency == null) return;
    for (final key in data.keys.toList()) {
      if (!key.endsWith('_minor') || key == 'amount_minor') continue;
      final base = key.substring(0, key.length - '_minor'.length);
      final v = data[key];
      if (v is num && data[base] is! Map) {
        data[base] = {'amount_minor': v.toInt(), 'currency': currency};
      }
    }
    final total = data['amount_minor'];
    if (total is num && data['amount'] is! Map) {
      data['amount'] = {'amount_minor': total.toInt(), 'currency': currency};
    }
  }

  // ------------------------------------------------------------------ params & entitlements

  Future<void> _refreshParamsAndEntitlements({bool force = false}) async {
    final now = DateTime.now();
    bool due(String? iso, Duration every) {
      if (force || iso == null) return true;
      final t = DateTime.tryParse(iso);
      return t == null || now.difference(t) > every;
    }

    if (entitlements.publicKey == null || due(await db.getKv(_kLastManifest), const Duration(hours: 6))) {
      try {
        final key = await params.fetchPublicKey();
        if (key != null) await entitlements.setPublicKey(key);
      } on ApiException catch (e) {
        if (e.isNetwork) rethrow;
      }
      try {
        await params.pullManifest(farmId: session.farmId, publicKey: entitlements.publicKey);
        await db.setKv(_kLastManifest, now.toUtc().toIso8601String());
      } catch (e) {
        debugPrint('params manifest pull failed: $e');
      }
    }
    if (due(await db.getKv(_kLastMe), const Duration(hours: 6))) {
      final me = await api.get('/me');
      await session.applyMe(me);
      if (me['entitlements'] is Map) {
        await entitlements.update(Map<String, dynamic>.from(me['entitlements'] as Map));
      }
      await db.setKv(_kLastMe, now.toUtc().toIso8601String());
    }
  }
}
