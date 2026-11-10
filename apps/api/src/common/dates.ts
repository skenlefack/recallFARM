/** Business-date helpers. Business dates are `YYYY-MM-DD` strings; arithmetic is done in UTC. */

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateString(v: unknown): v is string {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
}

/** Parses `YYYY-MM-DD` or an ISO timestamp into epoch ms (UTC midnight for plain dates). */
export function parseDateMs(v: string): number {
  if (DATE_RE.test(v)) return Date.parse(`${v}T00:00:00Z`);
  return Date.parse(v);
}

export function toDateString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  return toDateString(parseDateMs(date.slice(0, 10)) + n * DAY_MS);
}

/** Whole days from d1 to d2 (truncated toward zero). */
export function daysBetween(d1: string, d2: string): number {
  const a = parseDateMs(d1);
  const b = parseDateMs(d2);
  const diff = (b - a) / DAY_MS;
  const r = Math.trunc(diff);
  return r === 0 ? 0 : r;
}

/** Today's business date in the given IANA time zone (default Africa/Douala). */
export function todayIn(tz = process.env.TZ || 'Africa/Douala', at: Date = new Date()): string {
  return dateIn(at, tz);
}

export function dateIn(at: Date, tz = process.env.TZ || 'Africa/Douala'): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  return parts;
}

/** Local "HH:MM" in the time zone. */
export function timeIn(at: Date, tz = process.env.TZ || 'Africa/Douala'): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(at);
}

/** ISO week string (e.g. 2026-W44) of a business date. */
export function isoWeek(date: string): string {
  const d = new Date(parseDateMs(date));
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day + 3); // Thursday of this week
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((d.getTime() - jan4.getTime()) / DAY_MS - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Monday (YYYY-MM-DD) of an ISO week string. */
export function isoWeekMonday(week: string): string {
  const m = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!m) throw new Error('invalid week');
  const year = Number(m[1]);
  const w = Number(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = (jan4.getUTCDay() + 6) % 7;
  const monday = Date.UTC(year, 0, 4 - jan4Day) + (w - 1) * 7 * DAY_MS;
  return toDateString(monday);
}

export function mondayOf(date: string): string {
  const d = new Date(parseDateMs(date));
  const day = (d.getUTCDay() + 6) % 7;
  return addDays(date, -day);
}
