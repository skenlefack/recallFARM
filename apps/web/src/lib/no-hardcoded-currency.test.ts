import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regle du depot : montant en unite mineure ISO 4217 + devise recue de l'API ; jamais de devise en dur
 * (ni « FCFA », ni un code ISO ecrit dans le rendu). Les donnees de demonstration (src/mocks) et les tests sont exclus.
 */
export const HARDCODED_CURRENCY = [
  /\b(?:FCFA|F\s?CFA|XAF|XOF)\b/, // libelles et codes de la zone CFA
  /\bcurrency\s*[:=]\s*['"`][A-Za-z]{3}['"`]/, // currency: 'EUR', currency = "USD"
  /\bcurrency\s*=\s*['"`][A-Za-z]{3}['"`]/, // parametre par defaut : (x, currency = 'XAF')
  /['"`](?:EUR|USD|GNF|CDF|MAD|DZD|TND|NGN|GHS)['"`]/,
];

export function findHardcodedCurrency(source: string): string[] {
  const hits: string[] = [];
  source.split(/\r?\n/).forEach((line, i) => {
    // les commentaires ne sont pas rendus
    const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '').replace(/^\s*\*.*$/, '');
    if (HARDCODED_CURRENCY.some((re) => re.test(code))) hits.push(`${i + 1}: ${line.trim()}`);
  });
  return hits;
}

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'mocks' || name === 'test') continue;
      sources(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe('aucune devise codee en dur dans le rendu', () => {
  it('le detecteur reconnait les ecritures interdites', () => {
    expect(findHardcodedCurrency("<span>{num(a)} FCFA</span>")).toHaveLength(1);
    expect(findHardcodedCurrency("export function money(a: number, currency = 'XAF') {}")).toHaveLength(1);
    expect(findHardcodedCurrency("const label = currency === 'XOF' ? 'FCFA' : currency;")).toHaveLength(1);
    expect(findHardcodedCurrency("new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })")).toHaveLength(1);
    expect(findHardcodedCurrency("const c = 'USD';")).toHaveLength(1);
  });

  it('le detecteur laisse passer les devises recues de l\'API et les commentaires', () => {
    expect(findHardcodedCurrency('money(p.amount.amount_minor, p.amount.currency)')).toEqual([]);
    expect(findHardcodedCurrency("new Intl.NumberFormat('fr-FR', { style: 'currency', currency: key })")).toEqual([]);
    expect(findHardcodedCurrency('// XAF/XOF : exposant 0 selon ISO 4217')).toEqual([]);
    expect(findHardcodedCurrency(' * « FCFA » vient du pack')).toEqual([]);
  });

  it('index.html, public/ et vite.config.ts (manifeste PWA) ne contiennent aucune devise en dur', () => {
    const files = ['index.html', 'vite.config.ts'].map((f) => join(process.cwd(), f));
    const pub = join(process.cwd(), 'public');
    for (const name of readdirSync(pub)) if (/\.(html|svg|json|txt|webmanifest|xml)$/.test(name)) files.push(join(pub, name));
    const found = files.flatMap((f) => findHardcodedCurrency(readFileSync(f, 'utf8')).map((h) => `${relative(process.cwd(), f)}:${h}`));
    expect(found).toEqual([]);
  });

  it('src/ (hors mocks et tests) ne contient aucune devise en dur', () => {
    const root = join(process.cwd(), 'src');
    const found = sources(root).flatMap((f) => findHardcodedCurrency(readFileSync(f, 'utf8')).map((h) => `${relative(root, f)}:${h}`));
    expect(found).toEqual([]);
  });
});
