/**
 * Minimal contract check of a response against apps/api/openapi.json (no extra dependency):
 * $ref, oneOf, allOf, type (3.1 arrays), enum, required, properties, items. A property absent from
 * the schema is reported too: the documented shape must be the real one, both ways.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

type Schema = {
  $ref?: string;
  oneOf?: Schema[];
  allOf?: Schema[];
  type?: string | string[];
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean | Schema;
  items?: Schema;
};

export const OPENAPI = JSON.parse(readFileSync(join(__dirname, '..', 'openapi.json'), 'utf8')) as {
  paths: Record<string, Record<string, { responses: Record<string, { content?: Record<string, { schema: Schema }> }> }>>;
  components: { schemas: Record<string, Schema> };
};

function resolve(s: Schema): Schema {
  if (!s.$ref) return s;
  const name = s.$ref.replace('#/components/schemas/', '');
  const found = OPENAPI.components.schemas[name];
  if (!found) throw new Error(`schema ${name} absent`);
  return resolve(found);
}

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

/** Returns the list of differences (empty: the value conforms). */
export function check(value: unknown, schema: Schema, path = '$'): string[] {
  const s = resolve(schema);
  if (s.oneOf) {
    const results = s.oneOf.map((x) => check(value, x, path));
    const ok = results.filter((r) => r.length === 0).length;
    return ok === 1 ? [] : [`${path}: ${ok} branches oneOf valides (${results.flat().join(' ; ')})`];
  }
  if (s.allOf) return s.allOf.flatMap((x) => check(value, x, path));
  const errs: string[] = [];
  if (s.type) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    const t = typeOf(value);
    if (!types.includes(t) && !(t === 'integer' && types.includes('number'))) return [`${path}: type ${t}, attendu ${types.join('|')}`];
  }
  if (value === null) return errs;
  if (s.enum && !s.enum.includes(value)) errs.push(`${path}: ${JSON.stringify(value)} hors enum`);
  if (Array.isArray(value) && s.items) value.forEach((v, i) => errs.push(...check(v, s.items!, `${path}[${i}]`)));
  if (typeOf(value) === 'object' && s.properties) {
    const o = value as Record<string, unknown>;
    for (const k of s.required ?? []) if (!(k in o)) errs.push(`${path}.${k}: requis`);
    for (const [k, v] of Object.entries(o)) {
      if (s.properties[k]) errs.push(...check(v, s.properties[k], `${path}.${k}`));
      else if (s.additionalProperties === undefined || s.additionalProperties === false) errs.push(`${path}.${k}: non documente`);
    }
  }
  return errs;
}

/** Schema of a documented response, e.g. response('/v1/payments/{id}', 'get', '200'). */
export function response(path: string, method: string, status: string): Schema {
  const r = OPENAPI.paths[path]?.[method]?.responses?.[status];
  const schema = r?.content?.['application/json']?.schema;
  if (!schema) throw new Error(`${method.toUpperCase()} ${path} ${status} : pas de schema de reponse`);
  return schema;
}
