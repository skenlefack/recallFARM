import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/data/models.dart';
import '../../core/data/providers.dart';
import '../../core/i18n/strings.dart';
import '../../core/params/resolution.dart';
import '../../core/theme/tokens.dart';
import '../../core/theme/typography.dart';
import '../../core/util/dates.dart';
import '../../core/util/format.dart';
import '../../core/widgets/common.dart';
import '../health/reminder_actions.dart';
import 'home_data.dart';

/// Labels shared by home, health and notifications.
class ReminderTexts {
  ReminderTexts(this.res, this.lang);
  final Resolution res;
  final String lang;

  String label(String? code) => code == null ? '' : res.label(code, lang);

  String subjectDisplay(BuildContext context, ReminderView r) => r.subjectType == 'dog'
      ? context.tr('dog_quoted', {'name': r.subjectName})
      : context.tr('batch_named', {'name': r.subjectName});

  /// « Rappel Newcastle »
  String title(BuildContext context, ReminderView r) =>
      context.tr('reminder_of', {'disease': r.disease == null ? r.step : label(r.disease)});

  /// « Bande B02 · 197 poulets · voie oculaire »
  String subtitle(BuildContext context, ReminderView r) {
    final parts = <String>[subjectDisplay(context, r)];
    if (r.subjectCount != null) {
      parts.add(context.tr(r.speciesLabel == 'volaille' ? 'n_birds' : 'n_heads',
          {'n': Fmt.integer(r.subjectCount, lang)}));
    }
    if (r.route != null) parts.add(label(r.route));
    return parts.join(' · ');
  }

  /// Upcoming row: « Rage · « Rex » » / « Rappel annuel »
  String rowTitle(BuildContext context, ReminderView r) =>
      '${r.disease == null ? r.step : label(r.disease)} · ${subjectDisplay(context, r)}';

  String rowSubtitle(BuildContext context, ReminderView r) {
    if (r.kind == 'recurrent') return context.tr('recurrent_reminder');
    if (r.kind == 'manuel') return context.tr('manual_reminder');
    return context.tr('protocol_step_on', {'date': Fmt.date(r.dueDate, lang)});
  }
}

/// E10 — Accueil, reproduced from MobileAccueil.dc.html.
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  int _index = 0;
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionProvider);
    final farm = ref.watch(currentFarmProvider).valueOrNull;
    final data = ref.watch(homeDataProvider);
    final res = ref.watch(resolutionProvider).valueOrNull;
    final lang = context.lang;

    return RefreshIndicator(
      color: RfColors.lime,
      backgroundColor: RfColors.panel,
      onRefresh: () => ref.read(syncEngineProvider).sync(manual: true),
      child: ListView(
        padding: const EdgeInsets.fromLTRB(RfSpace.gutter, 10, RfSpace.gutter, 24),
        children: [
          // Greeting + farm + connection badge
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      session.name == null || session.name!.isEmpty
                          ? context.tr('hello')
                          : context.tr('hello_name', {'name': session.name!.split(' ').first}),
                      style: RfType.body(size: 13, color: RfColors.textMuted),
                    ),
                    const SizedBox(height: 2),
                    Semantics(
                      header: true,
                      child: Text(
                        farm?.name ?? '',
                        style: RfType.title(size: 25, color: RfColors.text),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              const ConnectionBadge(),
            ],
          ),
          const SizedBox(height: RfSpace.gap),
          AsyncBuilder<HomeData>(
            value: data,
            loading: const SkeletonList(rows: 3),
            builder: (d) {
              final texts = res == null ? null : ReminderTexts(res, lang);
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final a in d.openCriticalAlerts.take(1)) ...[
                    _CriticalAlertStrip(alert: a),
                    const SizedBox(height: RfSpace.gap),
                  ],
                  _todayCard(context, d, texts),
                  const SizedBox(height: RfSpace.gap),
                  if (d.upcoming.isNotEmpty) _upcoming(context, d, texts),
                  if (d.upcoming.isNotEmpty) const SizedBox(height: RfSpace.gap),
                  SectionLabel(context.tr('this_week')),
                  const SizedBox(height: 10),
                  _kpis(context, d, lang),
                  const SizedBox(height: RfSpace.gap),
                  const PendingSyncBanner(),
                ],
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _todayCard(BuildContext context, HomeData d, ReminderTexts? texts) {
    if (d.today.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(color: RfColors.lime, borderRadius: BorderRadius.circular(RfRadii.hero)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(context.tr('todo_today').toUpperCase(),
                style: RfType.mono(size: 11, color: RfColors.bg, letterSpacing: 0.66)),
            const SizedBox(height: 12),
            Text(context.tr('home_empty'), style: RfType.body(size: 15, color: RfColors.bg, height: 1.4)),
            const SizedBox(height: 12),
            PillButton(
              label: context.tr('add_animal'),
              kind: PillKind.dark,
              onPressed: () => context.go('/livestock'),
            ),
          ],
        ),
      );
    }
    final i = _index.clamp(0, d.today.length - 1).toInt();
    final item = d.today[i];
    final r = item.reminder;
    final t = item.task;
    final title = r != null ? (texts?.title(context, r) ?? r.step) : t!.title;
    final subtitle = r != null
        ? (texts?.subtitle(context, r) ?? r.subjectName)
        : (t!.category == null ? context.tr('task') : context.tr('task_cat_${t.category}'));
    final overdueDate = (r != null && r.status == 'en_retard') ? r.dueDate : null;

    return Semantics(
      container: true,
      label: '${context.tr('todo_today')}, ${i + 1} / ${d.today.length}',
      child: Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(color: RfColors.lime, borderRadius: BorderRadius.circular(RfRadii.hero)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(context.tr('todo_today').toUpperCase(),
                      style: RfType.mono(size: 11, color: RfColors.bg, letterSpacing: 0.66)),
                ),
                InkWell(
                  onTap: d.today.length > 1 ? () => setState(() => _index = (i + 1) % d.today.length) : null,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                    child: Text('${i + 1} / ${d.today.length}',
                        style: RfType.mono(size: 11, color: RfColors.bg, letterSpacing: 0.66)),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            GestureDetector(
              onTap: r == null
                  ? () => context.push('/tasks')
                  : () => context.push('/health/reminder/${Uri.encodeComponent(r.key)}'),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: RfType.title(size: 22, color: RfColors.bg)),
                  const SizedBox(height: 4),
                  Text(subtitle, style: RfType.body(size: 14, color: RfColors.bg)),
                  if (overdueDate != null) ...[
                    const SizedBox(height: 4),
                    Text(
                      context.tr('overdue_since', {'date': Fmt.date(overdueDate, context.lang)}),
                      style: RfType.body(size: 12, weight: FontWeight.w600, color: RfColors.bg),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: PillButton(
                    label: context.tr('done'),
                    kind: PillKind.dark,
                    busy: _busy,
                    onPressed: () => _done(item),
                  ),
                ),
                const SizedBox(width: 8),
                PillButton(
                  label: context.tr('postpone'),
                  kind: PillKind.outlineDark,
                  bold: false,
                  onPressed: _busy ? null : () => _postpone(item),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _done(TodoItem item) async {
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    final msg = context.tr('saved_offline_short');
    try {
      final r = item.reminder;
      if (r != null) {
        await ReminderActions(ref).confirm(r);
      } else {
        await ref.read(repositoryProvider).completeTask(item.task!);
      }
      messenger.showSnackBar(SnackBar(content: Text(msg)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _postpone(TodoItem item) async {
    final r = item.reminder;
    final tomorrow = Dates.addDays(Dates.today(), 1);
    if (r != null) {
      await ReminderActions(ref).snooze(r, tomorrow);
    } else {
      final t = item.task!;
      await ref.read(repositoryProvider).saveTask({...t.data, 'due_date': tomorrow});
    }
    if (mounted) setState(() => _index = 0);
  }

  Widget _upcoming(BuildContext context, HomeData d, ReminderTexts? texts) {
    final today = Dates.today();
    return Container(
      decoration: const BoxDecoration(border: Border(top: BorderSide(color: RfColors.lineSoft))),
      child: Column(
        children: [
          for (final item in d.upcoming)
            Builder(builder: (context) {
              final days = Dates.daysBetween(today, item.dueDate);
              final r = item.reminder;
              return ChevronRow(
                leading: Fmt.dayOffset(days),
                leadingColor: days <= 3 ? RfColors.amber : RfColors.textMuted,
                title: r != null ? (texts?.rowTitle(context, r) ?? r.step) : item.task!.title,
                subtitle: r != null ? texts?.rowSubtitle(context, r) : context.tr('task'),
                onTap: () => r != null
                    ? context.push('/health/reminder/${Uri.encodeComponent(r.key)}')
                    : context.push('/tasks'),
              );
            }),
        ],
      ),
    );
  }

  Widget _kpis(BuildContext context, HomeData d, String lang) {
    final k = d.kpi;
    final kpiValue = k.value == null
        ? '—'
        : (k.unit == '%' ? Fmt.dec(k.value, lang, digits: k.value! >= 10 ? 0 : 1) : Fmt.integer(k.value, lang));
    final marginMajor = d.minorUnit == 0 ? d.marginMinor : d.marginMinor / 100;
    final delta = d.marginDeltaPct;
    final footer = delta == null
        ? d.currencySymbol
        : '${d.currencySymbol} · ${context.tr('vs_last_month', {
                'delta': '${delta >= 0 ? '+' : ''}${Fmt.dec(delta, lang, digits: 0)} %',
              })}';
    return LayoutBuilder(builder: (context, c) {
      final narrow = c.maxWidth < 300;
      final tiles = [
        KpiTile(
          label: context.tr(k.labelKey),
          value: kpiValue,
          unit: k.unit,
          child: k.trend.length >= 2 ? Sparkline(values: k.trend) : null,
        ),
        KpiTile(
          label: context.tr('kpi_month_margin'),
          value: Fmt.integer(marginMajor, lang),
          footer: footer,
        ),
      ];
      if (narrow) {
        return Column(children: [tiles[0], const SizedBox(height: 10), tiles[1]]);
      }
      return IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [Expanded(child: tiles[0]), const SizedBox(width: 10), Expanded(child: tiles[1])],
        ),
      );
    });
  }
}

class _CriticalAlertStrip extends StatelessWidget {
  const _CriticalAlertStrip({required this.alert});
  final Map<String, dynamic> alert;

  @override
  Widget build(BuildContext context) {
    return Panel(
      color: RfColors.alertBg,
      borderColor: RfColors.coral,
      onTap: () => context.push('/alerts/${alert['id']}/critical'),
      child: Row(
        children: [
          Container(width: 8, height: 8, decoration: const BoxDecoration(color: RfColors.coral, shape: BoxShape.circle)),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              (alert['title'] ?? context.tr('critical_alert')).toString(),
              style: RfType.body(size: 14, weight: FontWeight.w600, color: RfColors.alertText),
            ),
          ),
          Text(context.tr('open'), style: RfType.body(size: 13, color: RfColors.coral)),
        ],
      ),
    );
  }
}
