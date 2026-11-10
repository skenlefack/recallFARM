import '../params/reminder_engine.dart';
import '../params/resolution.dart';
import 'models.dart';

/// Merges locally computed reminders (shared engine, works offline) with the
/// server rows (`reminders`, pull only) and local overrides (snooze/cancel).
class ReminderService {
  ReminderService._();

  static const _closedServerStatuses = {'confirme', 'annule', 'clos'};

  /// Resolved vaccination protocol applying to [s] (species + production type).
  static Map<String, dynamic>? protocolFor(Resolution res, Subject s) {
    Map<String, dynamic>? generic;
    for (final p in res.ofKind('vaccination_protocol')) {
      if (p['species'] != s.species) continue;
      final pt = p['production_type'];
      if (pt == null) {
        generic ??= p;
      } else if (pt == s.productionType) {
        return p;
      }
    }
    return generic;
  }

  static Map<String, Map<String, dynamic>> diseases(Resolution res) => {
        for (final d in res.ofKind('disease')) d['code'].toString(): d,
      };

  static List<ReminderView> build({
    required Resolution res,
    required List<Subject> subjects,
    required List<HealthEvent> events,
    required List<Map<String, dynamic>> serverReminders,
    required Map<String, Map<String, dynamic>> overrides,
    required String today,
  }) {
    final dis = diseases(res);
    final bySubject = <String, List<HealthEvent>>{};
    for (final e in events) {
      bySubject.putIfAbsent(e.subjectId, () => []).add(e);
    }
    final subjectsById = {for (final s in subjects) s.id: s};
    final views = <String, ReminderView>{};

    for (final s in subjects) {
      if (s is Batch && !s.isActive) continue;
      final protocol = protocolFor(res, s);
      final evs = bySubject[s.id] ?? const <HealthEvent>[];
      final computed = protocol == null
          ? ReminderEngine.compute(
              protocol: const {'steps': <Map<String, dynamic>>[]},
              diseases: dis,
              subject: s.data,
              events: evs.map((e) => HealthEventInput.fromJson(e.data)).toList(),
              today: today,
            )
          : ReminderEngine.compute(
              protocol: protocol,
              diseases: dis,
              subject: {...s.data, 'created_at': s.createdDate},
              events: evs.map((e) => HealthEventInput.fromJson(e.data)).toList(),
              today: today,
            );
      for (final c in computed) {
        final key = '${s.id}:${c.step}';
        views[key] = ReminderView(
          key: key,
          subjectType: s.subjectType,
          subjectId: s.id,
          subjectName: s.name,
          step: c.step,
          disease: c.disease,
          dueDate: c.dueDate,
          status: c.status,
          priority: c.priority,
          kind: c.kind,
          route: c.route,
          certificate: c.certificate,
          subjectCount: s is Batch ? s.currentCount : null,
          speciesLabel: s.species,
        );
      }
    }

    // Server rows: attach ids, drop closed ones, add server-only open ones.
    for (final r in serverReminders) {
      final subjectId = r['subject_id']?.toString();
      final step = (r['protocol_step'] ?? r['step'] ?? r['source_step'] ?? r['id'])?.toString();
      if (subjectId == null || step == null) continue;
      final key = '$subjectId:$step';
      final status = r['status']?.toString() ?? 'a_venir';
      if (_closedServerStatuses.contains(status)) {
        views.remove(key);
        continue;
      }
      final local = views[key];
      if (local != null) {
        views[key] = _copy(local, serverId: r['id']?.toString());
        continue;
      }
      final due = r['due_date']?.toString();
      if (due == null) continue;
      final s = subjectsById[subjectId];
      views[key] = ReminderView(
        key: key,
        subjectType: r['subject_type']?.toString() ?? s?.subjectType ?? 'batch',
        subjectId: subjectId,
        subjectName: r['subject_ref']?.toString() ?? s?.name ?? '',
        step: step,
        disease: r['disease']?.toString(),
        dueDate: due,
        status: ReminderEngine.statusFor(due, today),
        priority: r['priority']?.toString() ?? 'normale',
        kind: r['source_type']?.toString() ?? 'serveur',
        serverId: r['id']?.toString(),
        subjectCount: s is Batch ? s.currentCount : null,
        speciesLabel: s?.species,
      );
    }

    // Local overrides.
    final out = <ReminderView>[];
    for (final v in views.values) {
      final o = overrides[v.key];
      if (o != null) {
        if (o['cancelled'] == true || o['confirmed_on'] != null) continue;
        final snoozed = o['snoozed_until']?.toString();
        if (snoozed != null && snoozed.compareTo(v.dueDate) > 0) {
          out.add(_copy(v, dueDate: snoozed, status: ReminderEngine.statusFor(snoozed, today)));
          continue;
        }
      }
      out.add(v);
    }
    int rank(ReminderView v) => v.status == 'en_retard' ? 0 : (v.status == 'aujourdhui' ? 1 : 2);
    int prio(ReminderView v) => v.priority == 'critique' ? 0 : (v.priority == 'haute' ? 1 : 2);
    out.sort((a, b) {
      final r = rank(a).compareTo(rank(b));
      if (r != 0) return r;
      final d = a.dueDate.compareTo(b.dueDate);
      if (d != 0) return d;
      return prio(a).compareTo(prio(b));
    });
    return out;
  }

  static ReminderView _copy(ReminderView v, {String? serverId, String? dueDate, String? status}) => ReminderView(
        key: v.key,
        subjectType: v.subjectType,
        subjectId: v.subjectId,
        subjectName: v.subjectName,
        step: v.step,
        disease: v.disease,
        dueDate: dueDate ?? v.dueDate,
        status: status ?? v.status,
        priority: v.priority,
        kind: v.kind,
        serverId: serverId ?? v.serverId,
        route: v.route,
        subjectCount: v.subjectCount,
        speciesLabel: v.speciesLabel,
        certificate: v.certificate,
      );
}
