/**
 * Chargement des packs et des vecteurs : le dossier vient de l'environnement ou de la disposition du monorepo.
 * Le test fixe lui-meme les variables, pour que la couverture ne depende pas de l'environnement de la CI (RG-PAR-02).
 */
import { defaultPacksDir, defaultVectorsDir, loadPacksFromDir, loadVectors } from './packs-loader';

describe('packs loader', () => {
  const saved = { packs: process.env.PACKS_DIR, vectors: process.env.VECTORS_DIR };
  const restore = (key: 'PACKS_DIR' | 'VECTORS_DIR', value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  afterEach(() => {
    restore('PACKS_DIR', saved.packs);
    restore('VECTORS_DIR', saved.vectors);
  });

  it('uses the monorepo layout without environment variables', () => {
    delete process.env.PACKS_DIR;
    delete process.env.VECTORS_DIR;
    expect(defaultPacksDir().replace(/\\/g, '/')).toMatch(/packages\/params\/packs$/);
    expect(defaultVectorsDir().replace(/\\/g, '/')).toMatch(/packages\/params\/vectors$/);
    const packs = loadPacksFromDir();
    expect(packs.map((p) => p.pack)).toEqual(expect.arrayContaining(['global.core', 'pays.CM']));
    expect(loadVectors('expressions').cases.length).toBeGreaterThan(20);
  });

  it('honours PACKS_DIR and VECTORS_DIR', () => {
    process.env.PACKS_DIR = '/data/packs';
    process.env.VECTORS_DIR = '/data/vectors';
    expect(defaultPacksDir()).toBe('/data/packs');
    expect(defaultVectorsDir()).toBe('/data/vectors');
    delete process.env.VECTORS_DIR;
    // without VECTORS_DIR the vectors sit next to the packs directory
    expect(defaultVectorsDir().replace(/\\/g, '/')).toMatch(/data\/vectors$/);
  });
});
