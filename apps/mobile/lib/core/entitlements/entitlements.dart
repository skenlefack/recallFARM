import 'package:flutter/foundation.dart';

import '../db/local_db.dart';
import '../params/signature.dart';

/// Offline feature gating (dossier 04 §4.8): the signed `entitlements.token`
/// (JWS Ed25519) is verified locally with the cached platform public key.
class EntitlementState {
  const EntitlementState({
    required this.plan,
    required this.features,
    required this.quotas,
    required this.status,
    required this.verified,
    this.expiresAt,
    this.graceUntil,
  });

  /// decouverte | pro | structure | institution
  final String plan;
  final Set<String> features;
  final Map<String, dynamic> quotas;

  /// active | grace | expired | free
  final String status;
  final bool verified;
  final DateTime? expiresAt;
  final DateTime? graceUntil;

  bool has(String feature) => features.contains('*') || features.contains(feature);

  static const free = EntitlementState(
    plan: 'decouverte',
    features: kFreeFeatures,
    quotas: {'farms': 1, 'cameras': 0, 'sms_per_month': 0},
    status: 'free',
    verified: false,
  );
}

/// Features of the « Découverte » plan (global.core `plan:decouverte`).
const Set<String> kFreeFeatures = {
  'carnet',
  'rappels_locaux',
  'journal',
  'stocks',
  'ventes',
  'marche',
  'export_donnees',
};

class EntitlementsService extends ChangeNotifier {
  EntitlementsService(this._db);

  final LocalDb _db;
  EntitlementState _state = EntitlementState.free;
  Map<String, dynamic>? _raw;
  List<int>? _publicKey;
  DateTime? _lastServerTime;

  static const _kEnt = 'entitlements';
  static const _kKey = 'params.public_key';
  static const _kServerTime = 'last_server_time';

  EntitlementState get state => _state;
  bool has(String feature) => _state.has(feature);
  List<int>? get publicKey => _publicKey;

  Future<void> load() async {
    final key = await _db.getKv(_kKey);
    if (key != null) _publicKey = Ed25519Verifier.b64(key);
    final st = await _db.getKv(_kServerTime);
    if (st != null) _lastServerTime = DateTime.tryParse(st);
    _raw = await _db.getKvJson(_kEnt);
    await _recompute();
  }

  Future<void> setPublicKey(List<int> key) async {
    _publicKey = key;
    await _db.setKv(_kKey, Ed25519Verifier.b64UrlNoPad(key));
    await _recompute();
  }

  /// Records the latest server time seen (HTTP `Date`), for clock tampering detection.
  Future<void> recordServerTime(DateTime t) async {
    if (_lastServerTime != null && !t.isAfter(_lastServerTime!)) return;
    _lastServerTime = t;
    await _db.setKv(_kServerTime, t.toUtc().toIso8601String());
  }

  /// Effective "now": never earlier than the last known server time.
  DateTime effectiveNow() {
    final device = DateTime.now().toUtc();
    final server = _lastServerTime;
    if (server != null && device.isBefore(server)) return server;
    return device;
  }

  /// Stores `entitlements` from `GET /me` or `GET /subscriptions/current`.
  Future<void> update(Map<String, dynamic>? entitlements) async {
    _raw = entitlements;
    await _db.setKvJson(_kEnt, entitlements);
    await _recompute();
  }

  Future<void> clear() async {
    _raw = null;
    await _db.setKv(_kEnt, null);
    _state = EntitlementState.free;
    notifyListeners();
  }

  Future<void> _recompute() async {
    final raw = _raw;
    var next = EntitlementState.free;
    final token = raw?['token'];
    if (raw != null && token is String && _publicKey != null) {
      final payload = await Ed25519Verifier.verifyJws(token, _publicKey!);
      if (payload != null) next = _fromClaims(payload);
    }
    _state = next;
    notifyListeners();
  }

  EntitlementState _fromClaims(Map<String, dynamic> c) {
    DateTime? date(Object? v) {
      if (v is String) return DateTime.tryParse(v)?.toUtc();
      if (v is num) return DateTime.fromMillisecondsSinceEpoch(v.toInt() * 1000, isUtc: true);
      return null;
    }

    final ent = c['entitlements'] is Map ? Map<String, dynamic>.from(c['entitlements'] as Map) : c;
    final plan = (ent['plan'] ?? 'decouverte').toString();
    final features = <String>{
      for (final f in (ent['features'] as List? ?? const [])) f.toString(),
    };
    final expires = date(ent['expires_at'] ?? c['exp']);
    final grace = date(ent['grace_until']);
    final now = effectiveNow();
    String status;
    if (expires == null || now.isBefore(expires)) {
      status = 'active';
    } else if (grace != null && now.isBefore(grace)) {
      status = 'grace';
    } else {
      status = 'expired';
    }
    if (status == 'expired') {
      return EntitlementState(
        plan: 'decouverte',
        features: kFreeFeatures,
        quotas: const {'farms': 1, 'cameras': 0, 'sms_per_month': 0},
        status: 'expired',
        verified: true,
        expiresAt: expires,
        graceUntil: grace,
      );
    }
    return EntitlementState(
      plan: plan,
      features: {...kFreeFeatures, ...features},
      quotas: ent['quotas'] is Map ? Map<String, dynamic>.from(ent['quotas'] as Map) : const {},
      status: status,
      verified: true,
      expiresAt: expires,
      graceUntil: grace,
    );
  }
}
