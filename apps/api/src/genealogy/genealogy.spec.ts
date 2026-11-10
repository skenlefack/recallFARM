import { coancestry, Pedigree, pedigreeComplete, verdict } from './genealogy';

const ped = (rows: Array<[string, string | null, string | null]>): Pedigree =>
  new Map(rows.map(([id, s, d]) => [id, { id, name: id, sire_id: s, dam_id: d }]));

describe('Wright coefficient', () => {
  it('full siblings → 0.25', () => {
    const p = ped([['A', 'S', 'D'], ['B', 'S', 'D'], ['S', null, null], ['D', null, null]]);
    expect(coancestry(p, 'A', 'B', 3).coef).toBeCloseTo(0.25);
  });
  it('half siblings → 0.125', () => {
    const p = ped([['A', 'S', 'D1'], ['B', 'S', 'D2']]);
    expect(coancestry(p, 'A', 'B', 3).coef).toBeCloseTo(0.125);
  });
  it('first cousins → 0.0625 (threshold) = a_eviter', () => {
    const p = ped([['X', 'P1', 'M1'], ['Y', 'P2', 'M2'], ['P1', 'G', 'GM'], ['P2', 'G', 'GM']]);
    const r = coancestry(p, 'X', 'Y', 3);
    expect(r.coef).toBeCloseTo(0.0625);
    expect(verdict(r.coef, 0.0625)).toBe('a_eviter');
  });
  it('half first cousins → 3.125 % = attention', () => {
    const p = ped([['X', 'P1', 'M1'], ['Y', 'P2', 'M2'], ['P1', 'G', 'GA'], ['P2', 'G', 'GB']]);
    const r = coancestry(p, 'X', 'Y', 3);
    expect(r.coef).toBeCloseTo(0.03125);
    expect(verdict(r.coef, 0.0625)).toBe('attention');
    expect(r.common.map((c) => c.id)).toEqual(['G']);
  });
  it('flags incomplete pedigrees', () => {
    const p = ped([['X', 'P1', null]]);
    expect(pedigreeComplete(p, 'X', 2)).toBe(false);
  });
});
