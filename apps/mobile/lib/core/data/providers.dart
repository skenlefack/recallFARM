import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../api/token_store.dart';
import '../db/local_db.dart';
import '../entitlements/entitlements.dart';
import '../notifications/notification_service.dart';
import '../params/params_repository.dart';
import '../params/resolution.dart';
import '../session/session.dart';
import '../sync/connectivity_service.dart';
import '../sync/sync_engine.dart';
import '../util/dates.dart';
import 'models.dart';
import 'reminder_service.dart';
import 'repository.dart';

// ---------------------------------------------------------------------------
// Singletons created in main() and injected with overrides.

final localDbProvider = Provider<LocalDb>((ref) => throw UnimplementedError('override in main'));
final tokenStoreProvider = Provider<TokenStore>((ref) => throw UnimplementedError('override in main'));
final apiClientProvider = Provider<ApiClient>((ref) => throw UnimplementedError('override in main'));
final notificationServiceProvider =
    Provider<NotificationService>((ref) => throw UnimplementedError('override in main'));
final paramsRepositoryProvider =
    Provider<ParamsRepository>((ref) => throw UnimplementedError('override in main'));

final sessionProvider = ChangeNotifierProvider<AppSession>((ref) => throw UnimplementedError('override in main'));
final connectivityProvider =
    ChangeNotifierProvider<ConnectivityService>((ref) => throw UnimplementedError('override in main'));
final entitlementsProvider =
    ChangeNotifierProvider<EntitlementsService>((ref) => throw UnimplementedError('override in main'));
final syncEngineProvider = ChangeNotifierProvider<SyncEngine>((ref) => throw UnimplementedError('override in main'));

final repositoryProvider = Provider<FarmRepository>((ref) => FarmRepository(ref.watch(localDbProvider)));

// ---------------------------------------------------------------------------
// Reactivity: any DB write bumps the revision; data providers watch it.

class DbRevision extends Notifier<int> {
  @override
  int build() {
    final db = ref.watch(localDbProvider);
    final sub = db.changes.listen((_) => state = state + 1);
    ref.onDispose(sub.cancel);
    return 0;
  }
}

final dbRevisionProvider = NotifierProvider<DbRevision, int>(DbRevision.new);

String _requireFarmId(Ref ref) {
  final id = ref.watch(sessionProvider.select((s) => s.farmId));
  if (id == null) throw StateError('no active farm');
  return id;
}

final currentFarmProvider = FutureProvider<Farm?>((ref) async {
  ref.watch(dbRevisionProvider);
  final id = ref.watch(sessionProvider.select((s) => s.farmId));
  if (id == null) return null;
  return ref.read(repositoryProvider).farm(id);
});

/// Resolved parameters for the active farm (falls back to the session speculations
/// while the farm row is being created).
final resolutionProvider = FutureProvider<Resolution>((ref) async {
  ref.watch(dbRevisionProvider.select((v) => v)); // packs table changes too
  final farm = await ref.watch(currentFarmProvider.future);
  final session = ref.read(sessionProvider);
  final params = ref.read(paramsRepositoryProvider);
  return params.resolve(
    country: farm?.country ?? 'CM',
    speculations: farm?.speculations ?? session.speculations,
    organisationId: farm?.organisationId,
  );
});

final subjectsProvider = FutureProvider<List<Subject>>((ref) async {
  ref.watch(dbRevisionProvider);
  return ref.read(repositoryProvider).subjects(_requireFarmId(ref));
});

final batchesProvider = FutureProvider<List<Batch>>((ref) async {
  ref.watch(dbRevisionProvider);
  return ref.read(repositoryProvider).batches(_requireFarmId(ref));
});

final dogsProvider = FutureProvider<List<Dog>>((ref) async {
  ref.watch(dbRevisionProvider);
  return ref.read(repositoryProvider).dogs(_requireFarmId(ref));
});

final healthEventsProvider = FutureProvider<List<HealthEvent>>((ref) async {
  ref.watch(dbRevisionProvider);
  return ref.read(repositoryProvider).healthEvents(_requireFarmId(ref));
});

final tasksProvider = FutureProvider<List<TaskItem>>((ref) async {
  ref.watch(dbRevisionProvider);
  return ref.read(repositoryProvider).tasks(_requireFarmId(ref));
});

/// All open reminders of the farm, merged (engine + server + overrides).
final remindersProvider = FutureProvider<List<ReminderView>>((ref) async {
  ref.watch(dbRevisionProvider);
  final farmId = _requireFarmId(ref);
  final repo = ref.read(repositoryProvider);
  final res = await ref.watch(resolutionProvider.future);
  final subjects = await repo.subjects(farmId);
  final events = await repo.healthEvents(farmId);
  final server = await repo.serverReminders(farmId);
  final overrides = await repo.reminderOverrides();
  return ReminderService.build(
    res: res,
    subjects: subjects,
    events: events,
    serverReminders: server,
    overrides: overrides,
    today: Dates.today(),
  );
});

final alertsProvider = FutureProvider<List<Map<String, dynamic>>>((ref) async {
  ref.watch(dbRevisionProvider);
  return ref.read(repositoryProvider).alerts(_requireFarmId(ref));
});

final pendingSyncProvider = Provider<int>((ref) => ref.watch(syncEngineProvider).pending);
