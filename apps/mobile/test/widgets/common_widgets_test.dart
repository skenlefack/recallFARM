import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:recallfarm/core/router/app_router.dart';
import 'package:recallfarm/core/session/session.dart';
import 'package:recallfarm/core/theme/typography.dart';
import 'package:recallfarm/core/widgets/common.dart';

import 'test_app.dart';

void main() {
  setUpAll(() => RfType.useBundledFonts = false);

  group('onboarding guard', () {
    test('sends the user to the first unfinished step', () {
      expect(onboardingRedirect(OnboardingStage.speculation, '/home'), '/onboarding/speculation');
      expect(onboardingRedirect(OnboardingStage.account, '/home'), '/onboarding/account');
      expect(onboardingRedirect(OnboardingStage.farm, '/onboarding/farm'), isNull);
    });
    test('earlier steps stay reachable, later ones do not', () {
      expect(onboardingRedirect(OnboardingStage.consents, '/onboarding/speculation'), isNull);
      expect(onboardingRedirect(OnboardingStage.account, '/onboarding/farm'), '/onboarding/account');
    });
    test('a ready user leaves onboarding', () {
      expect(onboardingRedirect(OnboardingStage.ready, '/onboarding/account'), '/home');
      expect(onboardingRedirect(OnboardingStage.ready, '/journal'), isNull);
    });
  });

  testWidgets('KPI tile with sparkline renders at 360 px and scale 1.3', (tester) async {
    await tester.binding.setSurfaceSize(const Size(360, 640));
    await tester.pumpWidget(testApp(
      const Padding(
        padding: EdgeInsets.all(20),
        child: Row(children: [
          Expanded(
            child: KpiTile(
              label: 'Taux de ponte',
              value: '76',
              unit: '%',
              child: Sparkline(values: [60, 62, 61, 66, 68, 67, 71, 72]),
            ),
          ),
          SizedBox(width: 10),
          Expanded(child: KpiTile(label: 'Marge du mois', value: '184 500', footer: 'FCFA · +12 %')),
        ]),
      ),
      textScale: 1.3,
    ));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.text('Marge du mois'), findsOneWidget);
    await tester.binding.setSurfaceSize(null);
  });

  testWidgets('pill buttons honour the 48 dp minimum', (tester) async {
    await tester.pumpWidget(testApp(Center(child: PillButton(label: 'Reporter', onPressed: () {}))));
    final size = tester.getSize(find.byType(TextButton));
    expect(size.height, greaterThanOrEqualTo(48));
    expect(size.width, greaterThanOrEqualTo(48));
  });
}
