/** French formatting helpers (narrow no-break space thousands separator, comma decimals). */

import { getLocale } from './i18n';

const NNBSP = '\u202F';
const NBSP = '\u00A0';

export function num(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n).replace(/\u00A0/g, NNBSP);
}

/** Accepts a ratio (0..1) or a percentage (>1) and prints "87,4 %". */
export function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined) return '—';
  const p = Math.abs(v) <= 1 ? v * 100 : v;
  return `${num(p, digits)}${NBSP}%`;
}
export function asPercent(v: number): number {
  return Math.abs(v) <= 1 ? v * 100 : v;
}

/** Formats Intl en cache par locale et devise (la construction d'un Intl.NumberFormat est couteuse). */
const currencyFormats = new Map<string, Intl.NumberFormat | null>();
function currencyFormat(currency: string): Intl.NumberFormat | null {
  const tag = getLocale() === 'en' ? 'en' : 'fr-FR';
  const key = `${tag}|${currency.toUpperCase()}`;
  if (!currencyFormats.has(key)) {
    try {
      currencyFormats.set(key, new Intl.NumberFormat(tag, { style: 'currency', currency: currency.toUpperCase() }));
    } catch {
      currencyFormats.set(key, null); // code de devise inconnu de l'environnement
    }
  }
  return currencyFormats.get(key) ?? null;
}

/**
 * Montant en unite mineure ISO 4217 + devise recue de l'API (jamais de devise par defaut).
 * L'exposant (0 pour XAF/XOF, 2 pour EUR...) et le symbole viennent d'Intl, pas du code.
 * Sans devise connue, seul le nombre est affiche : pas d'unite inventee.
 */
export function money(amountMinor: number | null | undefined, currency: string | null | undefined): string {
  if (amountMinor === null || amountMinor === undefined || Number.isNaN(amountMinor)) return '—';
  const f = currency ? currencyFormat(currency) : null;
  if (!f) return currency ? `${num(amountMinor)}${NBSP}${currency}` : num(amountMinor);
  const digits = f.resolvedOptions().maximumFractionDigits ?? 0;
  return f.format(amountMinor / 10 ** digits);
}

/** Libelle court d'une devise (symbole Intl, sinon code ISO), pour un champ de saisie. */
export function currencyLabel(currency: string | null | undefined): string {
  if (!currency) return '';
  const f = currencyFormat(currency);
  return f?.formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency;
}

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MONTHS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

function parse(d: string | Date): Date {
  if (d instanceof Date) return d;
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T00:00:00') : new Date(d);
}

/** "1er nov. 2026" */
export function dateShort(d: string | Date | null | undefined, withYear = true): string {
  if (!d) return '—';
  const x = parse(d);
  const day = x.getDate() === 1 ? '1er' : String(x.getDate());
  return `${day} ${MONTHS[x.getMonth()]}${withYear ? ` ${x.getFullYear()}` : ''}`;
}
export function dateLong(d: string | Date): string {
  const x = parse(d);
  return `${DAYS[x.getDay()]} ${x.getDate() === 1 ? '1er' : x.getDate()} ${MONTHS_LONG[x.getMonth()]} ${x.getFullYear()}`;
}
export function dateTime(d: string | null | undefined): string {
  if (!d) return '—';
  const x = parse(d);
  return `${dateShort(x, false)} · ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
}

/** "2 h", "3 j", "12 min" since a timestamp. */
export function since(d: string | null | undefined, now = Date.now()): string {
  if (!d) return '—';
  const ms = Math.max(0, now - parse(d).getTime());
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${Math.max(1, min)} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.round(h / 24)} j`;
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDaysISO(iso: string, n: number): string {
  const d = parse(iso);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function daysBetween(a: string, b: string): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000);
}
/** "dans 3 jours", "aujourd'hui", "il y a 2 jours" */
export function relDays(iso: string, from = todayISO()): string {
  const n = daysBetween(from, iso);
  if (n === 0) return "aujourd'hui";
  if (n === 1) return 'demain';
  if (n === -1) return 'hier';
  return n > 0 ? `dans ${n} jours` : `il y a ${-n} jours`;
}

export function isoWeek(d = new Date()): { year: number; week: number; start: Date; end: Date } {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() || 7) - 1));
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return { year, week, start, end };
}
/** "Semaine 44 · 26 oct. – 1er nov. 2026" */
export function weekLabel(d = new Date()): string {
  const w = isoWeek(d);
  return `Semaine ${w.week} · ${dateShort(w.start, w.start.getFullYear() !== w.end.getFullYear())} – ${dateShort(w.end)}`;
}
export function weekCode(d = new Date()): string {
  const w = isoWeek(d);
  return `${w.year}-W${String(w.week).padStart(2, '0')}`;
}
/** "2026-W44" → "S44" */
export function shortWeek(code: string): string {
  const m = /W(\d+)/.exec(code);
  return m ? `S${Number(m[1])}` : code;
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.replace(/^(Dr|M\.|Mme)\s+/i, '').split(/[\s-]+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
/** "Aïcha Nana" → "Aïcha N." */
export function shortName(name: string | null | undefined): string {
  if (!name) return 'Utilisateur';
  const p = name.split(' ');
  return p.length > 1 && !/^(Dr|M\.|Mme)$/i.test(p[0]) ? `${p[0]} ${p[p.length - 1][0]}.` : name;
}

export function phone(p: string | null | undefined): string {
  if (!p) return '—';
  const m = /^\+237(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(p.replace(/\s/g, ''));
  return m ? `+237 ${m[1]} ${m[2]} ${m[3]} ${m[4]} ${m[5]}` : p;
}

export const SPECULATION_LABEL: Record<string, string> = {
  volaille: 'Volaille',
  chien: 'Canin',
  porcin: 'Porcins',
  petits_ruminants: 'Petits ruminants',
  bovin: 'Bovins',
  lapin: 'Lapins',
};

export const DISEASE_LABEL: Record<string, string> = {
  newcastle: 'Newcastle',
  gumboro: 'Gumboro',
  marek: 'Marek',
  variole_aviaire: 'Variole aviaire',
  bronchite_infectieuse: 'Bronchite infectieuse',
  rage: 'Rage',
  chppil: 'CHPPiL',
  parvovirose: 'Parvovirose',
  mycoplasme: 'Mycoplasme',
};

export const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrateur',
  agent: 'Agent de terrain',
  veterinaire: 'Vétérinaire',
  membre: 'Membre',
  proprietaire: 'Propriétaire',
  prestataire: 'Prestataire',
  param_author: 'Référent paramétrage',
  param_reviewer: 'Réviseur',
  param_publisher: 'Publieur',
  platform_admin: 'Admin plateforme',
};

export const PLAN_LABEL: Record<string, string> = { decouverte: 'Découverte', pro: 'Pro', structure: 'Structure', institution: 'Institution' };

export function pluralize(n: number, one: string, many: string): string {
  return `${num(n)} ${n > 1 ? many : one}`;
}

/** Heure d'un instant ISO (« 14:32 ») dans le fuseau du pays s'il est connu, sinon celui de l'appareil. */
export function timeOfDay(iso: string, timeZone?: string): string {
  const tag = getLocale() === 'en' ? 'en' : 'fr-FR';
  const d = new Date(iso);
  try {
    return new Intl.DateTimeFormat(tag, { hour: '2-digit', minute: '2-digit', ...(timeZone ? { timeZone } : {}) }).format(d);
  } catch (e) {
    console.warn('[format] fuseau inconnu, heure de l\'appareil', timeZone, e);
    return new Intl.DateTimeFormat(tag, { hour: '2-digit', minute: '2-digit' }).format(d);
  }
}
