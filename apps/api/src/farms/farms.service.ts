import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { EntitlementsService } from '../billing/entitlements.service';
import { AccessService, ORG_MANAGER_ROLES } from '../common/access.service';
import { AuthUser } from '../common/auth';
import { Errors } from '../common/errors';
import { Farm, FarmSettings } from '../database/entities';
import { filierePackFor, resolvePacks } from '../params/engine/resolution';
import { ParamsService } from '../params/params.service';
import { WriteOpts } from '../health/health-events.service';

export interface FarmInput {
  id: string;
  name: string;
  speculations: string[];
  country: string;
  region?: string | null;
  locality?: string | null;
  currency?: string | null;
  gps_lat?: number | null;
  gps_lng?: number | null;
  area_ha?: number | null;
  manager_name?: string | null;
  organisation_id?: string | null;
}

@Injectable()
export class FarmsService {
  constructor(
    private readonly ds: DataSource,
    private readonly access: AccessService,
    private readonly entitlements: EntitlementsService,
    private readonly params: ParamsService,
  ) {}

  serialize(f: Farm) {
    return {
      id: f.id,
      name: f.name,
      speculations: f.speculations,
      country: f.country,
      region: f.region,
      locality: f.locality,
      currency: f.currency,
      gps_lat: f.gps_lat,
      gps_lng: f.gps_lng,
      area_ha: f.area_ha,
      manager_name: f.manager_name,
      organisation_id: f.organisation_id,
      owner_id: f.owner_id,
      created_at: f.created_at,
      updated_at: f.updated_at,
      deleted_at: f.deleted_at,
      sync_version: Number(f.sync_version),
      client_rev: f.client_rev,
    };
  }

  async list(user: AuthUser, q: { organisation_id?: string; q?: string }, offset: number, take: number): Promise<Farm[]> {
    let ids: string[];
    if (q.organisation_id) {
      await this.access.assertOrgManager(user, q.organisation_id);
      const rows: Array<{ id: string }> = await this.ds.query(`SELECT id FROM farms WHERE organisation_id = $1 AND deleted_at IS NULL`, [q.organisation_id]);
      ids = rows.map((r) => r.id);
    } else {
      ids = await this.access.farmIds(user);
    }
    if (!ids.length) return [];
    const qb = this.ds.getRepository(Farm).createQueryBuilder('f').where({ id: In(ids) });
    if (q.q) qb.andWhere('(f.name ILIKE :q OR f.locality ILIKE :q)', { q: `%${q.q}%` });
    return qb.orderBy('f.created_at', 'ASC').skip(offset).take(take).getMany();
  }

  private validate(input: FarmInput): void {
    const fields: Record<string, string> = {};
    if (!input.speculations?.length) fields.speculations = 'au moins une spéculation';
    else if (input.speculations.some((s) => !filierePackFor(s) && !['cooperative', 'veterinaire'].includes(s))) fields.speculations = 'spéculation inconnue';
    if (input.gps_lat !== undefined && input.gps_lat !== null && (input.gps_lat < -90 || input.gps_lat > 90)) fields.gps_lat = 'latitude invalide';
    if (input.gps_lng !== undefined && input.gps_lng !== null && (input.gps_lng < -180 || input.gps_lng > 180)) fields.gps_lng = 'longitude invalide';
    if (Object.keys(fields).length) throw Errors.validation(fields);
  }

  async upsert(user: AuthUser, input: FarmInput, opts: WriteOpts = {}): Promise<Farm> {
    this.validate(input);
    const repo = this.ds.getRepository(Farm);
    const existing = await repo.findOne({ where: { id: input.id }, withDeleted: true });
    if (existing) {
      if (!(await this.access.canAccessFarm(user, existing))) throw Errors.forbidden();
    } else {
      const ent = await this.entitlements.forUser(user.id, false);
      const owned: Array<{ n: number }> = await this.ds.query(`SELECT count(*)::int AS n FROM farms WHERE owner_id = $1 AND deleted_at IS NULL`, [user.id]);
      const max = ent.quotas.farms ?? 1;
      if (owned[0].n >= max) throw Errors.quota(`Votre formule ${ent.plan} permet ${max} exploitation(s)`, { quota: 'farms', max, required_plan: 'pro' });
    }
    if (input.organisation_id && input.organisation_id !== existing?.organisation_id) {
      const m = await this.access.membership(user, input.organisation_id);
      if (!m) throw Errors.forbidden("Vous n'êtes pas membre de cette organisation");
    }
    let currency = input.currency ?? existing?.currency;
    if (!currency) {
      const pays = (await this.params.publishedPacks()).find((p) => p.doc.pack === `pays.${input.country}`);
      currency = pays?.doc.currency ?? 'XAF';
    }
    const row = existing ?? repo.create({ id: input.id, owner_id: user.id, created_by: user.id });
    Object.assign(row, {
      name: input.name,
      speculations: input.speculations,
      country: input.country,
      region: input.region ?? null,
      locality: input.locality ?? null,
      currency,
      gps_lat: input.gps_lat ?? null,
      gps_lng: input.gps_lng ?? null,
      area_ha: input.area_ha ?? null,
      manager_name: input.manager_name ?? null,
      organisation_id: input.organisation_id ?? existing?.organisation_id ?? null,
      updated_by: user.id,
      deleted_at: null,
      last_device_id: opts.deviceId ?? null,
      client_rev: Math.max(existing?.client_rev ?? 0, opts.clientRev ?? 0),
    });
    await repo.save(row);
    return (await repo.findOne({ where: { id: row.id } }))!;
  }

  get(user: AuthUser, id: string): Promise<Farm> {
    return this.access.farm(user, id);
  }

  async patch(user: AuthUser, id: string, patch: Partial<FarmInput>): Promise<Farm> {
    const farm = await this.access.farm(user, id);
    return this.upsert(user, { ...(this.serialize(farm) as unknown as FarmInput), ...patch, id });
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    const farm = await this.access.farm(user, id);
    if (farm.owner_id !== user.id) {
      const m = farm.organisation_id ? await this.access.membership(user, farm.organisation_id) : null;
      if (!m || !ORG_MANAGER_ROLES.includes(m.role)) throw Errors.forbidden('Seul le propriétaire peut supprimer');
    }
    await this.ds.getRepository(Farm).softDelete({ id });
  }

  async settings(user: AuthUser, farmId: string) {
    await this.access.farm(user, farmId);
    const s = await this.ds.getRepository(FarmSettings).findOne({ where: { farm_id: farmId } });
    return s ?? { farm_id: farmId, overrides: {}, targets: {}, dashboard_kpis: [], oncall_default: {} };
  }

  /** PUT /farms/:id/settings — out-of-bounds overrides are refused (RG-PAR-01). */
  async putSettings(user: AuthUser, farmId: string, body: { overrides?: Record<string, Record<string, unknown>>; targets?: Record<string, unknown>; dashboard_kpis?: string[]; oncall_default?: Record<string, unknown> }) {
    const farm = await this.access.farm(user, farmId);
    if (body.overrides) {
      const stack = await this.params.stackFor(farm);
      const r = resolvePacks(stack.map((p) => p.doc), body.overrides);
      if (r.rejected.length) {
        await this.ds.query(
          `INSERT INTO param_override_events (farm_id, object_ref, property, attempted_value, policy, by_pack)
           SELECT $1, x->>'kind' || ':' || (x->>'code'), x->>'property', NULL, x->>'reason', x->>'by_pack' FROM jsonb_array_elements($2::jsonb) x`,
          [farmId, JSON.stringify(r.rejected)],
        );
        throw Errors.business('RG-PAR-01', 'Surcharge hors des bornes autorisées', { rejected: r.rejected });
      }
    }
    const repo = this.ds.getRepository(FarmSettings);
    const cur = (await repo.findOne({ where: { farm_id: farmId } })) ?? repo.create({ farm_id: farmId });
    if (body.overrides) cur.overrides = body.overrides;
    if (body.targets) cur.targets = body.targets;
    if (body.dashboard_kpis) cur.dashboard_kpis = body.dashboard_kpis;
    if (body.oncall_default) cur.oncall_default = body.oncall_default;
    await repo.save(cur);
    return cur;
  }
}
