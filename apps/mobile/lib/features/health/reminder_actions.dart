import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/data/models.dart';
import '../../core/data/providers.dart';
import '../../core/util/dates.dart';
import '../../core/util/ids.dart';

/// Reminder actions, all offline-capable:
/// - confirm: records the act locally (the engine closes the step) and, for a
///   server-known reminder, queues `POST /reminders/:id/confirm`;
/// - snooze (≤ +14 d) / cancel: local override + queued call.
class ReminderActions {
  ReminderActions(this.ref);
  final WidgetRef ref;

  static String eventTypeFor(String? disease) => disease == 'vermifugation' ? 'deparasitage' : 'vaccination';

  Future<HealthEvent> confirm(ReminderView r, {Map<String, dynamic> extra = const {}}) async {
    final farmId = ref.read(sessionProvider).farmId!;
    final repo = ref.read(repositoryProvider);
    final db = ref.read(localDbProvider);
    final event = <String, dynamic>{
      'id': Ids.newId(),
      'subject_type': r.subjectType,
      'subject_id': r.subjectId,
      'event_type': eventTypeFor(r.disease),
      if (r.disease != null) 'disease': r.disease,
      'event_date': Dates.today(),
      if (r.kind != 'manuel') 'protocol_step': r.step,
      if (r.route != null) 'dose_route': r.route,
      ...extra,
    };
    final saved = await repo.saveHealthEvent(farmId, event);
    if (r.serverId != null) {
      final payload = Map<String, dynamic>.from(saved.data)
        ..remove('_local')
        ..remove('_dirty')
        ..remove('sync_version')
        ..remove('client_rev');
      await db.queueAction('POST', '/reminders/${r.serverId}/confirm', {'health_event': payload});
      await repo.setReminderOverride(r.key, {'confirmed_on': Dates.today()});
    } else if (r.kind == 'manuel') {
      await repo.setReminderOverride(r.key, {'confirmed_on': Dates.today()});
    }
    return saved;
  }

  Future<void> snooze(ReminderView r, String until) async {
    final repo = ref.read(repositoryProvider);
    final db = ref.read(localDbProvider);
    await repo.setReminderOverride(r.key, {'snoozed_until': until});
    if (r.serverId != null) {
      await db.queueAction('POST', '/reminders/${r.serverId}/snooze', {'until': until});
    }
  }

  Future<void> cancel(ReminderView r, String reason) async {
    final repo = ref.read(repositoryProvider);
    final db = ref.read(localDbProvider);
    await repo.setReminderOverride(r.key, {'cancelled': true, 'reason': reason});
    if (r.serverId != null) {
      await db.queueAction('POST', '/reminders/${r.serverId}/cancel', {'reason': reason});
    }
  }
}
