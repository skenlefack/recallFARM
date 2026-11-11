import 'package:flutter_test/flutter_test.dart';
import 'package:recallfarm/core/params/inbreeding.dart';

void main() {
  // Pedigree of the MobileGenealogie mock-up: V-014 × T-208 share great-grandsire V-002.
  final pedigree = {
    for (final n in const [
      PedigreeNode(id: 'V-014', sireId: 'V-006', damId: 'T-090'),
      PedigreeNode(id: 'T-208', sireId: 'V-009', damId: 'T-151'),
      PedigreeNode(id: 'V-006', sireId: 'V-002', damId: 'T-031'),
      PedigreeNode(id: 'V-009', sireId: 'V-002', damId: 'T-077'),
    ])
      n.id: n,
  };

  test('half-cousins through V-002 → 1/32 (3,13 %)', () {
    final r = Inbreeding(pedigree).check('V-014', 'T-208');
    expect(r.expectedCoef, closeTo(0.03125, 1e-12));
    expect(r.verdict, 'attention');
    expect(r.commonAncestors, ['V-002']);
    expect(r.complete, isFalse);
  });

  test('full siblings → 25 % (à éviter)', () {
    final ped = {
      'A': const PedigreeNode(id: 'A', sireId: 'S', damId: 'D'),
      'B': const PedigreeNode(id: 'B', sireId: 'S', damId: 'D'),
    };
    final r = Inbreeding(ped).check('A', 'B');
    expect(r.expectedCoef, closeTo(0.25, 1e-12));
    expect(r.verdict, 'a_eviter');
  });

  test('unrelated → 0 (ok)', () {
    final r = Inbreeding(pedigree).check('V-006', 'T-151');
    expect(r.expectedCoef, 0);
    expect(r.verdict, 'ok');
  });

  test('inbreedingOf: offspring of full siblings → 25 %, memoised, unknown parents → 0', () {
    // Built at runtime (not const) so the constructor itself is exercised.
    final ped = <String, PedigreeNode>{
      for (final n in [
        // ignore: prefer_const_constructors
        PedigreeNode(id: 'A', sireId: 'S', damId: 'D', label: 'A'),
        // ignore: prefer_const_constructors
        PedigreeNode(id: 'B', sireId: 'S', damId: 'D'),
        // ignore: prefer_const_constructors
        PedigreeNode(id: 'X', sireId: 'A', damId: 'B'),
      ])
        n.id: n,
    };
    final engine = Inbreeding(ped);
    expect(engine.inbreedingOf('X'), closeTo(0.25, 1e-12));
    expect(engine.inbreedingOf('X'), closeTo(0.25, 1e-12), reason: 'memoised value');
    expect(engine.inbreedingOf('S'), 0, reason: 'founder without known parents');
    expect(engine.inbreedingOf('inconnu'), 0);
    expect(Inbreeding(ped, maxGenerations: 0).inbreedingOf('X', 1), 0, reason: 'beyond max depth');
  });

  test('MatingCheckResult.fromJson: API response and defaults', () {
    final r = MatingCheckResult.fromJson({
      'expected_coef': 0.125,
      'verdict': 'a_eviter',
      'common_ancestors': [
        {'id': 'V-002'},
        {'name': 'Rex'},
        {'other': 1},
        'T-031',
      ],
      'threshold': 0.1,
      'complete': false,
    });
    expect(r.expectedCoef, 0.125);
    expect(r.verdict, 'a_eviter');
    expect(r.commonAncestors, ['V-002', 'Rex', '', 'T-031']);
    expect(r.threshold, 0.1);
    expect(r.complete, isFalse);

    final d = MatingCheckResult.fromJson(const {});
    expect(d.expectedCoef, 0);
    expect(d.verdict, 'ok');
    expect(d.commonAncestors, isEmpty);
    expect(d.threshold, Inbreeding.defaultThreshold);
    expect(d.complete, isTrue);
  });
}
