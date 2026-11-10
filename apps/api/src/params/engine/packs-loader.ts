import { readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { PackDoc } from './types';

/** Default location of the source packs (monorepo layout); overridable with PACKS_DIR. */
export function defaultPacksDir(): string {
  return process.env.PACKS_DIR || resolve(__dirname, '../../../../../packages/params/packs');
}

export function defaultVectorsDir(): string {
  return process.env.VECTORS_DIR || resolve(defaultPacksDir(), '../vectors');
}

export function loadPacksFromDir(dir = defaultPacksDir()): PackDoc[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as PackDoc);
}

export function loadVectors(name: 'expressions' | 'resolution' | 'reminders', dir = defaultVectorsDir()): any {
  return JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));
}
