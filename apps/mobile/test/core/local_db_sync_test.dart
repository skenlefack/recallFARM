import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:recallfarm/core/db/local_db.dart';

import 'memory_db.dart';

/// RG-SYN-01 / EF-SYN : merge rules of the local store, on a real LocalDb
/// (SQLite FFI in memory, same SQL as on the phone; review M2).
void main() {
  group('mergeRemote (pure)', () {
    Map<String, Object?> existingRow(Map<String, dynamic> data, {bool dirty = false, List<String>? fields, int rev = 1}) => {
          'id': data['id'],
          'data': jsonEncode(data),
          'dirty': dirty ? 1 : 0,
          'dirty_fields': fields == null ? null : jsonEncode(fields),
          'client_rev': rev,
        };

    test('server row without local copy is taken as is, not dirty', () {
      final v = LocalDb.mergeRemote(RemoteRow('batches', {'id': 'b1', 'name': 'Bande', 'client_rev': 3}, syncVersion: 7), null);
      expect(v['sync_version'], 7);
      expect(v['client_rev'], 3);
      expect(v['dirty'], 0);
      expect(jsonDecode(v['data'] as String)['name'], 'Bande');
    });

    test('unsynced local fields win until pushed; dirty state and client_rev are kept', () {
      final local = existingRow({'id': 'b1', 'name': 'Bande locale', 'status': 'en_cours'},
          dirty: true, fields: ['name'], rev: 5);
      final v = LocalDb.mergeRemote(
          RemoteRow('batches', {'id': 'b1', 'name': 'Bande serveur', 'status': 'termine', 'client_rev': 4}, syncVersion: 9),
          local);
      final data = jsonDecode(v['data'] as String) as Map;
      expect(data['name'], 'Bande locale', reason: 'dirty field');
      expect(data['status'], 'termine', reason: 'clean field follows the server');
      expect(v['dirty'], 1);
      expect(v['client_rev'], 5);
      expect(jsonDecode(v['dirty_fields'] as String), ['name']);
    });

    test('a locally confirmed reminder wins over manque/envoye, not over annule', () {
      final local = existingRow({'id': 'r1', 'status': 'confirme'});
      for (final s in ['manque', 'envoye']) {
        final v = LocalDb.mergeRemote(RemoteRow('reminders', {'id': 'r1', 'status': s}, syncVersion: 2), local);
        expect((jsonDecode(v['data'] as String) as Map)['status'], 'confirme', reason: s);
      }
      final v = LocalDb.mergeRemote(RemoteRow('reminders', {'id': 'r1', 'status': 'annule'}, syncVersion: 2), local);
      expect((jsonDecode(v['data'] as String) as Map)['status'], 'annule');
    });

    test('deletion sets deleted_at', () {
      final v = LocalDb.mergeRemote(RemoteRow('dogs', {'id': 'd1'}, syncVersion: 3, deleted: true), null);
      expect(v['deleted_at'], isNotNull);
    });
  });

  group('applyRemoteAll / markPushedAll (LocalDb)', () {
    late LocalDb db;
    setUp(() async => db = await memoryLocalDb());
    tearDown(() => db.close());

    test('a page of more than 500 ids (bound-variable chunks) is applied in one go', () async {
      final rows = [
        for (var i = 0; i < 1203; i++)
          RemoteRow('daily_logs', {'id': 'l$i', 'farm_id': 'f', 'subject_id': 's', 'log_date': '2026-01-01', 'mortality': i},
              syncVersion: i + 1)
      ];
      await db.applyRemoteAll(rows);
      // a second page touching the same ids reads them back through chunked IN (...)
      await db.applyRemoteAll([for (final r in rows) RemoteRow(r.table, {...r.data, 'mortality': 0}, syncVersion: 5000)]);
      final all = await db.list('daily_logs', includeDeleted: true);
      expect(all, hasLength(1203));
      expect(all.every((l) => l['mortality'] == 0 && l['sync_version'] == 5000), isTrue);
    });

    test('a pulled page keeps unsynced local edits', () async {
      await db.saveLocal('batches', {'id': 'b1', 'farm_id': 'f', 'name': 'Locale'});
      await db.applyRemoteAll([RemoteRow('batches', {'id': 'b1', 'farm_id': 'f', 'name': 'Serveur', 'status': 'termine'}, syncVersion: 4)]);
      final b = (await db.get('batches', 'b1'))!;
      expect(b['name'], 'Locale');
      expect(b['status'], 'termine');
      expect(b['_dirty'], isTrue);
      expect(await db.pendingCount(), 1, reason: 'still to push');
    });

    test('acknowledging several tables at once clears outbox and dirty flags', () async {
      await db.saveLocal('farms', {'id': 'f1', 'name': 'Ferme'});
      await db.saveLocal('batches', {'id': 'b1', 'farm_id': 'f1', 'name': 'Bande'});
      await db.saveLocal('expenses', {'id': 'e1', 'farm_id': 'f1', 'amount': {'amount_minor': 1025, 'currency': 'XAF'}});
      final pending = await db.pendingChanges();
      expect(pending, hasLength(3));
      await db.markPushedAll([for (final e in pending) PushAck(e.entity, e.entityId, e.clientRev, 10)]);
      expect(await db.pendingCount(), 0);
      for (final (t, id) in [('farms', 'f1'), ('batches', 'b1'), ('expenses', 'e1')]) {
        final row = (await db.get(t, id))!;
        expect(row['_dirty'], isFalse, reason: t);
        expect(row['sync_version'], 10, reason: t);
      }
    });

    test('client_rev guard: an edit made during the push stays dirty and queued', () async {
      await db.saveLocal('batches', {'id': 'b1', 'farm_id': 'f', 'name': 'v1'});
      final pushed = (await db.pendingChanges()).single; // client_rev 1 sent
      await db.saveLocal('batches', {'id': 'b1', 'name': 'v2'}); // client_rev 2 while in flight
      await db.markPushedAll([PushAck('batches', 'b1', pushed.clientRev, 11)]);
      final row = (await db.get('batches', 'b1'))!;
      expect(row['_dirty'], isTrue);
      expect(row['name'], 'v2');
      expect(row['sync_version'], 11);
      final left = await db.pendingChanges();
      expect(left.single.clientRev, 2, reason: 'the newer revision is still to push');
    });

    test('server merged data is applied when acknowledging', () async {
      await db.saveLocal('batches', {'id': 'b1', 'farm_id': 'f', 'name': 'v1'});
      final e = (await db.pendingChanges()).single;
      await db.markPushedAll([PushAck('batches', 'b1', e.clientRev, 12, serverData: {'current_count': 480})]);
      final row = (await db.get('batches', 'b1'))!;
      expect(row['current_count'], 480);
      expect(row['name'], 'v1');
    });
  });
}
