import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:recallfarm/core/api/api_client.dart';
import 'package:recallfarm/core/sync/sync_engine.dart';
import 'package:recallfarm/core/util/dates.dart';
import 'package:recallfarm/core/util/ids.dart';

import 'support/harness.dart';

/// Hors ligne d'abord (EF-SYN-*, RG-SYN-01) contre une vraie API :
///  1. 50 cycles « mode avion » : saisies hors ligne (journal, depense, modification
///     du lot), tentative de synchro refusee, redemarrage de l'app hors ligne tous
///     les 10 cycles, coupure APRES envoi (le serveur a applique, la reponse est
///     perdue) tous les 5 cycles, puis retour du reseau → synchro automatique.
///     Verification finale : serveur == telephone, aucune perte, aucun doublon.
///  2. Synchro de 500 changements, chronometree (ENF de performance : < 10 s en 2G ;
///     la limitation 2G est appliquee par l'emulateur : `adb emu network speed edge`).
///
/// flutter test integration_test/offline_sync_test.dart -d emulator-5554 \
///   --dart-define=API_BASE_URL=https://recallfarm.com/v1 [--dart-define=CYCLES=50]
const int kCycles = int.fromEnvironment('CYCLES', defaultValue: 50);
const int kBulk = int.fromEnvironment('BULK', defaultValue: 500);
const int kBulkTimeoutS = int.fromEnvironment('BULK_TIMEOUT_S', defaultValue: 120);

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('$kCycles cycles mode avion : aucune perte, aucun doublon', (tester) async {
    final name = 'airplane_${DateTime.now().millisecondsSinceEpoch}';
    var env = await TestEnv.create(name: name, fakeNetwork: true);
    final phone = uniqueTestPhone();
    await env.signInWithOtp(phone);
    await env.session.setSpeculations(const ['volaille']);
    await env.session.setConsentsDone();

    final farmId = Ids.newId();
    await env.repo.saveFarm({'id': farmId, 'name': 'Ferme avion', 'speculations': ['volaille'], 'country': 'CM', 'currency': 'XAF'});
    await env.session.setFarm(farmId);
    final batchId = Ids.newId();
    await env.repo.saveSubject('batch', {
      'id': batchId,
      'farm_id': farmId,
      'name': 'Lot avion',
      'species': 'volaille',
      'production_type': 'chair',
      'start_date': Dates.addDays(Dates.today(), -kCycles - 5),
      'initial_count': 5000,
      'status': 'en_cours',
      'attributes': <String, dynamic>{},
    });
    expect(await env.drain(), greaterThan(0));

    final expectedLogs = <String, int>{}; // log_date -> mortality
    final expectedExpenses = <String, int>{}; // id -> amount_minor
    var restarts = 0;
    var cuts = 0;
    final sw = Stopwatch()..start();

    for (var i = 1; i <= kCycles; i++) {
      // ---- avion
      await env.setOnline(false);
      final date = Dates.addDays(Dates.today(), -i);
      await env.repo.saveDailyLog({
        'id': Ids.newId(),
        'farm_id': farmId,
        'subject_type': 'batch',
        'subject_id': batchId,
        'log_date': date,
        'mortality': i % 7,
        'feed_kg': 10 + i,
      });
      expectedLogs[date] = i % 7;
      final expenseId = Ids.newId();
      final amount = 1000 * i + 25; // unite mineure, jamais de flottant
      await env.repo.saveExpense({
        'id': expenseId,
        'farm_id': farmId,
        'category': 'aliment',
        'amount': {'amount_minor': amount, 'currency': 'XAF'},
        'payment_method': 'especes',
        'expense_date': date,
        'attributes': <String, dynamic>{},
      });
      expectedExpenses[expenseId] = amount;
      final batch = await env.db.get('batches', batchId);
      await env.repo.saveSubject('batch', {...batch!, 'attributes': {'note_cycle': i}});

      expect(await env.sync.sync(), isFalse, reason: 'pas de synchro en mode avion');
      expect(await env.db.pendingCount(), greaterThanOrEqualTo(3));

      if (i % 10 == 0) {
        // l'app est tuee hors ligne puis relancee : la file chiffree survit
        await env.close();
        env = await TestEnv.create(name: name, fakeNetwork: true, keepExistingDb: true);
        await env.setOnline(false);
        expect(await env.db.pendingCount(), greaterThanOrEqualTo(3), reason: 'outbox persistee');
        restarts++;
      }
      if (i % 5 == 0) env.gate.cutAfterSend = true;

      // ---- retour du reseau : la synchro part toute seule (ConnectivityService)
      await env.setOnline(true);
      final drained = await _waitDrained(env, const Duration(seconds: 60));
      if (env.gate.cut > 0) cuts += env.gate.cut;
      env.gate.cut = 0;
      expect(drained, isTrue, reason: 'cycle $i : file non videe (${env.sync.lastError})');
    }
    sw.stop();

    // ---- verification serveur
    final server = await _pullAll(env.api, 'daily_logs,expenses,batches');
    final logs = server.where((c) => c['entity'] == 'daily_logs' && (c['data'] as Map)['subject_id'] == batchId).toList();
    final expenses = server.where((c) => c['entity'] == 'expenses' && (c['data'] as Map)['farm_id'] == farmId).toList();
    final batchRow = server.lastWhere((c) => c['entity'] == 'batches' && c['id'] == batchId);

    final serverLogs = <String, int>{
      for (final c in logs) _dateKey((c['data'] as Map)['log_date']): ((c['data'] as Map)['mortality'] as num).toInt()
    };
    expect(logs.length, kCycles, reason: 'un journal par cycle, sans doublon');
    expect(serverLogs, expectedLogs);
    expect(expenses.length, kCycles, reason: 'une depense par cycle, sans doublon');
    for (final c in expenses) {
      final d = c['data'] as Map;
      final minor = d['amount_minor'] ?? (d['amount'] is Map ? (d['amount'] as Map)['amount_minor'] : null);
      expect((minor as num).toInt(), expectedExpenses[c['id']], reason: 'montant exact ${c['id']}');
    }
    final attrs = (batchRow['data'] as Map)['attributes'] as Map;
    expect(attrs['note_cycle'], kCycles, reason: 'derniere modification hors ligne gagnee');
    expect(await env.db.pendingCount(), 0);
    expect(cuts, greaterThanOrEqualTo(kCycles ~/ 5), reason: 'coupures apres envoi reellement simulees');

    final report = {
      'cycles': kCycles,
      'restarts_offline': restarts,
      'cuts_after_send': cuts,
      'server_daily_logs': logs.length,
      'server_expenses': expenses.length,
      'duration_s': sw.elapsedMilliseconds / 1000,
    };
    debugPrint('IT airplane: $report');
    binding.reportData = {...?binding.reportData, 'airplane': report};
    await env.dispose();
  });

  testWidgets('Synchro de $kBulk changements (chronometree)', (tester) async {
    final env = await TestEnv.create(name: 'bulk_${DateTime.now().millisecondsSinceEpoch}', fakeNetwork: true);
    await env.signInWithOtp(uniqueTestPhone());
    final farmId = Ids.newId();
    await env.repo.saveFarm({'id': farmId, 'name': 'Ferme 500', 'speculations': ['volaille'], 'country': 'CM', 'currency': 'XAF'});
    await env.session.setFarm(farmId);
    final batchId = Ids.newId();
    await env.repo.saveSubject('batch', {
      'id': batchId, 'farm_id': farmId, 'name': 'Lot 500', 'species': 'volaille', 'production_type': 'chair',
      'start_date': Dates.addDays(Dates.today(), -kBulk - 2), 'initial_count': 100000, 'status': 'en_cours',
      'attributes': <String, dynamic>{},
    });
    expect(await env.drain(), greaterThan(0));

    await env.setOnline(false);
    final write = Stopwatch()..start();
    for (var i = 1; i <= kBulk; i++) {
      await env.repo.saveDailyLog({
        'id': Ids.newId(), 'farm_id': farmId, 'subject_type': 'batch', 'subject_id': batchId,
        'log_date': Dates.addDays(Dates.today(), -i), 'mortality': i % 3, 'feed_kg': 20,
      });
    }
    write.stop();
    expect(await env.db.pendingCount(), kBulk);

    // Retour du reseau : la synchro part seule (ConnectivityService) ; on chronometre
    // jusqu'a la file vide (push par lots de 200 + pull + parametres).
    final requestsBefore = env.gate.requests;
    final sw = Stopwatch()..start();
    await env.setOnline(true);
    final drained = await _waitDrained(env, const Duration(seconds: kBulkTimeoutS));
    sw.stop();
    expect(drained, isTrue, reason: 'file videe (${env.sync.lastError})');
    expect(await env.db.pendingCount(), 0);
    final serverLogs = (await _pullAll(env.api, 'daily_logs'))
        .where((c) => (c['data'] as Map)['subject_id'] == batchId)
        .length;
    expect(serverLogs, kBulk, reason: 'toutes les saisies sont sur le serveur');
    final report = {
      'changes': kBulk,
      'local_write_ms': write.elapsedMilliseconds,
      'sync_ms': sw.elapsedMilliseconds,
      'requests': env.gate.requests - requestsBefore,
      'server_daily_logs': serverLogs,
    };
    debugPrint('IT bulk: $report');
    binding.reportData = {...?binding.reportData, 'bulk': report};
    await env.dispose();
  });
}

String _dateKey(Object? v) => v.toString().substring(0, 10);

Future<bool> _waitDrained(TestEnv env, Duration timeout) async {
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    await Future<void>.delayed(const Duration(milliseconds: 250));
    if (await env.db.pendingCount() == 0) return true;
    // after a cut the engine waits for its back-off: retry now, like a manual pull-to-refresh
    if (env.sync.phase != SyncPhase.syncing) await env.sync.sync();
  }
  await env.drain(maxCycles: 1); // prints the diagnostics (IT drain: ...)
  return false;
}

Future<List<Map<String, dynamic>>> _pullAll(ApiClient api, String entities) async {
  final out = <Map<String, dynamic>>[];
  var since = 0;
  for (var page = 0; page < 100; page++) {
    final r = await api.get('/sync/pull', query: {'since': since, 'entities': entities, 'limit': 100}); // small pages: also run under 2G
    for (final c in r['changes'] as List) {
      out.add(Map<String, dynamic>.from(c as Map));
    }
    since = (r['server_version'] as num).toInt();
    if (r['has_more'] != true) break;
  }
  return out;
}
