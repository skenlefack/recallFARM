import 'package:flutter_test/flutter_test.dart';
import 'package:recallfarm/core/params/reminder_engine.dart';
import 'package:recallfarm/core/params/resolution.dart';

import 'vectors.dart';

void main() {
  final base = loadBasePacks();
  final res = Resolver.resolve(Resolver.selectPacks(
    base,
    const FarmScope(country: 'CM', speculations: ['volaille', 'chien']),
  ));
  final diseases = <String, Map<String, dynamic>>{
    for (final d in res.ofKind('disease')) d['code'].toString(): d,
  };
  final vectors = loadJson('vectors/reminders.json');
  final cases = (vectors['cases'] as List).cast<Map<String, dynamic>>();

  group('reminders.json (shared vectors)', () {
    for (final c in cases) {
      test(c['name'] as String, () {
        final protocol = res.get('vaccination_protocol', c['protocol'] as String);
        expect(protocol, isNotNull);
        final out = ReminderEngine.compute(
          protocol: protocol!,
          diseases: diseases,
          subject: Map<String, dynamic>.from(c['subject'] as Map),
          events: [
            for (final e in (c['events'] as List))
              HealthEventInput.fromJson(Map<String, dynamic>.from(e as Map)),
          ],
          today: c['today'] as String,
        );
        expect(
          out.map((r) => r.toJson()).toList(),
          (c['expected'] as List).map((x) => Map<String, dynamic>.from(x as Map)).toList(),
        );
      });
    }
  });

  group('notification plan', () {
    final plan = vectors['notification_plan'] as Map<String, dynamic>;
    final reminderPlan = res.get('reminder_plan', 'plan_rappels_cm')!;
    test('with rappels_sms', () {
      final slots = ReminderEngine.notificationPlan(
        dueDate: plan['reminder_due_date'] as String,
        reminderPlan: reminderPlan,
        entitlements: (plan['entitlements'] as List).cast<String>(),
      );
      expect(slots.map((s) => s.toJson()).toList(),
          (plan['expected'] as List).map((x) => Map<String, dynamic>.from(x as Map)).toList());
    });
    test('without sms entitlement', () {
      final slots = ReminderEngine.notificationPlan(
        dueDate: plan['reminder_due_date'] as String,
        reminderPlan: reminderPlan,
        entitlements: const <String>[],
      );
      expect(slots.map((s) => s.toJson()).toList(),
          (plan['expected_without_sms'] as List).map((x) => Map<String, dynamic>.from(x as Map)).toList());
    });
  });

  test('manual reminder from an off-protocol act with next_due', () {
    final out = ReminderEngine.compute(
      protocol: const {'reference': 'birth_date', 'steps': <Map<String, dynamic>>[]},
      diseases: diseases,
      subject: const {'birth_date': '2024-01-01', 'created_at': '2024-01-02'},
      events: const [
        HealthEventInput(eventDate: '2026-10-01', disease: 'vermifugation', nextDue: '2027-01-01'),
      ],
      today: '2026-10-27',
    );
    expect(out.single.kind, 'manuel');
    expect(out.single.dueDate, '2027-01-01');
    expect(out.single.status, 'a_venir');
  });
}
