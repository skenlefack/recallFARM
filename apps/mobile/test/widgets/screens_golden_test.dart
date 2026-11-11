// P0.1 / ENF accessibilite: every main screen renders without exception or
// overflow at 360x640 and 412x915, text scale 1.3, with a golden image each, and
// respects the Android tap-target (48 dp) and labelled-target guidelines.
//
// Regenerate goldens with: flutter test --update-goldens test/widgets/screens_golden_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:recallfarm/core/theme/typography.dart';
import 'package:recallfarm/core/util/dates.dart';
import 'package:recallfarm/features/alerts/alerts_screen.dart';
import 'package:recallfarm/features/dogs/dog_profile_screen.dart';
import 'package:recallfarm/features/economy/expenses_screen.dart';
import 'package:recallfarm/features/economy/sales_screen.dart';
import 'package:recallfarm/features/economy/stocks_screen.dart';
import 'package:recallfarm/features/farm_live/farm_live_screen.dart';
import 'package:recallfarm/features/genealogy/genealogy_screen.dart';
import 'package:recallfarm/features/health/health_event_form_screen.dart';
import 'package:recallfarm/features/health/health_screen.dart';
import 'package:recallfarm/features/home/home_screen.dart';
import 'package:recallfarm/features/journal/journal_screen.dart';
import 'package:recallfarm/features/livestock/batch_detail_screen.dart';
import 'package:recallfarm/features/livestock/livestock_screen.dart';
import 'package:recallfarm/features/livestock/subject_form_screen.dart';
import 'package:recallfarm/features/more/more_screen.dart';
import 'package:recallfarm/features/my_data/my_data_screen.dart';
import 'package:recallfarm/features/onboarding/speculation_screen.dart';
import 'package:recallfarm/features/onboarding/account_screen.dart';
import 'package:recallfarm/features/onboarding/consents_screen.dart';
import 'package:recallfarm/features/onboarding/farm_setup_screen.dart';
import 'package:recallfarm/features/alerts/critical_alert_screen.dart';
import 'package:recallfarm/features/health/reminder_detail_screen.dart';
import 'package:recallfarm/features/health/certificate_screen.dart';
import 'package:recallfarm/features/settings/settings_screen.dart';
import 'package:recallfarm/features/subscription/subscription_screen.dart';
import 'package:recallfarm/features/tasks/tasks_screen.dart';

import 'harness.dart';
import 'subscription_test.dart' show plansBody;

const kBatchId = '33333333-3333-4333-8333-333333333333';
const kDogId = '44444444-4444-4444-8444-444444444444';

Rig richRig({bool online = true}) {
  final rig = Rig(online: online, api: FakeApi((m, p, b) {
    if (p == '/plans') return plansBody();
    throw offlineError();
  }));
  rig.db
    ..seed('batches', [
      {
        'id': kBatchId,
        'farm_id': kFarmId,
        'name': 'Bande A1',
        'species': 'volaille',
        'production_type': 'chair',
        'initial_count': 500,
        'start_date': '2026-10-20',
        'status': 'en_cours',
        'attributes': {'age_at_start_days': 1},
        'date_key': '2026-10-20',
        'created_at': '2026-10-20T08:00:00Z',
      }
    ])
    ..seed('dogs', [
      {
        'id': kDogId,
        'farm_id': kFarmId,
        'name': 'Rex',
        'breed': 'Berger',
        'sex': 'M',
        'birth_date': '2023-04-02',
        'attributes': {'role': 'garde'},
        'created_at': '2026-01-02T08:00:00Z',
      }
    ])
    ..seed('health_events', [
      {
        'id': '55555555-5555-4555-8555-555555555555',
        'farm_id': kFarmId,
        'subject_type': 'batch',
        'subject_id': kBatchId,
        'event_type': 'vaccination',
        'disease': 'newcastle',
        'event_date': '2026-10-25',
        'protocol_step': 'newcastle_j7',
        'date_key': '2026-10-25',
      }
    ])
    ..seed('tasks', [
      {
        'id': '66666666-6666-4666-8666-666666666666',
        'farm_id': kFarmId,
        'title': 'Nettoyer les abreuvoirs',
        'due_date': '2026-11-10',
        'status': 'a_faire',
        'date_key': '2026-11-10',
      }
    ])
    ..seed('alerts', [
      {
        'id': '77777777-7777-4777-8777-777777777777',
        'farm_id': kFarmId,
        'severity': 'critique',
        'title': 'Mortalité élevée',
        'rule': 'mortality_high',
        'status': 'ouverte',
        'created_at': '2026-11-09T08:00:00Z',
      }
    ]);
  return rig;
}

class Case {
  Case(this.name, this.build, {this.rig = richRig});
  final String name;
  final Widget Function() build;
  final Rig Function({bool online}) rig;
}

void main() {
  setUpAll(() {
    RfType.useBundledFonts = false;
    Dates.clock = () => DateTime(2026, 11, 10, 12);
  });
  tearDownAll(() => Dates.clock = DateTime.now);

  final cases = <Case>[
    Case('E10_home', () => const HomeScreen()),
    Case('E20_livestock', () => const LivestockScreen()),
    Case('E21_subject_form_batch', () => const SubjectFormScreen(type: 'batch')),
    Case('E22_batch_detail', () => const BatchDetailScreen(id: kBatchId)),
    Case('E24_dog_profile', () => const DogProfileScreen(id: kDogId)),
    Case('E25_genealogy', () => const GenealogyScreen()),
    Case('E30_journal', () => const JournalScreen()),
    Case('E40_health', () => const HealthScreen()),
    Case('E41_health_event_form', () => const HealthEventFormScreen()),
    Case('E50_subscription', () => const SubscriptionScreen()),
    Case('E60_sales', () => const SalesScreen()),
    Case('E61_expenses', () => const ExpensesScreen()),
    Case('E62_stocks', () => const StocksScreen()),
    Case('E65_tasks', () => const TasksScreen()),
    Case('E70_farm_live', () => const FarmLiveScreen()),
    Case('E72_alerts', () => const AlertsScreen()),
    Case('E80_more', () => const MoreScreen()),
    Case('E81_settings', () => const SettingsScreen()),
    Case('E82_my_data', () => const MyDataScreen()),
    Case('E01_speculation', () => const SpeculationScreen()),
    Case('E02_account', () => const AccountScreen()),
    Case('E03_consents', () => const ConsentsScreen()),
    Case('E04_farm_setup', () => const FarmSetupScreen()),
    Case('E23_reminder_detail', () => const ReminderDetailScreen(reminderKey: '$kBatchId:newcastle_j7')),
    Case('E42_certificate', () => const CertificateScreen(eventId: '55555555-5555-4555-8555-555555555555')),
    Case('E60_sale_form', () => const SaleFormScreen()),
    Case('E61_expense_form', () => const ExpenseFormScreen()),
    Case('E62_stock_form', () => const StockMovementFormScreen()),
    Case('E65_task_form', () => const TaskFormScreen()),
    Case('E73_critical_alert', () => const CriticalAlertScreen(alertId: '77777777-7777-4777-8777-777777777777')),
  ];

  for (final size in const [Size(360, 640), Size(412, 915)]) {
    final tag = '${size.width.toInt()}x${size.height.toInt()}';
    for (final c in cases) {
      testWidgets('${c.name} @ $tag x1.3: no overflow, tap targets, golden', (t) async {
        final handle = t.ensureSemantics();
        await pumpScreen(t, c.build(), c.rig(), size: size);
        await t.pump(const Duration(milliseconds: 400));
        expect(t.takeException(), isNull, reason: 'exception or overflow in ${c.name}');
        await expectLater(t, meetsGuideline(androidTapTargetGuideline));
        await expectLater(t, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/${c.name}_$tag.png'));
        handle.dispose();
        await t.pumpWidget(const SizedBox()); // dispose providers (live polling timer)
        await t.pump(const Duration(seconds: 31));
      });
    }
  }

  testWidgets('E50_subscription offline @ 360x640 x1.3 golden', (t) async {
    await pumpScreen(t, const SubscriptionScreen(), richRig(online: false));
    await t.pump(const Duration(milliseconds: 400));
    expect(t.takeException(), isNull);
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/E50_subscription_offline_360x640.png'));
  });
}
