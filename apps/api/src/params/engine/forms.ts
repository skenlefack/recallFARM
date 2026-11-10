import { isDateString } from '../../common/dates';
import { evaluate } from '../expr';

/** Server-side form engine (dossier 12 §6.1): validates standard columns + `attributes` against a resolved form. */

export interface FormField {
  code: string;
  type: string;
  label?: string;
  required?: boolean;
  required_if?: string;
  visible_if?: string;
  default?: unknown;
  min?: number;
  max?: number;
  pattern?: string;
  options?: unknown[];
  maps_to?: string;
  expr?: string;
  unit?: string;
}

export interface FormDef {
  code: string;
  applies_to: string;
  species?: string;
  fields: FormField[];
}

export interface FormInput {
  /** Standard columns (top level of the request body). */
  [column: string]: unknown;
  attributes?: Record<string, unknown>;
}

export interface FormResult {
  errors: Record<string, string>;
  /** Normalised values (defaults applied), split between columns and attributes. */
  columns: Record<string, unknown>;
  attributes: Record<string, unknown>;
}

function fieldPath(f: FormField): string {
  return f.maps_to ?? `attributes.${f.code}`;
}

function readPath(input: FormInput, path: string): unknown {
  if (path.startsWith('attributes.')) return input.attributes?.[path.slice('attributes.'.length)];
  return input[path];
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/**
 * @param ctxBuilder builds the expression context from the current normalised values
 *        (e.g. `{ subject, log }` for a daily log, `{ subject: values }` for a batch).
 */
export function validateForm(
  form: FormDef,
  input: FormInput,
  ctxBuilder: (values: Record<string, unknown>) => Record<string, unknown>,
  opts: { partial?: boolean } = {},
): FormResult {
  const errors: Record<string, string> = {};
  const columns: Record<string, unknown> = {};
  const attributes: Record<string, unknown> = { ...(input.attributes ?? {}) };
  const values: Record<string, unknown> = {};

  // First pass: collect raw values and defaults.
  for (const f of form.fields) {
    if (f.type === 'computed') continue;
    const path = fieldPath(f);
    let v = readPath(input, path);
    if (v === undefined && f.default !== undefined && !opts.partial) v = f.default;
    values[f.code] = v ?? null;
  }
  const ctx = ctxBuilder(values);
  const cond = (expr: string | undefined, path: string, fallback: boolean): boolean => {
    if (!expr) return fallback;
    const r = evaluate(expr, ctx);
    if (!r.ok) {
      // A condition that cannot be evaluated (e.g. null operand) is considered false.
      return false;
    }
    if (typeof r.value !== 'boolean') {
      errors[path] = `condition non booléenne`;
      return false;
    }
    return r.value;
  };

  for (const f of form.fields) {
    if (f.type === 'computed') continue;
    const path = fieldPath(f);
    const v = values[f.code];
    const visible = cond(f.visible_if, path, true);
    const required = visible && (f.required === true || cond(f.required_if, path, false));
    const present = !isEmpty(v);
    const provided = readPath(input, path) !== undefined;

    if (!present) {
      if (required && !(opts.partial && !provided)) errors[path] = 'obligatoire';
      if (provided || (v !== null && v !== undefined)) assign(path, v === '' ? null : v);
      continue;
    }
    const err = checkType(f, v);
    if (err) {
      errors[path] = err;
      continue;
    }
    assign(path, v);
  }

  function assign(path: string, v: unknown) {
    if (path.startsWith('attributes.')) attributes[path.slice('attributes.'.length)] = v;
    else columns[path] = v;
  }

  return { errors, columns, attributes };
}

function checkType(f: FormField, v: unknown): string | null {
  switch (f.type) {
    case 'text':
    case 'rfid':
    case 'qr':
    case 'photo':
    case 'signature': {
      if (typeof v !== 'string') return 'texte attendu';
      if (f.pattern && !new RegExp(f.pattern).test(v)) return 'format invalide';
      if (typeof f.min === 'number' && v.length < f.min) return `au moins ${f.min} caractères`;
      if (typeof f.max === 'number' && v.length > f.max) return `au plus ${f.max} caractères`;
      return null;
    }
    case 'integer':
    case 'decimal': {
      if (typeof v !== 'number' || !Number.isFinite(v)) return 'nombre attendu';
      if (f.type === 'integer' && !Number.isInteger(v)) return 'entier attendu';
      if (typeof f.min === 'number' && v < f.min) return `minimum ${f.min}`;
      if (typeof f.max === 'number' && v > f.max) return `maximum ${f.max}`;
      return null;
    }
    case 'date':
      return isDateString(v) ? null : 'date attendue (AAAA-MM-JJ)';
    case 'datetime':
      return typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? null : 'horodatage ISO attendu';
    case 'boolean':
      return typeof v === 'boolean' ? null : 'booléen attendu';
    case 'select':
      if (Array.isArray(f.options) && f.options.length && !f.options.includes(v as never)) return 'valeur non autorisée';
      return null;
    case 'multiselect':
      if (!Array.isArray(v)) return 'liste attendue';
      if (Array.isArray(f.options) && f.options.length && v.some((x) => !f.options!.includes(x))) return 'valeur non autorisée';
      return null;
    case 'money': {
      const m = v as { amount_minor?: unknown; currency?: unknown };
      if (typeof m !== 'object' || !Number.isInteger(m.amount_minor) || typeof m.currency !== 'string') return 'montant attendu';
      return null;
    }
    case 'geo': {
      const g = v as { lat?: unknown; lng?: unknown };
      if (typeof g !== 'object' || typeof g.lat !== 'number' || typeof g.lng !== 'number') return 'position attendue';
      return null;
    }
    default:
      return null;
  }
}

/** Evaluates `computed` fields for display (e.g. laying rate). */
export function computeFields(form: FormDef, ctx: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of form.fields) {
    if (f.type !== 'computed' || !f.expr) continue;
    const r = evaluate(f.expr, ctx);
    out[f.code] = r.ok ? r.value : null;
  }
  return out;
}
