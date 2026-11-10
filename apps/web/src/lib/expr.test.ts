import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { check, evaluate, roundHalfUp, truthy } from './expr';

type Case = { expr: string; value?: unknown; error?: string };
// vitest runs with cwd = apps/web
const vectorsPath = resolve(process.cwd(), '../../packages/params/vectors/expressions.json');
const vectors = JSON.parse(readFileSync(vectorsPath, 'utf8')) as { context: Record<string, unknown>; cases: Case[] };

describe('expression vectors (packages/params/vectors/expressions.json)', () => {
  it('has cases', () => expect(vectors.cases.length).toBeGreaterThan(20));
  for (const c of vectors.cases) {
    it(`${c.expr}  →  ${'error' in c ? 'error ' + c.error : JSON.stringify(c.value)}`, () => {
      const r = evaluate(c.expr, vectors.context);
      if (c.error !== undefined) {
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toBe(c.error);
      } else {
        expect(r).toEqual({ ok: true, value: c.value });
      }
    });
  }
});

describe('expr extras', () => {
  it('enforces the operation budget', () => {
    const big = `sum([${Array.from({ length: 10_001 }, () => '1').join(', ')}])`;
    const r = evaluate(big);
    expect(r).toMatchObject({ ok: false, error: 'budget' });
  });
  it('rounds half away from zero', () => {
    expect(roundHalfUp(0.125, 2)).toBe(0.13);
    expect(roundHalfUp(-0.125, 2)).toBe(-0.13);
  });
  it('checks syntax without evaluating', () => {
    expect(check('animal.sexe == "M"').ok).toBe(true);
    expect(check('animal.sexe ==').ok).toBe(false);
    expect(check('nope(1)')).toMatchObject({ ok: false, error: 'unknown_function' });
  });
  it('truthy falls back on errors and non-booleans', () => {
    expect(truthy("subject.production_type == 'ponte'", { subject: { production_type: 'ponte' } })).toBe(true);
    expect(truthy('log.x + 1 > 0', { log: {} }, true)).toBe(true);
    expect(truthy(undefined, {}, true)).toBe(true);
  });
});
