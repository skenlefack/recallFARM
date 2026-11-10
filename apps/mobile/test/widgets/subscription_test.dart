// EF-ABO-01 (payment methods from the country pack), EF-ABO-02 (PAY-INIT /
// PAY-PENDING, no double charge, tracking), ENF accessibilite (48 dp, 1.3x).
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:recallfarm/core/api/api_client.dart';
import 'package:recallfarm/core/widgets/common.dart';
import 'package:recallfarm/features/subscription/subscription_screen.dart';

import 'harness.dart';

Map<String, dynamic> plansBody() => {
      'country': 'CM',
      'data': [
        {'code': 'decouverte', 'features': ['carnet'], 'monthly': {'amount_minor': 0, 'currency': 'XAF'}, 'yearly': {'amount_minor': 0, 'currency': 'XAF'}},
        {'code': 'pro', 'features': ['carnet', 'sms'], 'monthly': {'amount_minor': 2500, 'currency': 'XAF'}, 'yearly': {'amount_minor': 25000, 'currency': 'XAF'}},
      ],
      'payment_methods': [
        {'code': 'wave', 'label': 'Wave Cameroun'},
        {'code': 'orange_money', 'label': 'Orange Money'},
      ],
    };

ApiException business(String rule, [Map<String, dynamic> extra = const {}]) =>
    ApiException(code: 'BUSINESS_RULE', message: rule, status: 422, details: {'rule': rule, ...extra});

Future<void> openDialog(WidgetTester t) async {
  await t.ensureVisible(find.text('Choisir Pro'));
  await t.pump();
  await t.tap(find.text('Choisir Pro'));
  await t.pumpAndSettle();
}

void main() {
  const screen = SubscriptionScreen(pollInterval: Duration(seconds: 5), maxPolls: 3);

  testWidgets('payment methods come from GET /plans (pack labels), not from the code', (t) async {
    final rig = Rig(api: FakeApi((m, p, b) => plansBody()));
    await pumpScreen(t, screen, rig);
    await openDialog(t);
    expect(find.text('Wave Cameroun'), findsOneWidget);
    expect(find.text('Orange Money'), findsOneWidget);
    expect(find.text('MTN MoMo'), findsNothing);
  });

  testWidgets('offline: methods fall back to the bundled pack, checkout disabled with a clear message', (t) async {
    final rig = Rig(online: false);
    await pumpScreen(t, screen, rig);
    expect(find.text('Le paiement nécessite une connexion.'), findsWidgets);
    final btn = t.widget<PillButton>(find.byType(PillButton).first);
    expect(btn.onPressed, isNull);
    expect(rig.api.count('POST', '/subscriptions/checkout'), 0);
  });

  testWidgets('PAY-INIT: short refusal message, button usable again, no polling', (t) async {
    final rig = Rig(api: FakeApi((m, p, b) {
      if (p == '/plans') return plansBody();
      throw business('PAY-INIT', {'payment_id': 'p1'});
    }));
    await pumpScreen(t, screen, rig);
    await openDialog(t);
    await t.tap(find.text('Payer'));
    await t.pumpAndSettle();
    expect(find.textContaining('Rien n\'a été débité'), findsOneWidget);
    final btn = t.widget<PillButton>(find.byType(PillButton).first);
    expect(btn.onPressed, isNotNull);
    await t.pump(const Duration(seconds: 20));
    expect(rig.api.calls.where((c) => c.$2.startsWith('/payments')), isEmpty);
  });

  testWidgets('PAY-PENDING: never relaunch, follow GET /payments/:id until confirmed', (t) async {
    var polls = 0;
    final rig = Rig(api: FakeApi((m, p, b) {
      if (p == '/plans') return plansBody();
      if (p == '/subscriptions/checkout') throw business('PAY-PENDING', {'payment_id': 'pay-9'});
      if (p == '/payments/pay-9') return {'status': ++polls < 2 ? 'en_attente' : 'confirme'};
      if (p == '/subscriptions/current') return {'entitlements': {'plan': 'pro'}};
      throw offlineError();
    }));
    await pumpScreen(t, screen, rig);
    await openDialog(t);
    await t.tap(find.text('Payer'));
    await settle(t);
    expect(find.textContaining('Ne relancez pas'), findsOneWidget);
    // Buttons locked while the outcome is unknown.
    expect(t.widget<PillButton>(find.byType(PillButton).first).onPressed, isNull);
    expect(rig.db.kv['subscription.pending_payment_id'], 'pay-9');

    await t.pump(const Duration(seconds: 5));
    await t.pump(const Duration(seconds: 5));
    await t.pump();
    expect(rig.api.count('POST', '/subscriptions/checkout'), 1);
    expect(find.textContaining('Paiement confirmé'), findsOneWidget);
    expect(rig.entitlements.updates, isNotEmpty);
    expect(rig.db.kv.containsKey('subscription.pending_payment_id'), isFalse);
    expect(t.widget<PillButton>(find.byType(PillButton).first).onPressed, isNotNull);
  });

  testWidgets('double tap on Payer sends a single checkout', (t) async {
    final rig = Rig(api: FakeApi((m, p, b) {
      if (p == '/plans') return plansBody();
      if (p == '/subscriptions/checkout') return {'payment_id': 'pay-1', 'status': 'initie'};
      return {'status': 'en_attente'};
    }));
    await pumpScreen(t, screen, rig);
    await openDialog(t);
    final pay = find.text('Payer');
    await t.tap(pay);
    await t.tap(pay, warnIfMissed: false);
    await settle(t);
    expect(rig.api.count('POST', '/subscriptions/checkout'), 1);
    // And the plan button is disabled while sending/following.
    expect(t.widget<PillButton>(find.byType(PillButton).first).onPressed, isNull);
  });

  testWidgets('polling gives up after maxPolls: still pending, no new checkout, "Vérifier maintenant" available',
      (t) async {
    final rig = Rig(api: FakeApi((m, p, b) {
      if (p == '/plans') return plansBody();
      if (p == '/subscriptions/checkout') return {'payment_id': 'pay-2'};
      return {'status': 'en_attente'};
    }));
    await pumpScreen(t, screen, rig);
    await openDialog(t);
    await t.tap(find.text('Payer'));
    await settle(t);
    for (var i = 0; i < 3; i++) {
      await t.pump(const Duration(seconds: 5));
    }
    await t.pump();
    expect(find.textContaining('Ne payez pas une seconde fois'), findsOneWidget);
    expect(t.widget<PillButton>(find.byType(PillButton).first).onPressed, isNull);
    expect(find.text('Vérifier maintenant'), findsOneWidget);
    await t.pump(const Duration(seconds: 30)); // dispose cancels the timer
  });

  testWidgets('network lost during polling: nothing is lost, tracking continues', (t) async {
    var fail = true;
    final rig = Rig(api: FakeApi((m, p, b) {
      if (p == '/plans') return plansBody();
      if (p == '/subscriptions/checkout') return {'payment_id': 'pay-3'};
      if (p == '/payments/pay-3') {
        if (fail) throw offlineError();
        return {'status': 'echoue'};
      }
      throw offlineError();
    }));
    await pumpScreen(t, const SubscriptionScreen(maxPolls: 10), rig);
    await openDialog(t);
    await t.tap(find.text('Payer'));
    await settle(t);
    await t.pump(const Duration(seconds: 5));
    expect(rig.db.kv['subscription.pending_payment_id'], 'pay-3');
    fail = false;
    await t.pump(const Duration(seconds: 5));
    await t.pump();
    expect(find.textContaining('Paiement échoué'), findsOneWidget);
  });

  testWidgets('a pending payment survives a restart and is followed, not relaunched', (t) async {
    final db = FakeDb()..kv['subscription.pending_payment_id'] = 'pay-7';
    final rig = Rig(db: db, api: FakeApi((m, p, b) {
      if (p == '/plans') return plansBody();
      if (p == '/payments/pay-7') return {'status': 'confirme'};
      return {'entitlements': {'plan': 'pro'}};
    }));
    await pumpScreen(t, screen, rig);
    expect(find.textContaining('Ne relancez pas'), findsOneWidget);
    await t.pump(const Duration(seconds: 5));
    await t.pump();
    expect(find.textContaining('Paiement confirmé'), findsOneWidget);
    expect(rig.api.count('POST', '/subscriptions/checkout'), 0);
  });

  for (final size in const [Size(360, 640), Size(412, 915)]) {
    testWidgets('touch targets >= 48 dp and no overflow at 1.3x on ${size.width.toInt()}x${size.height.toInt()}',
        (t) async {
      final rig = Rig(api: FakeApi((m, p, b) => plansBody()));
      await pumpScreen(t, screen, rig, size: size);
      expect(t.getSize(find.byType(PillButton).first).height >= 48, isTrue);
      await openDialog(t);
      for (final label in ['Wave Cameroun', 'Orange Money', 'Payer', 'Annuler']) {
        final r = t.getRect(find.ancestor(of: find.text(label), matching: find.byType(InkWell)).first);
        expect(r.height >= 47.5, isTrue, reason: '$label ${r.height} @ $size');
      }
      expect(t.takeException(), isNull);
    });
  }

  testWidgets('invalid phone is refused before any request', (t) async {
    final rig = Rig(api: FakeApi((m, p, b) => plansBody()));
    await pumpScreen(t, screen, rig);
    await openDialog(t);
    await t.enterText(find.byType(TextField), '12');
    await t.tap(find.text('Payer'));
    await t.pumpAndSettle();
    expect(find.text('Entrez un numéro de téléphone valide.'), findsOneWidget);
    expect(rig.api.count('POST', '/subscriptions/checkout'), 0);
  });
}

/// Closes the dialog and lets async calls finish (a spinner never settles).
Future<void> settle(WidgetTester t) async {
  for (var i = 0; i < 4; i++) {
    await t.pump(const Duration(milliseconds: 100));
  }
}
