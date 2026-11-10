/** Small, dependency-free helpers used by the declarative connectors. */

export type Vars = Record<string, string | number | boolean | null | undefined>;

const SINGLE_VAR = /^\{\{\s*([a-z0-9_]+)\s*\}\}$/i;
const ENV_REF = /\$\{env:([A-Z0-9_]+)\}/g;

export class TemplateError extends Error {}

/** Replaces `${env:NAME}` with the environment value; throws if a referenced variable is unset. */
export function resolveEnv(value: string, env: NodeJS.ProcessEnv = process.env): string {
  return value.replace(ENV_REF, (_m, name: string) => {
    const v = env[name];
    if (v === undefined || v === '') throw new TemplateError(`variable d'environnement ${name} absente`);
    return v;
  });
}

/** Lists the environment variables a value (string, object, array) refers to. */
export function envRefs(value: unknown, out = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    for (const m of value.matchAll(ENV_REF)) out.add(m[1]);
  } else if (Array.isArray(value)) {
    value.forEach((v) => envRefs(v, out));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((v) => envRefs(v, out));
  }
  return out;
}

/** One pass over the template: values inserted for {{var}} are never rescanned for ${env:...}. */
const TOKEN = /\{\{\s*([a-z0-9_]+)\s*\}\}|\$\{env:([A-Z0-9_]+)\}/gi;

function renderString(s: string, vars: Vars, encode?: (v: string) => string): string | number | boolean | null {
  const single = SINGLE_VAR.exec(s);
  if (single) {
    if (!(single[1] in vars)) throw new TemplateError(`variable inconnue {{${single[1]}}}`);
    const v = vars[single[1]];
    return v === undefined ? null : v;
  }
  return s.replace(TOKEN, (_m, name: string | undefined, envName: string | undefined) => {
    if (envName) return resolveEnv(`\${env:${envName}}`);
    const key = name as string;
    if (!(key in vars)) throw new TemplateError(`variable inconnue {{${key}}}`);
    const v = vars[key];
    const text = v === undefined || v === null ? '' : String(v);
    return encode ? encode(text) : text;
  });
}

/** Renders a templated value: strings are interpolated, objects and arrays recursively. */
export function render(template: unknown, vars: Vars): unknown {
  if (typeof template === 'string') return renderString(template, vars);
  if (Array.isArray(template)) return template.map((t) => render(t, vars));
  if (template && typeof template === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(template)) out[k] = render(v, vars);
    return out;
  }
  return template;
}

/** Renders to a string (headers; URLs with `encode` = encodeURIComponent). */
export function renderText(template: string, vars: Vars, encode?: (v: string) => string): string {
  const v = renderString(template, vars, encode);
  if (v === null) return '';
  return encode && SINGLE_VAR.test(template) ? encode(String(v)) : String(v);
}

/** True when a templated value (string, object, array) uses {{name}}. */
export function usesVar(template: unknown, name: string): boolean {
  if (typeof template === 'string') return new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`, 'i').test(template);
  if (Array.isArray(template)) return template.some((t) => usesVar(t, name));
  if (template && typeof template === 'object') return Object.values(template).some((t) => usesVar(t, name));
  return false;
}

/** Reads a dot path ("data.items.0.id") in a parsed document. */
export function getPath(doc: unknown, path: string | undefined): unknown {
  if (!path) return undefined;
  let cur: unknown = doc;
  for (const key of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const i = Number(key);
      cur = Number.isInteger(i) ? cur[i] : undefined;
    } else if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return cur;
}

export function getString(doc: unknown, path: string | undefined): string | undefined {
  const v = getPath(doc, path);
  if (v === undefined || v === null) return undefined;
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

/** Writes an E.164 number ("+2376...") in the format a provider expects. */
export function formatPhone(e164: string, format: 'e164' | 'e164_no_plus' | 'national' = 'e164', nationalPrefix?: string): string {
  const digits = e164.replace(/^\+/, '');
  if (format === 'e164_no_plus') return digits;
  if (format === 'national') {
    if (nationalPrefix && digits.startsWith(nationalPrefix)) return digits.slice(nationalPrefix.length);
    return digits;
  }
  return `+${digits}`;
}

/** Normalises an inbound number to E.164 when it arrives without "+". */
export function toE164(raw: string, nationalPrefix?: string): string {
  const s = raw.trim().replace(/[\s.-]/g, '');
  if (s.startsWith('+')) return s;
  if (s.startsWith('00')) return `+${s.slice(2)}`;
  if (nationalPrefix && !s.startsWith(nationalPrefix)) return `+${nationalPrefix}${s}`;
  return `+${s}`;
}

/* GSM 03.38 basic set and extension table (extension characters count twice). */
const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXT = '^{}\\[~]|€\f';

/** Fills concatenated segments one by one: a character (2 septets, or a surrogate pair) is never split across two parts. */
function fillSegments(sizes: number[], single: number, part: number): number {
  const total = sizes.reduce((a, b) => a + b, 0);
  if (total <= single) return 1;
  let segments = 1;
  let used = 0;
  for (const size of sizes) {
    if (used + size > part) {
      segments++;
      used = 0;
    }
    used += size;
  }
  return segments;
}

/** Counts SMS segments: GSM-7 (160 / 153 per part) or UCS-2 (70 / 67 per part), as a phone splits them (m14). */
export function smsSegments(text: string): { encoding: 'gsm7' | 'ucs2'; units: number; segments: number } {
  const septets: number[] = [];
  let gsm = true;
  for (const ch of text) {
    if (GSM7_BASIC.includes(ch)) septets.push(1);
    else if (GSM7_EXT.includes(ch)) septets.push(2);
    else {
      gsm = false;
      break;
    }
  }
  if (gsm) return { encoding: 'gsm7', units: septets.reduce((a, b) => a + b, 0), segments: fillSegments(septets, 160, 153) };
  // UCS-2 counts UTF-16 code units (characters outside the BMP use two).
  const units = [...text].map((ch) => ch.length);
  return { encoding: 'ucs2', units: text.length, segments: fillSegments(units, 70, 67) };
}

/** Minor-unit exponent of an ISO 4217 currency (XAF → 0, EUR → 2), from the runtime's ICU data. */
export function currencyExponent(currency: string): number {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

/** Integer minor units → decimal string in major units, without floating point ("2500" XAF → "2500", 1999 EUR → "19.99"). */
export function amountMajor(amountMinor: number, currency: string): string {
  const exp = currencyExponent(currency);
  if (!Number.isInteger(amountMinor)) throw new TemplateError('montant non entier');
  if (exp === 0) return String(amountMinor);
  const neg = amountMinor < 0;
  const s = String(Math.abs(amountMinor)).padStart(exp + 1, '0');
  return `${neg ? '-' : ''}${s.slice(0, -exp)}.${s.slice(-exp)}`;
}
