import '../db/local_db.dart';
import '../util/dates.dart';
import '../util/ids.dart';
import 'models.dart';

/// Offline-first data access. Every write goes to the encrypted local DB and the
/// outbox; the sync engine pushes it later.
class FarmRepository {
  FarmRepository(this.db);
  final LocalDb db;

  // ------------------------------------------------------------------ farms

  Future<List<Farm>> farms() async =>
      (await db.list('farms', orderBy: 'created_at ASC')).map(Farm.new).toList();

  Future<Farm?> farm(String id) async {
    final r = await db.get('farms', id);
    return r == null || r['deleted_at'] != null ? null : Farm(r);
  }

  Future<Farm> saveFarm(Map<String, dynamic> data) async => Farm(await db.saveLocal('farms', data));

  // ------------------------------------------------------------------ subjects

  Future<List<Batch>> batches(String farmId, {bool activeOnly = false}) async {
    final rows = await db.list('batches', farmId: farmId, orderBy: 'date_key DESC');
    final logs = await db.list('daily_logs', farmId: farmId);
    final mortality = <String, int>{};
    final feed = <String, double>{};
    for (final l in logs) {
      final sid = l['subject_id']?.toString();
      if (sid == null) continue;
      mortality[sid] = (mortality[sid] ?? 0) +
          ((l['mortality'] as num?)?.toInt() ?? 0) +
          ((l['culled'] as num?)?.toInt() ?? 0);
      feed[sid] = (feed[sid] ?? 0) + ((l['feed_kg'] as num?)?.toDouble() ?? 0);
    }
    final out = [
      for (final r in rows)
        Batch(r,
            cumulativeMortality: mortality[r['id']] ?? 0,
            cumulativeFeedKg: feed[r['id']] ?? 0)
    ];
    return activeOnly ? out.where((b) => b.isActive).toList() : out;
  }

  Future<List<Dog>> dogs(String farmId) async =>
      (await db.list('dogs', farmId: farmId, orderBy: 'created_at ASC')).map(Dog.new).toList();

  Future<List<Subject>> subjects(String farmId) async =>
      [...await batches(farmId), ...await dogs(farmId)];

  Future<Subject?> subject(String farmId, String type, String id) async {
    final all = type == 'dog' ? await dogs(farmId) : await batches(farmId);
    for (final s in all) {
      if (s.id == id) return s;
    }
    return null;
  }

  Future<Map<String, dynamic>> saveSubject(String type, Map<String, dynamic> payload) =>
      db.saveLocal(type == 'dog' ? 'dogs' : 'batches', payload);

  // ------------------------------------------------------------------ daily logs

  Future<List<Map<String, dynamic>>> dailyLogs(String farmId, {String? subjectId, String? from}) =>
      db.list('daily_logs', farmId: farmId, subjectId: subjectId, dateFrom: from);

  Future<Map<String, dynamic>?> dailyLogFor(String farmId, String subjectId, String date) async {
    final rows = await db.list('daily_logs', farmId: farmId, subjectId: subjectId, dateFrom: date, dateTo: date);
    return rows.isEmpty ? null : rows.first;
  }

  /// RG-JOU-05: a second entry the same day for the same subject updates the first.
  Future<Map<String, dynamic>> saveDailyLog(Map<String, dynamic> payload) async {
    final existing = await dailyLogFor(
      payload['farm_id'].toString(),
      payload['subject_id'].toString(),
      payload['log_date'].toString(),
    );
    final data = {...payload, 'id': existing?['id'] ?? payload['id'] ?? Ids.newId()};
    return db.saveLocal('daily_logs', data);
  }

  // ------------------------------------------------------------------ health

  Future<List<HealthEvent>> healthEvents(String farmId, {String? subjectId}) async {
    final subjectIds = subjectId != null ? {subjectId} : (await subjects(farmId)).map((s) => s.id).toSet();
    final rows = await db.list('health_events', subjectId: subjectId);
    return [
      for (final r in rows)
        if (subjectIds.contains(r['subject_id']?.toString())) HealthEvent(r)
    ];
  }

  /// Stores an act. `farm_id` is kept in the local-only `_local` bag (the API
  /// shape of health events has no farm_id).
  Future<HealthEvent> saveHealthEvent(String farmId, Map<String, dynamic> payload) async {
    final data = {
      ...payload,
      'id': payload['id'] ?? Ids.newId(),
      '_local': {'farm_id': farmId},
    };
    return HealthEvent(await db.saveLocal('health_events', data));
  }

  Future<HealthEvent?> healthEvent(String id) async {
    final r = await db.get('health_events', id);
    return r == null ? null : HealthEvent(r);
  }

  /// Server reminder rows (pull only).
  Future<List<Map<String, dynamic>>> serverReminders(String farmId) =>
      db.list('reminders', farmId: farmId, orderBy: 'date_key ASC');

  static const _kOverrides = 'reminder_overrides';

  Future<Map<String, Map<String, dynamic>>> reminderOverrides() async {
    final j = await db.getKvJson(_kOverrides) ?? {};
    return {
      for (final e in j.entries)
        if (e.value is Map) e.key: Map<String, dynamic>.from(e.value as Map)
    };
  }

  Future<void> setReminderOverride(String key, Map<String, dynamic>? value) async {
    final all = await reminderOverrides();
    if (value == null) {
      all.remove(key);
    } else {
      all[key] = {...?all[key], ...value};
    }
    await db.setKvJson(_kOverrides, all);
  }

  // ------------------------------------------------------------------ tasks

  Future<List<TaskItem>> tasks(String farmId) async =>
      (await db.list('tasks', farmId: farmId, orderBy: 'date_key ASC')).map(TaskItem.new).toList();

  Future<TaskItem> saveTask(Map<String, dynamic> data) async => TaskItem(await db.saveLocal('tasks', data));

  /// Marks a task done; a recurring task spawns its next occurrence locally.
  Future<void> completeTask(TaskItem task) async {
    await db.saveLocal('tasks', {...task.data, 'status': 'fait', 'done_at': Dates.nowIso()});
    final every = _recurrenceDays(task.recurrence);
    if (every != null) {
      await db.saveLocal('tasks', {
        'id': Ids.newId(),
        'farm_id': task.data['farm_id'],
        'title': task.title,
        'category': task.category,
        'subject_type': task.data['subject_type'],
        'subject_id': task.data['subject_id'],
        'due_date': Dates.addDays(task.dueDate, every),
        'recurrence': task.recurrence,
        'status': 'a_faire',
      });
    }
  }

  static int? _recurrenceDays(String? rrule) {
    if (rrule == null || rrule.isEmpty) return null;
    switch (rrule) {
      case 'FREQ=DAILY':
        return 1;
      case 'FREQ=WEEKLY':
        return 7;
      case 'FREQ=MONTHLY':
        return 30;
    }
    final m = RegExp(r'INTERVAL=(\d+)').firstMatch(rrule);
    final interval = m == null ? 1 : int.parse(m.group(1)!);
    if (rrule.contains('DAILY')) return interval;
    if (rrule.contains('WEEKLY')) return 7 * interval;
    return null;
  }

  // ------------------------------------------------------------------ economy

  Future<List<Map<String, dynamic>>> sales(String farmId, {String? from}) =>
      db.list('sales', farmId: farmId, dateFrom: from);
  Future<Map<String, dynamic>> saveSale(Map<String, dynamic> d) => db.saveLocal('sales', d);

  Future<List<Map<String, dynamic>>> expenses(String farmId, {String? from}) =>
      db.list('expenses', farmId: farmId, dateFrom: from);
  Future<Map<String, dynamic>> saveExpense(Map<String, dynamic> d) => db.saveLocal('expenses', d);

  Future<List<Map<String, dynamic>>> stockMovements(String farmId) => db.list('stock_movements', farmId: farmId);
  Future<Map<String, dynamic>> saveStockMovement(Map<String, dynamic> d) => db.saveLocal('stock_movements', d);

  /// Current quantity per stock item (entrée +, sortie −, ajustement = signed delta).
  Future<Map<String, double>> stockSummary(String farmId) async {
    final out = <String, double>{};
    for (final m in await stockMovements(farmId)) {
      final item = (m['item_id'] ?? m['item_code'])?.toString();
      if (item == null) continue;
      final q = (m['quantity'] as num?)?.toDouble() ?? 0;
      final dir = m['direction']?.toString();
      final delta = dir == 'sortie' ? -q : q;
      out[item] = (out[item] ?? 0) + delta;
    }
    return out;
  }

  static int amountMinor(Object? money) {
    if (money is Map) return (money['amount_minor'] as num?)?.toInt() ?? 0;
    if (money is num) return money.toInt();
    return 0;
  }

  /// Sales − expenses over [from]..[to] (minor units).
  Future<int> margin(String farmId, String from, String to) async {
    var total = 0;
    for (final s in await db.list('sales', farmId: farmId, dateFrom: from, dateTo: to)) {
      final explicit = s['amount'];
      if (explicit is Map) {
        total += amountMinor(explicit);
      } else {
        final q = (s['quantity'] as num?)?.toDouble() ?? 0;
        total += (q * amountMinor(s['unit_price'])).round();
      }
    }
    for (final e in await db.list('expenses', farmId: farmId, dateFrom: from, dateTo: to)) {
      total -= amountMinor(e['amount']);
    }
    return total;
  }

  // ------------------------------------------------------------------ alerts

  Future<List<Map<String, dynamic>>> alerts(String farmId) =>
      db.list('alerts', farmId: farmId, orderBy: 'updated_at DESC');

  Future<Map<String, dynamic>?> alert(String id) => db.get('alerts', id);
}
