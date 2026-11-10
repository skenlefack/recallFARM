/* eslint-disable no-console */
import { DEMO } from '../seed/demo';

/**
 * Publishes simulated readings for the demo farm sensors through POST /v1/ingest/telemetry.
 * Env: API_URL (default http://localhost:3000/v1), INTERVAL_S (default 30).
 * Flags: --once (single round), --heatwave (Poulailler 2 above 32 °C → critical alert after the profile `for`).
 */
const API = (process.env.API_URL || 'http://localhost:3000/v1').replace(/\/$/, '');
const INTERVAL = Number(process.env.INTERVAL_S || 30) * 1000;
const once = process.argv.includes('--once');
const heatwave = process.argv.includes('--heatwave');
let tick = 0;

function value(slug: string, base: number): number {
  const hour = new Date().getUTCHours() + 1;
  const diurnal = Math.sin(((hour - 8) / 24) * 2 * Math.PI);
  switch (slug) {
    case 'poulailler-1':
      return base - 2 + diurnal * 2.2 + (Math.random() - 0.5) * 0.4;
    case 'poulailler-2':
      return heatwave ? 33.6 + Math.random() * 0.4 : base - 1.5 + diurnal * 1.8 + (Math.random() - 0.5) * 0.4;
    case 'chateau-eau':
      return Math.max(0, base - (tick % 60) * 0.2 + (Math.random() - 0.5));
    case 'ammoniac-p2':
      return base + (Math.random() - 0.5) * 3;
    default:
      return base + tick * 0.5;
  }
}

async function round(): Promise<void> {
  tick++;
  for (const d of DEMO.devices.filter((x) => x.metric)) {
    const v = Math.round(value(d.slug, d.base!) * 10) / 10;
    try {
      const res = await fetch(`${API}/ingest/telemetry`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-device-key': DEMO.deviceKey(d.slug) },
        body: JSON.stringify({ device_id: DEMO.deviceId(d.slug), metric: d.metric, value: v, ts: new Date().toISOString() }),
      });
      const body = (await res.json().catch(() => ({}))) as { alert_id?: string | null };
      console.log(`${new Date().toISOString()} ${d.name.padEnd(28)} ${String(v).padStart(6)} ${d.unit ?? ''} → ${res.status}${body.alert_id ? ` ALERTE ${body.alert_id}` : ''}`);
    } catch (e) {
      console.error(`${d.name}: ${(e as Error).message}`);
    }
  }
}

async function main(): Promise<void> {
  console.log(`IoT simulator → ${API} (${once ? 'once' : `every ${INTERVAL / 1000}s`}${heatwave ? ', heatwave' : ''})`);
  await round();
  if (once) return;
  setInterval(() => void round(), INTERVAL);
}

void main();
