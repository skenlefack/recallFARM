import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:recallfarm/core/theme/typography.dart';
import 'package:recallfarm/core/widgets/shell.dart';

import '../widgets/test_app.dart';

/// Regression (found on the emulator by integration_test/pilot_journey_test.dart):
/// the bottom bar took the whole screen height, the page body got 0 px.
void main() {
  setUpAll(() => RfType.useBundledFonts = false);

  testWidgets('the bottom bar stays a bar; the page body gets the screen', (tester) async {
    tester.view.physicalSize = const Size(360, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(testApp(const AppShell(location: '/livestock', child: Text('CORPS'))));
    final bar = tester.getSize(find.byType(RfBottomNav));
    expect(bar.height, lessThan(120), reason: 'bar height ${bar.height}');
    expect(tester.getTopLeft(find.byType(RfBottomNav)).dy, greaterThan(500));
    expect(find.text('CORPS'), findsOneWidget);
  });
}
