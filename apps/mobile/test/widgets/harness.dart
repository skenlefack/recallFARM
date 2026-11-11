// Widget-test harness: in-memory fakes of the socle services (no plugin, no
// network, no SQLCipher). Business logic stays in the real engines/repositories;
// only the I/O edges are faked.
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:recallfarm/core/api/api_client.dart';
import 'package:recallfarm/core/data/providers.dart';
import 'package:recallfarm/core/db/local_db.dart';
import 'package:recallfarm/core/entitlements/entitlements.dart';
import 'package:recallfarm/core/params/resolution.dart';
import 'package:recallfarm/core/session/session.dart';
import 'package:recallfarm/core/sync/connectivity_service.dart';
import 'package:recallfarm/core/sync/sync_engine.dart';
import 'package:recallfarm/core/theme/app_theme.dart';
import 'package:recallfarm/core/theme/typography.dart';

const kFarmId = '11111111-1111-4111-8111-111111111111';
const kUserId = '22222222-2222-4222-8222-222222222222';

/// In-memory LocalDb: tables of JSON rows + kv. Unused methods fail loudly.
class FakeDb implements LocalDb {
  final Map<String, List<Map<String, dynamic>>> tables = {};
  final Map<String, String> kv = {};
  final List<(String, String, Map<String, dynamic>?)> queued = [];
  final StreamController<String> _changes = StreamController<String>.broadcast();

  @override
  Stream<String> get changes => _changes.stream;

  void seed(String table, List<Map<String, dynamic>> rows) => tables[table] = [for (final r in rows) {...r}];

  @override
  Future<String?> getKv(String key) async => kv[key];

  @override
  Future<void> setKv(String key, String? value) async {
    if (value == null) {
      kv.remove(key);
    } else {
      kv[key] = value;
    }
  }

  @override
  Future<Map<String, dynamic>?> getKvJson(String key) async {
    final v = kv[key];
    return v == null ? null : jsonDecode(v) as Map<String, dynamic>;
  }

  @override
  Future<void> setKvJson(String key, Object? value) => setKv(key, value == null ? null : jsonEncode(value));

  @override
  Future<Map<String, dynamic>?> get(String table, String id) async {
    for (final r in tables[table] ?? const <Map<String, dynamic>>[]) {
      if (r['id'] == id) return {...r};
    }
    return null;
  }

  @override
  Future<List<Map<String, dynamic>>> list(
    String table, {
    String? farmId,
    String? subjectId,
    String? dateFrom,
    String? dateTo,
    bool includeDeleted = false,
    String orderBy = 'date_key DESC, updated_at DESC',
    int? limit,
  }) async {
    final out = [
      for (final r in tables[table] ?? const <Map<String, dynamic>>[])
        if ((farmId == null || r['farm_id'] == farmId) &&
            (subjectId == null || r['subject_id'] == subjectId) &&
            (includeDeleted || r['deleted_at'] == null))
          {...r}
    ];
    return limit == null ? out : out.take(limit).toList();
  }

  @override
  Future<Map<String, dynamic>> saveLocal(String table, Map<String, dynamic> input) async {
    final rows = tables.putIfAbsent(table, () => []);
    final id = (input['id'] ?? 'gen-${rows.length}').toString();
    final saved = {...input, 'id': id};
    rows.removeWhere((r) => r['id'] == id);
    rows.add(saved);
    _changes.add(table);
    return saved;
  }

  @override
  Future<void> queueAction(String method, String path, [Map<String, dynamic>? body]) async {
    queued.add((method, path, body));
  }

  @override
  Future<int> pendingCount() async => queued.length;

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('FakeDb.${invocation.memberName} not faked');
}

typedef ApiHandler = FutureOr<Map<String, dynamic>> Function(String method, String path, Object? body);

/// Records every call; [handler] answers or throws ApiException.
class FakeApi implements ApiClient {
  FakeApi(this.handler);
  ApiHandler handler;
  final List<(String, String, Object?)> calls = [];

  int count(String method, String path) => calls.where((c) => c.$1 == method && c.$2 == path).length;

  Future<Map<String, dynamic>> _call(String m, String p, Object? b) async {
    calls.add((m, p, b));
    return await handler(m, p, b);
  }

  @override
  Future<Map<String, dynamic>> get(String path, {Map<String, dynamic>? query, bool noAuth = false}) =>
      _call('GET', path, query);

  @override
  Future<List<Map<String, dynamic>>> getList(String path, {Map<String, dynamic>? query}) async =>
      ApiClient.asList(await _call('GET', path, query));

  @override
  Future<Map<String, dynamic>> post(String path, [Object? body, bool noAuth = false]) => _call('POST', path, body);

  @override
  Future<Map<String, dynamic>> patch(String path, Object? body) => _call('PATCH', path, body);

  @override
  Future<Map<String, dynamic>> delete(String path, [Object? body]) => _call('DELETE', path, body);

  @override
  Future<Map<String, dynamic>> send(String method, String path, [Object? body]) => _call(method, path, body);

  @override
  String language = 'fr';

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('FakeApi.${invocation.memberName} not faked');
}

ApiException offlineError() => ApiException(code: 'NETWORK', message: 'network');

class FakeConnectivity extends ChangeNotifier implements ConnectivityService {
  FakeConnectivity({this.isOnline = true});
  bool isOnline;
  void set(bool v) {
    isOnline = v;
    notifyListeners();
  }

  @override
  bool get online => isOnline;
  @override
  bool get osOnline => isOnline;
  @override
  String get kind => isOnline ? 'wifi' : '';
  @override
  Future<void> start() async {}
  @override
  void reportFailure() {}
  @override
  void reportSuccess() {}
  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError('${invocation.memberName}');
}

class FakeEntitlements extends ChangeNotifier implements EntitlementsService {
  FakeEntitlements([EntitlementState? s]) : _state = s ?? EntitlementState.free;
  final EntitlementState _state;
  final List<Map<String, dynamic>?> updates = [];

  @override
  EntitlementState get state => _state;
  @override
  bool has(String feature) => _state.has(feature);
  @override
  Future<void> update(Map<String, dynamic>? entitlements) async {
    updates.add(entitlements);
    notifyListeners();
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError('${invocation.memberName}');
}

class FakeSession extends ChangeNotifier implements AppSession {
  @override
  List<String> speculations = const ['volaille', 'canin'];
  @override
  String? userId = kUserId;
  @override
  String? phone = '+237690000001';
  @override
  String? name = 'Awa';
  @override
  bool provisional = false;
  @override
  bool consentsDone = true;
  @override
  String? farmId = kFarmId;
  @override
  String language = 'fr';
  @override
  String deviceId = 'dev';
  @override
  List<String> platformRoles = const [];
  @override
  List<Map<String, dynamic>> memberships = const [];
  @override
  bool get isAuthenticated => true;
  @override
  OnboardingStage get stage => OnboardingStage.ready;

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError('${invocation.memberName}');
}

class FakeSync extends ChangeNotifier implements SyncEngine {
  @override
  int pending = 0;
  @override
  SyncPhase phase = SyncPhase.idle;
  @override
  DateTime? lastSyncAt;
  @override
  String? lastError;
  @override
  int conflictsMerged = 0;
  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError('${invocation.memberName}');
}

Resolution loadResolution({String country = 'CM', List<String> speculations = const ['volaille', 'canin']}) {
  final packs = [
    for (final n in const ['global.core', 'filiere.volaille', 'filiere.canin', 'pays.CM'])
      ParamPack.fromJson(jsonDecode(File('assets/packs/$n.json').readAsStringSync()) as Map<String, dynamic>),
  ];
  final selected = Resolver.selectPacks(packs, FarmScope(country: country, speculations: speculations));
  return Resolver.resolve(selected);
}

Map<String, dynamic> farmRow() => {
      'id': kFarmId,
      'name': 'Ferme de test',
      'country': 'CM',
      'currency': 'XAF',
      'speculations': ['volaille', 'canin'],
      'created_at': '2026-01-01T00:00:00Z',
    };

class Rig {
  Rig({FakeDb? db, FakeApi? api, bool online = true, EntitlementState? entitlements})
      : db = db ?? FakeDb(),
        api = api ?? FakeApi((m, p, b) => throw offlineError()),
        connectivity = FakeConnectivity(isOnline: online),
        entitlements = FakeEntitlements(entitlements),
        session = FakeSession(),
        sync = FakeSync() {
    this.db.seed('farms', [farmRow()]);
  }

  final FakeDb db;
  final FakeApi api;
  final FakeConnectivity connectivity;
  final FakeEntitlements entitlements;
  final FakeSession session;
  final FakeSync sync;
  final Resolution resolution = loadResolution();

  List<Override> get overrides => [
        localDbProvider.overrideWithValue(db),
        apiClientProvider.overrideWithValue(api),
        sessionProvider.overrideWith((ref) => session),
        connectivityProvider.overrideWith((ref) => connectivity),
        entitlementsProvider.overrideWith((ref) => entitlements),
        syncEngineProvider.overrideWith((ref) => sync),
        resolutionProvider.overrideWith((ref) async => resolution),
      ];
}

/// Pumps [screen] in a sized surface with the real theme, French locale and
/// the given text scale (default 1.3, the accessibility target).
Future<void> pumpScreen(
  WidgetTester tester,
  Widget screen,
  Rig rig, {
  Size size = const Size(360, 640),
  double textScale = 1.3,
}) async {
  RfType.useBundledFonts = false;
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: rig.overrides,
      child: MaterialApp(
        theme: AppTheme.dark(),
        locale: const Locale('fr'),
        supportedLocales: const [Locale('fr'), Locale('en')],
        localizationsDelegates: GlobalMaterialLocalizations.delegates,
        builder: (context, c) => MediaQuery(
          data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)),
          child: c!,
        ),
        home: Material(color: AppTheme.dark().scaffoldBackgroundColor, child: screen),
      ),
    ),
  );
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 50));
}
