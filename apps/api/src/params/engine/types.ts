export type ParamLevel = 'global' | 'filiere' | 'pays' | 'org';

export interface ParamObject {
  kind: string;
  code: string;
  override?: Record<string, OverridePolicy>;
  [prop: string]: unknown;
}

export interface OverridePolicy {
  policy: 'libre' | 'bornee' | 'ajout_seulement' | 'verrouillee';
  min?: number;
  max?: number;
  min_delta?: number;
  max_delta?: number;
  values?: unknown[];
}

export interface PackDoc {
  pack: string;
  version: string;
  level: ParamLevel;
  requires?: Record<string, string>;
  country?: string;
  currency?: string;
  languages?: string[];
  objects: ParamObject[];
  i18n?: Record<string, Record<string, string>>;
  [k: string]: unknown;
}

export interface Rejection {
  kind: string;
  code: string;
  property: string;
  by_pack: string;
  reason: string;
}

export interface Resolved {
  objects: Record<string, ParamObject>;
  provenance: Record<string, Record<string, string>>;
  rejected: Rejection[];
  param_version: string;
  i18n: Record<string, Record<string, string>>;
}

/** Farm-level overrides (`farm_settings`), keyed by "<kind>:<code>". */
export type FarmSettingsOverrides = Record<string, Record<string, unknown>>;
