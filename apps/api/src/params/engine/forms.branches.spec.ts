/**
 * Moteur de formulaires : tous les types de champ et toutes les conditions (EF-PAR-04, EF-CHE-02, EF-JOU-01, T-51).
 * Formulaires synthetiques : aucune espece ni aucun pays n'est suppose par le moteur.
 */
import { computeFields, FormDef, FormField, validateForm } from './forms';

const ctx = (v: Record<string, unknown>) => ({ subject: v });
const form = (...fields: FormField[]): FormDef => ({ code: 'f', applies_to: 'x', fields });
const errorsOf = (f: FormField, value: unknown) =>
  Object.fromEntries(
    Object.entries(validateForm(form(f), { attributes: { [f.code]: value } }, ctx).errors).map(([k, v]) => [k.replace(/^attributes./, ''), v]),
  );

describe('type checks (EF-PAR-04)', () => {
  it('text-like fields: type, pattern, length bounds', () => {
    const f: FormField = { code: 't', type: 'text', pattern: '^[a-z]+$', min: 2, max: 4 };
    expect(errorsOf(f, 12)).toEqual({ t: 'texte attendu' });
    expect(errorsOf(f, 'AB')).toEqual({ t: 'format invalide' });
    expect(errorsOf({ code: 't', type: 'text', min: 2 }, 'a')).toEqual({ t: 'au moins 2 caractères' });
    expect(errorsOf({ code: 't', type: 'text', max: 2 }, 'abc')).toEqual({ t: 'au plus 2 caractères' });
    expect(errorsOf(f, 'abc')).toEqual({});
    for (const type of ['rfid', 'qr', 'photo', 'signature']) expect(errorsOf({ code: 't', type }, 5)).toEqual({ t: 'texte attendu' });
  });

  it('numbers: finite, integer, bounds', () => {
    expect(errorsOf({ code: 'n', type: 'integer' }, 'x')).toEqual({ n: 'nombre attendu' });
    expect(errorsOf({ code: 'n', type: 'decimal' }, Infinity)).toEqual({ n: 'nombre attendu' });
    expect(errorsOf({ code: 'n', type: 'integer' }, 1.5)).toEqual({ n: 'entier attendu' });
    expect(errorsOf({ code: 'n', type: 'decimal' }, 1.5)).toEqual({});
    expect(errorsOf({ code: 'n', type: 'integer', min: 1 }, 0)).toEqual({ n: 'minimum 1' });
    expect(errorsOf({ code: 'n', type: 'integer', max: 3 }, 4)).toEqual({ n: 'maximum 3' });
    expect(errorsOf({ code: 'n', type: 'integer', min: 1, max: 3 }, 2)).toEqual({});
  });

  it('dates, timestamps, booleans', () => {
    expect(errorsOf({ code: 'd', type: 'date' }, '2026-13-45')).toEqual({ d: 'date attendue (AAAA-MM-JJ)' });
    expect(errorsOf({ code: 'd', type: 'date' }, '2026-11-10')).toEqual({});
    expect(errorsOf({ code: 'd', type: 'datetime' }, 'hier')).toEqual({ d: 'horodatage ISO attendu' });
    expect(errorsOf({ code: 'd', type: 'datetime' }, 12)).toEqual({ d: 'horodatage ISO attendu' });
    expect(errorsOf({ code: 'd', type: 'datetime' }, '2026-11-10T08:00:00Z')).toEqual({});
    expect(errorsOf({ code: 'b', type: 'boolean' }, 'oui')).toEqual({ b: 'booléen attendu' });
    expect(errorsOf({ code: 'b', type: 'boolean' }, false)).toEqual({});
  });

  it('select and multiselect against their options', () => {
    const sel: FormField = { code: 's', type: 'select', options: ['a', 'b'] };
    expect(errorsOf(sel, 'c')).toEqual({ s: 'valeur non autorisée' });
    expect(errorsOf(sel, 'a')).toEqual({});
    expect(errorsOf({ code: 's', type: 'select' }, 'anything')).toEqual({});
    expect(errorsOf({ code: 's', type: 'select', options: [] }, 'anything')).toEqual({});
    const multi: FormField = { code: 'm', type: 'multiselect', options: ['a', 'b'] };
    expect(errorsOf(multi, 'a')).toEqual({ m: 'liste attendue' });
    expect(errorsOf(multi, ['a', 'z'])).toEqual({ m: 'valeur non autorisée' });
    expect(errorsOf(multi, ['a', 'b'])).toEqual({});
    expect(errorsOf({ code: 'm', type: 'multiselect' }, ['q'])).toEqual({});
  });

  it('money needs an integer minor amount and a currency (no float, no hard-coded currency)', () => {
    const f: FormField = { code: 'p', type: 'money' };
    expect(errorsOf(f, 'cher')).toEqual({ p: 'montant attendu' });
    expect(errorsOf(f, { amount_minor: 12.5, currency: 'XAF' })).toEqual({ p: 'montant attendu' });
    expect(errorsOf(f, { amount_minor: 1250, currency: 5 })).toEqual({ p: 'montant attendu' });
    expect(errorsOf(f, { amount_minor: 125050, currency: 'CDF' })).toEqual({});
  });

  it('geo needs numeric lat and lng', () => {
    const f: FormField = { code: 'g', type: 'geo' };
    expect(errorsOf(f, 'ici')).toEqual({ g: 'position attendue' });
    expect(errorsOf(f, { lat: '3.8', lng: 11 })).toEqual({ g: 'position attendue' });
    expect(errorsOf(f, { lat: 3.86, lng: 11.52 })).toEqual({});
  });

  it('unknown types are accepted as is (forward compatibility)', () => {
    expect(errorsOf({ code: 'x', type: 'futur' }, { any: 1 })).toEqual({});
  });
});

describe('conditions, defaults and partial updates (EF-PAR-04, T-51)', () => {
  it('stores standard columns and attributes separately (maps_to)', () => {
    const r = validateForm(
      form({ code: 'name', type: 'text', maps_to: 'name', required: true }, { code: 'ring', type: 'text' }),
      { name: 'B1', attributes: { ring: 'rouge', legacy: 1 } },
      ctx,
    );
    expect(r.errors).toEqual({});
    expect(r.columns).toEqual({ name: 'B1' });
    expect(r.attributes).toEqual({ ring: 'rouge', legacy: 1 });
  });

  it('applies defaults on create but not on partial update', () => {
    const f = form({ code: 'strain', type: 'text', default: 'x' });
    expect(validateForm(f, {}, ctx).attributes).toEqual({ strain: 'x' });
    expect(validateForm(f, {}, ctx, { partial: true }).attributes).toEqual({});
  });

  it('required fields: missing, blank, and tolerated when absent from a partial update', () => {
    const f = form({ code: 'name', type: 'text', maps_to: 'name', required: true });
    expect(validateForm(f, {}, ctx).errors).toEqual({ name: 'obligatoire' });
    expect(validateForm(f, { name: '   ' }, ctx).errors).toEqual({ name: 'obligatoire' });
    expect(validateForm(f, {}, ctx, { partial: true }).errors).toEqual({});
    expect(validateForm(f, { name: '' }, ctx, { partial: true }).errors).toEqual({ name: 'obligatoire' });
    expect(validateForm(f, { name: null }, ctx, { partial: true }).columns).toEqual({ name: null });
  });

  it('clears an optional value sent as an empty string', () => {
    const r = validateForm(form({ code: 'note', type: 'text', maps_to: 'note' }), { note: '' }, ctx);
    expect(r.errors).toEqual({});
    expect(r.columns).toEqual({ note: null });
  });

  it('visible_if hides a field and lifts its requirement', () => {
    const f = form(
      { code: 'kind', type: 'text', maps_to: 'kind' },
      { code: 'eggs', type: 'integer', maps_to: 'eggs', required: true, visible_if: 'subject.kind == "ponte"' },
    );
    expect(validateForm(f, { kind: 'chair' }, ctx).errors).toEqual({});
    expect(validateForm(f, { kind: 'ponte' }, ctx).errors).toEqual({ eggs: 'obligatoire' });
  });

  it('required_if: unevaluable conditions count as false, non-boolean ones are reported', () => {
    const n: FormField = { code: 'n', type: 'integer', maps_to: 'n' };
    const x: FormField = { code: 'x', type: 'integer', maps_to: 'x' };
    // null operand (n absent): false, so not required
    expect(validateForm(form(n, { ...x, required_if: 'subject.n > 1' }), {}, ctx).errors).toEqual({});
    expect(validateForm(form(n, { ...x, required_if: 'subject.n > 1' }), { n: 5 }, ctx).errors).toEqual({ x: 'obligatoire' });
    // non boolean
    expect(validateForm(form(n, { ...x, required_if: '1 + 1' }), { x: 1 }, ctx).errors).toEqual({ x: 'condition non booléenne' });
  });

  it('computed fields are skipped by validation and evaluated for display', () => {
    const f = form({ code: 'rate', type: 'computed', expr: 'subject.a / subject.b' }, { code: 'bad', type: 'computed', expr: '1 / 0' }, { code: 'none', type: 'computed' });
    expect(validateForm(f, {}, ctx).errors).toEqual({});
    expect(computeFields(f, { subject: { a: 1, b: 4 } })).toEqual({ rate: 0.25, bad: null });
  });
});

describe('blank defaults', () => {
  it('stores a blank default of an optional field as null', () => {
    const r = validateForm(form({ code: 'note', type: 'text', maps_to: 'note', default: '' }), {}, ctx);
    expect(r.errors).toEqual({});
    expect(r.columns).toEqual({ note: null });
  });
});
