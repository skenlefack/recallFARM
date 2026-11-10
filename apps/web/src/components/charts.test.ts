import { describe, expect, it } from 'vitest';
import { layoutHexes, niceMax } from './charts';

// cells as returned by the real API (axial spiral coordinates)
const api = [
  ['Awaé', 0, 0], ['Bikok', -1, 1], ['Elig-Mfomo', 0, 1], ['Esse', 1, 0], ['Evodoula', 1, -1], ['Mbalmayo', 0, -1], ['Mbankomo', -1, 0],
  ['Mfou', -2, 2], ['Monatélé', -1, 2], ['Ngoumou', 0, 2], ['Nkolafamba', 1, 1], ['Obala', 2, 0], ['Okola', 2, -1], ["Sa'a", 2, -2], ['Soa', 1, -2],
].map(([zone, q, r]) => ({ zone: zone as string, q: q as number, r: r as number, rate: 0.8, masked: false }));

describe('layoutHexes', () => {
  it('lays axial coordinates out as a compact, centred honeycomb', () => {
    const pts = layoutHexes(api);
    const xs = pts.map((p) => p.cx);
    const ys = pts.map((p) => p.cy);
    expect(new Set(pts.map((p) => `${p.cx},${p.cy}`)).size).toBe(15);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(4 * 40);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(4 * 36);
    expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(150);
  });
  it('falls back to sorted rows when coordinates are sparse or missing', () => {
    const sparse = api.slice(0, 4).map((c, i) => ({ ...c, q: i * 7, r: i * 5 }));
    const pts = layoutHexes(sparse);
    expect(Math.max(...pts.map((p) => p.cx)) - Math.min(...pts.map((p) => p.cx))).toBeLessThanOrEqual(3 * 40);
    expect(layoutHexes(api.map(({ zone, rate, masked }) => ({ zone, rate, masked }))).length).toBe(15);
  });
  it('rounds chart maxima to readable steps', () => {
    expect(niceMax(508)).toBe(600);
  });
});
