/**
 * Moteur de resolution : politiques de surcharge, listes a ajout seul, parametres d'alerte, reglages de ferme
 * (EF-PAR-02, RG-PAR-01, T-42, T-44, T-51). Packs synthetiques : le moteur ne connait aucune espece ni aucun pays.
 */
import { filierePackFor, getObject, getPath, objectKey, objectsOfKind, resolvePacks, selectPacks } from './resolution';
import { OverridePolicy, PackDoc, ParamObject } from './types';

const pack = (name: string, level: PackDoc['level'], objects: ParamObject[], extra: Partial<PackDoc> = {}): PackDoc => ({
  pack: name,
  version: '1.0.0',
  level,
  objects,
  ...extra,
});
const base = (props: Record<string, unknown>, override?: Record<string, OverridePolicy>): ParamObject => ({
  kind: 'thing',
  code: 'c',
  ...props,
  ...(override ? { override } : {}),
});
const resolveTwo = (lower: ParamObject, upper: ParamObject, settings?: Record<string, Record<string, unknown>>) =>
  resolvePacks([pack('global.a', 'global', [lower]), pack('pays.B', 'pays', [upper])], settings);

describe('selectPacks and filierePackFor', () => {
  it('maps every speculation alias to its filiere pack (case insensitive)', () => {
    expect(filierePackFor('Volaille')).toBe('filiere.volaille');
    expect(filierePackFor('aviculture')).toBe('filiere.volaille');
    for (const s of ['chien', 'canin', 'elevage_canin', 'dressage', 'pension_canine']) expect(filierePackFor(s)).toBe('filiere.canin');
    expect(filierePackFor('porcins')).toBe('filiere.porcin');
    expect(filierePackFor('petits_ruminants')).toBe('filiere.petits_ruminants');
    expect(filierePackFor('bovin')).toBe('filiere.bovin');
    expect(filierePackFor('cuniculture')).toBe('filiere.lapin');
    expect(filierePackFor('licorne')).toBeNull();
  });

  it('orders global, filieres, country, organisation packs; ignores unknown and duplicate ones', () => {
    const available = [
      pack('global.core', 'global', []),
      pack('filiere.volaille', 'filiere', []),
      pack('pays.CM', 'pays', []),
      pack('org.x', 'org', []),
    ];
    const names = (farm: Parameters<typeof selectPacks>[1], orgs: string[] = []) => selectPacks(available, farm, orgs).map((p) => p.pack);
    expect(names({ country: 'CM', speculations: ['volaille', 'aviculture', 'licorne', 'chien'] }, ['org.x', 'org.absent', 'org.x'])).toEqual([
      'global.core',
      'filiere.volaille',
      'pays.CM',
      'org.x',
    ]);
    expect(names({})).toEqual(['global.core']);
    expect(names({ country: 'XX', speculations: null })).toEqual(['global.core']);
  });
});

describe('objectKey, getObject, objectsOfKind, getPath', () => {
  it('keys message templates by channel and language', () => {
    expect(objectKey({ kind: 'message_template', code: 'r', channel: 'sms', lang: 'fr' })).toBe('message_template:r:sms:fr');
    expect(objectKey({ kind: 'message_template', code: 'r' })).toBe('message_template:r::');
    expect(objectKey({ kind: 'form', code: 'f' })).toBe('form:f');
  });

  it('reads resolved objects and dotted paths', () => {
    const r = resolvePacks([pack('global.a', 'global', [base({ a: { b: 1 } })])]);
    expect(getObject(r, 'thing', 'c')).toMatchObject({ code: 'c' });
    expect(getObject(r, 'thing', 'zz')).toBeUndefined();
    expect(objectsOfKind(r, 'thing')).toHaveLength(1);
    expect(getPath({ a: { b: 1 } }, 'a.b')).toBe(1);
    expect(getPath({ a: 1 }, 'a.b.c')).toBeUndefined();
  });
});

describe('override policies (RG-PAR-01)', () => {
  it('accepts anything without a policy or with a libre one, and records provenance', () => {
    const r = resolveTwo(base({ n: 1, m: 1 }, { m: { policy: 'libre' } }), base({ n: 2, m: 5, extra: true }));
    expect(getObject(r, 'thing', 'c')).toMatchObject({ n: 2, m: 5, extra: true });
    expect(r.provenance['thing:c']).toMatchObject({ n: 'pays.B@1.0.0', m: 'pays.B@1.0.0', extra: 'pays.B@1.0.0' });
    expect(r.rejected).toEqual([]);
  });

  it('refuses a locked value and says which pack tried', () => {
    const r = resolveTwo(base({ n: 1 }, { n: { policy: 'verrouillee' } }), base({ n: 2 }));
    expect(getObject(r, 'thing', 'c')).toMatchObject({ n: 1 });
    expect(r.rejected).toEqual([{ kind: 'thing', code: 'c', property: 'n', by_pack: 'pays.B@1.0.0', reason: 'verrouillee' }]);
    expect(r.provenance['thing:c'].n).toBe('global.a@1.0.0');
  });

  it('bornee: absolute min/max, discrete values, and deltas', () => {
    const run = (policy: OverridePolicy, oldV: unknown, newV: unknown) => {
      const r = resolveTwo(base({ n: oldV }, { n: policy }), base({ n: newV }));
      return [getObject<ParamObject>(r, 'thing', 'c')!.n, r.rejected.map((x) => x.reason)];
    };
    expect(run({ policy: 'bornee', min: 1, max: 3 }, 2, 3)).toEqual([3, []]);
    expect(run({ policy: 'bornee', min: 1, max: 3 }, 2, 0)).toEqual([2, ['bornee']]);
    expect(run({ policy: 'bornee', min: 1, max: 3 }, 2, 4)).toEqual([2, ['bornee']]);
    expect(run({ policy: 'bornee' }, 2, 100)).toEqual([100, []]);
    expect(run({ policy: 'bornee', min: 1 }, 2, 'x')).toEqual([2, ['bornee']]);
    expect(run({ policy: 'bornee', values: ['a', 'b'] }, 'a', 'b')).toEqual(['b', []]);
    expect(run({ policy: 'bornee', values: ['a', 'b'] }, 'a', 'c')).toEqual(['a', ['bornee']]);
    expect(run({ policy: 'bornee', min_delta: -1, max_delta: 1 }, 10, 11)).toEqual([11, []]);
    expect(run({ policy: 'bornee', min_delta: -1, max_delta: 1 }, 10, 8)).toEqual([10, ['bornee']]);
    expect(run({ policy: 'bornee', min_delta: -1, max_delta: 1 }, 10, 12)).toEqual([10, ['bornee']]);
    expect(run({ policy: 'bornee', min_delta: -1 }, 10, 12)).toEqual([12, []]);
    expect(run({ policy: 'bornee', max_delta: 1 }, 10, 5)).toEqual([5, []]);
    expect(run({ policy: 'bornee', max_delta: 1 }, 'a', 5)).toEqual(['a', ['bornee']]);
  });

  it('ajout_seulement behaves as locked for scalars', () => {
    const r = resolveTwo(base({ n: 1 }, { n: { policy: 'ajout_seulement' } }), base({ n: 2 }));
    expect(r.rejected).toEqual([expect.objectContaining({ property: 'n', reason: 'ajout_seulement' })]);
  });

  it('treats an unknown policy name as free', () => {
    const r = resolveTwo(base({ n: 1 }, { n: { policy: 'inconnue' as never } }), base({ n: 2 }));
    expect(getObject(r, 'thing', 'c')).toMatchObject({ n: 2 });
  });

  it('lets a lower level only add policies for keys not yet governed', () => {
    const r = resolveTwo(base({ n: 1, m: 1 }, { n: { policy: 'verrouillee' } }), base({ override: { n: { policy: 'libre' }, m: { policy: 'verrouillee' } } }));
    const o = getObject<ParamObject>(r, 'thing', 'c')!;
    expect(o.override).toEqual({ n: { policy: 'verrouillee' }, m: { policy: 'verrouillee' } });
    // a non-object override is ignored
    const r2 = resolveTwo(base({ n: 1 }), base({ override: 'x' as never }));
    expect(getObject(r2, 'thing', 'c')!.override).toBeUndefined();
  });
});

describe('alert parameters (params.<key>)', () => {
  const rule = (params: Record<string, unknown>, override?: Record<string, OverridePolicy>) => ({ kind: 'alert_rule', code: 'r', params, ...(override ? { override } : {}) });

  it('governs each threshold by params.<key> or <key>', () => {
    const lower = rule({ seuil: 2, delai: 30 }, { 'params.seuil': { policy: 'bornee', min: 1, max: 5 }, delai: { policy: 'verrouillee' } });
    const r = resolvePacks([pack('global.a', 'global', [lower]), pack('pays.B', 'pays', [rule({ seuil: 9, delai: 60, libre: 1 })])]);
    expect(getObject<ParamObject>(r, 'alert_rule', 'r')!.params).toEqual({ seuil: 2, delai: 30, libre: 1 });
    expect(r.rejected.map((x) => x.property)).toEqual(['params.seuil', 'params.delai']);
    const ok = resolvePacks([pack('global.a', 'global', [lower]), pack('pays.B', 'pays', [rule({ seuil: 4 })])]);
    expect(getObject<ParamObject>(ok, 'alert_rule', 'r')!.params).toMatchObject({ seuil: 4 });
    expect(ok.provenance['alert_rule:r'].params).toBe('pays.B@1.0.0');
  });
});

describe('append-only lists (ajout_seulement)', () => {
  const list = (items: Array<Record<string, unknown>>, override?: Record<string, OverridePolicy>): ParamObject => ({ kind: 'protocol', code: 'p', steps: items, ...(override ? { override } : {}) });

  it('adds new coded items, edits governed fields of existing ones and rejects the rest', () => {
    const lower = list([{ code: 's1', offset_days: 10, disease: 'a' }], { steps: { policy: 'ajout_seulement' }, 'steps.offset_days': { policy: 'bornee', min: 5, max: 15 }, disease: { policy: 'verrouillee' } });
    const upper = list([
      { code: 's1', offset_days: 12, disease: 'b' },
      { code: 's2', offset_days: 40, disease: 'c' },
    ]);
    const r = resolvePacks([pack('global.a', 'global', [lower]), pack('pays.B', 'pays', [upper])]);
    expect((getObject<ParamObject>(r, 'protocol', 'p')!.steps as Array<Record<string, unknown>>)).toEqual([
      { code: 's1', offset_days: 12, disease: 'a' },
      { code: 's2', offset_days: 40, disease: 'c' },
    ]);
    expect(r.rejected).toEqual([expect.objectContaining({ property: 'steps.s1.disease', reason: 'verrouillee' })]);
    const tooFar = resolvePacks([pack('global.a', 'global', [lower]), pack('pays.B', 'pays', [list([{ code: 's1', offset_days: 99 }])])]);
    expect(tooFar.rejected).toEqual([expect.objectContaining({ property: 'steps.s1.offset_days', reason: 'bornee' })]);
  });

  it('falls back to the plain policy when the values are not coded lists', () => {
    const lower: ParamObject = { kind: 'protocol', code: 'p', steps: [{ nocode: 1 }], override: { steps: { policy: 'ajout_seulement' } } };
    const upper: ParamObject = { kind: 'protocol', code: 'p', steps: [{ code: 'x' }] };
    const r = resolvePacks([pack('global.a', 'global', [lower]), pack('pays.B', 'pays', [upper])]);
    expect(r.rejected).toEqual([expect.objectContaining({ property: 'steps', reason: 'ajout_seulement' })]);
  });
});

describe('nested objects governed by dotted policies', () => {
  const nested = (props: Record<string, unknown>, override?: Record<string, OverridePolicy>): ParamObject => ({ kind: 'cfg', code: 'c', ...props, ...(override ? { override } : {}) });

  it('applies each key of a nested object through its own policy', () => {
    const lower = nested({ quiet: { start: '20:00', end: '06:00' } }, { 'quiet.start': { policy: 'verrouillee' } });
    const r = resolvePacks([pack('global.a', 'global', [lower]), pack('pays.B', 'pays', [nested({ quiet: { start: '18:00', end: '07:00' } })])]);
    expect(getObject<ParamObject>(r, 'cfg', 'c')!.quiet).toEqual({ start: '20:00', end: '07:00' });
    expect(r.rejected).toEqual([expect.objectContaining({ property: 'quiet.start', reason: 'verrouillee' })]);
  });

  it('replaces the value wholesale when it is not an object', () => {
    const lower = nested({ quiet: { start: '20:00' } }, { 'quiet.start': { policy: 'verrouillee' } });
    const r = resolvePacks([pack('global.a', 'global', [lower]), pack('pays.B', 'pays', [nested({ quiet: 'off' })])]);
    expect(getObject<ParamObject>(r, 'cfg', 'c')!.quiet).toBe('off');
  });
});

describe('farm settings, i18n and version string', () => {
  it('applies farm overrides through the same policies, skipping unknown objects and non-objects', () => {
    const lower = base({ n: 1, m: 1 }, { n: { policy: 'bornee', min: 1, max: 3 } });
    const packs = [pack('global.a', 'global', [lower])];
    const r = resolvePacks(packs, { 'thing:c': { n: 2, m: 7 }, 'thing:absent': { n: 1 }, 'thing:other': 'x' as never });
    expect(getObject(r, 'thing', 'c')).toMatchObject({ n: 2, m: 7 });
    expect(r.provenance['thing:c'].n).toBe('ferme');
    const refused = resolvePacks(packs, { 'thing:c': { n: 50 } });
    expect(refused.rejected).toEqual([{ kind: 'thing', code: 'c', property: 'n', by_pack: 'ferme', reason: 'bornee' }]);
    expect(resolvePacks(packs, null).rejected).toEqual([]);
  });

  it('merges i18n labels with the most specific level winning, and lists the versions', () => {
    const r = resolvePacks([
      pack('global.a', 'global', [], { i18n: { fr: { a: 'A', b: 'B' } } }),
      pack('pays.B', 'pays', [], { version: '2.1.0', i18n: { fr: { b: 'B2' }, en: { a: 'A' } } }),
      pack('org.C', 'org', [{ kind: 'x', code: 'y' }]),
    ]);
    expect(r.i18n).toEqual({ fr: { a: 'A', b: 'B2' }, en: { a: 'A' } });
    expect(r.param_version).toBe('global.a@1.0.0+pays.B@2.1.0+org.C@1.0.0');
  });

  it('tolerates a pack without objects', () => {
    const p = { pack: 'global.empty', version: '1.0.0', level: 'global' } as unknown as PackDoc;
    expect(resolvePacks([p]).objects).toEqual({});
  });
});

describe('undefined values', () => {
  it('keeps an undefined farm setting undefined instead of cloning it', () => {
    const r = resolvePacks([pack('global.a', 'global', [base({ n: 1 })])], { 'thing:c': { m: undefined } });
    expect(getObject<ParamObject>(r, 'thing', 'c')!.m).toBeUndefined();
  });
});
