import { createHash } from 'crypto';

/** Deterministic UUID (v4 layout) derived from a name: keeps the seed idempotent. */
export function demoId(name: string): string {
  const h = createHash('sha1').update(`recallfarm-demo:${name}`).digest('hex');
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const DEMO = {
  phones: {
    marthe: '+237690000001',
    aicha: '+237690000002',
    jeanMarc: '+237690000003',
    mbarga: '+237690000004',
    paul: '+237690000005',
    admin: '+237690000009',
    oncall: '+237690000111',
  },
  orgId: demoId('org:coop-centre'),
  marthe: {
    farmId: demoId('farm:mfou'),
    b01: demoId('batch:B01'),
    b02: demoId('batch:B02'),
    rex: demoId('dog:rex'),
    nala: demoId('dog:nala'),
  },
  /** IoT demo devices (device id, key, metric) — used by `npm run simulate:iot`. */
  devices: [
    { slug: 'gateway', name: 'Passerelle Mfou', type: 'gateway', metric: null, unit: null, base: null },
    { slug: 'poulailler-1', name: 'Poulailler 1', type: 'temp_rh', metric: 'temperature', unit: 'C', base: 28.2 },
    { slug: 'poulailler-2', name: 'Poulailler 2 · température', type: 'temp_rh', metric: 'temperature', unit: 'C', base: 31.4 },
    { slug: 'chateau-eau', name: "Château d'eau", type: 'water_level', metric: 'water_level', unit: '%', base: 72 },
    { slug: 'ammoniac-p2', name: 'Ammoniac P2', type: 'nh3', metric: 'nh3', unit: 'ppm', base: 14 },
    { slug: 'eau-consommee', name: 'Eau consommée', type: 'water_flow', metric: 'water_flow', unit: 'L', base: 412 },
  ] as Array<{ slug: string; name: string; type: string; metric: string | null; unit: string | null; base: number | null }>,
  deviceId: (slug: string) => demoId(`device:${slug}`),
  deviceKey: (slug: string) => `rf-demo-${slug}`,
};
