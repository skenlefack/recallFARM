/** Renders `{{var}}` placeholders of a message template. */
export function renderTemplate(text: string, vars: Record<string, string | number | null | undefined>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => (vars[k] === undefined || vars[k] === null ? '' : String(vars[k])));
}

export function normalisePhone(raw: string): string {
  const s = raw.replace(/[\s.-]/g, '');
  if (/^\+\d{8,15}$/.test(s)) return s;
  if (/^00\d{8,15}$/.test(s)) return `+${s.slice(2)}`;
  if (/^6\d{8}$/.test(s)) return `+237${s}`; // Cameroon mobile without prefix
  return s;
}

export const E164 = /^\+[1-9]\d{7,14}$/;

/** Masks a phone for display to third parties (k-anonymised views, exports). */
export function maskPhone(p: string): string {
  return p.length > 6 ? `${p.slice(0, 6)}••••${p.slice(-2)}` : '••••';
}

export function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  return [headers.join(','), ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(','))].join('\n') + '\n';
}
