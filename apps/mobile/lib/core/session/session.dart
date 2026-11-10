import 'package:flutter/foundation.dart';

import '../api/token_store.dart';
import '../db/local_db.dart';
import '../util/ids.dart';

/// Onboarding stages (E01 → E02 → E03 → E04 → E10).
enum OnboardingStage { speculation, account, consents, farm, ready }

/// Persistent app session: onboarding progress, user, active farm, language.
class AppSession extends ChangeNotifier {
  AppSession(this._db, this._tokens);

  final LocalDb _db;
  final TokenStore _tokens;

  static const _kSession = 'session';

  List<String> speculations = const [];
  String? userId;
  String? phone;
  String? name;

  /// True when the account was created offline (dossier 05 §1 `provisional_user_id`).
  bool provisional = false;
  bool consentsDone = false;
  String? farmId;
  String language = 'fr';
  String deviceId = '';
  List<String> platformRoles = const [];
  List<Map<String, dynamic>> memberships = const [];

  bool get isAuthenticated => _tokens.hasSession && !provisional;

  OnboardingStage get stage {
    if (speculations.isEmpty) return OnboardingStage.speculation;
    if (userId == null) return OnboardingStage.account;
    if (!consentsDone) return OnboardingStage.consents;
    if (farmId == null) return OnboardingStage.farm;
    return OnboardingStage.ready;
  }

  Future<void> load() async {
    await _tokens.load();
    final j = await _db.getKvJson(_kSession);
    if (j != null) {
      speculations = [for (final s in (j['speculations'] as List? ?? const [])) s.toString()];
      userId = j['user_id'] as String?;
      phone = j['phone'] as String?;
      name = j['name'] as String?;
      provisional = j['provisional'] == true;
      consentsDone = j['consents_done'] == true;
      farmId = j['farm_id'] as String?;
      language = (j['language'] as String?) ?? 'fr';
      deviceId = (j['device_id'] as String?) ?? '';
      platformRoles = [for (final r in (j['platform_roles'] as List? ?? const [])) r.toString()];
      memberships = [
        for (final m in (j['memberships'] as List? ?? const []))
          if (m is Map) Map<String, dynamic>.from(m)
      ];
    }
    if (deviceId.isEmpty) {
      deviceId = Ids.newId();
      await _persist();
    }
    notifyListeners();
  }

  Future<void> _persist() => _db.setKvJson(_kSession, {
        'speculations': speculations,
        'user_id': userId,
        'phone': phone,
        'name': name,
        'provisional': provisional,
        'consents_done': consentsDone,
        'farm_id': farmId,
        'language': language,
        'device_id': deviceId,
        'platform_roles': platformRoles,
        'memberships': memberships,
      });

  Future<void> _update(void Function() change) async {
    change();
    await _persist();
    notifyListeners();
  }

  Future<void> setSpeculations(List<String> value) => _update(() => speculations = value);

  /// Online account (after OTP verification).
  Future<void> signedIn({
    required String userId,
    required String phone,
    String? name,
    String? language,
  }) =>
      _update(() {
        this.userId = userId;
        this.phone = phone;
        this.name = name ?? this.name;
        if (language != null) this.language = language;
        provisional = false;
      });

  /// Offline provisional account (attached at the next OTP verification).
  Future<void> createProvisional({required String phone, String? name}) => _update(() {
        userId ??= Ids.newId();
        this.phone = phone;
        this.name = name;
        provisional = true;
      });

  Future<void> applyMe(Map<String, dynamic> me) => _update(() {
        userId = (me['id'] ?? userId)?.toString();
        phone = (me['phone'] ?? phone)?.toString();
        name = (me['name'] as String?) ?? name;
        final lang = me['language'];
        if (lang is String && lang.isNotEmpty) language = lang;
        platformRoles = [for (final r in (me['platform_roles'] as List? ?? const [])) r.toString()];
        memberships = [
          for (final m in (me['memberships'] as List? ?? const []))
            if (m is Map) Map<String, dynamic>.from(m)
        ];
        final farms = me['farms'];
        if (farmId == null && farms is List && farms.isNotEmpty && farms.first is Map) {
          farmId = (farms.first as Map)['id']?.toString();
          if (farmId != null) consentsDone = true;
        }
      });

  Future<void> setConsentsDone() => _update(() => consentsDone = true);
  Future<void> setFarm(String id) => _update(() => farmId = id);
  Future<void> setLanguage(String lang) => _update(() => language = lang);
  Future<void> setName(String value) => _update(() => name = value);

  /// Logout: tokens and local data are wiped (encrypted DB stays, emptied).
  Future<void> signOut() async {
    await _tokens.clear();
    await _db.wipeUserData();
    final keepDevice = deviceId;
    speculations = const [];
    userId = null;
    phone = null;
    name = null;
    provisional = false;
    consentsDone = false;
    farmId = null;
    platformRoles = const [];
    memberships = const [];
    deviceId = keepDevice;
    await _persist();
    notifyListeners();
  }
}
