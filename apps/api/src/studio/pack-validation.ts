import { collectCalls, isKnownFunction, parse } from '../params/expr';
import { ExprError } from '../params/expr/errors';
import { objectKey, resolvePacks } from '../params/engine/resolution';
import { PackDoc } from '../params/engine/types';

export interface ValidationIssue {
  path: string;
  message: string;
}

export const KNOWN_KINDS = [
  'species_profile', 'production_type', 'form', 'kpi', 'vaccination_protocol', 'task_template', 'alert_rule', 'checklist', 'projection_model',
  'workflow', 'message_template', 'plan', 'plan_price', 'payment_method', 'export_mapping', 'sensor_profile', 'disease', 'unit', 'currency',
  'stock_item', 'reminder_plan', 'ussd_menu', 'i18n',
];
const POLICIES = ['libre', 'bornee', 'ajout_seulement', 'verrouillee'];
const FIELD_TYPES = ['text', 'integer', 'decimal', 'date', 'datetime', 'select', 'multiselect', 'boolean', 'photo', 'geo', 'rfid', 'qr', 'subject_ref', 'money', 'signature', 'computed'];
const SEMVER = /^\d+\.\d+\.\d+$/;

function checkExpr(expr: unknown, path: string, out: ValidationIssue[]): void {
  if (typeof expr !== 'string') {
    out.push({ path, message: 'expression attendue (chaîne)' });
    return;
  }
  try {
    const node = parse(expr);
    for (const fn of collectCalls(node)) {
      if (!isKnownFunction(fn)) out.push({ path, message: `fonction inconnue : ${fn}` });
    }
  } catch (e) {
    out.push({ path, message: e instanceof ExprError ? `expression invalide (${e.code}) : ${e.message}` : 'expression invalide' });
  }
}

export function semverSatisfies(version: string, range: string): boolean {
  const v = version.split('.').map(Number);
  const r = range.replace(/^[\^~]/, '').split('.').map(Number);
  if (range.startsWith('^')) return v[0] === r[0] && (v[1] > r[1] || (v[1] === r[1] && v[2] >= r[2]));
  if (range.startsWith('~')) return v[0] === r[0] && v[1] === r[1] && v[2] >= r[2];
  return version === range.replace(/^=/, '');
}

/**
 * Static validation of a pack (schema, expression types, override policies — RG-PAR-01).
 * `stackWith(doc)` returns the resolution stack with the candidate inserted at its level.
 */
export function validatePack(
  doc: PackDoc,
  expected: { code: string; level: string },
  stackWith: (doc: PackDoc) => PackDoc[],
  published: Array<{ pack: string; version: string }>,
  inherited: Set<string> = new Set(),
): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (!doc || typeof doc !== 'object') return [{ path: '', message: 'document JSON attendu' }];
  if (doc.pack !== expected.code) out.push({ path: 'pack', message: `doit valoir ${expected.code}` });
  if (typeof doc.version !== 'string' || !SEMVER.test(doc.version)) out.push({ path: 'version', message: 'version sémantique attendue (x.y.z)' });
  if (doc.level !== expected.level) out.push({ path: 'level', message: `doit valoir ${expected.level}` });
  if (!Array.isArray(doc.objects)) return [...out, { path: 'objects', message: 'liste attendue' }];
  for (const [dep, range] of Object.entries(doc.requires ?? {})) {
    if (!published.some((p) => p.pack === dep && semverSatisfies(p.version, String(range)))) {
      out.push({ path: `requires.${dep}`, message: `dépendance non satisfaite (${range})` });
    }
  }
  const seen = new Set<string>();
  doc.objects.forEach((o, i) => {
    const p = `objects[${i}]`;
    if (!o || typeof o !== 'object') {
      out.push({ path: p, message: 'objet attendu' });
      return;
    }
    if (!KNOWN_KINDS.includes(o.kind)) out.push({ path: `${p}.kind`, message: `type inconnu : ${String(o.kind)}` });
    if (typeof o.code !== 'string' || !/^[a-z0-9_]+$/.test(o.code)) out.push({ path: `${p}.code`, message: 'code snake_case attendu' });
    const key = objectKey(o);
    if (seen.has(key)) out.push({ path: `${p}.code`, message: `doublon ${key}` });
    seen.add(key);
    const isOverride = inherited.has(`${o.kind}:${o.code}`) || inherited.has(key);
    for (const prop of ['when', 'expr']) if (o[prop] !== undefined) checkExpr(o[prop], `${p}.${prop}`, out);
    if (!isOverride && o.kind === 'kpi' && o.expr === undefined) out.push({ path: `${p}.expr`, message: 'expression obligatoire' });
    if (!isOverride && o.kind === 'alert_rule' && o.when === undefined) out.push({ path: `${p}.when`, message: 'condition obligatoire' });
    if (o.kind === 'sensor_profile' && (o.default_alert as { when?: unknown })?.when !== undefined) {
      checkExpr((o.default_alert as { when: unknown }).when, `${p}.default_alert.when`, out);
    }
    if (o.kind === 'workflow' && o.guard && typeof o.guard === 'object') {
      for (const [k, v] of Object.entries(o.guard as Record<string, unknown>)) checkExpr(v, `${p}.guard.${k}`, out);
    }
    if (o.kind === 'form') {
      if (!Array.isArray(o.fields)) out.push({ path: `${p}.fields`, message: 'liste de champs attendue' });
      else {
        const codes = new Set<string>();
        (o.fields as Array<Record<string, unknown>>).forEach((f, j) => {
          const fp = `${p}.fields[${j}]`;
          if (typeof f.code !== 'string') out.push({ path: `${fp}.code`, message: 'code attendu' });
          else if (codes.has(f.code)) out.push({ path: `${fp}.code`, message: 'champ en double' });
          else codes.add(f.code);
          if (!FIELD_TYPES.includes(f.type as string)) out.push({ path: `${fp}.type`, message: `type de champ inconnu : ${String(f.type)}` });
          for (const ek of ['visible_if', 'required_if', 'expr']) if (f[ek] !== undefined) checkExpr(f[ek], `${fp}.${ek}`, out);
          if (f.type === 'computed' && f.expr === undefined) out.push({ path: `${fp}.expr`, message: 'expression obligatoire pour un champ calculé' });
          if (f.pattern !== undefined) {
            try {
              new RegExp(String(f.pattern));
            } catch {
              out.push({ path: `${fp}.pattern`, message: 'expression régulière invalide' });
            }
          }
          if (typeof f.min === 'number' && typeof f.max === 'number' && f.min > f.max) out.push({ path: `${fp}.min`, message: 'min > max' });
          if (f.type === 'select' && f.options !== undefined && !Array.isArray(f.options)) out.push({ path: `${fp}.options`, message: 'liste attendue' });
        });
      }
    }
    if (o.kind === 'vaccination_protocol') {
      if (!isOverride && typeof o.reference !== 'string') out.push({ path: `${p}.reference`, message: 'référence obligatoire (start_date | birth_date)' });
      if (o.steps !== undefined && !Array.isArray(o.steps)) out.push({ path: `${p}.steps`, message: 'liste attendue' });
      (Array.isArray(o.steps) ? (o.steps as Array<Record<string, unknown>>) : []).forEach((s, j) => {
        const sp = `${p}.steps[${j}]`;
        if (typeof s.code !== 'string') out.push({ path: `${sp}.code`, message: 'code attendu' });
        if (s.offset_days !== undefined && (!Number.isInteger(s.offset_days) || (s.offset_days as number) < 0)) out.push({ path: `${sp}.offset_days`, message: 'entier ≥ 0 attendu' });
      });
      const rec = o.recurring as Record<string, unknown> | undefined;
      if (rec && rec.every_days !== undefined && (!Number.isInteger(rec.every_days) || (rec.every_days as number) <= 0)) {
        out.push({ path: `${p}.recurring.every_days`, message: 'entier > 0 attendu' });
      }
    }
    if (o.override !== undefined) {
      if (typeof o.override !== 'object' || o.override === null) out.push({ path: `${p}.override`, message: 'objet attendu' });
      else
        for (const [k, pol] of Object.entries(o.override)) {
          if (!POLICIES.includes((pol as { policy?: string })?.policy ?? '')) out.push({ path: `${p}.override.${k}`, message: 'politique inconnue' });
        }
    }
  });
  // Override policies of upper levels (RG-PAR-01): refused at publication.
  try {
    const r = resolvePacks(stackWith(doc));
    for (const rej of r.rejected.filter((x) => x.by_pack === `${doc.pack}@${doc.version}`)) {
      out.push({ path: `${rej.kind}:${rej.code}.${rej.property}`, message: `surcharge refusée (${rej.reason})` });
    }
  } catch (e) {
    out.push({ path: '', message: `résolution impossible : ${(e as Error).message}` });
  }
  return out;
}

export interface DiffEntry {
  op: '+' | '-' | '~';
  path: string;
  from?: unknown;
  to?: unknown;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function diffValues(a: unknown, b: unknown, path: string, out: DiffEntry[]): void {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (isObj(a) && isObj(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in a)) out.push({ op: '+', path: `${path}.${k}`, to: b[k] });
      else if (!(k in b)) out.push({ op: '-', path: `${path}.${k}`, from: a[k] });
      else diffValues(a[k], b[k], `${path}.${k}`, out);
    }
    return;
  }
  const coded = (l: unknown) => Array.isArray(l) && l.every((x) => isObj(x) && typeof x.code === 'string');
  if (coded(a) && coded(b)) {
    const la = a as Array<Record<string, unknown>>;
    const lb = b as Array<Record<string, unknown>>;
    for (const x of la) {
      const y = lb.find((e) => e.code === x.code);
      if (!y) out.push({ op: '-', path: `${path}.${String(x.code)}`, from: x });
      else diffValues(x, y, `${path}.${String(x.code)}`, out);
    }
    for (const y of lb) if (!la.some((e) => e.code === y.code)) out.push({ op: '+', path: `${path}.${String(y.code)}`, to: y });
    return;
  }
  out.push({ op: '~', path, from: a, to: b });
}

/** Changes from `base` (published) to `next` (draft), by object key then property. */
export function diffPacks(base: PackDoc | null, next: PackDoc): DiffEntry[] {
  const out: DiffEntry[] = [];
  const index = (d: PackDoc | null) => new Map((d?.objects ?? []).map((o) => [objectKey(o), o]));
  const a = index(base);
  const b = index(next);
  for (const [k, o] of a) if (!b.has(k)) out.push({ op: '-', path: k, from: o });
  for (const [k, o] of b) {
    if (!a.has(k)) out.push({ op: '+', path: k, to: o });
    else diffValues(a.get(k), o, k, out);
  }
  diffValues(base?.i18n ?? {}, next.i18n ?? {}, 'i18n', out);
  return out;
}
