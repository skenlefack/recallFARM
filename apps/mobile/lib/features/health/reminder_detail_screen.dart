import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/data/models.dart';
import '../../core/data/providers.dart';
import '../../core/i18n/strings.dart';
import '../../core/params/reminder_engine.dart';
import '../../core/theme/tokens.dart';
import '../../core/theme/typography.dart';
import '../../core/util/dates.dart';
import '../../core/util/format.dart';
import '../../core/widgets/common.dart';
import '../home/home_screen.dart' show ReminderTexts;
import 'reminder_actions.dart';

/// E21 — reminder detail: subject, disease, due date, status, planned channels;
/// actions Confirmer / Reporter (≤ +14 d) / Demander un vétérinaire / Annuler.
class ReminderDetailScreen extends ConsumerWidget {
  const ReminderDetailScreen({super.key, required this.reminderKey});
  final String reminderKey;

  Future<void> _snooze(BuildContext context, WidgetRef ref, ReminderView r) async {
    final today = DateTime.now();
    final actions = ReminderActions(ref);
    final msg = context.tr('postponed');
    final messenger = ScaffoldMessenger.of(context);
    final picked = await showDatePicker(
      context: context,
      initialDate: today.add(const Duration(days: 1)),
      firstDate: today,
      lastDate: today.add(const Duration(days: 14)),
    );
    if (picked == null) return;
    await actions.snooze(r, Dates.ymd(picked));
    messenger.showSnackBar(SnackBar(content: Text(msg)));
  }

  Future<void> _cancel(BuildContext context, WidgetRef ref, ReminderView r) async {
    final actions = ReminderActions(ref);
    final router = GoRouter.of(context);
    final controller = TextEditingController();
    final reason = await showDialog<String>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(c.tr('cancel_reminder')),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: InputDecoration(labelText: '${c.tr('reason')} *'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c), child: Text(c.tr('back'))),
          TextButton(
            onPressed: () {
              final t = controller.text.trim();
              if (t.isNotEmpty) Navigator.pop(c, t);
            },
            child: Text(c.tr('confirm')),
          ),
        ],
      ),
    );
    if (reason == null) return;
    await actions.cancel(r, reason);
    router.pop();
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final reminders = ref.watch(remindersProvider);
    final res = ref.watch(resolutionProvider).valueOrNull;
    final ent = ref.watch(entitlementsProvider);
    final lang = context.lang;
    return Scaffold(
      body: SafeArea(
        child: AsyncBuilder<List<ReminderView>>(
          value: reminders,
          builder: (list) {
            ReminderView? r;
            for (final x in list) {
              if (x.key == reminderKey) r = x;
            }
            if (r == null || res == null) {
              return Column(children: [
                ScreenHeader(title: context.tr('reminder')),
                EmptyState(message: context.tr('reminder_closed')),
              ]);
            }
            final rv = r;
            final texts = ReminderTexts(res, lang);
            final plan = res.ofKind('reminder_plan').isEmpty ? null : res.ofKind('reminder_plan').first;
            final slots = plan == null
                ? const <NotificationSlot>[]
                : ReminderEngine.notificationPlan(
                    dueDate: rv.dueDate, reminderPlan: plan, entitlements: ent.state.features);
            final statusColor = rv.status == 'en_retard'
                ? RfColors.coral
                : (rv.status == 'aujourdhui' ? RfColors.amber : RfColors.cyan);
            return Column(
              children: [
                ScreenHeader(title: texts.title(context, rv), subtitle: texts.subtitle(context, rv)),
                Expanded(
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(RfSpace.gutter, 8, RfSpace.gutter, 24),
                    children: [
                      Panel(
                        radius: RfRadii.hero,
                        padding: const EdgeInsets.all(18),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(context.tr('status_${rv.status}').toUpperCase(),
                                style: RfType.mono(size: 11, color: statusColor, letterSpacing: 0.66)),
                            const SizedBox(height: 8),
                            Text(context.tr('due_on', {'date': Fmt.date(rv.dueDate, lang)}),
                                style: RfType.title(size: 22, color: RfColors.text)),
                            const SizedBox(height: 4),
                            Text(
                              [
                                Fmt.dayOffset(rv.daysFromToday()),
                                context.tr('priority_${rv.priority}'),
                                context.tr('kind_${rv.kind}'),
                              ].join(' · '),
                              style: RfType.body(size: 13, color: RfColors.textMuted),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: RfSpace.gap),
                      SectionLabel(context.tr('planned_sends')),
                      for (final s in slots)
                        ChevronRow(
                          leading: Fmt.dayOffset(-s.offset),
                          title: Fmt.date(s.sendDate, lang),
                          subtitle: s.channels.map((c) => context.tr('channel_$c')).join(', '),
                          trailing: const SizedBox.shrink(),
                        ),
                      if (!ent.has('rappels_sms'))
                        Padding(
                          padding: const EdgeInsets.only(top: 8),
                          child: Text(context.tr('sms_pro_hint'), style: RfType.body(size: 12, color: RfColors.textMuted)),
                        ),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(RfSpace.gutter, 8, RfSpace.gutter, 20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      PillButton(
                        label: context.tr('confirm'),
                        fontSize: 16,
                        padding: const EdgeInsets.all(16),
                        onPressed: () => context.push('/health/new?reminder=${Uri.encodeComponent(rv.key)}'),
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Expanded(
                            child: PillButton(
                              label: context.tr('postpone'),
                              kind: PillKind.outline,
                              bold: false,
                              onPressed: () => _snooze(context, ref, rv),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: PillButton(
                              label: context.tr('ask_vet'),
                              kind: PillKind.outline,
                              bold: false,
                              onPressed: () => showSnack(context, context.tr('v1_feature')),
                            ),
                          ),
                        ],
                      ),
                      TextButton(
                        onPressed: () => _cancel(context, ref, rv),
                        child: Text(context.tr('cancel_reminder'), style: const TextStyle(color: RfColors.coral)),
                      ),
                    ],
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}
