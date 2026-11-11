import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'support/harness.dart';

/// Smoke test: the app starts on a fresh device state and the onboarding
/// navigates E01 → E02 → (offline) E03 without any network.
///
/// flutter test integration_test/smoke_test.dart -d emulator-5554
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('Demarrage, E01 → E02 → compte hors ligne → E03', (tester) async {
    final env = await TestEnv.create(name: 'smoke', fakeNetwork: true);
    addTearDown(env.dispose);
    await env.setOnline(false);

    await tester.pumpWidget(env.app());
    await pumpUntil(tester, find.text('Que faites-vous ?'), reason: 'E01 sur un etat vierge');
    expect(tester.takeException(), isNull);
    for (final label in const [
      'Aviculture', 'Élevage canin', 'Pension canine', 'Dressage', //
      'Petits ruminants', 'Porcins', 'Bovins', 'Cuniculture',
    ]) {
      expect(find.text(label), findsOneWidget, reason: label);
    }

    await tester.tap(find.text('Aviculture'));
    await tester.pump(const Duration(milliseconds: 300));
    await tester.tap(find.text('Continuer'));
    await pumpUntil(tester, find.text('Votre numéro'), reason: 'E02');

    await tester.enterText(find.widgetWithText(TextField, 'Téléphone'), '690000001');
    await tester.pump();
    await tester.ensureVisible(find.text('Continuer hors ligne'));
    await tester.tap(find.text('Continuer hors ligne'));
    await pumpUntil(tester, find.text('Vos données vous appartiennent'), reason: 'E03 apres compte provisoire');
    expect(env.session.provisional, isTrue);
    await env.unmount(tester);
  });
}
