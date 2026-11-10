import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../features/alerts/alerts_screen.dart';
import '../../features/alerts/critical_alert_screen.dart';
import '../../features/dogs/dog_profile_screen.dart';
import '../../features/economy/expenses_screen.dart';
import '../../features/economy/sales_screen.dart';
import '../../features/economy/stocks_screen.dart';
import '../../features/farm_live/farm_live_screen.dart';
import '../../features/genealogy/genealogy_screen.dart';
import '../../features/health/certificate_screen.dart';
import '../../features/health/health_event_form_screen.dart';
import '../../features/health/health_screen.dart';
import '../../features/health/reminder_detail_screen.dart';
import '../../features/home/home_screen.dart';
import '../../features/journal/journal_screen.dart';
import '../../features/livestock/batch_detail_screen.dart';
import '../../features/livestock/livestock_screen.dart';
import '../../features/livestock/subject_form_screen.dart';
import '../../features/more/more_screen.dart';
import '../../features/my_data/my_data_screen.dart';
import '../../features/onboarding/account_screen.dart';
import '../../features/onboarding/consents_screen.dart';
import '../../features/onboarding/farm_setup_screen.dart';
import '../../features/onboarding/speculation_screen.dart';
import '../../features/settings/settings_screen.dart';
import '../../features/subscription/subscription_screen.dart';
import '../../features/tasks/tasks_screen.dart';
import '../session/session.dart';
import '../widgets/shell.dart';

const _stagePaths = {
  OnboardingStage.speculation: '/onboarding/speculation',
  OnboardingStage.account: '/onboarding/account',
  OnboardingStage.consents: '/onboarding/consents',
  OnboardingStage.farm: '/onboarding/farm',
};

/// Onboarding/auth guard: the user is sent to the first unfinished onboarding
/// step; earlier steps stay reachable (back navigation), later ones are not.
String? onboardingRedirect(OnboardingStage stage, String location) {
  final inOnboarding = location.startsWith('/onboarding');
  if (stage != OnboardingStage.ready) {
    final target = _stagePaths[stage]!;
    if (inOnboarding) {
      final requested = _stagePaths.entries
          .where((e) => e.value == location)
          .map((e) => e.key)
          .toList();
      if (requested.isNotEmpty && requested.first.index <= stage.index) return null;
    }
    return location == target ? null : target;
  }
  if (inOnboarding || location == '/') return '/home';
  return null;
}

/// Where to go when the session moves from [previous] to [current]: the new
/// step when it is a later one (« Continuer » on E01, OTP verified, consents
/// given, farm saved), null otherwise (back navigation, other changes).
/// Needed because [onboardingRedirect] keeps earlier steps reachable, so a
/// router refresh alone leaves the user on the step he just completed.
String? onboardingAdvanceTarget(OnboardingStage previous, OnboardingStage current) {
  if (current.index <= previous.index) return null;
  return current == OnboardingStage.ready ? '/home' : _stagePaths[current];
}

GoRouter buildRouter(AppSession session, GlobalKey<NavigatorState> rootKey) {
  final shellKey = GlobalKey<NavigatorState>(debugLabel: 'shell');
  String? q(GoRouterState s, String name) => s.uri.queryParameters[name];
  late final GoRouter router;
  var lastStage = session.stage;
  session.addListener(() {
    final target = onboardingAdvanceTarget(lastStage, session.stage);
    lastStage = session.stage;
    if (target == null) return;
    // After the current notification round (the refresh may still be running).
    scheduleMicrotask(() {
      final current = router.routerDelegate.currentConfiguration;
      if (current.isNotEmpty && current.uri.path == target) return;
      router.go(target);
    });
  });

  router = GoRouter(
    navigatorKey: rootKey,
    initialLocation: '/home',
    refreshListenable: session,
    redirect: (context, state) => onboardingRedirect(session.stage, state.matchedLocation),
    routes: [
      GoRoute(path: '/', redirect: (_, __) => '/home'),
      GoRoute(path: '/onboarding/speculation', builder: (_, __) => const SpeculationScreen()),
      GoRoute(path: '/onboarding/account', builder: (_, __) => const AccountScreen()),
      GoRoute(path: '/onboarding/consents', builder: (_, __) => const ConsentsScreen()),
      GoRoute(path: '/onboarding/farm', builder: (_, __) => const FarmSetupScreen()),
      ShellRoute(
        navigatorKey: shellKey,
        builder: (context, state, child) => AppShell(location: state.uri.path, child: child),
        routes: [
          GoRoute(path: '/home', pageBuilder: (_, __) => const NoTransitionPage(child: HomeScreen())),
          GoRoute(path: '/livestock', pageBuilder: (_, __) => const NoTransitionPage(child: LivestockScreen())),
          GoRoute(path: '/farm-live', pageBuilder: (_, __) => const NoTransitionPage(child: FarmLiveScreen())),
          GoRoute(path: '/more', pageBuilder: (_, __) => const NoTransitionPage(child: MoreScreen())),
        ],
      ),
      GoRoute(
        path: '/livestock/add/:type',
        parentNavigatorKey: rootKey,
        builder: (_, s) => SubjectFormScreen(type: s.pathParameters['type'] ?? 'batch', editId: q(s, 'id')),
      ),
      GoRoute(
        path: '/livestock/batch/:id',
        parentNavigatorKey: rootKey,
        builder: (_, s) => BatchDetailScreen(id: s.pathParameters['id']!),
      ),
      GoRoute(
        path: '/livestock/dog/:id',
        parentNavigatorKey: rootKey,
        builder: (_, s) => DogProfileScreen(id: s.pathParameters['id']!),
      ),
      GoRoute(
        path: '/journal',
        parentNavigatorKey: rootKey,
        builder: (_, s) => JournalScreen(subjectRef: q(s, 'subject')),
      ),
      GoRoute(path: '/health', parentNavigatorKey: rootKey, builder: (_, __) => const HealthScreen()),
      GoRoute(
        path: '/health/new',
        parentNavigatorKey: rootKey,
        builder: (_, s) => HealthEventFormScreen(subjectRef: q(s, 'subject'), reminderKey: q(s, 'reminder')),
      ),
      GoRoute(
        path: '/health/reminder/:key',
        parentNavigatorKey: rootKey,
        builder: (_, s) => ReminderDetailScreen(reminderKey: Uri.decodeComponent(s.pathParameters['key']!)),
      ),
      GoRoute(
        path: '/health/certificate/:eventId',
        parentNavigatorKey: rootKey,
        builder: (_, s) => CertificateScreen(eventId: s.pathParameters['eventId']!),
      ),
      GoRoute(path: '/sales', parentNavigatorKey: rootKey, builder: (_, __) => const SalesScreen()),
      GoRoute(
        path: '/sales/new',
        parentNavigatorKey: rootKey,
        builder: (_, s) => SaleFormScreen(subjectRef: q(s, 'subject')),
      ),
      GoRoute(path: '/expenses', parentNavigatorKey: rootKey, builder: (_, __) => const ExpensesScreen()),
      GoRoute(path: '/expenses/new', parentNavigatorKey: rootKey, builder: (_, __) => const ExpenseFormScreen()),
      GoRoute(path: '/stocks', parentNavigatorKey: rootKey, builder: (_, __) => const StocksScreen()),
      GoRoute(
        path: '/stocks/new',
        parentNavigatorKey: rootKey,
        builder: (_, s) => StockMovementFormScreen(itemCode: q(s, 'item')),
      ),
      GoRoute(path: '/tasks', parentNavigatorKey: rootKey, builder: (_, __) => const TasksScreen()),
      GoRoute(path: '/tasks/new', parentNavigatorKey: rootKey, builder: (_, __) => const TaskFormScreen()),
      GoRoute(path: '/alerts', parentNavigatorKey: rootKey, builder: (_, __) => const AlertsScreen()),
      GoRoute(
        path: '/alerts/:id/critical',
        parentNavigatorKey: rootKey,
        builder: (_, s) => CriticalAlertScreen(alertId: s.pathParameters['id']!),
      ),
      GoRoute(
        path: '/genealogy',
        parentNavigatorKey: rootKey,
        builder: (_, s) => GenealogyScreen(sireId: q(s, 'sire'), damId: q(s, 'dam')),
      ),
      GoRoute(path: '/subscription', parentNavigatorKey: rootKey, builder: (_, __) => const SubscriptionScreen()),
      GoRoute(path: '/my-data', parentNavigatorKey: rootKey, builder: (_, __) => const MyDataScreen()),
      GoRoute(path: '/settings', parentNavigatorKey: rootKey, builder: (_, __) => const SettingsScreen()),
    ],
  );
  return router;
}
