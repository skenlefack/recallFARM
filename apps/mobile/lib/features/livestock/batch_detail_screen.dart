import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/data/models.dart';
import '../../core/data/providers.dart';
import '../../core/i18n/strings.dart';
import '../../core/params/expr/expression.dart';
import '../../core/params/resolution.dart';
import '../../core/theme/tokens.dart';
import '../../core/theme/typography.dart';
import '../../core/util/dates.dart';
import '../../core/util/format.dart';
import '../../core/widgets/common.dart';
import '../home/home_screen.dart' show ReminderTexts;

class _BatchDetail {
  _BatchDetail(this.batch, this.logs, this.events);
  final Batch batch;
  final List<Map<String, dynamic>> logs;
  final List<HealthEvent> events;
}

final _batchDetailProvider = FutureProvider.autoDispose.family<_BatchDetail?, String>((ref, id) async {
  ref.watch(dbRevisionProvider);
  final farmId = ref.watch(sessionProvider.select((s) => s.farmId));
  if (farmId == null) return null;
  final repo = ref.read(repositoryProvider);
  final batches = await repo.batches(farmId);
  Batch? batch;
  for (final b in batches) {
    if (b.id == id) batch = b;
  }
  if (batch == null) return null;
  final logs = await repo.dailyLogs(farmId, subjectId: id);
  final events = await repo.healthEvents(farmId, subjectId: id);
  return _BatchDetail(batch, logs, events);
});

/// Active withdrawal period (« délai d'attente ») of a subject, if any.
String? activeWithdrawal(List<HealthEvent> events) {
  final today = Dates.today();
  String? latest;
  for (final e in events) {
    for (final k in const ['withdrawal_meat_until', 'withdrawal_milk_until', 'withdrawal_eggs_until']) {
      final v = e.str(k);
      if (v != null && v.compareTo(today) >= 0 && (latest == null || v.compareTo(latest) > 0)) latest = v;
    }
  }
  return latest;
}

/// E14 — generic batch sheet: identity, pack KPIs, health, journal, actions.
class BatchDetailScreen extends ConsumerWidget {
  const BatchDetailScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final detail = ref.watch(_batchDetailProvider(id));
    final res = ref.watch(resolutionProvider).valueOrNull;
    final reminders = ref.watch(remindersProvider).valueOrNull ?? const <ReminderView>[];
    final lang = context.lang;
    return Scaffold(
      body: SafeArea(
        child: AsyncBuilder<_BatchDetail?>(
          value: detail,
          builder: (d) {
            if (d == null) return EmptyState(message: context.tr('not_found'));
            final b = d.batch;
            String label(String? c) => c == null ? '' : (res?.label(c, lang) ?? c);
            final withdrawal = activeWithdrawal(d.events);
            final mine = reminders.where((r) => r.subjectId == b.id).toList();
            final texts = res == null ? null : ReminderTexts(res, lang);
            return Column(
              children: [
                ScreenHeader(
                  title: context.tr('batch_named', {'name': b.name}),
                  subtitle: [
                    label(b.productionType),
                    if (b.data['attributes'] is Map && (b.attributes['strain'] ?? '').toString().isNotEmpty)
                      b.attributes['strain'].toString(),
                    context.tr('week_n', {'n': b.ageDays() ~/ 7 + 1}),
                  ].where((e) => e.isNotEmpty).join(' · '),
                  trailing: IconButton(
                    tooltip: context.tr('edit'),
                    icon: const Icon(Icons.edit_outlined, color: RfColors.textMuted),
                    onPressed: () => context.push('/livestock/add/batch?id=${b.id}'),
                  ),
                ),
                Expanded(
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(RfSpace.gutter, 8, RfSpace.gutter, 24),
                    children: [
                      if (withdrawal != null) ...[
                        Panel(
                          color: RfColors.amberPanel,
                          borderColor: RfColors.amber,
                          child: Text(
                            context.tr('withdrawal_banner', {'date': Fmt.date(withdrawal, lang)}),
                            style: RfType.body(size: 13, color: RfColors.amberText),
                          ),
                        ),
                        const SizedBox(height: RfSpace.gap),
                      ],
                      _kpiGrid(context, res, b, d.logs, lang),
                      const SizedBox(height: RfSpace.gap),
                      SectionLabel(context.tr('health')),
                      const SizedBox(height: 4),
                      if (mine.isEmpty && d.events.isEmpty)
                        EmptyState(message: context.tr('no_health_yet')),
                      for (final r in mine.take(5))
                        ChevronRow(
                          leading: Fmt.dayOffset(Dates.daysBetween(Dates.today(), r.dueDate)),
                          leadingColor: r.status == 'en_retard' ? RfColors.coral : RfColors.amber,
                          title: texts?.title(context, r) ?? r.step,
                          subtitle: Fmt.date(r.dueDate, lang),
                          onTap: () => context.push('/health/reminder/${Uri.encodeComponent(r.key)}'),
                        ),
                      for (final e in d.events.take(5))
                        ChevronRow(
                          leading: '✓',
                          leadingColor: RfColors.lime,
                          title: '${label(e.eventType)}${e.disease == null ? '' : ' · ${label(e.disease)}'}',
                          subtitle: Fmt.date(e.eventDate, lang),
                          trailing: const SizedBox.shrink(),
                        ),
                      const SizedBox(height: RfSpace.gap),
                      SectionLabel(context.tr('journal')),
                      const SizedBox(height: 4),
                      if (d.logs.isEmpty) EmptyState(message: context.tr('no_journal_yet')),
                      for (final l in d.logs.take(7))
                        ChevronRow(
                          leading: Fmt.dateShort(l['log_date']?.toString(), lang).split('/').take(2).join('/'),
                          title: [
                            if (l['eggs'] != null) context.tr('n_eggs', {'n': Fmt.integer(l['eggs'] as num, lang)}),
                            context.tr('n_dead', {'n': Fmt.integer((l['mortality'] as num?) ?? 0, lang)}),
                            if (l['feed_kg'] != null) '${Fmt.number(l['feed_kg'] as num, lang)} kg',
                          ].join(' · '),
                          onTap: () => context.push('/journal?subject=batch:${b.id}'),
                        ),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(RfSpace.gutter, 8, RfSpace.gutter, 20),
                  child: Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    alignment: WrapAlignment.center,
                    children: [
                      PillButton(
                        label: context.tr('daily_journal'),
                        onPressed: () => context.push('/journal?subject=batch:${b.id}'),
                      ),
                      PillButton(
                        label: context.tr('vaccinate_treat'),
                        kind: PillKind.outline,
                        onPressed: () => context.push('/health/new?subject=batch:${b.id}'),
                      ),
                      PillButton(
                        label: context.tr('sell'),
                        kind: PillKind.outline,
                        onPressed: () => context.push('/sales/new?subject=batch:${b.id}'),
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

  Widget _kpiGrid(BuildContext context, Resolution? res, Batch b, List<Map<String, dynamic>> logs, String lang) {
    final tiles = <Widget>[
      KpiTile(label: context.tr('current_count'), value: Fmt.integer(b.currentCount, lang)),
    ];
    if (res != null) {
      final lastLog = logs.isEmpty ? null : logs.first;
      final ctx = <String, Object?>{
        'now': Dates.today(),
        'subject': b.toContext(),
        'log': lastLog,
      };
      for (final k in res.ofKind('kpi')) {
        final pt = k['production_type'];
        if (pt != null && pt != b.productionType) continue;
        final expr = k['expr']?.toString();
        if (expr == null || expr.contains('rabies')) continue;
        final r = Expressions.evaluate(expr, ctx);
        if (!r.ok || r.value is! num) continue;
        tiles.add(KpiTile(
          label: res.label(k['code'].toString(), lang),
          value: Fmt.number(r.value as num, lang, maxDigits: 2),
          unit: k['unit']?.toString(),
        ));
      }
    }
    return LayoutBuilder(builder: (context, c) {
      final cols = c.maxWidth > 340 ? 2 : 1;
      final w = (c.maxWidth - (cols - 1) * 10) / cols;
      return Wrap(
        spacing: 10,
        runSpacing: 10,
        children: [for (final t in tiles) SizedBox(width: w, child: t)],
      );
    });
  }
}
