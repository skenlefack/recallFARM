/** Hand-written SVG charts reproducing the designs (no chart library). */
import { useId } from 'react';
import { asPercent, num, shortWeek } from '../lib/format';

/* -------------------------------------------------- weekly line chart */

export function niceMax(v: number, steps = 4): number {
  if (v <= 0) return steps;
  const raw = v / steps;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const nice = [1, 1.5, 2, 2.5, 3, 5, 7.5, 10].map((m) => m * mag).find((m) => m >= raw) ?? 10 * mag;
  return nice * steps;
}

export function WeeklyChart({ data, height = 230 }: { data: { week: string; due: number; confirmed: number }[]; height?: number }) {
  const W = 640;
  const H = 230;
  const x0 = 40;
  const x1 = 630;
  const yTop = 20;
  const yBase = 200;
  const max = niceMax(Math.max(1, ...data.map((d) => Math.max(d.due, d.confirmed))));
  const n = data.length;
  const X = (i: number) => (n <= 1 ? x0 : x0 + ((x1 - x0) * i) / (n - 1));
  const Y = (v: number) => yBase - (v / max) * (yBase - yTop);
  const pts = (k: 'due' | 'confirmed') => data.map((d, i) => `${Math.round(X(i))},${Math.round(Y(d[k]))}`).join(' ');
  const last = data[n - 1];
  const first = data[0];
  const rate = (d?: { due: number; confirmed: number }) => (d && d.due ? Math.round((d.confirmed / d.due) * 100) : 0);
  const label = n
    ? `Courbe : les rappels confirmés passent de ${rate(first)} % à ${rate(last)} % des rappels dus entre ${shortWeek(first.week)} et ${shortWeek(last.week)}`
    : 'Aucune donnée';
  const ticks = [0, 1, 2, 3, 4].map((i) => (max / 4) * i);

  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height} role="img" aria-label={label}>
        <g stroke="#E6EDF4" strokeWidth="1">
          {ticks.map((t) => (
            <line key={t} x1={x0} x2={x1} y1={Y(t)} y2={Y(t)} stroke={t === 0 ? '#C9D8E6' : undefined} />
          ))}
        </g>
        <g fontFamily="IBM Plex Mono, monospace" fontSize="10" fill="#7D93A8" textAnchor="end">
          {ticks.map((t) => (
            <text key={t} x={32} y={Y(t) + 3}>
              {num(t)}
            </text>
          ))}
        </g>
        {n > 0 && (
          <>
            <polyline fill="none" stroke="#7D93A8" strokeWidth="1.5" strokeDasharray="4 4" points={pts('due')} />
            <polygon fill="#0780D8" fillOpacity="0.10" points={`${pts('confirmed')} ${X(n - 1)},${yBase} ${x0},${yBase}`} />
            <polyline fill="none" stroke="#0780D8" strokeWidth="2" points={pts('confirmed')} />
            <circle cx={X(n - 1)} cy={Y(last.confirmed)} r="4.5" fill="#0780D8" stroke="#FFFFFF" strokeWidth="2" />
            <g fontFamily="IBM Plex Mono, monospace" fontSize="10" fill="#7D93A8" textAnchor="middle">
              {data.map((d, i) =>
                (i % 2 === 0 && n - 1 - i >= 2) || i === n - 1 ? (
                  <text key={d.week} x={i === n - 1 ? X(i) - 14 : X(i)} y={218}>
                    {shortWeek(d.week)}
                  </text>
                ) : null,
              )}
            </g>
            <text x={X(n - 1) - 10} y={Y(last.confirmed) - 10} fontFamily="IBM Plex Mono, monospace" fontSize="11" fill="#0B2540" textAnchor="end">
              {num(last.confirmed)} / {num(last.due)}
            </text>
            {data.map((d, i) => (
              <rect key={d.week} x={X(i) - (x1 - x0) / (2 * Math.max(1, n - 1))} y={yTop} width={(x1 - x0) / Math.max(1, n - 1)} height={yBase - yTop} fill="transparent">
                <title>
                  {shortWeek(d.week)} : {num(d.confirmed)} confirmés sur {num(d.due)} dus ({rate(d)} %)
                </title>
              </rect>
            ))}
          </>
        )}
      </svg>
      <table className="sr-only">
        <caption>Rappels dus et confirmés par semaine</caption>
        <thead>
          <tr>
            <th scope="col">Semaine</th>
            <th scope="col">Dus</th>
            <th scope="col">Confirmés</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.week}>
              <td>{shortWeek(d.week)}</td>
              <td>{d.due}</td>
              <td>{d.confirmed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/* ------------------------------------------------------ hex coverage */

export type HexCell = { zone: string; rate: number | null; masked: boolean; q?: number; r?: number; farms?: number };

export function coverageColor(rate: number | null): string {
  if (rate === null) return '#E6EDF4';
  const p = asPercent(rate);
  if (p < 50) return '#FF7D5C';
  if (p < 70) return '#F4B04F';
  if (p < 80) return '#7FA346';
  if (p < 90) return '#A9D25A';
  return '#C8F169';
}

function hexPoints(cx: number, cy: number) {
  return [
    [cx - 20, cy - 12],
    [cx, cy - 24],
    [cx + 20, cy - 12],
    [cx + 20, cy + 12],
    [cx, cy + 24],
    [cx - 20, cy + 12],
  ]
    .map((p) => p.join(','))
    .join(' ');
}

const HEX_W = 40;
const HEX_ROW = 36;

/** Compact honeycomb rows (4, 5, 4, 5…) centred, cells sorted by zone name. */
function honeycomb(cells: HexCell[]): { c: HexCell; x: number; y: number }[] {
  const sorted = [...cells].sort((a, b) => a.zone.localeCompare(b.zone, 'fr'));
  const out: { c: HexCell; x: number; y: number }[] = [];
  let i = 0;
  for (let r = 0; i < sorted.length; r++) {
    const n = r % 2 === 0 ? 4 : 5;
    const row = sorted.slice(i, i + n);
    row.forEach((c, k) => out.push({ c, x: (k - (row.length - 1) / 2) * HEX_W, y: r * HEX_ROW }));
    i += n;
  }
  return out;
}

/**
 * Positions in an SVG of width 300, centred. q/r are axial hex coordinates when any is negative (API spiral),
 * otherwise "offset" rows (odd rows shifted left). A sparse shape falls back to a compact honeycomb.
 */
export function layoutHexes(cells: HexCell[]): (HexCell & { cx: number; cy: number })[] {
  if (!cells.length) return [];
  const hasCoords = cells.every((c) => c.q !== undefined && c.r !== undefined);
  let pts: { c: HexCell; x: number; y: number }[];
  if (hasCoords) {
    const axial = cells.some((c) => (c.q ?? 0) < 0 || (c.r ?? 0) < 0);
    pts = cells.map((c) => {
      const q = c.q!;
      const r = c.r!;
      return axial ? { c, x: HEX_W * (q + r / 2), y: HEX_ROW * r } : { c, x: (r % 2 === 1 ? -20 : 0) + q * HEX_W, y: r * HEX_ROW };
    });
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const area = ((Math.max(...xs) - Math.min(...xs)) / HEX_W + 1) * ((Math.max(...ys) - Math.min(...ys)) / HEX_ROW + 1);
    const unique = new Set(pts.map((p) => `${p.x},${p.y}`)).size;
    if (unique < pts.length || area > cells.length * 2.2) pts = honeycomb(cells);
  } else pts = honeycomb(cells);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const dx = 150 - (Math.min(...xs) + Math.max(...xs)) / 2;
  const dy = 30 - Math.min(...ys);
  return pts.map((p) => ({ ...p.c, cx: p.x + dx, cy: p.y + dy }));
}

export function HexMap({ cells, height = 200, disease }: { cells: HexCell[]; height?: number; disease?: string }) {
  const pid = useId().replace(/:/g, '');
  const placed = layoutHexes(cells);
  const visible = placed.filter((c) => !c.masked && c.rate !== null);
  const lowest = visible.length ? visible.reduce((a, b) => ((a.rate ?? 1) <= (b.rate ?? 1) ? a : b)) : null;
  const maxY = Math.max(200, ...placed.map((c) => c.cy + 30));
  const summary = lowest
    ? `Carte en hexagones de la couverture vaccinale${disease ? ` ${disease}` : ''} par zone, de faible à élevée ; couverture la plus faible : ${lowest.zone} (${Math.round(asPercent(lowest.rate!))} %)`
    : 'Carte en hexagones de la couverture vaccinale par zone';
  const right = lowest && lowest.cx <= 220;
  return (
    <svg viewBox={`0 0 300 ${maxY}`} width="100%" height={height} role="img" aria-label={summary}>
      <defs>
        <pattern id={`hatch-${pid}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="#EEF3F8" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="#C9D8E6" strokeWidth="2" />
        </pattern>
      </defs>
      <g stroke="#FFFFFF" strokeWidth="2">
        {placed.map((c) => (
          <polygon key={c.zone} points={hexPoints(c.cx, c.cy)} fill={c.masked || c.rate === null ? `url(#hatch-${pid})` : coverageColor(c.rate)}>
            <title>{c.masked ? `${c.zone} : masquée (moins de 5 exploitations)` : `${c.zone} : ${Math.round(asPercent(c.rate ?? 0))} %${c.farms ? ` · ${c.farms} exploitations` : ''}`}</title>
          </polygon>
        ))}
      </g>
      {lowest && (
        <g fontFamily="IBM Plex Mono, monospace" fontSize="10" fill="#5B7690">
          {right ? (
            <>
              <line x1={lowest.cx + 10} y1={lowest.cy + 4} x2={lowest.cx + 24} y2={lowest.cy + 12} stroke="#5B7690" />
              <text x={lowest.cx + 26} y={lowest.cy + 16}>
                {lowest.zone}
              </text>
            </>
          ) : (
            <>
              <line x1={lowest.cx - 10} y1={lowest.cy + 4} x2={lowest.cx - 24} y2={lowest.cy + 12} stroke="#5B7690" />
              <text x={lowest.cx - 26} y={lowest.cy + 16} textAnchor="end">
                {lowest.zone}
              </text>
            </>
          )}
        </g>
      )}
    </svg>
  );
}

/* ----------------------------------------------------- protocol frise */

export type FriseEvent = { step: string; label: string; offset_days: number; kind: 'vaccin' | 'soin' | 'jalon' | 'recurrent'; conditional?: boolean; after_step?: string | null };

export function Frise({ events, height = 120, highlight }: { events: FriseEvent[]; height?: number; highlight?: string | null }) {
  const x0 = 20;
  const x1 = 740;
  const maxDay = Math.max(28, ...events.map((e) => e.offset_days));
  const span = Math.ceil(maxDay / 7) * 7;
  const X = (d: number) => x0 + ((x1 - x0) * d) / span;
  const ticks = Array.from({ length: span / 7 + 1 }, (_, i) => i * 7);
  const sorted = [...events].sort((a, b) => a.offset_days - b.offset_days);
  const byStep = new Map(sorted.map((e) => [e.step, e]));
  const label = `Frise : ${sorted.map((e) => (e.kind === 'jalon' ? `${e.label.toLowerCase()} J${e.offset_days}` : `${e.label.toLowerCase()} J${e.offset_days}`)).join(', ')}`;
  return (
    <svg viewBox="0 0 760 120" width="100%" height={height} role="img" aria-label={label}>
      <line x1={x0} y1="60" x2={x1} y2="60" stroke="#C9D8E6" strokeWidth="1.5" />
      <g fontFamily="IBM Plex Mono, monospace" fontSize="10" fill="#7D93A8" textAnchor="middle">
        {ticks.map((t) => (
          <text key={t} x={X(t)} y="104">
            J{t}
          </text>
        ))}
      </g>
      <g stroke="#DCE6F0">
        {ticks.slice(1, -1).map((t) => (
          <line key={t} x1={X(t)} y1="56" x2={X(t)} y2="64" />
        ))}
      </g>
      {sorted.map((e) => {
        const prev = e.after_step ? byStep.get(e.after_step) : undefined;
        if (!prev) return null;
        const a = X(prev.offset_days);
        const b = X(e.offset_days);
        return <path key={`arc-${e.step}`} d={`M${a} 60 Q ${(a + b) / 2} ${60 - Math.min(58, (b - a) / 3.1)} ${b} 60`} fill="none" stroke="#0780D8" strokeDasharray="3 4" strokeWidth="1.2" />;
      })}
      {sorted.map((e, i) => {
        const x = X(e.offset_days);
        const above = i % 2 === 0;
        const ty = above ? 38 : 86;
        const hl = highlight === e.step;
        const anchor = x < 60 ? 'start' : x > 700 && e.kind !== 'jalon' ? 'end' : 'middle';
        const text = e.kind === 'jalon' ? e.label : `${e.label} · J${e.offset_days}`;
        return (
          <g key={e.step}>
            {e.kind === 'jalon' ? (
              <rect x={x - 10} y="50" width="20" height="20" rx="4" fill="#FFFFFF" stroke="#E0951A" strokeWidth="1.5" />
            ) : e.conditional ? (
              <circle cx={x} cy="60" r="7" fill="#FFFFFF" stroke="#5B7690" strokeWidth="1.5" />
            ) : (
              <circle cx={x} cy="60" r="7" fill={e.kind === 'soin' ? '#7FA346' : '#0780D8'} />
            )}
            {hl && <circle cx={x} cy="60" r="12" fill="none" stroke="#0780D8" strokeWidth="1.5" opacity="0.5" />}
            <text
              x={x}
              y={ty}
              fontFamily="IBM Plex Sans, sans-serif"
              fontSize="12"
              fill={e.kind === 'jalon' ? '#B86E00' : e.conditional ? '#3E5A74' : '#0B2540'}
              textAnchor={anchor}
            >
              {text}
            </text>
            <title>
              {e.label} : J{e.offset_days}
              {e.conditional ? ' (conditionnel)' : ''}
            </title>
          </g>
        );
      })}
    </svg>
  );
}

/* ----------------------------------------------------------- sparkline */

export function Sparkline({ values, width = 120, height = 32, color = '#0780D8', label }: { values: number[]; width?: number; height?: number; color?: string; label?: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * (width - 4) + 2},${height - 3 - ((v - min) / range) * (height - 6)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

/* ----------------------------------------------------------- gauge bar */

export function GaugeBar({ value, max, label, valueLabel }: { value: number; max: number; label: string; valueLabel?: string }) {
  const p = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const tone = p >= 95 ? ' crit' : p >= 85 ? ' warn' : '';
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="sms-row">
        <span>{label}</span>
        <span className="mono">{valueLabel ?? `${num(value)} / ${num(max)}`}</span>
      </div>
      <div className={`bar${tone}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-valuetext={valueLabel ?? `${num(value)} sur ${num(max)}`}>
        <span style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}
