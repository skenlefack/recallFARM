import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/data/models.dart';
import '../../core/data/providers.dart';
import '../../core/params/resolution.dart';
import '../../core/util/dates.dart';

class HomeKpi {
  const HomeKpi({required this.labelKey, required this.value, this.unit, this.trend = const [], this.footer});
  final String labelKey;
  final double? value;
  final String? unit;
  final List<double> trend;
  final String? footer;
}

class HomeData {
  HomeData({
    required this.today,
    required this.upcoming,
    required this.kpi,
    required this.marginMinor,
    required this.marginDeltaPct,
    required this.currencySymbol,
    required this.minorUnit,
    required this.openCriticalAlerts,
  });

  final List<TodoItem> today;
  final List<TodoItem> upcoming;
  final HomeKpi kpi;
  final int marginMinor;
  final double? marginDeltaPct;
  final String currencySymbol;
  final int minorUnit;
  final List<Map<String, dynamic>> openCriticalAlerts;
}

/// Currency symbol from the resolved `currency` objects (never hard-coded).
({String symbol, int minorUnit}) currencyOf(Resolution res, String code) {
  final c = res.get('currency', code);
  return (symbol: (c?['symbol'] ?? code).toString(), minorUnit: (c?['minor_unit'] as num?)?.toInt() ?? 0);
}

/// Home (E10) data computed locally (works offline).
final homeDataProvider = FutureProvider<HomeData>((ref) async {
  ref.watch(dbRevisionProvider);
  final farm = await ref.watch(currentFarmProvider.future);
  final reminders = await ref.watch(remindersProvider.future);
  final tasks = await ref.watch(tasksProvider.future);
  final res = await ref.watch(resolutionProvider.future);
  final repo = ref.read(repositoryProvider);
  final farmId = farm?.id ?? ref.read(sessionProvider).farmId!;
  final today = Dates.today();
  final horizon = Dates.addDays(today, 14);

  final todayItems = <TodoItem>[
    for (final r in reminders)
      if (r.status == 'en_retard' || r.status == 'aujourdhui') TodoItem.reminder(r),
    for (final t in tasks)
      if (!t.isDone && t.status != 'annule' && t.dueDate.compareTo(today) <= 0) TodoItem.task(t),
  ];
  todayItems.sort((a, b) {
    if (a.isHigh != b.isHigh) return a.isHigh ? -1 : 1;
    return a.dueDate.compareTo(b.dueDate);
  });
  final upcoming = <TodoItem>[
    for (final r in reminders)
      if (r.status == 'a_venir' && r.dueDate.compareTo(horizon) <= 0) TodoItem.reminder(r),
    for (final t in tasks)
      if (!t.isDone && t.status != 'annule' && t.dueDate.compareTo(today) > 0 && t.dueDate.compareTo(horizon) <= 0)
        TodoItem.task(t),
  ]..sort((a, b) => a.dueDate.compareTo(b.dueDate));

  // KPI 1 — laying rate (ponte), else 7-day mortality, else dogs with valid rabies.
  final batches = await repo.batches(farmId, activeOnly: true);
  final from = Dates.addDays(today, -6);
  final logs = await repo.dailyLogs(farmId, from: from);
  HomeKpi kpi;
  final ponteIds = batches.where((b) => b.productionType == 'ponte').map((b) => b.id).toSet();
  if (ponteIds.isNotEmpty) {
    final trend = <double>[];
    for (var i = 0; i < 7; i++) {
      final day = Dates.addDays(from, i);
      var eggs = 0.0;
      var present = 0.0;
      for (final l in logs) {
        if (l['log_date'] != day || !ponteIds.contains(l['subject_id'])) continue;
        eggs += (l['eggs'] as num?)?.toDouble() ?? 0;
        present += (l['present_count'] as num?)?.toDouble() ?? 0;
      }
      if (present > 0) trend.add(eggs / present * 100);
    }
    kpi = HomeKpi(labelKey: 'kpi_laying_rate', value: trend.isEmpty ? null : trend.last, unit: '%', trend: trend);
  } else if (batches.isNotEmpty) {
    var dead = 0;
    for (final l in logs) {
      dead += (l['mortality'] as num?)?.toInt() ?? 0;
    }
    final heads = batches.fold<int>(0, (s, b) => s + b.currentCount);
    kpi = HomeKpi(
      labelKey: 'kpi_mortality_7d',
      value: heads == 0 ? null : dead / heads * 100,
      unit: '%',
    );
  } else {
    final dogs = await repo.dogs(farmId);
    final overdueRabies = reminders
        .where((r) => r.subjectType == 'dog' && r.disease == 'rage' && r.status == 'en_retard')
        .map((r) => r.subjectId)
        .toSet();
    kpi = HomeKpi(
      labelKey: 'kpi_dogs_rabies_ok',
      value: (dogs.length - overdueRabies.length).toDouble(),
      unit: '/ ${dogs.length}',
    );
  }

  // KPI 2 — month margin vs previous month (same number of days).
  final monthStart = Dates.monthStart(today);
  final prevStart = Dates.previousMonthStart(today);
  final elapsed = Dates.daysBetween(monthStart, today);
  final prevEnd = Dates.addDays(prevStart, elapsed);
  final margin = await repo.margin(farmId, monthStart, today);
  final prevMargin = await repo.margin(farmId, prevStart, prevEnd);
  final delta = prevMargin == 0 ? null : (margin - prevMargin) / prevMargin.abs() * 100;
  final cur = currencyOf(res, farm?.currency ?? 'XAF');

  final alerts = await repo.alerts(farmId);
  return HomeData(
    today: todayItems,
    upcoming: upcoming.take(4).toList(),
    kpi: kpi,
    marginMinor: margin,
    marginDeltaPct: delta,
    currencySymbol: cur.symbol,
    minorUnit: cur.minorUnit,
    openCriticalAlerts: [
      for (final a in alerts)
        if (a['severity'] == 'critique' && (a['status'] == 'ouverte' || a['status'] == 'escaladee')) a
    ],
  );
});
