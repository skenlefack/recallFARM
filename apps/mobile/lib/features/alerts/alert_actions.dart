import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/data/providers.dart';
import '../../core/util/dates.dart';

/// Alert actions (E72): online call, queued when offline; the local row is
/// updated optimistically (alerts are pull-only).
class AlertActions {
  AlertActions(this.ref);
  final WidgetRef ref;

  Future<void> _call(Map<String, dynamic> alert, String path, Map<String, dynamic> body, String status,
      Map<String, dynamic> extra) async {
    final api = ref.read(apiClientProvider);
    final db = ref.read(localDbProvider);
    final id = alert['id'].toString();
    try {
      final r = await api.post('/alerts/$id/$path', body);
      final updated = r.isEmpty ? {...alert, 'status': status, ...extra} : {...alert, ...r};
      await db.applyRemote('alerts', updated, syncVersion: (alert['sync_version'] as num?)?.toInt() ?? 0);
    } on ApiException catch (e) {
      if (!e.isNetwork) rethrow;
      await db.queueAction('POST', '/alerts/$id/$path', body);
      await db.applyRemote('alerts', {...alert, 'status': status, ...extra},
          syncVersion: (alert['sync_version'] as num?)?.toInt() ?? 0);
    }
  }

  Future<void> ack(Map<String, dynamic> alert) =>
      _call(alert, 'ack', const {}, 'acquittee', {'acked_at': Dates.nowIso()});

  Future<void> resolve(Map<String, dynamic> alert, String cause, String action) =>
      _call(alert, 'resolve', {'cause': cause, 'action': action}, 'resolue', {'resolved_at': Dates.nowIso()});

  /// Refreshes the local alerts from `GET /alerts?farm_id=` (when online).
  Future<void> refresh() async {
    final farmId = ref.read(sessionProvider).farmId;
    if (farmId == null) return;
    final api = ref.read(apiClientProvider);
    final db = ref.read(localDbProvider);
    final rows = await api.getList('/alerts', query: {'farm_id': farmId});
    for (final r in rows) {
      await db.applyRemote('alerts', {'farm_id': farmId, ...r},
          syncVersion: (r['sync_version'] as num?)?.toInt() ?? 0);
    }
  }
}
