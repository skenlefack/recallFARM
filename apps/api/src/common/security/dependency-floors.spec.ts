/**
 * Planchers de version des dependances d'execution corrigees pour des CVE HIGH (scan Trivy de l'image API).
 * Si une mise a jour du verrou fait redescendre l'une d'elles sous le plancher, ce test echoue avant la CI.
 * Voir docs/security/cve-image-api.md (origine, correctif, atteignabilite de chaque CVE).
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';

type Floor = { pkg: string; via: string[]; min: string; cves: string[] };

const FLOORS: Floor[] = [
  { pkg: 'body-parser', via: ['@nestjs/platform-express'], min: '1.20.9', cves: ['CVE-2026-111181'] },
  { pkg: 'body-parser', via: ['@nestjs/platform-express', 'express'], min: '1.20.9', cves: ['CVE-2026-111181'] },
  {
    pkg: 'multer',
    via: ['@nestjs/platform-express'],
    min: '2.5.0',
    cves: ['CVE-2026-113872', 'CVE-2026-2359', 'CVE-2026-3304', 'CVE-2026-3520', 'CVE-2026-5079', 'CVE-2026-77078', 'CVE-2026-82333'],
  },
  { pkg: 'js-yaml', via: ['@nestjs/swagger'], min: '4.3.2', cves: ['CVE-2026-59869', 'CVE-2026-84375', 'GHSA-5p4m-2wfm-xmqj'] },
  { pkg: 'lodash', via: ['@nestjs/swagger'], min: '4.18.0', cves: ['CVE-2026-4800'] },
  // xlsx (CVE-2023-30533, CVE-2024-22363) : aucun correctif sur le registre npm (0.18.5 = derniere version),
  // decision ouverte Q-SEC-01 dans docs/plan/questions.md ; plancher a ajouter une fois tranchee.
];

/** Compare deux versions x.y.z (sans pre-version) ; < 0 si a < b. */
function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).slice(0, 3).map(Number);
  const pb = b.split(/[.+-]/).slice(0, 3).map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** Version installee de `pkg` telle que la resout le dernier paquet de la chaine `via` (racine si vide). */
function installedVersion(pkg: string, via: string[]): string {
  let base = join(__dirname, '..', '..', '..');
  for (const parent of via) base = dirname(require.resolve(`${parent}/package.json`, { paths: [base] }));
  const file = require.resolve(`${pkg}/package.json`, { paths: [base] });
  return (JSON.parse(readFileSync(file, 'utf8')) as { version: string }).version;
}

describe('planchers de version des dependances (CVE HIGH de l image API)', () => {
  it('compareVersions ordonne correctement', () => {
    expect(compareVersions('1.20.4', '1.20.9')).toBeLessThan(0);
    expect(compareVersions('2.5.0', '2.5.0')).toBe(0);
    expect(compareVersions('0.20.3', '0.20.2')).toBeGreaterThan(0);
    expect(compareVersions('4.18.1', '4.17.21')).toBeGreaterThan(0);
  });

  it.each(FLOORS.map((f) => [`${[...f.via, f.pkg].join(' > ')} >= ${f.min}`, f] as const))('%s', (_label, f) => {
    const v = installedVersion(f.pkg, f.via);
    expect({ pkg: f.pkg, version: v, ok: compareVersions(v, f.min) >= 0 }).toEqual({ pkg: f.pkg, version: v, ok: true });
  });
});
