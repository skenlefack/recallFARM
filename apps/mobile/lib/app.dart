import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'core/data/providers.dart';
import 'core/data/models.dart';
import 'core/i18n/strings.dart';
import 'core/router/app_router.dart';
import 'core/theme/app_theme.dart';
import 'core/util/format.dart';

class RecallFarmApp extends ConsumerStatefulWidget {
  const RecallFarmApp({super.key});

  @override
  ConsumerState<RecallFarmApp> createState() => _RecallFarmAppState();
}

class _RecallFarmAppState extends ConsumerState<RecallFarmApp> {
  final _rootKey = GlobalKey<NavigatorState>(debugLabel: 'root');
  late final GoRouter _router;
  StreamSubscription<String>? _tapSub;
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    final session = ref.read(sessionProvider);
    _router = buildRouter(session, _rootKey);
    _tapSub = ref.read(notificationServiceProvider).taps.listen((route) {
      if (session.farmId != null) _router.push(route);
    });
  }

  @override
  void dispose() {
    _tapSub?.cancel();
    _debounce?.cancel();
    _router.dispose();
    super.dispose();
  }

  /// Reschedules local reminder notifications whenever the merged reminders change.
  void _reschedule(List<ReminderView> reminders, String lang) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(seconds: 2), () {
      final s = S(lang);
      ref.read(notificationServiceProvider).scheduleReminders(
            reminders,
            title: (r, offset) => s.t('notif_title', {
              'disease': r.disease == null ? s.t('reminder') : _label(r.disease!),
              'subject': r.subjectName,
            }),
            body: (r, offset) => s.t(offset < 0 ? 'notif_body_before' : (offset == 0 ? 'notif_body_today' : 'notif_body_late'), {
              'date': Fmt.date(r.dueDate, lang),
              'n': offset.abs(),
            }),
          );
    });
  }

  String _label(String code) {
    final res = ref.read(resolutionProvider).valueOrNull;
    final lang = ref.read(sessionProvider).language;
    return res?.label(code, lang) ?? code;
  }

  @override
  Widget build(BuildContext context) {
    final lang = ref.watch(sessionProvider.select((s) => s.language));
    final hasFarm = ref.watch(sessionProvider.select((s) => s.farmId != null));
    if (hasFarm) {
      ref.listen<AsyncValue<List<ReminderView>>>(remindersProvider, (prev, next) {
        final v = next.valueOrNull;
        if (v != null) _reschedule(v, lang);
      });
    }
    return MaterialApp.router(
      title: 'RecallFarm',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.dark(),
      locale: Locale(lang),
      supportedLocales: const [Locale('fr'), Locale('en')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      routerConfig: _router,
      builder: (context, child) {
        // Accessibility: honour text scaling up to 1.3 (layouts are tested at 360×640).
        final mq = MediaQuery.of(context);
        final scaler = mq.textScaler.clamp(minScaleFactor: 1.0, maxScaleFactor: 1.3);
        return MediaQuery(data: mq.copyWith(textScaler: scaler), child: child ?? const SizedBox.shrink());
      },
    );
  }
}
