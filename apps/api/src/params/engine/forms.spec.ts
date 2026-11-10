import { FormDef, validateForm } from './forms';
import { loadPacksFromDir } from './packs-loader';
import { getObject, resolvePacks, selectPacks } from './resolution';

const resolved = resolvePacks(selectPacks(loadPacksFromDir(), { country: 'CM', speculations: ['volaille', 'chien'] }));
const batchForm = getObject<FormDef>(resolved, 'form', 'batch_volaille')!;
const logForm = getObject<FormDef>(resolved, 'form', 'daily_log_volaille')!;
const dogForm = getObject<FormDef>(resolved, 'form', 'dog')!;

describe('form engine', () => {
  it('accepts a valid batch and applies defaults', () => {
    const r = validateForm(batchForm, { name: 'B03', production_type: 'chair', start_date: '2026-10-20', initial_count: 500 }, (v) => ({ subject: v }));
    expect(r.errors).toEqual({});
    expect(r.attributes.age_at_start_days).toBe(1);
  });

  it('reports required, type and bound errors with field paths', () => {
    const r = validateForm(batchForm, { production_type: 'canard', initial_count: 0, attributes: { age_at_start_days: 'x' } }, (v) => ({ subject: v }));
    expect(r.errors).toMatchObject({
      name: 'obligatoire',
      production_type: 'valeur non autorisée',
      start_date: 'obligatoire',
      initial_count: 'minimum 1',
      'attributes.age_at_start_days': 'nombre attendu',
    });
  });

  it('applies required_if through expressions', () => {
    const ctx = (v: Record<string, unknown>) => ({ subject: { production_type: 'ponte' }, log: v });
    expect(validateForm(logForm, { mortality: 1 }, ctx).errors).toEqual({ eggs: 'obligatoire' });
    const chair = (v: Record<string, unknown>) => ({ subject: { production_type: 'chair' }, log: v });
    expect(validateForm(logForm, { mortality: 1 }, chair).errors).toEqual({});
  });

  it('checks patterns (chip number)', () => {
    const r = validateForm(dogForm, { name: 'Rex', sex: 'M', chip_number: '12AB' }, (v) => ({ subject: v }));
    expect(r.errors).toEqual({ chip_number: 'format invalide' });
  });
});
