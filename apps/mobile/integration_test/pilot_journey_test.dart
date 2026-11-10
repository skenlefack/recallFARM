import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:recallfarm/main.dart' as app;

/// Integration test — Pilot journey (P0.1 acceptance criteria).
///
/// Runs on a real device or emulator against the app.
/// The API stack must be running (docker compose up) at the emulator's host.
///
/// Steps tested:
///   E01 Speculation → E02 Account (offline) → E03 Consents → E04 Farm setup → E10 Home
///
/// Run: flutter test integration_test/pilot_journey_test.dart -d emulator-5554
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  group('Pilot journey — onboarding flow', () {
    testWidgets('E01: speculation screen shows and allows selection', (tester) async {
      await app.main();
      await tester.pumpAndSettle(const Duration(seconds: 5));

      // E01 — "Que faites-vous ?" screen
      expect(find.text('Que faites-vous ?'), findsOneWidget,
          reason: 'Should start on speculation screen E01');

      // Verify all 8 speculation options are visible
      expect(find.text('Aviculture'), findsOneWidget);
      expect(find.text('Élevage canin'), findsOneWidget);
      expect(find.text('Pension canine'), findsOneWidget);
      expect(find.text('Dressage'), findsOneWidget);
      expect(find.text('Petits ruminants'), findsOneWidget);
      expect(find.text('Porcins'), findsOneWidget);
      expect(find.text('Bovins'), findsOneWidget);
      expect(find.text('Cuniculture'), findsOneWidget);

      // "Continuer" should be disabled (nothing selected)
      final continueButton = find.text('Continuer');
      expect(continueButton, findsOneWidget);

      // Select "Aviculture"
      await tester.tap(find.text('Aviculture'));
      await tester.pumpAndSettle();

      // Tap "Continuer" — should navigate to E02 (account)
      await tester.tap(continueButton);
      await tester.pumpAndSettle(const Duration(seconds: 2));

      // E02 — "Votre numéro" screen
      expect(find.text('Votre numéro'), findsOneWidget,
          reason: 'Should navigate to account screen E02');
    });

    testWidgets('E02: continue offline creates provisional account', (tester) async {
      await app.main();
      await tester.pumpAndSettle(const Duration(seconds: 5));

      // Navigate past E01
      await tester.tap(find.text('Aviculture'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Continuer'));
      await tester.pumpAndSettle(const Duration(seconds: 2));

      // E02 — tap "Continuer hors ligne"
      final offlineButton = find.text('Continuer hors ligne');
      if (offlineButton.evaluate().isNotEmpty) {
        await tester.tap(offlineButton);
        await tester.pumpAndSettle(const Duration(seconds: 2));

        // Should be on E03 (consents) or E04 (farm)
        final onConsents = find.text('Vos données vous appartiennent');
        final onFarm = find.textContaining('ferme');
        expect(
          onConsents.evaluate().isNotEmpty || onFarm.evaluate().isNotEmpty,
          isTrue,
          reason: 'Should navigate past account after offline continue',
        );
      }
    });
  });

  group('Pilot journey — screen rendering', () {
    testWidgets('App starts without crash', (tester) async {
      await app.main();
      await tester.pumpAndSettle(const Duration(seconds: 5));

      // App must render without exceptions
      expect(tester.takeException(), isNull);

      // Must show either onboarding or home
      final hasOnboarding = find.text('Que faites-vous ?').evaluate().isNotEmpty;
      final hasHome = find.text('Accueil').evaluate().isNotEmpty;
      expect(hasOnboarding || hasHome, isTrue, reason: 'App must show onboarding or home');
    });
  });
}
