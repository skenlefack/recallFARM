import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/data/models.dart';
import '../../core/data/providers.dart';
import '../../core/i18n/strings.dart';
import '../../core/theme/tokens.dart';
import '../../core/util/dates.dart';
import '../../core/util/format.dart';
import '../../core/widgets/common.dart';
import '../home/home_screen.dart' show ReminderTexts;

/// E20 — health & vaccination: upcoming reminders (coloured) and recent history.
class HealthScreen extends ConsumerWidget {
  const HealthScreen({super.key});

  Color _color(ReminderView r) {
    if (r.status == 'en_retard' || r.priority == 'critique') return RfColors.coral;
    final d = r.daysFromToday();
    if (d <= 1) return RfColors.amber;
    return RfColors.textMuted;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final reminders = ref.watch(remindersProvider);
    final events = ref.watch(healthEventsProvider).valueOrNull ?? const <HealthEvent>[];
    final subjects = ref.watch(subjectsProvider).valueOrNull ?? const <Subject>[];
    final res = ref.watch(resolutionProvider).valueOrNull;
    final lang = context.lang;
    final names = {for (final s in subjects) s.id: s.name};
    String label(String? c) => c == null ? '' : (res?.label(c, lang) ?? c);

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            ScreenHeader(title: context.tr('health'), subtitle: context.tr('health_subtitle')),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(RfSpace.gutter, 8, RfSpace.gutter, 24),
                children: [
                  PillButton(
                    label: context.tr('record_act_cta'),
                    expand: true,
                    onPressed: () => context.push('/health/new'),
                  ),
                  const SizedBox(height: RfSpace.gap),
                  SectionLabel(context.tr('upcoming_reminders')),
                  AsyncBuilder<List<ReminderView>>(
                    value: reminders,
                    builder: (list) {
                      if (list.isEmpty) return EmptyState(message: context.tr('no_reminders'));
                      final texts = res == null ? null : ReminderTexts(res, lang);
                      return Column(
                        children: [
                          for (final r in list.take(30))
                            ChevronRow(
                              leading: Fmt.dayOffset(r.daysFromToday()),
                              leadingColor: _color(r),
                              title: texts?.rowTitle(context, r) ?? r.step,
                              subtitle: '${Fmt.date(r.dueDate, lang)} · ${context.tr('status_${r.status}')}',
                              onTap: () => context.push('/health/reminder/${Uri.encodeComponent(r.key)}'),
                            ),
                        ],
                      );
                    },
                  ),
                  const SizedBox(height: RfSpace.gap),
                  SectionLabel(context.tr('recent_history')),
                  if (events.isEmpty) EmptyState(message: context.tr('no_health_yet')),
                  for (final e in events.take(30))
                    ChevronRow(
                      leading: Fmt.dayOffset(Dates.daysBetween(Dates.today(), e.eventDate)),
                      title: [
                        label(e.eventType),
                        if (e.disease != null) label(e.disease),
                        names[e.subjectId] ?? '',
                      ].where((x) => x.isNotEmpty).join(' · '),
                      subtitle: [
                        Fmt.date(e.eventDate, lang),
                        if (e.product != null) e.product!,
                        if (e.isDirty) context.tr('pending_sync_item'),
                      ].join(' · '),
                      trailing: e.disease == 'rage' ? null : const SizedBox.shrink(),
                      onTap: e.disease == 'rage' ? () => context.push('/health/certificate/${e.id}') : null,
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
