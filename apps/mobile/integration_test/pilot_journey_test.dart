import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:integration_test/integration_test.dart';
import 'package:recallfarm/core/data/providers.dart';

import 'support/harness.dart';

/// Parcours pilote (MVP-SCOPE §6) pilote par l'interface, contre une vraie API :
///   E01 speculation → E02 telephone + OTP (dev_code) → E03 consentements →
///   E04 exploitation → E10 accueil → E12 ajout d'un lot → E13 saisie du jour →
///   synchronisation (EF-SYN, RG-SYN-01) → rappels (moteur local + serveur).
///
/// flutter test integration_test/pilot_journey_test.dart -d emulator-5554 \
///   --dart-define=API_BASE_URL=https://recallfarm.com/v1
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('Parcours pilote : OTP → exploitation → lot → saisie du jour → rappel', (tester) async {
    final env = await TestEnv.create(name: 'pilot');
    addTearDown(env.dispose);
    final phone = uniqueTestPhone();
    final farmName = 'Ferme IT ${DateTime.now().millisecondsSinceEpoch % 100000}';

    await tester.pumpWidget(env.app());
    await pumpUntil(tester, find.text('Que faites-vous ?'), reason: 'E01');

    // ---- E01
    await tester.tap(find.text('Aviculture'));
    await tester.pump(const Duration(milliseconds: 300));
    await tapUntil(tester, find.text('Continuer'), find.text('Votre numéro'), reason: 'E02');

    // ---- E02 : numero local (9 chiffres) puis OTP
    await tester.enterText(find.widgetWithText(TextField, 'Téléphone'), phone.substring(4));
    await tester.pump();
    await tapUntil(tester, find.text('Recevoir le code'), find.textContaining('Code (dev) :'),
        attempts: 1, each: const Duration(seconds: 40), reason: 'dev_code renvoye par l API');
    final devLabel = tester.widget<Text>(find.textContaining('Code (dev) :')).data!;
    final code = RegExp(r'(\d{6})').firstMatch(devLabel)!.group(1)!;
    await tester.enterText(find.widgetWithText(TextField, 'Code reçu par SMS'), code);
    await tester.pump();
    await tapUntil(tester, find.text('Vérifier'), find.text('Vos données vous appartiennent'), reason: 'E03');
    expect(env.session.isAuthenticated, isTrue);

    // ---- E03 : CGU obligatoire
    await tester.tap(find.textContaining("Conditions d'utilisation"));
    await tester.pump(const Duration(milliseconds: 300));
    await tapUntil(tester, find.text('Continuer'), find.text('Votre exploitation'), reason: 'E04');

    // ---- E04
    await tester.enterText(find.byType(TextFormField).first, farmName);
    await tester.pump();
    await tapUntil(tester, find.text('Enregistrer'), find.text('Cheptel'), reason: 'E10 accueil + barre de navigation');
    final farmId = env.session.farmId!;

    // ---- E12 : ajout d'un lot de chair
    expect(env.session.speculations, contains('volaille'));
    await tapUntil(tester, find.text('Cheptel').last, find.text('Ajouter un lot'), reason: 'E11 Cheptel');
    await tapUntil(tester, find.text('Ajouter un lot'), _label('Nom du lot'), reason: 'formulaire E12 (pack volaille)');
    // Le nom du lot est propose par l'app (« Bande B01 ») : on le garde.
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pump(const Duration(milliseconds: 600));
    final productionType = find.byType(DropdownButtonFormField<String>).first;
    await tester.ensureVisible(productionType);
    await tester.pump(const Duration(milliseconds: 300));
    await tester.tap(productionType);
    await pumpUntil(tester, find.text('Chair'), reason: 'menu type de production');
    await tester.pump(const Duration(milliseconds: 500));
    await tester.tap(find.text('Chair').last);
    await tester.pump(const Duration(seconds: 1));
    await tester.enterText(_fieldNear('Effectif initial'), '500');
    await tester.pump();
    await tapUntil(tester, find.text('Enregistrer'), find.text('Journal du jour'), reason: 'retour au cheptel (bouton Journal du jour)');
    final batches = await env.repo.batches(farmId);
    expect(batches, hasLength(1));
    expect(batches.single.initialCount, 500);
    final batchName = batches.single.name;
    final batchId = batches.single.id;
    await pumpUntil(tester, find.textContaining(batchName), reason: 'lot visible dans le cheptel');

    // ---- E13 : saisie du jour (mortalite 3)
    _router(tester).push('/journal');
    await pumpUntil(tester, find.text('Journal du jour'), reason: 'E13');
    await pumpUntil(tester, _label('Morts'), reason: 'formulaire journal');
    await tester.enterText(_fieldNear('Morts'), '3');
    await tester.pump();
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pump(const Duration(milliseconds: 600));
    await tester.tap(find.text('Enregistrer'));
    await tester.pump(const Duration(seconds: 2));
    final logs = await env.repo.dailyLogs(farmId, subjectId: batchId);
    expect(logs, hasLength(1));
    expect(logs.first['mortality'], 3);

    // ---- Synchronisation : rien ne reste dans la file, le serveur a tout
    expect(await env.drain(), greaterThan(0), reason: 'outbox videe');
    expect(await env.db.pendingCount(), 0);
    final serverBatches = await env.api.get('/sync/pull', query: {'since': 0, 'entities': 'batches,daily_logs', 'limit': 500});
    final ids = [for (final c in serverBatches['changes'] as List) (c as Map)['id'].toString()];
    expect(ids, contains(batchId), reason: 'lot pousse au serveur');
    expect(ids, contains(logs.first['id'].toString()), reason: 'saisie du jour poussee');

    // ---- Rappels : calcules hors ligne par le moteur partage et affiches en Sante
    final container = ProviderScope.containerOf(tester.element(find.byType(Scaffold).first));
    final sub = container.listen(remindersProvider, (_, __) {});
    addTearDown(sub.close);
    final until = DateTime.now().add(const Duration(seconds: 30));
    while (!sub.read().hasValue && DateTime.now().isBefore(until)) {
      await tester.pump(const Duration(milliseconds: 200));
    }
    expect(sub.read().hasValue, isTrue, reason: 'rappels calcules (${sub.read()})');
    final reminders = sub.read().requireValue;
    final forBatch = reminders.where((r) => r.subjectId == batchId).toList();
    expect(forBatch, isNotEmpty, reason: 'protocole volaille → rappels pour le nouveau lot');
    _router(tester).go('/health');
    await pumpUntil(tester, find.text('Rappels à venir'), reason: 'E20 Sante');
    await pumpUntil(tester, find.textContaining(batchName), reason: 'rappel du lot affiche');

    // Rappels cote serveur (canaux SMS/WhatsApp) pour la meme exploitation.
    final server = await env.api.get('/reminders', query: {'farm_id': farmId});
    final rows = server['data'] is List ? server['data'] as List : (server['items'] as List? ?? const []);
    debugPrint('IT pilot: ${forBatch.length} rappels locaux, ${rows.length} rappels serveur pour $farmId');
    await env.unmount(tester);
  });
}

/// The pack-driven form renders each label as a sibling Text above its input:
/// returns the first editable field of the nearest column holding [label].
Finder _fieldNear(String label) {
  final labelFinder = _label(label).first;
  final column = find.ancestor(of: labelFinder, matching: find.byType(Column)).first;
  return find.descendant(of: column, matching: find.byType(EditableText)).first;
}

/// Pack field label, with or without the required marker.
Finder _label(String label) =>
    find.byWidgetPredicate((w) => w is Text && (w.data == label || w.data == '$label *'));

GoRouter _router(WidgetTester tester) => GoRouter.of(tester.element(find.byType(Scaffold).last));
