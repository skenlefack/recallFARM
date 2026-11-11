import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:path/path.dart' as p;
import 'package:recallfarm/app.dart';
import 'package:recallfarm/core/api/api_client.dart';
import 'package:recallfarm/core/api/token_store.dart';
import 'package:recallfarm/core/config/app_config.dart';
import 'package:recallfarm/core/data/providers.dart';
import 'package:recallfarm/core/data/repository.dart';
import 'package:recallfarm/core/db/local_db.dart';
import 'package:recallfarm/core/entitlements/entitlements.dart';
import 'package:recallfarm/core/notifications/notification_service.dart';
import 'package:recallfarm/core/params/params_repository.dart';
import 'package:recallfarm/core/session/session.dart';
import 'package:recallfarm/core/sync/connectivity_service.dart';
import 'package:recallfarm/core/sync/sync_engine.dart';
import 'package:sqflite_sqlcipher/sqflite.dart';

/// API under test. Pass `--dart-define=API_BASE_URL=...` :
/// - pile docker locale vue de l'emulateur : http://10.0.2.2:<port>/v1
/// - recette : https://recallfarm.com/v1
String get apiUnderTest => AppConfig.apiBaseUrl;

/// Simulated airplane mode at the exact layer the app sees it: the OS reports
/// "no network" (connectivity_plus) and every socket fails (dio connectionError).
/// [cutAfterSend] simulates the worst case of 2G: the request reached the server
/// (and was applied) but the response never came back.
class NetworkGate extends Interceptor {
  bool offline = false;
  bool cutAfterSend = false;
  int requests = 0;
  int cut = 0;

  DioException _error(RequestOptions o) => DioException(
        requestOptions: o,
        type: DioExceptionType.connectionError,
        message: 'simulated airplane mode',
      );

  /// Logs every call (`IT http ...`) to diagnose a failing journey from logcat.
  bool log = true;

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    requests++;
    options.extra['it_t0'] = DateTime.now().millisecondsSinceEpoch;
    if (offline) {
      if (log) debugPrint('IT http ${options.method} ${options.path} -> OFFLINE');
      return handler.reject(_error(options));
    }
    handler.next(options);
  }

  int _ms(RequestOptions o) => DateTime.now().millisecondsSinceEpoch - ((o.extra['it_t0'] as int?) ?? 0);

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    if (log) {
      debugPrint('IT http ${err.requestOptions.method} ${err.requestOptions.path} -> '
          '${err.response?.statusCode ?? err.type.name} (${_ms(err.requestOptions)} ms) ${err.response?.data ?? ''}');
    }
    handler.next(err);
  }

  @override
  void onResponse(Response<dynamic> response, ResponseInterceptorHandler handler) {
    if (log) {
      debugPrint('IT http ${response.requestOptions.method} ${response.requestOptions.path} -> '
          '${response.statusCode} (${_ms(response.requestOptions)} ms)');
    }
    if (cutAfterSend && response.requestOptions.path.contains('/sync/push')) {
      cut++;
      cutAfterSend = false; // one cut per arming
      return handler.reject(_error(response.requestOptions));
    }
    handler.next(response);
  }
}

/// connectivity_plus double driven by the test.
class FakeConnectivity implements Connectivity {
  final _controller = StreamController<List<ConnectivityResult>>.broadcast();
  List<ConnectivityResult> _current = const [ConnectivityResult.mobile];

  void set(bool online) {
    _current = online ? const [ConnectivityResult.mobile] : const [ConnectivityResult.none];
    _controller.add(_current);
  }

  @override
  Future<List<ConnectivityResult>> checkConnectivity() async => _current;

  @override
  Stream<List<ConnectivityResult>> get onConnectivityChanged => _controller.stream;
}

/// The same object graph as `lib/main.dart`, on a fresh encrypted database so
/// each test starts from E01 whatever ran before on the device.
class TestEnv {
  TestEnv._({
    required this.db,
    required this.tokens,
    required this.session,
    required this.api,
    required this.params,
    required this.entitlements,
    required this.connectivity,
    required this.sync,
    required this.notifications,
    required this.gate,
    required this.fakeConnectivity,
    required this.dbPath,
  });

  final LocalDb db;
  final TokenStore tokens;
  final AppSession session;
  final ApiClient api;
  final ParamsRepository params;
  final EntitlementsService entitlements;
  final ConnectivityService connectivity;
  final SyncEngine sync;
  final NotificationService notifications;
  final NetworkGate gate;
  final FakeConnectivity? fakeConnectivity;
  final String dbPath;

  FarmRepository get repo => FarmRepository(db);

  static Future<TestEnv> create({
    String? name,
    bool fakeNetwork = false,
    bool startSync = true,
    bool keepExistingDb = false,
  }) async {
    await initializeDateFormatting('fr');
    await initializeDateFormatting('en');

    final dbPath = p.join(await getDatabasesPath(), 'it_${name ?? DateTime.now().microsecondsSinceEpoch}.db');
    if (!keepExistingDb) await deleteDatabase(dbPath);
    final db = await LocalDb.open(path: dbPath);
    final tokens = TokenStore();
    if (!keepExistingDb) await tokens.clear();
    final session = AppSession(db, tokens);
    await session.load();
    final entitlements = EntitlementsService(db);
    await entitlements.load();

    final fake = fakeNetwork ? FakeConnectivity() : null;
    final connectivity = ConnectivityService(fake);
    final gate = NetworkGate();
    final api = ApiClient(
      tokens: tokens,
      onServerTime: (t) => unawaited(entitlements.recordServerTime(t)),
    )..language = session.language;
    api.dio.interceptors.insert(0, gate);
    final params = ParamsRepository(db, api);
    await params.ensureBundled();
    final notifications = NotificationService();
    final sync = SyncEngine(
      db: db,
      api: api,
      session: session,
      connectivity: connectivity,
      params: params,
      entitlements: entitlements,
    );
    await connectivity.start();
    if (startSync) await sync.start();
    return TestEnv._(
      db: db,
      tokens: tokens,
      session: session,
      api: api,
      params: params,
      entitlements: entitlements,
      connectivity: connectivity,
      sync: sync,
      notifications: notifications,
      gate: gate,
      fakeConnectivity: fake,
      dbPath: dbPath,
    );
  }

  /// Airplane mode on/off, as seen by the app.
  Future<void> setOnline(bool online) async {
    gate.offline = !online;
    fakeConnectivity?.set(online);
    await Future<void>.delayed(const Duration(milliseconds: 20));
  }

  /// True once [app] was built: the ProviderScope then owns (and disposes) the
  /// ChangeNotifiers (session, connectivity, entitlements, sync).
  bool _appBuilt = false;

  Widget app() {
    _appBuilt = true;
    return _app();
  }

  /// Unmounts the app (ProviderScope disposes its notifiers) before the
  /// database is closed. Call at the end of every UI test.
  Future<void> unmount(WidgetTester tester) async {
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
  }

  Widget _app() => ProviderScope(
        overrides: [
          localDbProvider.overrideWithValue(db),
          tokenStoreProvider.overrideWithValue(tokens),
          apiClientProvider.overrideWithValue(api),
          notificationServiceProvider.overrideWithValue(notifications),
          paramsRepositoryProvider.overrideWithValue(params),
          sessionProvider.overrideWith((ref) => session),
          connectivityProvider.overrideWith((ref) => connectivity),
          entitlementsProvider.overrideWith((ref) => entitlements),
          syncEngineProvider.overrideWith((ref) => sync),
        ],
        child: const RecallFarmApp(),
      );

  /// Signs in through the real OTP endpoints (the test server returns `dev_code`).
  Future<void> signInWithOtp(String phone) async {
    final req = await api.post('/auth/otp/request', {'phone': phone}, true);
    final code = req['dev_code']?.toString();
    expect(code, isNotNull, reason: 'API under test must echo dev_code (OTP_DEV_ECHO=true)');
    final r = await api.post('/auth/otp/verify', {
      'phone': phone,
      'code': code,
      if (session.provisional && session.userId != null) 'provisional_user_id': session.userId,
    }, true);
    final tokensJson = r['tokens'] is Map ? r['tokens'] as Map : r;
    await tokens.save(
      access: (tokensJson['access_token'] ?? tokensJson['access']).toString(),
      refresh: (tokensJson['refresh_token'] ?? tokensJson['refresh'])?.toString(),
    );
    final user = r['user'] is Map ? r['user'] as Map : const {};
    await session.signedIn(userId: (user['id'] ?? session.userId ?? '').toString(), phone: phone);
  }

  /// Runs sync cycles until the outbox is empty (or [maxCycles] is reached).
  Future<int> drain({int maxCycles = 10}) async {
    for (var i = 0; i < maxCycles; i++) {
      await sync.sync(manual: i == 0);
      if (await db.pendingCount() == 0) return i + 1;
      await Future<void>.delayed(const Duration(milliseconds: 300)); // a running sync may finish
    }
    final left = await db.pendingChanges();
    final actions = await db.pendingActions();
    debugPrint('IT drain: still pending ${left.map((e) => '${e.entity}/${e.op} ${e.lastError ?? ''}').toList()} '
        'actions=${actions.map((a) => a.payload['path']).toList()} phase=${sync.phase} error=${sync.lastError} '
        'auth=${session.isAuthenticated} online=${connectivity.osOnline}');
    return -1;
  }

  /// App killed: services stopped, the encrypted database stays on disk.
  Future<void> close() async {
    if (!_appBuilt) {
      sync.dispose(); // no new sync from now on
      connectivity.dispose();
    }
    await sync.idle(); // the in-flight one finishes its database work first
    await db.close();
  }

  /// End of test: the database file is removed.
  Future<void> dispose() async {
    await close();
    await deleteDatabase(dbPath);
  }
}

/// A Cameroon test number unlikely to collide between runs (+237 69x xxx xxx).
String uniqueTestPhone() {
  final n = DateTime.now().millisecondsSinceEpoch % 10000000;
  return '+2376${(90000000 + n).toString().substring(0, 8)}';
}

/// Closes the soft keyboard, scrolls [target] into view and taps it until
/// [until] appears (a tap can be lost while the keyboard resizes the screen).
Future<void> tapUntil(WidgetTester tester, Finder target, Finder until,
    {int attempts = 3, Duration each = const Duration(seconds: 20), String? reason}) async {
  for (var i = 0; i < attempts; i++) {
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pump(const Duration(milliseconds: 600));
    if (until.evaluate().isNotEmpty) return;
    if (target.evaluate().isEmpty) break; // the screen already changed: just wait
    await tester.ensureVisible(target.first);
    await tester.pump(const Duration(milliseconds: 200));
    await tester.tap(target.first);
    final end = DateTime.now().add(each);
    while (DateTime.now().isBefore(end)) {
      await tester.pump(const Duration(milliseconds: 200));
      if (until.evaluate().isNotEmpty) return;
    }
  }
  await pumpUntil(tester, until, timeout: const Duration(seconds: 10), reason: reason);
}

/// Pumps frames until [finder] matches (pumpAndSettle never settles while a
/// network call or a periodic timer is pending).
Future<void> pumpUntil(WidgetTester tester, Finder finder,
    {Duration timeout = const Duration(seconds: 30), String? reason}) async {
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 200));
    if (finder.evaluate().isNotEmpty) return;
  }
  final visible = find
      .byType(RichText)
      .evaluate()
      .map((e) => (e.widget as RichText).text.toPlainText())
      .where((t) => t.trim().isNotEmpty)
      .take(50)
      .join(' | ');
  final spinners = find.byType(CircularProgressIndicator).evaluate().length;
  String? location;
  final scaffolds = find.byType(Scaffold).evaluate();
  if (scaffolds.isNotEmpty) {
    location = GoRouter.maybeOf(scaffolds.last)?.routerDelegate.currentConfiguration.uri.toString();
  }
  fail('Timeout waiting for $finder${reason == null ? '' : ' ($reason)'}\n'
      'Route : $location ; chargements : $spinners\nA l ecran : $visible');
}
