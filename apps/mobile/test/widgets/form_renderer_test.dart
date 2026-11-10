import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:recallfarm/core/params/form_engine.dart';
import 'package:recallfarm/core/params/resolution.dart';
import 'package:recallfarm/core/theme/typography.dart';
import 'package:recallfarm/features/forms/form_renderer.dart';

import 'test_app.dart';

Resolution _resolution() {
  ParamPack load(String name) =>
      ParamPack.fromJson(jsonDecode(File('assets/packs/$name.json').readAsStringSync()) as Map<String, dynamic>);
  return Resolver.resolve(Resolver.selectPacks(
    [load('global.core'), load('filiere.volaille'), load('filiere.canin'), load('pays.CM')],
    const FarmScope(country: 'CM', speculations: ['volaille', 'chien']),
  ));
}

class _Host extends StatefulWidget {
  const _Host({required this.engine, required this.res, required this.initial});
  final FormEngine engine;
  final Resolution res;
  final Map<String, Object?> initial;

  @override
  State<_Host> createState() => _HostState();
}

class _HostState extends State<_Host> {
  late Map<String, Object?> values = widget.initial;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: FormRenderer(
        engine: widget.engine,
        values: values,
        onChanged: (v) => setState(() => values = v),
        label: (k) => widget.res.label(k, 'fr'),
        exprContext: const {
          'subject': {'production_type': 'ponte'},
          'log': {'present_count': 1978},
        },
        iotValues: const {'water_l': 412},
      ),
    );
  }
}

void main() {
  setUpAll(() async {
    RfType.useGoogleFonts = false;
    await initializeDateFormatting('fr');
  });

  final res = _resolution();
  final engine = FormEngine(FormSpec.fromJson(res.get('form', 'daily_log_volaille')!));

  testWidgets('daily log form: stepper updates the computed laying rate', (tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 1600));
    await tester.pumpWidget(testApp(_Host(engine: engine, res: res, initial: {...engine.initialValues(), 'eggs': 1512})));
    await tester.pumpAndSettle();

    expect(find.text('Œufs ramassés *'), findsOneWidget); // required_if ponte
    expect(find.textContaining('76,4'), findsOneWidget);
    expect(find.text('Poids moyen (g)'), findsNothing); // chair only
    expect(find.text('du compteur connecté'), findsOneWidget); // IoT-filled water

    await tester.tap(find.text('+'));
    await tester.pumpAndSettle();
    expect(find.textContaining('76,5'), findsOneWidget); // 1513 / 1978
    await tester.binding.setSurfaceSize(null);
  });

  testWidgets('behaviour chips are selectable', (tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 1600));
    await tester.pumpWidget(testApp(_Host(engine: engine, res: res, initial: engine.initialValues())));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Toux'));
    await tester.pumpAndSettle();
    final chip = tester.widget<Semantics>(
      find.ancestor(of: find.text('Toux'), matching: find.byWidgetPredicate((w) => w is Semantics && w.properties.selected != null)).first,
    );
    expect(chip.properties.selected, isTrue);
    await tester.binding.setSurfaceSize(null);
  });

  testWidgets('no overflow at 360×640 with text scale 1.3, touch targets ≥ 48 dp', (tester) async {
    await tester.binding.setSurfaceSize(const Size(360, 640));
    final handle = tester.ensureSemantics();
    await tester.pumpWidget(
      testApp(_Host(engine: engine, res: res, initial: engine.initialValues()), textScale: 1.3),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    handle.dispose();
    await tester.binding.setSurfaceSize(null);
  });
}
