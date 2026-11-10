import { evaluate } from '../expr';
import { loadPacksFromDir, loadVectors } from './packs-loader';
import { computeProtocolReminders, DiseaseInfo, notificationPlan, Protocol, ReminderPlan } from './reminders';
import { getObject, getPath, objectsOfKind, resolvePacks, selectPacks } from './resolution';
import { PackDoc } from './types';

const basePacks = loadPacksFromDir();

describe('vectors/expressions.json', () => {
  const v = loadVectors('expressions');
  for (const c of v.cases as Array<{ expr: string; value?: unknown; error?: string }>) {
    it(`${c.expr}`, () => {
      const r = evaluate(c.expr, v.context);
      if (c.error) {
        expect(r).toMatchObject({ ok: false, error: c.error });
      } else {
        expect(r.ok).toBe(true);
        expect((r as { value: unknown }).value).toEqual(c.value);
      }
    });
  }
});

describe('vectors/resolution.json', () => {
  const v = loadVectors('resolution');
  for (const c of v.cases as any[]) {
    it(c.name, () => {
      const stack = selectPacks(basePacks, c.farm);
      if (c.org_pack) stack.push(c.org_pack as PackDoc);
      const r = resolvePacks(stack, c.farm_settings ?? null);
      const exp = c.expect;
      if (exp.param_version) expect(r.param_version).toBe(exp.param_version);
      if (exp.kind_code) {
        const obj = r.objects[exp.kind_code];
        expect(obj).toBeDefined();
        for (const [k, val] of Object.entries(exp)) {
          if (['kind_code', 'rejected', 'param_version'].includes(k)) continue;
          if (k === 'step_codes') {
            expect((obj.steps as any[]).map((s) => s.code)).toEqual(val);
          } else if (k === 'step_offsets') {
            for (const [code, off] of Object.entries(val as Record<string, number>)) {
              expect((obj.steps as any[]).find((s) => s.code === code)?.offset_days).toBe(off);
            }
          } else {
            expect(getPath(obj, k)).toEqual(val);
          }
        }
      }
      if (exp.rejected) expect(r.rejected).toEqual(exp.rejected);
    });
  }

  it('records provenance per property', () => {
    const r = resolvePacks(selectPacks(basePacks, { country: 'CM', speculations: ['chien'] }));
    expect(r.provenance['vaccination_protocol:chien_cm'].steps).toBe('pays.CM@1.0.0');
    expect(r.provenance['species_profile:chien'].gestation_days).toBe('global.core@1.0.0');
  });
});

describe('vectors/reminders.json', () => {
  const v = loadVectors('reminders');
  const resolved = resolvePacks(selectPacks(basePacks, { country: 'CM', speculations: ['volaille', 'chien'] }));
  const diseases: Record<string, DiseaseInfo> = {};
  for (const d of objectsOfKind<DiseaseInfo>(resolved, 'disease')) diseases[d.code] = d;

  for (const c of v.cases as any[]) {
    it(c.name, () => {
      const protocol = getObject<Protocol>(resolved, 'vaccination_protocol', c.protocol)!;
      const out = computeProtocolReminders(protocol, c.subject, c.events, c.today, diseases).map(
        ({ step, disease, due_date, status, priority, kind }) => ({ step, disease, due_date, status, priority, kind }),
      );
      expect(out).toEqual(c.expected);
    });
  }

  it('notification plan with and without rappels_sms', () => {
    const plan = getObject<ReminderPlan>(resolved, 'reminder_plan', 'plan_rappels_cm')!;
    const np = v.notification_plan;
    expect(notificationPlan(plan, np.reminder_due_date, np.entitlements)).toEqual(np.expected);
    expect(notificationPlan(plan, np.reminder_due_date, [])).toEqual(np.expected_without_sms);
  });
});

describe('expression evaluator extras', () => {
  it('enforces the operation budget', () => {
    const big = Array.from({ length: 6000 }, () => '1').join(' + ');
    expect(evaluate(big)).toMatchObject({ ok: false, error: 'budget' });
  });
  it('treats absent nested fields as null', () => {
    expect(evaluate('a.b.c', { a: {} })).toEqual({ ok: true, value: null });
  });
  it('evaluates if() lazily', () => {
    expect(evaluate('if(true, 1, 1 / 0)')).toEqual({ ok: true, value: 1 });
  });
});
