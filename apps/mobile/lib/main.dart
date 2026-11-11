import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'app.dart';
import 'core/api/api_client.dart';
import 'core/api/token_store.dart';
import 'core/data/providers.dart';
import 'core/db/local_db.dart';
import 'core/entitlements/entitlements.dart';
import 'core/notifications/notification_service.dart';
import 'core/params/params_repository.dart';
import 'core/session/session.dart';
import 'core/sync/connectivity_service.dart';
import 'core/sync/sync_engine.dart';
import 'core/theme/typography.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  RfType.registerFontLicenses();
  await initializeDateFormatting('fr');
  await initializeDateFormatting('en');

  final db = await LocalDb.open();
  final tokens = TokenStore();
  final session = AppSession(db, tokens);
  await session.load();

  final entitlements = EntitlementsService(db);
  await entitlements.load();

  final connectivity = ConnectivityService();
  late final SyncEngine sync;
  final api = ApiClient(
    tokens: tokens,
    onServerTime: (t) => unawaited(entitlements.recordServerTime(t)),
    onSessionExpired: () => debugPrint('session expired: OTP needed at next online action'),
  )..language = session.language;

  final params = ParamsRepository(db, api);
  await params.ensureBundled();

  final notifications = NotificationService();
  await notifications.init();

  sync = SyncEngine(
    db: db,
    api: api,
    session: session,
    connectivity: connectivity,
    params: params,
    entitlements: entitlements,
  );
  sync.onAlertPulled = (alert) {
    if (alert['severity'] == 'critique' && alert['status'] == 'ouverte') {
      unawaited(notifications.showCriticalAlert(
        alert['id'].toString(),
        (alert['title'] ?? 'Alerte critique').toString(),
        (alert['message'] ?? alert['rule'] ?? '').toString(),
      ));
    }
  };
  session.addListener(() => api.language = session.language);

  await connectivity.start();
  await sync.start();

  runApp(ProviderScope(
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
  ));
}
