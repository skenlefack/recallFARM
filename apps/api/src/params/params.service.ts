import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { DataSource } from 'typeorm';
import { KeysService } from '../common/keys.service';
import { config } from '../config';
import { Farm, FarmSettings, ParamPack, ParamPackVersion, ParamPublication } from '../database/entities';
import { FormDef } from './engine/forms';
import { loadPacksFromDir } from './engine/packs-loader';
import { DiseaseInfo, Protocol, ReminderPlan } from './engine/reminders';
import { getObject, objectsOfKind, resolvePacks, selectPacks } from './engine/resolution';
import { FarmSettingsOverrides, PackDoc, ParamObject, Resolved } from './engine/types';

export interface PublishedPack {
  versionId: string;
  doc: PackDoc;
  level: string;
  scopeRef: string | null;
  hash: string;
  signature: string;
  rollout: { percent?: number; farm_ids?: string[] } | null;
  syncVersion: number;
}

export interface FarmLike {
  id?: string;
  country?: string | null;
  speculations?: string[] | null;
  organisation_id?: string | null;
}

export interface PlanInfo {
  code: string;
  rank: number;
  features: string[];
  quotas: Record<string, number>;
}

/** Parameter packs: storage, signature, applicable stack per farm and resolution with provenance. */
@Injectable()
export class ParamsService {
  private readonly logger = new Logger('Params');
  private published: PublishedPack[] | null = null;
  private loadedAt = 0;
  private readonly cache = new Map<string, Resolved>();

  constructor(
    private readonly ds: DataSource,
    private readonly keys: KeysService,
  ) {}

  invalidate(): void {
    this.published = null;
    this.cache.clear();
  }

  /** Loads source packs from PACKS_DIR into the database (published + signed). Idempotent. */
  async ensureSourcePacks(): Promise<number> {
    const docs = loadPacksFromDir(config().packsDir);
    let inserted = 0;
    for (const doc of docs) {
      await this.ds.transaction(async (m) => {
        let pack = await m.getRepository(ParamPack).findOne({ where: { code: doc.pack } });
        if (!pack) {
          pack = await m.getRepository(ParamPack).save(
            m.getRepository(ParamPack).create({
              code: doc.pack,
              level: doc.level,
              scope_ref: doc.level === 'pays' ? (doc.country ?? doc.pack.split('.')[1]) : doc.level === 'filiere' ? doc.pack.split('.')[1] : null,
              title: doc.pack,
              review_required: doc.level !== 'org',
            }),
          );
        }
        const exists = await m.getRepository(ParamPackVersion).findOne({ where: { pack_id: pack.id, version: doc.version } });
        if (exists) return;
        const { hash, signature } = this.keys.signPack(doc);
        const v = await m.getRepository(ParamPackVersion).save(
          m.getRepository(ParamPackVersion).create({
            pack_id: pack.id,
            version: doc.version,
            status: 'publie',
            content: doc as unknown as Record<string, unknown>,
            content_hash: hash,
            signature,
            requires: doc.requires ?? {},
            changelog: 'Import initial depuis packages/params/packs',
            published_at: new Date(),
          }),
        );
        await m.getRepository(ParamPublication).save({ version_id: v.id, action: 'publish', reason: 'seed' });
        inserted++;
      });
    }
    if (inserted) this.invalidate();
    return inserted;
  }

  async publishedPacks(): Promise<PublishedPack[]> {
    // Short TTL so that publications made by another instance are picked up.
    if (this.published && Date.now() - this.loadedAt < 30_000) return this.published;
    if (this.published) this.cache.clear();
    const rows: Array<ParamPackVersion & { level: string; scope_ref: string | null }> = await this.ds.query(
      `SELECT v.*, p.level, p.scope_ref FROM param_pack_versions v JOIN param_packs p ON p.id = v.pack_id
        WHERE v.status = 'publie' ORDER BY p.code, v.published_at`,
    );
    this.published = rows.map((r) => ({
      versionId: r.id,
      doc: r.content as unknown as PackDoc,
      level: r.level,
      scopeRef: r.scope_ref,
      hash: r.content_hash ?? '',
      signature: r.signature ?? '',
      rollout: r.rollout,
      syncVersion: Number(r.sync_version),
    }));
    this.loadedAt = Date.now();
    return this.published;
  }

  private bucket(farmId: string, pack: string): number {
    return parseInt(createHash('sha256').update(`${pack}:${farmId}`).digest('hex').slice(0, 8), 16) % 100;
  }

  /** Picks, for each pack code, the published version applicable to the farm (progressive rollout RG-PAR-07). */
  private pickVersions(all: PublishedPack[], farmId?: string): PublishedPack[] {
    const byCode = new Map<string, PublishedPack[]>();
    for (const p of all) byCode.set(p.doc.pack, [...(byCode.get(p.doc.pack) ?? []), p]);
    const out: PublishedPack[] = [];
    for (const versions of byCode.values()) {
      const base = versions.filter((v) => !v.rollout).at(-1);
      const rollouts = versions.filter((v) => v.rollout);
      let chosen = base;
      for (const r of rollouts) {
        const inPilot = farmId && (r.rollout!.farm_ids?.includes(farmId) || (r.rollout!.percent !== undefined && this.bucket(farmId, r.doc.pack) < r.rollout!.percent));
        if (inPilot || !base) chosen = r;
      }
      if (chosen) out.push(chosen);
    }
    return out;
  }

  async stackFor(farm: FarmLike): Promise<PublishedPack[]> {
    const picked = this.pickVersions(await this.publishedPacks(), farm.id);
    const docs = picked.map((p) => p.doc);
    const orgPacks = farm.organisation_id ? picked.filter((p) => p.level === 'org' && p.scopeRef === farm.organisation_id).map((p) => p.doc.pack) : [];
    const ordered = selectPacks(docs, farm, orgPacks);
    return ordered.map((d) => picked.find((p) => p.doc === d)!);
  }

  async farmOverrides(farmId: string): Promise<FarmSettingsOverrides | null> {
    const s = await this.ds.getRepository(FarmSettings).findOne({ where: { farm_id: farmId } });
    return s && Object.keys(s.overrides ?? {}).length ? s.overrides : null;
  }

  async resolve(farm: FarmLike, overrides?: FarmSettingsOverrides | null): Promise<Resolved> {
    const stack = await this.stackFor(farm);
    const key = `${stack.map((p) => `${p.doc.pack}@${p.doc.version}`).join('+')}|${JSON.stringify(overrides ?? null)}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const r = resolvePacks(
      stack.map((p) => p.doc),
      overrides ?? null,
    );
    if (this.cache.size > 500) this.cache.clear();
    this.cache.set(key, r);
    return r;
  }

  async resolveFarm(farm: Farm): Promise<Resolved> {
    return this.resolve(farm, await this.farmOverrides(farm.id));
  }

  /** Global + country stack with every MVP filière (used when no farm is in context). */
  async resolveBase(country = 'CM'): Promise<Resolved> {
    return this.resolve({ country, speculations: ['volaille', 'chien'] });
  }

  // ---- Typed accessors ------------------------------------------------------------------

  diseases(r: Resolved): Record<string, DiseaseInfo & Record<string, unknown>> {
    const out: Record<string, DiseaseInfo & Record<string, unknown>> = {};
    for (const d of objectsOfKind<DiseaseInfo & Record<string, unknown>>(r, 'disease')) out[d.code] = d;
    return out;
  }

  plans(r: Resolved): PlanInfo[] {
    return objectsOfKind<PlanInfo>(r, 'plan').sort((a, b) => a.rank - b.rank);
  }

  form(r: Resolved, appliesTo: string, species?: string | null): FormDef | undefined {
    const forms = objectsOfKind<FormDef>(r, 'form').filter((f) => f.applies_to === appliesTo);
    return forms.find((f) => !species || !f.species || f.species === species) ?? undefined;
  }

  protocols(r: Resolved, species: string, productionType?: string | null): Protocol[] {
    return objectsOfKind<Protocol>(r, 'vaccination_protocol').filter(
      (p) => p.species === species && (!p.production_type || !productionType || p.production_type === productionType),
    );
  }

  alertRules(r: Resolved, source: string): Array<ParamObject & { when: string; severity: string; params?: Record<string, unknown> }> {
    return objectsOfKind<ParamObject & { when: string; severity: string; params?: Record<string, unknown>; source?: string }>(r, 'alert_rule').filter(
      (a) => a.source === source,
    );
  }

  reminderPlan(r: Resolved): ReminderPlan | undefined {
    return objectsOfKind<ReminderPlan>(r, 'reminder_plan')[0];
  }

  template(r: Resolved, code: string, channel: string, lang: string): string | undefined {
    const t =
      r.objects[`message_template:${code}:${channel}:${lang}`] ?? r.objects[`message_template:${code}:${channel}:fr`];
    return t?.text as string | undefined;
  }

  label(r: Resolved, code: string | null | undefined, lang = 'fr'): string {
    if (!code) return '';
    return r.i18n[lang]?.[code] ?? r.i18n.fr?.[code] ?? code;
  }

  get<T = ParamObject>(r: Resolved, kind: string, code: string): T | undefined {
    return getObject<T>(r, kind, code);
  }

  /** Manifest of the packs applicable to a farm (or to the base stack). */
  async manifest(farm?: FarmLike): Promise<Array<{ pack: string; version: string; level: string; hash: string; signature: string; sync_version: number }>> {
    const stack = await this.stackFor(farm ?? { country: 'CM', speculations: ['volaille', 'chien'] });
    return stack.map((p) => ({
      pack: p.doc.pack,
      version: p.doc.version,
      level: p.level,
      hash: p.hash,
      signature: p.signature,
      sync_version: p.syncVersion,
    }));
  }
}
