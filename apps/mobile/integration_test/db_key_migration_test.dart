import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:path/path.dart' as p;
import 'package:recallfarm/core/db/local_db.dart';
import 'package:sqflite_sqlcipher/sqflite.dart';

/// Cle SQLCipher brute (demarrage a froid) : une base creee avant P0.1 avec la
/// phrase de passe est re-chiffree sans perte, y compris si l'app est tuee entre
/// le re-chiffrement et l'ecriture du marqueur. Sur l'appareil reel (SQLCipher natif).
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  const secure = FlutterSecureStorage(aOptions: AndroidOptions(encryptedSharedPreferences: true));

  testWidgets('base existante (phrase de passe) migree vers la cle brute sans perte', (tester) async {
    final dir = await getDatabasesPath();
    final path = p.join(dir, 'it_migration.db');
    await deleteDatabase(path);
    await secure.delete(key: LocalDb.keyModeMarker(path));

    // La cle de l'app existe (creee au besoin par une premiere ouverture ailleurs).
    final seed = await LocalDb.open(path: p.join(dir, 'it_migration_seed.db'));
    await seed.close();
    final passphrase = (await secure.read(key: 'rf_db_key_v1'))!;

    // Base « ancienne version » : phrase de passe, une ecriture en attente de synchro.
    final legacy = await openDatabase(path, password: passphrase, version: 1, onCreate: (db, _) async {
      await db.execute('CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT)');
    });
    await legacy.insert('kv', {'key': 'k', 'value': 'donnee de l eleveur'});
    await legacy.close();

    // 1. Migration a l'ouverture.
    var db = await LocalDb.open(path: path);
    expect(await db.getKv('k'), 'donnee de l eleveur');
    await db.close();
    expect(await secure.read(key: LocalDb.keyModeMarker(path)), 'raw');

    // L'ancienne phrase de passe n'ouvre plus la base : elle a bien ete re-chiffree.
    await expectLater(
      () async => (await openDatabase(path, password: passphrase)).rawQuery('SELECT count(*) FROM kv'),
      throwsA(anything),
    );

    // 2. App tuee apres le rekey mais avant le marqueur : repli sur la cle brute.
    await secure.delete(key: LocalDb.keyModeMarker(path));
    db = await LocalDb.open(path: path);
    expect(await db.getKv('k'), 'donnee de l eleveur');
    await db.close();

    // 3. Relance normale.
    db = await LocalDb.open(path: path);
    expect(await db.getKv('k'), 'donnee de l eleveur');
    await db.close();

    await deleteDatabase(path);
    await deleteDatabase(p.join(dir, 'it_migration_seed.db'));
  });

  // Review B1: disk full (SQLITE_FULL) during the rekey must not brick the app.
  testWidgets('rekey en echec : app ouverte sur l ancienne cle, donnees lisibles, marqueur absent, reessai', (tester) async {
    final dir = await getDatabasesPath();
    final path = p.join(dir, 'it_rekey_fail.db');
    await deleteDatabase(path);
    await secure.delete(key: LocalDb.keyModeMarker(path));
    final seed = await LocalDb.open(path: p.join(dir, 'it_rekey_seed.db'));
    await seed.close();
    final passphrase = (await secure.read(key: 'rf_db_key_v1'))!;
    final legacy = await openDatabase(path, password: passphrase, version: 1, singleInstance: false,
        onCreate: (db, _) => db.execute('CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT)'));
    await legacy.insert('kv', {'key': 'k', 'value': 'saisie hors ligne'});
    await legacy.close();

    var calls = 0;
    final failedOn = <Database>[];
    LocalDb.rekey = (db, raw) async {
      calls++;
      failedOn.add(db);
      throw Exception('SQLITE_FULL: database or disk is full (simule)');
    };
    addTearDown(() => LocalDb.rekey = LocalDb.defaultRekey);

    // Two launches in a row with a failing rekey: the app opens every time.
    for (var launch = 1; launch <= 2; launch++) {
      final db = await LocalDb.open(path: path);
      // Review N1: the connection whose rekey failed is closed, never reused.
      expect(failedOn.last.isOpen, isFalse, reason: 'connexion du rekey en echec fermee');
      expect(await db.getKv('k'), 'saisie hors ligne', reason: 'lancement $launch');
      await db.setKv('k$launch', 'ecrit au lancement $launch');
      await db.close();
      expect(await secure.read(key: LocalDb.keyModeMarker(path)), isNull, reason: 'pas de marqueur sans rekey');
    }
    expect(calls, 2, reason: 'rekey retente a chaque lancement');

    // Space is back: the next launch migrates, nothing lost.
    LocalDb.rekey = LocalDb.defaultRekey;
    final db = await LocalDb.open(path: path);
    expect(await db.getKv('k'), 'saisie hors ligne');
    expect(await db.getKv('k2'), 'ecrit au lancement 2');
    await db.close();
    expect(await secure.read(key: LocalDb.keyModeMarker(path)), 'raw');

    await deleteDatabase(path);
    await deleteDatabase(p.join(dir, 'it_rekey_seed.db'));
  });
}
