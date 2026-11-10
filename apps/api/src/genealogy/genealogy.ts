/** Wright's path method for the inbreeding coefficient of a prospective offspring (RG-GEN-01..03). */

export interface PedigreeNode {
  id: string;
  name?: string | null;
  sire_id: string | null;
  dam_id: string | null;
}

export type Pedigree = Map<string, PedigreeNode>;

/** All upward paths (node lists, starting at `id`) of at most `depth` generations. */
function upwardPaths(ped: Pedigree, id: string, depth: number): string[][] {
  const out: string[][] = [[id]];
  const walk = (path: string[]) => {
    if (path.length - 1 >= depth) return;
    const node = ped.get(path[path.length - 1]);
    if (!node) return;
    for (const p of [node.sire_id, node.dam_id]) {
      if (!p || path.includes(p)) continue;
      const np = [...path, p];
      out.push(np);
      walk(np);
    }
  };
  walk([id]);
  return out;
}

/** Inbreeding coefficient F of an individual already in the pedigree. */
export function inbreedingOf(ped: Pedigree, id: string, depth: number, memo = new Map<string, number>()): number {
  const key = `${id}:${depth}`;
  if (memo.has(key)) return memo.get(key)!;
  const node = ped.get(id);
  const f = node?.sire_id && node?.dam_id && depth > 0 ? coancestry(ped, node.sire_id, node.dam_id, depth - 1, memo).coef : 0;
  memo.set(key, f);
  return f;
}

export interface CoancestryResult {
  coef: number;
  common: Array<{ id: string; name: string | null; contribution: number; paths: number }>;
}

/** Coefficient of coancestry of x and y = F of their offspring. */
export function coancestry(ped: Pedigree, x: string, y: string, depth: number, memo = new Map<string, number>()): CoancestryResult {
  const px = upwardPaths(ped, x, depth);
  const py = upwardPaths(ped, y, depth);
  const byAncestor = new Map<string, { contribution: number; paths: number }>();
  let coef = 0;
  for (const a of px) {
    const anc = a[a.length - 1];
    for (const b of py) {
      if (b[b.length - 1] !== anc) continue;
      // Paths may only meet at the common ancestor.
      const setA = new Set(a.slice(0, -1));
      if (b.slice(0, -1).some((n) => setA.has(n))) continue;
      const n1 = a.length - 1;
      const n2 = b.length - 1;
      const fa = inbreedingOf(ped, anc, Math.max(0, depth - Math.max(n1, n2)), memo);
      const c = Math.pow(0.5, n1 + n2 + 1) * (1 + fa);
      coef += c;
      const cur = byAncestor.get(anc) ?? { contribution: 0, paths: 0 };
      cur.contribution += c;
      cur.paths += 1;
      byAncestor.set(anc, cur);
    }
  }
  return {
    coef,
    common: [...byAncestor.entries()]
      .map(([id, v]) => ({ id, name: ped.get(id)?.name ?? null, contribution: Math.round(v.contribution * 1e6) / 1e6, paths: v.paths }))
      .sort((a, b) => b.contribution - a.contribution),
  };
}

/** True when every ancestor slot up to `depth` generations is known. */
export function pedigreeComplete(ped: Pedigree, id: string, depth: number): boolean {
  if (depth <= 0) return true;
  const n = ped.get(id);
  if (!n || !n.sire_id || !n.dam_id) return false;
  return pedigreeComplete(ped, n.sire_id, depth - 1) && pedigreeComplete(ped, n.dam_id, depth - 1);
}

export function verdict(coef: number, threshold: number): 'ok' | 'attention' | 'a_eviter' {
  if (coef >= threshold) return 'a_eviter';
  if (coef > 0) return 'attention';
  return 'ok';
}
