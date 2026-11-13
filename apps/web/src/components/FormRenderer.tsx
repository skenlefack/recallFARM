/**
 * Generic form renderer for resolved `form` objects (dossier 12 §6.1).
 * Field types: text, integer, decimal, date, datetime, select, multiselect, boolean, photo, geo, rfid,
 * qr, subject_ref, money, signature, computed. Attributes: required, required_if, visible_if, default,
 * min, max, pattern, help, unit, options, widget. Expressions are evaluated with src/lib/expr.ts and the
 * context { log: <current values>, subject, params, farm, now }.
 */
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { evaluate, truthy, type ExprContext } from '../lib/expr';
import { currencyLabel } from '../lib/format';

export type FieldType =
  | 'text'
  | 'integer'
  | 'decimal'
  | 'date'
  | 'datetime'
  | 'select'
  | 'multiselect'
  | 'boolean'
  | 'photo'
  | 'geo'
  | 'rfid'
  | 'qr'
  | 'subject_ref'
  | 'money'
  | 'signature'
  | 'computed';

export interface FormField {
  code: string;
  type: FieldType | string;
  label?: string;
  required?: boolean;
  required_if?: string;
  visible_if?: string;
  default?: unknown;
  min?: number;
  max?: number;
  pattern?: string;
  help?: string;
  unit?: string;
  options?: string[];
  widget?: string;
  expr?: string;
  currency?: string;
  maps_to?: string;
  sensitive?: boolean;
}

export interface FormDef {
  code: string;
  title?: string;
  fields: FormField[];
}

export type Values = Record<string, unknown>;
export interface RenderContext {
  subject?: Record<string, unknown>;
  params?: Record<string, unknown>;
  farm?: Record<string, unknown>;
  now?: string;
  subjects?: { id: string; label: string }[];
}

const EMPTY = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

export function exprContext(values: Values, ctx: RenderContext): ExprContext {
  return { log: values, subject: ctx.subject ?? {}, params: ctx.params ?? {}, farm: ctx.farm ?? {}, now: ctx.now ?? new Date().toISOString().slice(0, 10) };
}

export function initialValues(form: FormDef, ctx: RenderContext): Values {
  const v: Values = {};
  for (const f of form.fields) {
    if (f.type === 'computed' || f.default === undefined) continue;
    if (typeof f.default === 'string' && !['text', 'select', 'multiselect', 'rfid', 'qr'].includes(f.type)) {
      const r = evaluate(f.default, exprContext(v, ctx));
      v[f.code] = r.ok ? r.value : f.default;
    } else v[f.code] = f.default;
  }
  return v;
}

/** Values with computed fields resolved (computed see the non-computed values). */
export function withComputed(form: FormDef, values: Values, ctx: RenderContext): Values {
  const out: Values = { ...values };
  for (const f of form.fields) {
    if (f.type !== 'computed' || !f.expr) continue;
    const r = evaluate(f.expr, exprContext(out, ctx));
    out[f.code] = r.ok ? r.value : null;
  }
  return out;
}

export function isVisible(f: FormField, values: Values, ctx: RenderContext): boolean {
  return f.visible_if ? truthy(f.visible_if, exprContext(values, ctx), false) : true;
}
export function isRequired(f: FormField, values: Values, ctx: RenderContext): boolean {
  return !!f.required || (f.required_if ? truthy(f.required_if, exprContext(values, ctx), false) : false);
}

/** Returns errors keyed by field code (only visible fields are validated). */
export function validate(form: FormDef, values: Values, ctx: RenderContext, label: (k?: string) => string = (k) => k ?? ''): Record<string, string> {
  const errs: Record<string, string> = {};
  const all = withComputed(form, values, ctx);
  for (const f of form.fields) {
    if (f.type === 'computed' || !isVisible(f, all, ctx)) continue;
    const v = values[f.code];
    if (EMPTY(v)) {
      if (isRequired(f, all, ctx)) errs[f.code] = `${label(f.label) || f.code} est obligatoire.`;
      continue;
    }
    if (f.type === 'integer' || f.type === 'decimal' || f.type === 'money') {
      const n = Number(v);
      if (!Number.isFinite(n)) errs[f.code] = 'Nombre attendu.';
      else if (f.type === 'integer' && !Number.isInteger(n)) errs[f.code] = 'Nombre entier attendu.';
      else if (f.min !== undefined && n < f.min) errs[f.code] = `Minimum ${f.min}${f.unit ? ` ${f.unit}` : ''}.`;
      else if (f.max !== undefined && n > f.max) errs[f.code] = `Maximum ${f.max}${f.unit ? ` ${f.unit}` : ''}.`;
    }
    if (f.pattern && typeof v === 'string') {
      try {
        if (!new RegExp(f.pattern).test(v)) errs[f.code] = f.type === 'rfid' ? 'Numéro de puce : 15 chiffres (ISO 11784).' : 'Format invalide.';
      } catch {
        /* invalid pattern in pack: ignored client-side, reported by studio validation */
      }
    }
    if (f.type === 'select' && f.options && !f.options.includes(String(v))) errs[f.code] = 'Choix invalide.';
  }
  return errs;
}

/** Builds the API payload: standard columns + `attributes` (maps_to = "attributes.x"). */
export function toPayload(form: FormDef, values: Values, ctx: RenderContext): { columns: Values; attributes: Values } {
  const columns: Values = {};
  const attributes: Values = {};
  const all = withComputed(form, values, ctx);
  for (const f of form.fields) {
    if (f.type === 'computed' || !isVisible(f, all, ctx) || EMPTY(values[f.code])) continue;
    const target = f.maps_to ?? `attributes.${f.code}`;
    if (target.startsWith('attributes.')) attributes[target.slice(11)] = values[f.code];
    else columns[target] = values[f.code];
  }
  return { columns, attributes };
}

/* ------------------------------------------------------------- widgets */

function Chips({ id, options, value, onChange, label, multi }: { id: string; options: string[]; value: unknown; onChange: (v: unknown) => void; label: (k: string) => string; multi?: boolean }) {
  const arr = multi ? ((value as string[] | undefined) ?? []) : [];
  return (
    <div className="fr-chips" role="group" aria-labelledby={id}>
      {options.map((o) => {
        const on = multi ? arr.includes(o) : value === o;
        return (
          <button key={o} type="button" aria-pressed={on} className={on ? 'on' : ''} onClick={() => onChange(multi ? (on ? arr.filter((x) => x !== o) : [...arr, o]) : on ? null : o)}>
            {label(o)}
          </button>
        );
      })}
    </div>
  );
}

function SignaturePad({ value, onChange, labelId }: { value: unknown; onChange: (v: unknown) => void; labelId: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext?.('2d');
    if (!c || !ctx) return;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#062B4F';
  }, []);
  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return [((e.clientX - r.left) * ref.current!.width) / r.width, ((e.clientY - r.top) * ref.current!.height) / r.height];
  };
  return (
    <div className="fr-sign">
      <canvas
        ref={ref}
        width={300}
        height={90}
        aria-labelledby={labelId}
        role="img"
        onPointerDown={(e) => {
          const ctx = ref.current?.getContext('2d');
          if (!ctx) return;
          drawing.current = true;
          const [x, y] = pos(e);
          ctx.beginPath();
          ctx.moveTo(x, y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = ref.current?.getContext('2d');
          const [x, y] = pos(e);
          ctx?.lineTo(x, y);
          ctx?.stroke();
        }}
        onPointerUp={() => {
          drawing.current = false;
          onChange(ref.current?.toDataURL?.() ?? 'signed');
        }}
      />
      <button
        type="button"
        className="fr-mini"
        onClick={() => {
          const c = ref.current;
          c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
          onChange(null);
        }}
      >
        {value ? 'Effacer la signature' : 'Signez dans le cadre'}
      </button>
    </div>
  );
}

function FieldInput({ f, value, set, label, ctx, inputId, labelId, invalid, describedBy }: { f: FormField; value: unknown; set: (v: unknown) => void; label: (k?: string) => string; ctx: RenderContext; inputId: string; labelId: string; invalid: boolean; describedBy?: string }) {
  const aria = { 'aria-invalid': invalid || undefined, 'aria-describedby': describedBy } as const;
  switch (f.type) {
    case 'integer':
    case 'decimal': {
      const n = value === null || value === undefined || value === '' ? '' : String(value);
      const step = f.type === 'integer' ? 1 : 'any';
      const num = (s: string) => (s === '' ? null : f.type === 'integer' ? parseInt(s, 10) : parseFloat(s.replace(',', '.')));
      if (f.widget === 'stepper' && f.type === 'integer') {
        const cur = typeof value === 'number' ? value : 0;
        return (
          <div className="fr-stepper">
            <button type="button" aria-label={`Diminuer ${label(f.label)}`} onClick={() => set(Math.max(f.min ?? -Infinity, cur - 1))}>
              −
            </button>
            <input id={inputId} className="fr-input" inputMode="numeric" value={n} onChange={(e) => set(num(e.target.value.replace(/\D/g, '')))} {...aria} />
            <button type="button" aria-label={`Augmenter ${label(f.label)}`} onClick={() => set(Math.min(f.max ?? Infinity, cur + 1))}>
              +
            </button>
          </div>
        );
      }
      return (
        <div className="fr-unit">
          <input id={inputId} className="fr-input" type="number" step={step} min={f.min} max={f.max} inputMode={f.type === 'integer' ? 'numeric' : 'decimal'} value={n} onChange={(e) => set(num(e.target.value))} {...aria} />
          {f.unit && <span>{f.unit}</span>}
        </div>
      );
    }
    case 'money':
      return (
        <div className="fr-unit">
          <input id={inputId} className="fr-input" type="number" min={0} inputMode="numeric" value={value === null || value === undefined ? '' : String(value)} onChange={(e) => set(e.target.value === '' ? null : Number(e.target.value))} {...aria} />
          {f.currency && <span>{currencyLabel(f.currency)}</span>}
        </div>
      );
    case 'date':
    case 'datetime':
      return <input id={inputId} className="fr-input" type={f.type === 'date' ? 'date' : 'datetime-local'} value={(value as string) ?? ''} onChange={(e) => set(e.target.value || null)} {...aria} />;
    case 'boolean':
      return (
        <div className="fr-bool" role="radiogroup" aria-labelledby={labelId}>
          {[
            [true, 'Oui'],
            [false, 'Non'],
          ].map(([v, l]) => (
            <button key={String(v)} type="button" role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => set(value === v ? null : v)}>
              {l as string}
            </button>
          ))}
        </div>
      );
    case 'select': {
      const opts = f.options ?? [];
      if (f.widget === 'chips' || opts.length <= 3) return <Chips id={labelId} options={opts} value={value} onChange={set} label={(k) => label(k)} />;
      return (
        <select id={inputId} className="fr-input" value={(value as string) ?? ''} onChange={(e) => set(e.target.value || null)} {...aria}>
          <option value="">Choisir…</option>
          {opts.map((o) => (
            <option key={o} value={o}>
              {label(o)}
            </option>
          ))}
        </select>
      );
    }
    case 'multiselect':
      return <Chips id={labelId} options={f.options ?? []} value={value} onChange={set} label={(k) => label(k)} multi />;
    case 'subject_ref':
      return (
        <select id={inputId} className="fr-input" value={(value as string) ?? ''} onChange={(e) => set(e.target.value || null)} {...aria}>
          <option value="">Choisir…</option>
          {(ctx.subjects ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      );
    case 'rfid':
    case 'qr':
      return (
        <div className="fr-unit">
          <input id={inputId} className="fr-input mono" inputMode={f.type === 'rfid' ? 'numeric' : 'text'} value={(value as string) ?? ''} onChange={(e) => set(e.target.value || null)} {...aria} />
          <button type="button" className="fr-mini" disabled title="Disponible sur l'application mobile">
            {f.type === 'rfid' ? 'Lire la puce' : 'Scanner'}
          </button>
        </div>
      );
    case 'photo':
      return (
        <div className="fr-unit">
          <label className="fr-mini fr-file">
            {value ? 'Remplacer la photo' : 'Prendre une photo'}
            <input id={inputId} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => set(e.target.files?.[0]?.name ?? null)} {...aria} />
          </label>
          {typeof value === 'string' && <span className="mono small">{value}</span>}
        </div>
      );
    case 'geo': {
      const g = value as { lat: number; lng: number } | null;
      return (
        <div className="fr-unit">
          <button
            id={inputId}
            type="button"
            className="fr-mini"
            onClick={() =>
              navigator.geolocation?.getCurrentPosition(
                (p) => set({ lat: Math.round(p.coords.latitude * 1e5) / 1e5, lng: Math.round(p.coords.longitude * 1e5) / 1e5 }),
                () => set({ lat: 3.866, lng: 11.517 }),
                { timeout: 4000 },
              )
            }
            {...aria}
          >
            Relever la position
          </button>
          {g && (
            <span className="mono small">
              {g.lat}, {g.lng}
            </span>
          )}
        </div>
      );
    }
    case 'signature':
      return <SignaturePad value={value} onChange={set} labelId={labelId} />;
    default:
      return <input id={inputId} className="fr-input" value={(value as string) ?? ''} onChange={(e) => set(e.target.value || null)} {...aria} />;
  }
}

export function FormRenderer({
  form,
  i18n = {},
  ctx = {},
  title,
  compact,
  onSubmit,
  submitLabel = 'Tester la saisie',
}: {
  form: FormDef;
  i18n?: Record<string, string>;
  ctx?: RenderContext;
  title?: string;
  compact?: boolean;
  onSubmit?: (payload: { columns: Values; attributes: Values }) => void;
  submitLabel?: string;
}) {
  const uid = useId();
  const label = useMemo(() => (k?: string) => (k ? (i18n[k] ?? k) : ''), [i18n]);
  const [values, setValues] = useState<Values>(() => initialValues(form, ctx));
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const key = form.code + JSON.stringify(form.fields.map((f) => [f.code, f.type, f.default]));
  // reset when the definition changes
  useEffect(() => {
    setValues(initialValues(form, ctx));
    setTouched({});
    setSubmitted(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const all = withComputed(form, values, ctx);
  const errors = validate(form, values, ctx, label);
  const shown = (code: string) => (submitted || touched[code]) && errors[code];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length === 0) onSubmit?.(toPayload(form, values, ctx));
  };

  return (
    <form className={`fr${compact ? ' fr-compact' : ''}`} onSubmit={submit} noValidate aria-label={title ?? form.title ?? form.code}>
      {title && <span className="fr-title">{title}</span>}
      {form.fields.map((f) => {
        if (!isVisible(f, all, ctx)) return null;
        const inputId = `${uid}-${f.code}`;
        const labelId = `${inputId}-l`;
        const errId = `${inputId}-e`;
        const req = isRequired(f, all, ctx);
        const err = shown(f.code);
        if (f.type === 'computed') {
          const v = all[f.code];
          return (
            <div key={f.code} className="fr-field">
              <span className="fr-label" id={labelId}>
                {label(f.label)} <span className="fr-auto">calculé</span>
              </span>
              <output className="fr-computed mono" aria-labelledby={labelId}>
                {v === null || v === undefined ? '—' : typeof v === 'number' ? String(v).replace('.', ',') : String(v)}
                {f.unit && v !== null && v !== undefined ? ` ${f.unit}` : ''}
              </output>
            </div>
          );
        }
        const group = ['boolean', 'select', 'multiselect', 'signature'].includes(f.type) && !(f.type === 'select' && f.widget !== 'chips' && (f.options?.length ?? 0) > 3);
        return (
          <div key={f.code} className={`fr-field${err ? ' fr-err' : ''}`} onBlur={() => setTouched((t) => (t[f.code] ? t : { ...t, [f.code]: true }))}>
            {group ? (
              <span className="fr-label" id={labelId}>
                {label(f.label)}
                {req && <span className="fr-req" aria-label="obligatoire"> *</span>}
              </span>
            ) : (
              <label className="fr-label" id={labelId} htmlFor={inputId}>
                {label(f.label)}
                {req && <span className="fr-req" aria-label="obligatoire"> *</span>}
              </label>
            )}
            <FieldInput f={f} value={values[f.code]} set={(v) => setValues((s) => ({ ...s, [f.code]: v }))} label={label} ctx={ctx} inputId={inputId} labelId={labelId} invalid={!!err} describedBy={err ? errId : f.help ? `${inputId}-h` : undefined} />
            {f.help && !err && (
              <span id={`${inputId}-h`} className="fr-help">
                {label(f.help)}
              </span>
            )}
            {err && (
              <span id={errId} className="fr-errmsg" role="alert">
                {err}
              </span>
            )}
          </div>
        );
      })}
      {onSubmit && (
        <button type="submit" className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }}>
          {submitLabel}
        </button>
      )}
    </form>
  );
}
