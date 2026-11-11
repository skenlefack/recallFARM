import 'package:flutter_test/flutter_test.dart';
import 'package:recallfarm/core/router/app_router.dart';
import 'package:recallfarm/core/session/session.dart';

/// Onboarding navigation (E01 → E04). Regression found by integration_test/smoke_test.dart
/// and pilot_journey_test.dart: after « Continuer » on E01 (or the OTP check on E02)
/// the session moved to the next step but the user stayed on the completed screen,
/// because earlier steps stay reachable for back navigation.
void main() {
  test('a later step is followed', () {
    expect(onboardingAdvanceTarget(OnboardingStage.speculation, OnboardingStage.account), '/onboarding/account');
    expect(onboardingAdvanceTarget(OnboardingStage.account, OnboardingStage.consents), '/onboarding/consents');
    expect(onboardingAdvanceTarget(OnboardingStage.consents, OnboardingStage.farm), '/onboarding/farm');
    expect(onboardingAdvanceTarget(OnboardingStage.farm, OnboardingStage.ready), '/home');
    // applyMe can skip consents when the account already owns a farm
    expect(onboardingAdvanceTarget(OnboardingStage.account, OnboardingStage.ready), '/home');
  });

  test('no move on back navigation or unchanged step', () {
    expect(onboardingAdvanceTarget(OnboardingStage.account, OnboardingStage.speculation), isNull);
    expect(onboardingAdvanceTarget(OnboardingStage.ready, OnboardingStage.speculation), isNull); // sign out: redirect
    expect(onboardingAdvanceTarget(OnboardingStage.consents, OnboardingStage.consents), isNull);
  });

  test('guard unchanged: earlier steps reachable, later ones not', () {
    expect(onboardingRedirect(OnboardingStage.account, '/onboarding/speculation'), isNull);
    expect(onboardingRedirect(OnboardingStage.account, '/onboarding/farm'), '/onboarding/account');
    expect(onboardingRedirect(OnboardingStage.ready, '/onboarding/farm'), '/home');
  });
}
