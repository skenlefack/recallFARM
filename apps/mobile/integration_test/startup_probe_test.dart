import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:path/path.dart' as p;
import 'package:recallfarm/core/db/local_db.dart';
import 'package:sqflite_sqlcipher/sqflite.dart';

/// Cout des etapes de demarrage sur l'appareil (ENF demarrage a froid < 3 s) :
/// ouverture de la base chiffree (cle SQLCipher) mesuree sur l'appareil reel.
void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('cout d ouverture de la base chiffree', (tester) async {
    final dir = await getDatabasesPath();
    final report = <String, Object>{};

    // 1. LocalDb.open tel qu'utilise par main() (premier lancement puis relance).
    final path = p.join(dir, 'probe_localdb.db');
    await deleteDatabase(path);
    var sw = Stopwatch()..start();
    var db = await LocalDb.open(path: path);
    report['localdb_first_open_ms'] = sw.elapsedMilliseconds;
    await db.close();
    sw = Stopwatch()..start();
    db = await LocalDb.open(path: path);
    await db.getKv('probe');
    report['localdb_reopen_ms'] = sw.elapsedMilliseconds;
    await db.close();
    await deleteDatabase(path);

    // 2. Phrase de passe (PBKDF2) vs cle brute x'..' sur la meme base.
    final rnd = Random.secure();
    final bytes = List<int>.generate(32, (_) => rnd.nextInt(256));
    final pass = base64Url.encode(bytes);
    final raw = "x'${bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join()}'";
    for (final (name, key) in [('passphrase', pass), ('raw_key', raw)]) {
      final f = p.join(dir, 'probe_$name.db');
      await deleteDatabase(f);
      final d0 = await openDatabase(f, password: key, version: 1, onCreate: (d, _) => d.execute('CREATE TABLE t(x)'));
      await d0.close();
      sw = Stopwatch()..start();
      final d1 = await openDatabase(f, password: key);
      await d1.rawQuery('SELECT count(*) FROM t');
      report['${name}_open_ms'] = sw.elapsedMilliseconds;
      await d1.close();
      await deleteDatabase(f);
    }
    debugPrint('IT startup probe: $report');
    binding.reportData = {'startup_probe': report};
  });
}
