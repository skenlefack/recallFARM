import { FarmSettingsOverrides, OverridePolicy, PackDoc, ParamObject, Rejection, Resolved } from './types';

/**
 * Pack resolution engine (ENGINES.md §1, dossier 12 §2).
 * Merges packs from the most general to the most specific level, key by key, honouring the
 * override policies declared by the level that defined each object.
 */

const FARM_PACK = 'ferme';

export function objectKey(o: { kind: string; code: string; channel?: unknown; lang?: unknown }): string {
  if (o.kind === 'message_template') return `${o.kind}:${o.code}:${String(o.channel ?? '')}:${String(o.lang ?? '')}`;
  return `${o.kind}:${o.code}`;
}

function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isCodedList(v: unknown): v is Array<Record<string, unknown>> {
  return Array.isArray(v) && v.every((x) => isPlainObject(x) && typeof x.code === 'string');
}

/** Maps farm speculations to filière packs. */
export function filierePackFor(speculation: string): string | null {
  const s = speculation.toLowerCase();
  if (['volaille', 'aviculture'].includes(s)) return 'filiere.volaille';
  if (['chien', 'canin', 'elevage_canin', 'dressage', 'pension_canine'].includes(s)) return 'filiere.canin';
  if (['porcin', 'porcins'].includes(s)) return 'filiere.porcin';
  if (['petits_ruminants'].includes(s)) return 'filiere.petits_ruminants';
  if (['bovin', 'bovins'].includes(s)) return 'filiere.bovin';
  if (['lapin', 'cuniculture'].includes(s)) return 'filiere.lapin';
  return null;
}

/** Orders the applicable packs: global → filière(s) (farm speculation order) → pays → org. */
export function selectPacks(
  available: PackDoc[],
  farm: { country?: string | null; speculations?: string[] | null; organisation_id?: string | null },
  orgPackCodes: string[] = [],
): PackDoc[] {
  const byCode = new Map(available.map((p) => [p.pack, p]));
  const out: PackDoc[] = [];
  const push = (code: string | null) => {
    if (!code) return;
    const p = byCode.get(code);
    if (p && !out.includes(p)) out.push(p);
  };
  available.filter((p) => p.level === 'global').forEach((p) => push(p.pack));
  for (const s of farm.speculations ?? []) push(filierePackFor(s));
  if (farm.country) push(`pays.${farm.country}`);
  orgPackCodes.forEach(push);
  return out;
}

interface Entry {
  obj: ParamObject;
  policies: Record<string, OverridePolicy>;
  provenance: Record<string, string>;
}

function checkPolicy(
  policy: OverridePolicy | undefined,
  oldValue: unknown,
  newValue: unknown,
): { ok: boolean; reason?: string } {
  if (!policy || policy.policy === 'libre') return { ok: true };
  switch (policy.policy) {
    case 'verrouillee':
      return { ok: false, reason: 'verrouillee' };
    case 'bornee': {
      if (Array.isArray(policy.values)) {
        return policy.values.some((x) => JSON.stringify(x) === JSON.stringify(newValue)) ? { ok: true } : { ok: false, reason: 'bornee' };
      }
      if (typeof newValue !== 'number') return { ok: false, reason: 'bornee' };
      if (policy.min_delta !== undefined || policy.max_delta !== undefined) {
        if (typeof oldValue !== 'number') return { ok: false, reason: 'bornee' };
        const delta = newValue - oldValue;
        if (policy.min_delta !== undefined && delta < policy.min_delta) return { ok: false, reason: 'bornee' };
        if (policy.max_delta !== undefined && delta > policy.max_delta) return { ok: false, reason: 'bornee' };
        return { ok: true };
      }
      if (policy.min !== undefined && newValue < policy.min) return { ok: false, reason: 'bornee' };
      if (policy.max !== undefined && newValue > policy.max) return { ok: false, reason: 'bornee' };
      return { ok: true };
    }
    case 'ajout_seulement':
      // Only meaningful for lists; handled by the caller. For scalars, behave as locked.
      return { ok: false, reason: 'ajout_seulement' };
    default:
      return { ok: true };
  }
}

function mergeInto(entry: Entry, inc: ParamObject, byPack: string, rejected: Rejection[]): void {
  const cur = entry.obj;
  const reject = (property: string, reason: string) =>
    rejected.push({ kind: cur.kind, code: cur.code, property, by_pack: byPack, reason });

  for (const [prop, rawValue] of Object.entries(inc)) {
    if (prop === 'kind' || prop === 'code') continue;
    const value = clone(rawValue);

    if (prop === 'override') {
      // A lower level may only add policies for keys not already governed (tightening).
      if (isPlainObject(value)) {
        for (const [k, p] of Object.entries(value)) {
          if (!entry.policies[k]) entry.policies[k] = p as OverridePolicy;
        }
      }
      continue;
    }

    const policy = entry.policies[prop];
    const dottedPolicies = Object.keys(entry.policies).filter((k) => k.startsWith(`${prop}.`));
    let accepted = false;

    if (prop === 'params' && isPlainObject(value) && isPlainObject(cur.params)) {
      // Alert-rule thresholds: params.<key> governed by override.<key> (or override["params.<key>"]).
      const target = cur.params as Record<string, unknown>;
      for (const [k, v] of Object.entries(value)) {
        const p = entry.policies[`params.${k}`] ?? entry.policies[k];
        const res = checkPolicy(p, target[k], v);
        if (res.ok) {
          target[k] = v;
          accepted = true;
        } else reject(`params.${k}`, res.reason!);
      }
    } else if (policy && policy.policy === 'ajout_seulement' && isCodedList(cur[prop]) && isCodedList(value)) {
      const list = cur[prop] as Array<Record<string, unknown>>;
      for (const item of value) {
        const existing = list.find((x) => x.code === item.code);
        if (!existing) {
          list.push(item);
          accepted = true;
          continue;
        }
        for (const [ik, iv] of Object.entries(item)) {
          if (ik === 'code') continue;
          const p = entry.policies[`${prop}.${ik}`] ?? entry.policies[ik];
          const res = checkPolicy(p, existing[ik], iv);
          if (res.ok) {
            existing[ik] = iv;
            accepted = true;
          } else reject(`${prop}.${String(item.code)}.${ik}`, res.reason!);
        }
      }
    } else if (policy) {
      const res = checkPolicy(policy, cur[prop], value);
      if (res.ok) {
        cur[prop] = value;
        accepted = true;
      } else reject(prop, res.reason!);
    } else if (dottedPolicies.length > 0 && isPlainObject(value) && isPlainObject(cur[prop])) {
      const target = cur[prop] as Record<string, unknown>;
      for (const [k, v] of Object.entries(value)) {
        const res = checkPolicy(entry.policies[`${prop}.${k}`], target[k], v);
        if (res.ok) {
          target[k] = v;
          accepted = true;
        } else reject(`${prop}.${k}`, res.reason!);
      }
    } else {
      cur[prop] = value;
      accepted = true;
    }

    if (accepted) entry.provenance[prop] = byPack;
  }
}

export function resolvePacks(packs: PackDoc[], farmSettings?: FarmSettingsOverrides | null): Resolved {
  const entries = new Map<string, Entry>();
  const rejected: Rejection[] = [];
  const i18n: Record<string, Record<string, string>> = {};

  for (const pack of packs) {
    const byPack = `${pack.pack}@${pack.version}`;
    for (const raw of pack.objects ?? []) {
      const key = objectKey(raw);
      const existing = entries.get(key);
      if (!existing) {
        const obj = clone(raw);
        const policies = (isPlainObject(obj.override) ? obj.override : {}) as Record<string, OverridePolicy>;
        delete obj.override;
        const provenance: Record<string, string> = {};
        for (const p of Object.keys(obj)) if (p !== 'kind' && p !== 'code') provenance[p] = byPack;
        entries.set(key, { obj, policies: clone(policies), provenance });
      } else {
        mergeInto(existing, raw, byPack, rejected);
      }
    }
    for (const [lang, labels] of Object.entries(pack.i18n ?? {})) {
      i18n[lang] = { ...(i18n[lang] ?? {}), ...labels };
    }
  }

  if (farmSettings) {
    for (const [key, partial] of Object.entries(farmSettings)) {
      const entry = entries.get(key);
      if (!entry || !isPlainObject(partial)) continue;
      const [kind, code] = key.split(':');
      mergeInto(entry, { ...(partial as Record<string, unknown>), kind, code } as ParamObject, FARM_PACK, rejected);
    }
  }

  const objects: Record<string, ParamObject> = {};
  const provenance: Record<string, Record<string, string>> = {};
  for (const [key, e] of entries) {
    objects[key] = Object.keys(e.policies).length ? { ...e.obj, override: e.policies } : e.obj;
    provenance[key] = e.provenance;
  }
  return {
    objects,
    provenance,
    rejected,
    param_version: packs.map((p) => `${p.pack}@${p.version}`).join('+'),
    i18n,
  };
}

/** Returns all resolved objects of a kind. */
export function objectsOfKind<T = ParamObject>(r: Resolved, kind: string): T[] {
  return Object.values(r.objects).filter((o) => o.kind === kind) as unknown as T[];
}

export function getObject<T = ParamObject>(r: Resolved, kind: string, code: string): T | undefined {
  return r.objects[`${kind}:${code}`] as unknown as T | undefined;
}

/** Reads a dotted path ("recurring.every_days") from an object. */
export function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, k) => (isPlainObject(acc) ? acc[k] : undefined), obj);
}
