import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart' show visibleForTesting;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path/path.dart' as p;
import 'package:sqflite_sqlcipher/sqflite.dart';

import '../util/dates.dart';
import '../util/ids.dart';

/// Synced entities of the MVP (MVP-SCOPE §4 « Synchronisation »), in dependency
/// order: parents before children (dossier 03 §11). Push sorts by this rank.
const List<String> kSyncedEntities = [
  'farms',
  'batches',
  'dogs',
  'daily_logs',
  'health_events',
  'tasks',
  'stock_movements',
  'sales',
  'expenses',
  'reminders', // pull only
  'alerts', // pull only
];

const Set<String> kPullOnlyEntities = {'reminders', 'alerts'};

/// Derived aggregates are never pushed (RG-SYN-01 / RG-MDD-02).
const Map<String, Set<String>> kDerivedFields = {
  'batches': {'current_count'},
  'dogs': {'rabies_status', 'rabies_valid_until', 'inbreeding_coef', 'inbreeding_complete'},
  'sales': {'amount', 'amount_minor'},
};

/// Local-only bookkeeping keys never sent to the server.
const Set<String> kLocalOnlyFields = {'_local'};

int entityRank(String entity) {
  final i = kSyncedEntities.indexOf(entity);
  return i < 0 ? 999 : i;
}

/// A server row to apply locally (pull).
class RemoteRow {
  RemoteRow(this.table, this.data, {required this.syncVersion, this.deleted = false});
  final String table;
  final Map<String, dynamic> data;
  final int syncVersion;
  final bool deleted;
}

/// Server acknowledgement of a pushed change.
class PushAck {
  PushAck(this.entity, this.id, this.pushedRev, this.syncVersion, {this.serverData});
  final String entity;
  final String id;
  final int pushedRev;
  final int syncVersion;
  final Map<String, dynamic>? serverData;
}

class OutboxEntry {
  OutboxEntry({
    required this.seq,
    required this.entity,
    required this.entityId,
    required this.op,
    required this.clientRev,
    required this.payload,
    required this.attempts,
    required this.status,
    this.lastError,
  });

  factory OutboxEntry.fromRow(Map<String, Object?> r) => OutboxEntry(
        seq: r['seq'] as int,
        entity: r['entity'] as String,
        entityId: r['entity_id'] as String,
        op: r['op'] as String,
        clientRev: r['client_rev'] as int,
        payload: r['payload'] == null
            ? const {}
            : Map<String, dynamic>.from(jsonDecode(r['payload'] as String) as Map),
        attempts: r['attempts'] as int,
        status: r['status'] as String,
        lastError: r['last_error'] as String?,
      );

  final int seq;

  /// Entity table name, or `_action` for a queued REST call.
  final String entity;
  final String entityId;

  /// `upsert` | `delete` | `call`
  final String op;
  final int clientRev;
  final Map<String, dynamic> payload;
  final int attempts;

  /// `pending` | `rejected`
  final String status;
  final String? lastError;
}

/// Encrypted SQLite store (SQLCipher). One table per synced entity with the
/// common sync columns + a JSON `data` column; an `outbox` of pending writes;
/// a `kv` table; and the downloaded parameter packs.
class LocalDb {
  LocalDb._(this._db);

  final Database _db;
  final StreamController<String> _changes = StreamController<String>.broadcast();

  /// Emits the name of the table that changed.
  Stream<String> get changes => _changes.stream;

  static const _keyName = 'rf_db_key_v1';
  static const _dbName = 'recallfarm.db';
  static const _version = 1;

  /// Secure-storage marker telling how the database at [dbPath] is keyed.
  /// Value `raw`: SQLCipher raw key. Absent: legacy passphrase (before P0.1).
  @visibleForTesting
  static String keyModeMarker(String dbPath) => 'rf_db_key_mode_v1:${p.basename(dbPath)}';

  /// SQLCipher raw key literal (`x'<64 hex>'`) for the stored 256-bit key.
  /// A raw key skips SQLCipher's PBKDF2 (256 000 iterations) at every open:
  /// measured on a 2 GB emulator, 276 ms → 13 ms per cold start, more on low-end ARM.
  @visibleForTesting
  static String rawKey(String storedKey) =>
      "x'${base64Url.decode(storedKey).map((b) => b.toRadixString(16).padLeft(2, '0')).join()}'";

  static Future<LocalDb> open({FlutterSecureStorage? storage, String? path}) async {
    final secure = storage ?? const FlutterSecureStorage(aOptions: AndroidOptions(encryptedSharedPreferences: true));
    var key = await secure.read(key: _keyName);
    if (key == null) {
      final rnd = Random.secure();
      key = base64Url.encode(List<int>.generate(32, (_) => rnd.nextInt(256)));
      await secure.write(key: _keyName, value: key);
    }
    final dbPath = path ?? p.join(await getDatabasesPath(), _dbName);
    final marker = keyModeMarker(dbPath);
    final raw = rawKey(key);

    Future<Database> openWith(String password) => openDatabase(
          dbPath,
          password: password,
          version: _version,
          onCreate: (db, version) async => _createSchema(db),
        );

    final exists = await databaseExists(dbPath);
    final rawMode = !exists || await secure.read(key: marker) == 'raw';
    Database db;
    if (rawMode) {
      try {
        db = await openWith(raw);
      } on DatabaseException {
        // Marker written but rekey never happened (should not occur): legacy key.
        db = await _migrateToRawKey(openWith, key, raw);
      }
    } else {
      try {
        db = await _migrateToRawKey(openWith, key, raw);
      } on DatabaseException {
        // Killed after the rekey but before the marker was saved: already raw.
        db = await openWith(raw);
      }
    }
    await secure.write(key: marker, value: 'raw');
    return LocalDb._(db);
  }

  /// Opens a database keyed with the legacy passphrase and re-encrypts it in
  /// place with the raw key (one transaction inside SQLCipher: all or nothing).
  static Future<Database> _migrateToRawKey(
      Future<Database> Function(String) openWith, String passphrase, String raw) async {
    final db = await openWith(passphrase);
    await db.rawQuery('PRAGMA rekey = "$raw"');
    return db;
  }

  static Future<void> _createSchema(Database db) async {
    final batch = db.batch();
    for (final t in kSyncedEntities) {
      batch.execute('''
        CREATE TABLE $t (
          id TEXT PRIMARY KEY,
          farm_id TEXT,
          subject_type TEXT,
          subject_id TEXT,
          date_key TEXT,
          data TEXT NOT NULL,
          created_at TEXT,
          updated_at TEXT,
          deleted_at TEXT,
          sync_version INTEGER NOT NULL DEFAULT 0,
          client_rev INTEGER NOT NULL DEFAULT 0,
          dirty INTEGER NOT NULL DEFAULT 0,
          dirty_fields TEXT
        )''');
      batch.execute('CREATE INDEX idx_${t}_farm ON $t(farm_id)');
      batch.execute('CREATE INDEX idx_${t}_subject ON $t(subject_id)');
    }
    batch.execute('''
      CREATE TABLE outbox (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        entity TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        op TEXT NOT NULL,
        client_rev INTEGER NOT NULL,
        payload TEXT,
        created_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        last_error TEXT
      )''');
    batch.execute('CREATE UNIQUE INDEX idx_outbox_entity ON outbox(entity, entity_id)');
    batch.execute('CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT)');
    batch.execute('''
      CREATE TABLE param_packs (
        code TEXT NOT NULL,
        version TEXT NOT NULL,
        level TEXT,
        content TEXT NOT NULL,
        hash TEXT,
        signature TEXT,
        source TEXT NOT NULL,
        fetched_at TEXT,
        PRIMARY KEY (code, version)
      )''');
    await batch.commit(noResult: true);
  }

  Future<void> close() async {
    await _changes.close();
    await _db.close();
  }

  void _notify(String table) {
    if (!_changes.isClosed) _changes.add(table);
  }

  // ------------------------------------------------------------------ kv

  Future<String?> getKv(String key) async {
    final rows = await _db.query('kv', where: 'key = ?', whereArgs: [key], limit: 1);
    return rows.isEmpty ? null : rows.first['value'] as String?;
  }

  Future<void> setKv(String key, String? value) async {
    if (value == null) {
      await _db.delete('kv', where: 'key = ?', whereArgs: [key]);
    } else {
      await _db.insert('kv', {'key': key, 'value': value}, conflictAlgorithm: ConflictAlgorithm.replace);
    }
    _notify('kv');
  }

  Future<Map<String, dynamic>?> getKvJson(String key) async {
    final v = await getKv(key);
    if (v == null) return null;
    final decoded = jsonDecode(v);
    return decoded is Map ? Map<String, dynamic>.from(decoded) : null;
  }

  Future<void> setKvJson(String key, Object? value) =>
      setKv(key, value == null ? null : jsonEncode(value));

  // ------------------------------------------------------------------ entities

  static Map<String, Object?> _columns(String table, Map<String, dynamic> data) {
    String? str(Object? v) => v?.toString();
    final local = data['_local'];
    final localFarm = local is Map ? local['farm_id'] : null;
    return {
      'farm_id': table == 'farms' ? str(data['id']) : str(data['farm_id'] ?? localFarm),
      'subject_type': str(data['subject_type']),
      'subject_id': str(data['subject_id']),
      'date_key': str(data['log_date'] ??
          data['event_date'] ??
          data['due_date'] ??
          data['sale_date'] ??
          data['expense_date'] ??
          data['movement_date'] ??
          data['start_date'] ??
          data['opened_at']),
    };
  }

  static Map<String, dynamic> _decode(Map<String, Object?> row) {
    final data = Map<String, dynamic>.from(jsonDecode(row['data'] as String) as Map);
    data['id'] = row['id'];
    data['sync_version'] = row['sync_version'];
    data['client_rev'] = row['client_rev'];
    data['deleted_at'] = row['deleted_at'];
    data['_dirty'] = (row['dirty'] as int? ?? 0) == 1;
    return data;
  }

  Future<Map<String, dynamic>?> get(String table, String id) async {
    final rows = await _db.query(table, where: 'id = ?', whereArgs: [id], limit: 1);
    return rows.isEmpty ? null : _decode(rows.first);
  }

  Future<List<Map<String, dynamic>>> list(
    String table, {
    String? farmId,
    String? subjectId,
    String? dateFrom,
    String? dateTo,
    bool includeDeleted = false,
    String orderBy = 'date_key DESC, updated_at DESC',
    int? limit,
  }) async {
    final where = <String>[];
    final args = <Object?>[];
    if (farmId != null) {
      where.add('farm_id = ?');
      args.add(farmId);
    }
    if (subjectId != null) {
      where.add('subject_id = ?');
      args.add(subjectId);
    }
    if (dateFrom != null) {
      where.add('date_key >= ?');
      args.add(dateFrom);
    }
    if (dateTo != null) {
      where.add('date_key <= ?');
      args.add(dateTo);
    }
    if (!includeDeleted) where.add('deleted_at IS NULL');
    final rows = await _db.query(
      table,
      where: where.isEmpty ? null : where.join(' AND '),
      whereArgs: args.isEmpty ? null : args,
      orderBy: orderBy,
      limit: limit,
    );
    return rows.map(_decode).toList();
  }

  static Map<String, dynamic> _clean(Map<String, dynamic> data) {
    final out = Map<String, dynamic>.from(data);
    out.remove('_dirty');
    out.remove('sync_version');
    out.remove('client_rev');
    return out;
  }

  /// Local write (create or update): bumps `client_rev`, marks dirty fields and
  /// enqueues an `upsert` in the outbox — all in one transaction.
  Future<Map<String, dynamic>> saveLocal(String table, Map<String, dynamic> input) async {
    final now = Dates.nowIso();
    final id = (input['id'] ?? Ids.newId()).toString();
    late Map<String, dynamic> saved;
    await _db.transaction((txn) async {
      final rows = await txn.query(table, where: 'id = ?', whereArgs: [id], limit: 1);
      final existing = rows.isEmpty ? null : rows.first;
      final previous = existing == null
          ? <String, dynamic>{}
          : Map<String, dynamic>.from(jsonDecode(existing['data'] as String) as Map);
      final data = <String, dynamic>{...previous, ..._clean(input), 'id': id, 'updated_at': now};
      data.putIfAbsent('created_at', () => now);
      final changed = <String>{
        for (final k in data.keys)
          if (jsonEncode(previous[k]) != jsonEncode(data[k])) k
      };
      final prevDirty = existing?['dirty_fields'] == null
          ? <String>{}
          : (jsonDecode(existing!['dirty_fields'] as String) as List).cast<String>().toSet();
      final clientRev = ((existing?['client_rev'] as int?) ?? 0) + 1;
      final syncVersion = (existing?['sync_version'] as int?) ?? 0;
      final deletedAt = data['deleted_at'] as String?;
      await txn.insert(
        table,
        {
          'id': id,
          ..._columns(table, data),
          'data': jsonEncode(data),
          'created_at': data['created_at'],
          'updated_at': now,
          'deleted_at': deletedAt,
          'sync_version': syncVersion,
          'client_rev': clientRev,
          'dirty': 1,
          'dirty_fields': jsonEncode({...prevDirty, ...changed}.toList()),
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
      if (!kPullOnlyEntities.contains(table)) {
        await _enqueue(txn, table, id, deletedAt != null ? 'delete' : 'upsert', clientRev,
            _pushPayload(table, data));
      }
      saved = {...data, 'client_rev': clientRev, 'sync_version': syncVersion, '_dirty': true};
    });
    _notify(table);
    _notify('outbox');
    return saved;
  }

  /// Logical delete (RG-MDD-01).
  Future<void> deleteLocal(String table, String id) async {
    final existing = await get(table, id);
    if (existing == null) return;
    await saveLocal(table, {...existing, 'deleted_at': Dates.nowIso()});
  }

  static Map<String, dynamic> _pushPayload(String table, Map<String, dynamic> data) {
    final out = Map<String, dynamic>.from(data);
    for (final f in kDerivedFields[table] ?? const <String>{}) {
      out.remove(f);
    }
    for (final f in kLocalOnlyFields) {
      out.remove(f);
    }
    return out;
  }

  Future<void> _enqueue(Transaction txn, String entity, String entityId, String op, int clientRev,
      Map<String, dynamic> payload) async {
    await txn.delete('outbox', where: 'entity = ? AND entity_id = ?', whereArgs: [entity, entityId]);
    await txn.insert('outbox', {
      'entity': entity,
      'entity_id': entityId,
      'op': op,
      'client_rev': clientRev,
      'payload': jsonEncode(payload),
      'created_at': Dates.nowIso(),
      'attempts': 0,
      'status': 'pending',
    });
  }

  /// Queues a REST call to replay when online (e.g. reminder confirm, alert ack).
  Future<void> queueAction(String method, String path, [Map<String, dynamic>? body]) async {
    await _db.transaction((txn) async {
      await _enqueue(txn, '_action', Ids.newId(), 'call', 0, {
        'method': method,
        'path': path,
        if (body != null) 'body': body,
      });
    });
    _notify('outbox');
  }

  /// Applies a server row. Dirty local fields win until pushed (the server then
  /// resolves per-field last-write-wins).
  Future<void> applyRemote(String table, Map<String, dynamic> remote,
      {required int syncVersion, bool deleted = false}) =>
      applyRemoteAll([RemoteRow(table, remote, syncVersion: syncVersion, deleted: deleted)]);

  /// Applies a page of server rows in ONE transaction: existing rows are read
  /// with `id IN (...)` and all writes go in one [Batch] — a pull of 500 changes
  /// costs a handful of platform-channel calls and one commit, not 1 000 calls
  /// and 500 commits (measured: integration_test/offline_sync_test.dart).
  Future<void> applyRemoteAll(List<RemoteRow> rows) async {
    if (rows.isEmpty) return;
    await _db.transaction((txn) async {
      final existing = <String, Map<String, Map<String, Object?>>>{};
      for (final table in {for (final r in rows) r.table}) {
        existing[table] =
            await _rowsById(txn, table, [for (final r in rows) if (r.table == table) r.data['id'].toString()]);
      }
      final batch = txn.batch();
      for (final r in rows) {
        final id = r.data['id'].toString();
        batch.insert(r.table, _mergeRemote(r, existing[r.table]![id]), conflictAlgorithm: ConflictAlgorithm.replace);
      }
      await batch.commit(noResult: true);
    });
    for (final t in {for (final r in rows) r.table}) {
      _notify(t);
    }
  }

  /// Local rows of [table] by id (chunks of 500: SQLite bound-variable limit).
  static Future<Map<String, Map<String, Object?>>> _rowsById(
      DatabaseExecutor db, String table, List<String> ids) async {
    final out = <String, Map<String, Object?>>{};
    final unique = ids.toSet().toList();
    for (var i = 0; i < unique.length; i += 500) {
      final chunk = unique.sublist(i, min(i + 500, unique.length));
      final marks = List.filled(chunk.length, '?').join(',');
      final rows = await db.query(table, where: 'id IN ($marks)', whereArgs: chunk);
      for (final row in rows) {
        out[row['id'] as String] = row;
      }
    }
    return out;
  }

  /// Row values for a server row. Dirty local fields win until pushed (the
  /// server then resolves per-field last-write-wins).
  static Map<String, Object?> _mergeRemote(RemoteRow r, Map<String, Object?>? existing) {
    final table = r.table;
    final remote = r.data;
    final id = remote['id'].toString();
    final data = Map<String, dynamic>.from(_clean(remote));
    var dirty = 0;
    String? dirtyFields;
    var clientRev = (remote['client_rev'] as num?)?.toInt() ?? 0;
    if (existing != null && (existing['dirty'] as int? ?? 0) == 1) {
      final local = Map<String, dynamic>.from(jsonDecode(existing['data'] as String) as Map);
      final fields = existing['dirty_fields'] == null
          ? <String>[]
          : (jsonDecode(existing['dirty_fields'] as String) as List).cast<String>();
      for (final f in fields) {
        if (local.containsKey(f)) data[f] = local[f];
      }
      dirty = 1;
      dirtyFields = existing['dirty_fields'] as String?;
      clientRev = existing['client_rev'] as int? ?? clientRev;
    }
    // Rule: a locally confirmed reminder wins over `manque`/`envoye`.
    if (table == 'reminders' && existing != null) {
      final local = jsonDecode(existing['data'] as String) as Map;
      if (local['status'] == 'confirme' && (data['status'] == 'manque' || data['status'] == 'envoye')) {
        data['status'] = 'confirme';
      }
    }
    final deletedAt =
        r.deleted ? (data['deleted_at'] ?? Dates.nowIso()).toString() : data['deleted_at'] as String?;
    data['deleted_at'] = deletedAt;
    return {
      'id': id,
      ..._columns(table, data),
      'data': jsonEncode(data),
      'created_at': data['created_at']?.toString(),
      'updated_at': data['updated_at']?.toString(),
      'deleted_at': deletedAt,
      'sync_version': r.syncVersion,
      'client_rev': clientRev,
      'dirty': dirty,
      'dirty_fields': dirtyFields,
    };
  }

  /// Marks a pushed change as applied. Only clears the dirty flag when no newer
  /// local edit happened meanwhile.
  Future<void> markPushed(String entity, String id, int pushedRev, int syncVersion,
      {Map<String, dynamic>? serverData}) =>
      markPushedAll([PushAck(entity, id, pushedRev, syncVersion, serverData: serverData)]);

  /// Acknowledges a whole push batch in ONE transaction and one [Batch]
  /// (see [applyRemoteAll]).
  Future<void> markPushedAll(List<PushAck> acks) async {
    if (acks.isEmpty) return;
    await _db.transaction((txn) async {
      final existing = <String, Map<String, Map<String, Object?>>>{};
      for (final entity in {for (final a in acks) a.entity}) {
        if (entity == '_action') continue;
        existing[entity] = await _rowsById(txn, entity, [for (final a in acks) if (a.entity == entity) a.id]);
      }
      final batch = txn.batch();
      for (final a in acks) {
        final row = existing[a.entity]?[a.id];
        if (row != null) {
          final currentRev = row['client_rev'] as int? ?? 0;
          final values = <String, Object?>{'sync_version': a.syncVersion};
          if (currentRev <= a.pushedRev) {
            values['dirty'] = 0;
            values['dirty_fields'] = null;
            final serverData = a.serverData;
            if (serverData != null) {
              final merged = <String, dynamic>{
                ...Map<String, dynamic>.from(jsonDecode(row['data'] as String) as Map),
                ..._clean(serverData),
              };
              values['data'] = jsonEncode(merged);
              values.addAll(_columns(a.entity, merged));
            }
          }
          batch.update(a.entity, values, where: 'id = ?', whereArgs: [a.id]);
        }
        batch.delete('outbox',
            where: 'entity = ? AND entity_id = ? AND client_rev <= ?', whereArgs: [a.entity, a.id, a.pushedRev]);
      }
      await batch.commit(noResult: true);
    });
    for (final e in {for (final a in acks) a.entity}) {
      _notify(e);
    }
    _notify('outbox');
  }

  /// Physically removes a local row without queuing anything (used when the
  /// server merged our record into another id, e.g. daily_logs uniqueness).
  Future<void> removeLocalRow(String table, String id) async {
    await _db.delete(table, where: 'id = ?', whereArgs: [id]);
    await _db.delete('outbox', where: 'entity = ? AND entity_id = ?', whereArgs: [table, id]);
    _notify(table);
    _notify('outbox');
  }

  Future<void> markRejected(int seq, String error) async {
    await _db.update('outbox', {'status': 'rejected', 'last_error': error},
        where: 'seq = ?', whereArgs: [seq]);
    _notify('outbox');
  }

  Future<void> markAttempt(int seq, String? error) async {
    await _db.rawUpdate(
        'UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE seq = ?', [error, seq]);
  }

  Future<void> removeOutbox(int seq) async {
    await _db.delete('outbox', where: 'seq = ?', whereArgs: [seq]);
    _notify('outbox');
  }

  Future<void> retryRejected() async {
    await _db.update('outbox', {'status': 'pending', 'attempts': 0}, where: "status = 'rejected'");
    _notify('outbox');
  }

  /// Pending entity changes sorted parents-first, then by sequence.
  Future<List<OutboxEntry>> pendingChanges() async {
    final rows = await _db.query('outbox',
        where: "status = 'pending' AND entity != '_action'", orderBy: 'seq ASC');
    final list = rows.map(OutboxEntry.fromRow).toList();
    list.sort((a, b) {
      final r = entityRank(a.entity).compareTo(entityRank(b.entity));
      return r != 0 ? r : a.seq.compareTo(b.seq);
    });
    return list;
  }

  Future<List<OutboxEntry>> pendingActions() async {
    final rows = await _db.query('outbox',
        where: "status = 'pending' AND entity = '_action'", orderBy: 'seq ASC');
    return rows.map(OutboxEntry.fromRow).toList();
  }

  Future<List<OutboxEntry>> rejectedEntries() async {
    final rows = await _db.query('outbox', where: "status = 'rejected'", orderBy: 'seq ASC');
    return rows.map(OutboxEntry.fromRow).toList();
  }

  Future<int> pendingCount() async {
    final r = await _db.rawQuery("SELECT COUNT(*) AS c FROM outbox WHERE status = 'pending'");
    return (r.first['c'] as int?) ?? 0;
  }

  // ------------------------------------------------------------------ params

  Future<void> savePack({
    required String code,
    required String version,
    required String? level,
    required String content,
    required String source,
    String? hash,
    String? signature,
  }) async {
    await _db.insert(
      'param_packs',
      {
        'code': code,
        'version': version,
        'level': level,
        'content': content,
        'hash': hash,
        'signature': signature,
        'source': source,
        'fetched_at': Dates.nowIso(),
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
    _notify('param_packs');
  }

  Future<List<Map<String, Object?>>> packs() => _db.query('param_packs');

  Future<bool> hasPack(String code, String version) async {
    final r = await _db.query('param_packs',
        where: 'code = ? AND version = ?', whereArgs: [code, version], limit: 1);
    return r.isNotEmpty;
  }

  /// Wipes user data (logout / account deletion). Keeps bundled packs.
  Future<void> wipeUserData() async {
    await _db.transaction((txn) async {
      for (final t in kSyncedEntities) {
        await txn.delete(t);
      }
      await txn.delete('outbox');
      await txn.delete('kv');
      await txn.delete('param_packs', where: "source != 'bundled'");
    });
    for (final t in [...kSyncedEntities, 'outbox', 'kv', 'param_packs']) {
      _notify(t);
    }
  }
}
