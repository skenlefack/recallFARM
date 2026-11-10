import 'package:recallfarm/core/db/local_db.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// Real [LocalDb] (same schema, same SQL) on an in-memory SQLite through FFI:
/// no SQLCipher, no device. ADR-004.
Future<LocalDb> memoryLocalDb() async {
  sqfliteFfiInit();
  final db = await databaseFactoryFfi.openDatabase(
    inMemoryDatabasePath,
    options: OpenDatabaseOptions(singleInstance: false),
  );
  return LocalDb.forTesting(db);
}
