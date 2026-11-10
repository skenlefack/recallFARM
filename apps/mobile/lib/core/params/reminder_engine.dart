// Pure Dart — no Flutter imports. Contract: packages/params/ENGINES.md §2
import 'expr/evaluator.dart' show formatDate, parseDateLoose;

class ComputedReminder {
  const ComputedReminder({
    required this.step,
    required this.disease,
    required this.dueDate,
    required this.status,
    required this.priority,
    required this.kind,
    this.route,
    this.certificate = false,
  });

  final String step;
  final String? disease;

  /// `YYYY-MM-DD`
  final String dueDate;

  /// `en_retard` | `aujourdhui` | `a_venir`
  final String status;

  /// `haute` | `normale`
  final String priority;

  /// `protocole` | `recurrent` | `manuel`
  final String kind;
  final String? route;
  final bool certificate;

  Map<String, dynamic> toJson() => {
        'step': step,
        'disease': disease,
        'due_date': dueDate,
        'status': status,
        'priority': priority,
        'kind': kind,
      };

  @override
  String toString() => toJson().toString();
}

class HealthEventInput {
  const HealthEventInput({
    required this.eventDate,
    this.protocolStep,
    this.disease,
    this.nextDue,
  });

  factory HealthEventInput.fromJson(Map<String, dynamic> j) => HealthEventInput(
        eventDate: j['event_date'].toString(),
        protocolStep: j['protocol_step']?.toString(),
        disease: j['disease']?.toString(),
        nextDue: j['next_due']?.toString(),
      );

  final String eventDate;
  final String? protocolStep;
  final String? disease;
  final String? nextDue;
}

class NotificationSlot {
  const NotificationSlot({required this.offset, required this.sendDate, required this.channels});
  final int offset;
  final String sendDate;
  final List<String> channels;

  Map<String, dynamic> toJson() => {'offset': offset, 'send_date': sendDate, 'channels': channels};
}

class ReminderEngine {
  ReminderEngine._();

  static const int ignoreAfterDays = 30;

  static DateTime _d(String s) {
    final d = parseDateLoose(s);
    if (d == null) throw FormatException('Invalid date: $s');
    return d;
  }

  static DateTime _add(DateTime d, int days) => DateTime.utc(d.year, d.month, d.day + days);

  static String statusFor(String dueDate, String today) {
    final due = _d(dueDate);
    final t = _d(today);
    if (t.isAfter(due)) return 'en_retard';
    if (t.isAtSameMomentAs(due)) return 'aujourdhui';
    return 'a_venir';
  }

  /// Computes open reminders for one subject.
  ///
  /// [protocol] is a resolved `vaccination_protocol` object; [diseases] maps a
  /// disease code to its resolved `disease` object (for `notifiable`);
  /// [subject] carries `start_date` / `birth_date` and `created_at`.
  static List<ComputedReminder> compute({
    required Map<String, dynamic> protocol,
    required Map<String, Map<String, dynamic>> diseases,
    required Map<String, dynamic> subject,
    required List<HealthEventInput> events,
    required String today,
  }) {
    final out = <ComputedReminder>[];
    final mandatory = protocol['mandatory'] == true;
    String priorityFor(String? disease) {
      final notifiable = disease != null && diseases[disease]?['notifiable'] == true;
      return (notifiable || mandatory) ? 'haute' : 'normale';
    }

    final refKey = (protocol['reference'] ?? 'start_date').toString();
    final refRaw = subject[refKey];
    final doneSteps = <String>{
      for (final e in events)
        if (e.protocolStep != null) e.protocolStep!
    };

    final createdRaw = subject['created_at']?.toString();
    final created = createdRaw != null ? parseDateLoose(createdRaw) : null;
    final ignoreBefore = created != null ? _add(created, -ignoreAfterDays) : null;

    if (refRaw != null) {
      final ref = _d(refRaw.toString());
      final steps = protocol['steps'];
      if (steps is List) {
        for (final s in steps) {
          if (s is! Map) continue;
          final code = s['code']?.toString();
          if (code == null || doneSteps.contains(code)) continue;
          final offset = (s['offset_days'] as num?)?.toInt() ?? 0;
          final due = _add(ref, offset);
          if (ignoreBefore != null && due.isBefore(ignoreBefore)) continue; // `ignore`
          final dueStr = formatDate(due);
          final disease = s['disease']?.toString();
          out.add(ComputedReminder(
            step: code,
            disease: disease,
            dueDate: dueStr,
            status: statusFor(dueStr, today),
            priority: priorityFor(disease),
            kind: 'protocole',
            route: s['route']?.toString(),
            certificate: s['certificate'] == true,
          ));
        }
      }
    }

    // Recurrence: only the next occurrence is materialised.
    final rec = protocol['recurring'];
    if (rec is Map) {
      final afterStep = rec['after_step']?.toString();
      final disease = rec['disease']?.toString();
      final every = (rec['every_days'] as num?)?.toInt();
      if (afterStep != null && every != null && every > 0 && doneSteps.contains(afterStep)) {
        DateTime? last;
        for (final e in events) {
          if (e.protocolStep == afterStep) {
            final d = _d(e.eventDate);
            if (last == null || d.isAfter(last)) last = d;
          }
        }
        if (last != null && disease != null) {
          final recurrentStep = '${disease}_recurrent';
          DateTime latest = last;
          for (final e in events) {
            final sameDisease = e.disease == disease || e.protocolStep == recurrentStep;
            if (!sameDisease) continue;
            final d = _d(e.eventDate);
            if (d.isAfter(latest)) latest = d;
          }
          final dueStr = formatDate(_add(latest, every));
          out.add(ComputedReminder(
            step: recurrentStep,
            disease: disease,
            dueDate: dueStr,
            status: statusFor(dueStr, today),
            priority: priorityFor(disease),
            kind: 'recurrent',
            route: rec['route']?.toString(),
            certificate: rec['certificate'] == true,
          ));
        }
      }
    }

    // Manual reminders: off-protocol act with `next_due`, unless superseded by a later act.
    for (final e in events) {
      if (e.protocolStep != null || e.nextDue == null) continue;
      final at = _d(e.eventDate);
      final superseded = events.any((o) =>
          !identical(o, e) &&
          o.disease != null &&
          o.disease == e.disease &&
          _d(o.eventDate).isAfter(at));
      if (superseded) continue;
      final dueStr = formatDate(_d(e.nextDue!));
      out.add(ComputedReminder(
        step: 'manuel_${e.disease ?? 'acte'}',
        disease: e.disease,
        dueDate: dueStr,
        status: statusFor(dueStr, today),
        priority: priorityFor(e.disease),
        kind: 'manuel',
      ));
    }

    // Stable sort by due date.
    final indexed = [for (var i = 0; i < out.length; i++) MapEntry(i, out[i])];
    indexed.sort((a, b) {
      final c = a.value.dueDate.compareTo(b.value.dueDate);
      return c != 0 ? c : a.key.compareTo(b.key);
    });
    return [for (final e in indexed) e.value];
  }

  /// Notification plan for one open reminder (ENGINES.md §2.6).
  static List<NotificationSlot> notificationPlan({
    required String dueDate,
    required Map<String, dynamic> reminderPlan,
    required Iterable<String> entitlements,
  }) {
    final features = entitlements.toSet();
    final allowAll = features.contains('*');
    final offsets = (reminderPlan['offsets_days'] as List? ?? const [-7, -1, 0, 3])
        .map((e) => (e as num).toInt())
        .toList();
    final channelsByOffset = reminderPlan['channels'];
    final due = _d(dueDate);
    final out = <NotificationSlot>[];
    for (final off in offsets) {
      final raw = channelsByOffset is Map ? channelsByOffset[off.toString()] : null;
      final declared = raw is List ? raw.map((e) => e.toString()).toList() : <String>['app'];
      final channels = <String>[];
      for (final c in declared) {
        if (c == 'sms' && !(allowAll || features.contains('rappels_sms'))) continue;
        if (c == 'whatsapp' && !(allowAll || features.contains('rappels_whatsapp'))) continue;
        if (!channels.contains(c)) channels.add(c);
      }
      if (!channels.contains('app')) channels.insert(0, 'app');
      out.add(NotificationSlot(offset: off, sendDate: formatDate(_add(due, off)), channels: channels));
    }
    return out;
  }
}
