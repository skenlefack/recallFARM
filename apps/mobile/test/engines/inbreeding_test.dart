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
}
