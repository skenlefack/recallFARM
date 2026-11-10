import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AccessService } from '../common/access.service';
import { AuthUser } from '../common/auth';
import { addDays, daysBetween, isDateString, todayIn } from '../common/dates';
import { Errors } from '../common/errors';
import { Animal, Batch, Dog, Farm, HealthEvent } from '../database/entities';
import { WriteOpts } from '../health/health-events.service';
import { RemindersService } from '../health/reminders.service';
import { filierePackFor } from '../params/engine/resolution';
import { validateForm } from '../params/engine/forms';
import { Resolved } from '../params/engine/types';
import { ParamsService } from '../params/params.service';

const BATCH_COLUMNS = ['name', 'code', 'species', 'production_type', 'strain', 'start_date', 'initial_count', 'housing', 'status'] as const;
const DOG_COLUMNS = ['name', 'breed', 'sex', 'birth_date', 'chip_number', 'identification_type', 'coat', 'status', 'sire_id', 'dam_id', 'photo_uri'] as const;
const ANIMAL_COLUMNS = ['species', 'tag', 'name', 'sex', 'breed', 'birth_date', 'role', 'status', 'batch_id', 'sire_id', 'dam_id'] as const;

export type BatchInput = { id: string; attributes?: Record<string, unknown> } & Partial<Record<(typeof BATCH_COLUMNS)[number], any>>;
export type DogInput = { id: string; attributes?: Record<string, unknown> } & Partial<Record<(typeof DOG_COLUMNS)[number], any>>;
export type AnimalInput = { id: string; attributes?: Record<string, unknown> } & Partial<Record<(typeof ANIMAL_COLUMNS)[number], any>>;

function pick<T extends string>(src: Record<string, unknown>, keys: readonly T[]): Partial<Record<T, unknown>> {
  const out: Partial<Record<T, unknown>> = {};
  for (const k of keys) if (src[k] !== undefined) out[k] = src[k];
  return out;
}

/** Batches (lots), dogs and minimal individual animals; inputs are validated against the resolved forms (EF-PAR-04). */
@Injectable()
export class LivestockService {
  constructor(
    private readonly ds: DataSource,
    private readonly access: AccessService,
    private readonly params: ParamsService,
    private readonly reminders: RemindersService,
  ) {}

  private defaultSpecies(farm: Farm, kind: 'batch' | 'dog'): string {
    if (kind === 'dog') return 'chien';
    const s = farm.speculations.find((x) => filierePackFor(x) === 'filiere.volaille');
    return s ? 'volaille' : (farm.speculations[0] ?? 'volaille');
  }

  private formErrors(resolved: Resolved, appliesTo: string, species: string, input: Record<string, unknown>, partial: boolean) {
    const form = this.params.form(resolved, appliesTo, species);
    if (!form) return { errors: {} as Record<string, string>, columns: {} as Record<string, unknown>, attributes: (input.attributes ?? {}) as Record<string, unknown> };
    return validateForm(form, input as never, (v) => ({ subject: { ...input, ...v }, now: todayIn() }), { partial });
  }

  // ---- Batches -------------------------------------------------------------------------
  serializeBatch(b: Batch) {
    const today = todayIn();
    return {
      id: b.id,
      farm_id: b.farm_id,
      name: b.name,
      code: b.code,
      species: b.species,
      production_type: b.production_type,
      strain: b.strain,
      start_date: b.start_date,
      age_days: daysBetween(b.start_date, today) + Number((b.attributes?.age_at_start_days as number | undefined) ?? 0),
      initial_count: b.initial_count,
      current_count: b.current_count ?? b.initial_count,
      mortality_total: b.mortality_total,
      mortality_pct: b.initial_count ? Math.round((b.mortality_total / b.initial_count) * 1000) / 10 : 0,
      housing: b.housing,
      status: b.status,
      attributes: b.attributes,
      param_version: b.param_version,
      created_at: b.created_at,
      updated_at: b.updated_at,
      deleted_at: b.deleted_at,
      sync_version: Number(b.sync_version),
      client_rev: b.client_rev,
    };
  }

  async listBatches(user: AuthUser, farmId: string, offset: number, take: number) {
    await this.access.farm(user, farmId);
    return this.ds.getRepository(Batch).find({ where: { farm_id: farmId }, order: { start_date: 'DESC' }, skip: offset, take });
  }

  async getBatch(user: AuthUser, id: string): Promise<Batch> {
    const b = await this.ds.getRepository(Batch).findOne({ where: { id } });
    if (!b) throw Errors.notFound('Lot');
    await this.access.farm(user, b.farm_id);
    return b;
  }

  async upsertBatch(user: AuthUser, farmId: string, input: BatchInput, opts: WriteOpts & { partial?: boolean } = {}): Promise<Batch> {
    const farm = await this.access.farm(user, farmId);
    const repo = this.ds.getRepository(Batch);
    const existing = await repo.findOne({ where: { id: input.id }, withDeleted: true });
    if (existing && existing.farm_id !== farmId) throw Errors.conflict('Identifiant déjà utilisé', { existing_id: existing.id });
    // Derived aggregates are ignored on write (RG-SYN-01).
    const clean: Record<string, unknown> = { ...input };
    delete clean.current_count;
    delete clean.mortality_total;
    const merged = existing ? { ...this.serializeBatch(existing), ...clean, attributes: { ...existing.attributes, ...(input.attributes ?? {}) } } : clean;
    const species = (merged.species as string) ?? this.defaultSpecies(farm, 'batch');
    const resolved = await this.params.resolveFarm(farm);
    const { errors, attributes } = this.formErrors(resolved, 'batch', species, { ...merged, species }, !!opts.partial && !!existing);
    if (!merged.name) errors.name = errors.name ?? 'obligatoire';
    if (!merged.start_date || !isDateString(merged.start_date)) errors.start_date = errors.start_date ?? 'date attendue (AAAA-MM-JJ)';
    if (!Number.isInteger(merged.initial_count) || (merged.initial_count as number) < 1) errors.initial_count = errors.initial_count ?? 'entier ≥ 1';
    if (Object.keys(errors).length) throw Errors.validation(errors);

    const before = existing ? `${existing.start_date}|${existing.production_type}|${existing.status}` : null;
    const row = existing ?? repo.create({ id: input.id, farm_id: farmId, created_by: user.id, mortality_total: 0 });
    const cols = pick(merged as Record<string, unknown>, BATCH_COLUMNS);
    Object.assign(row, cols, {
      species,
      code: (merged.code as string) ?? (merged.name as string),
      attributes,
      param_version: resolved.param_version,
      updated_by: user.id,
      deleted_at: null,
      last_device_id: opts.deviceId ?? null,
      client_rev: Math.max(existing?.client_rev ?? 0, opts.clientRev ?? 0),
    });
    await repo.save(row);
    await this.recount(row.id);
    if (before !== `${row.start_date}|${row.production_type}|${row.status}`) {
      await this.reminders.recompute('batch', row.id);
    }
    return (await repo.findOne({ where: { id: row.id } }))!;
  }

  /** RG-CHE-01: current count = initial − Σ mortality − Σ culled (movements: V1). */
  async recount(batchId: string, m: EntityManager = this.ds.manager): Promise<void> {
    await m.query(
      `UPDATE batches b SET
         mortality_total = COALESCE(s.mort, 0),
         current_count = b.initial_count - COALESCE(s.mort, 0) - COALESCE(s.culled, 0)
       FROM (SELECT sum(mortality)::int AS mort, sum(culled)::int AS culled FROM daily_logs
              WHERE subject_type = 'batch' AND subject_id = $1 AND deleted_at IS NULL) s
       WHERE b.id = $1
         AND (b.mortality_total IS DISTINCT FROM COALESCE(s.mort, 0)
              OR b.current_count IS DISTINCT FROM b.initial_count - COALESCE(s.mort, 0) - COALESCE(s.culled, 0))`,
      [batchId],
    );
  }

  async removeBatch(user: AuthUser, id: string) {
    const b = await this.getBatch(user, id);
    await this.ds.getRepository(Batch).softDelete({ id: b.id });
    await this.reminders.recompute('batch', b.id);
  }

  // ---- Dogs ----------------------------------------------------------------------------
  /** Rabies validity derived from the last rabies act and the recurring interval of the resolved protocol. */
  async rabies(dogs: Dog[], resolved?: Resolved): Promise<Map<string, { status: 'a_jour' | 'expire' | 'inconnu'; valid_until: string | null; last_date: string | null }>> {
    const out = new Map<string, { status: 'a_jour' | 'expire' | 'inconnu'; valid_until: string | null; last_date: string | null }>();
    if (!dogs.length) return out;
    const r = resolved ?? (await this.params.resolveBase());
    const every = this.params.protocols(r, 'chien').find((p) => p.recurring?.disease === 'rage')?.recurring?.every_days ?? 365;
    const rows: Array<{ subject_id: string; last: string }> = await this.ds.query(
      `SELECT subject_id, max(event_date)::text AS last FROM health_events
        WHERE subject_type = 'dog' AND disease = 'rage' AND deleted_at IS NULL AND subject_id = ANY($1) GROUP BY subject_id`,
      [dogs.map((d) => d.id)],
    );
    const today = todayIn();
    for (const d of dogs) {
      const last = rows.find((x) => x.subject_id === d.id)?.last ?? null;
      if (!last) out.set(d.id, { status: 'inconnu', valid_until: null, last_date: null });
      else {
        const until = addDays(last, every);
        out.set(d.id, { status: until >= today ? 'a_jour' : 'expire', valid_until: until, last_date: last });
      }
    }
    return out;
  }

  serializeDog(d: Dog, rabies?: { status: string; valid_until: string | null }) {
    return {
      id: d.id,
      farm_id: d.farm_id,
      name: d.name,
      breed: d.breed,
      sex: d.sex,
      birth_date: d.birth_date,
      age_days: d.birth_date ? daysBetween(d.birth_date, todayIn()) : null,
      chip_number: d.chip_number,
      identification_type: d.identification_type,
      coat: d.coat,
      status: d.status,
      sire_id: d.sire_id,
      dam_id: d.dam_id,
      photo_uri: d.photo_uri,
      attributes: d.attributes,
      param_version: d.param_version,
      rabies_status: rabies?.status ?? 'inconnu',
      rabies_valid_until: rabies?.valid_until ?? null,
      created_at: d.created_at,
      updated_at: d.updated_at,
      deleted_at: d.deleted_at,
      sync_version: Number(d.sync_version),
      client_rev: d.client_rev,
    };
  }

  async serializeDogs(dogs: Dog[]) {
    const rab = await this.rabies(dogs);
    return dogs.map((d) => this.serializeDog(d, rab.get(d.id)));
  }

  async listDogs(user: AuthUser, farmId: string, offset: number, take: number) {
    await this.access.farm(user, farmId);
    return this.ds.getRepository(Dog).find({ where: { farm_id: farmId }, order: { name: 'ASC' }, skip: offset, take });
  }

  async getDog(user: AuthUser, id: string): Promise<Dog> {
    const d = await this.ds.getRepository(Dog).findOne({ where: { id } });
    if (!d) throw Errors.notFound('Chien');
    await this.access.farm(user, d.farm_id);
    return d;
  }

  private async checkParents(table: 'dogs' | 'animals', self: string, sireId: unknown, damId: unknown, birth: unknown, errors: Record<string, string>) {
    for (const [field, id, sex] of [['sire_id', sireId, 'M'], ['dam_id', damId, 'F']] as const) {
      if (!id) continue;
      if (id === self) {
        errors[field] = 'un animal ne peut pas être son propre parent';
        continue;
      }
      const rows: Array<{ sex: string; birth_date: string | null }> = await this.ds.query(`SELECT sex, birth_date FROM ${table} WHERE id = $1`, [id]);
      if (!rows.length) errors[field] = 'parent inconnu';
      else if (rows[0].sex !== sex) errors[field] = sex === 'M' ? 'le père doit être un mâle' : 'la mère doit être une femelle';
      else if (birth && rows[0].birth_date && rows[0].birth_date >= (birth as string)) errors[field] = 'le parent doit être né avant';
    }
  }

  async upsertDog(user: AuthUser, farmId: string, input: DogInput, opts: WriteOpts & { partial?: boolean } = {}): Promise<Dog> {
    const farm = await this.access.farm(user, farmId);
    const repo = this.ds.getRepository(Dog);
    const existing = await repo.findOne({ where: { id: input.id }, withDeleted: true });
    if (existing && existing.farm_id !== farmId) throw Errors.conflict('Identifiant déjà utilisé', { existing_id: existing.id });
    const clean: Record<string, unknown> = { ...input };
    delete clean.rabies_status;
    delete clean.rabies_valid_until;
    const merged = existing ? { ...this.serializeDog(existing), ...clean, attributes: { ...existing.attributes, ...(input.attributes ?? {}) } } : clean;
    const resolved = await this.params.resolveFarm(farm);
    const { errors, attributes } = this.formErrors(resolved, 'dog', 'chien', merged, !!opts.partial && !!existing);
    if (!merged.name) errors.name = errors.name ?? 'obligatoire';
    if (!['M', 'F'].includes(merged.sex as string)) errors.sex = errors.sex ?? 'M ou F';
    if (merged.birth_date && (!isDateString(merged.birth_date) || (merged.birth_date as string) > todayIn())) errors.birth_date = 'date passée attendue';
    await this.checkParents('dogs', input.id, merged.sire_id, merged.dam_id, merged.birth_date, errors);
    if (Object.keys(errors).length) throw Errors.validation(errors);
    const beforeBirth = existing ? existing.birth_date : undefined;
    const row = existing ?? repo.create({ id: input.id, farm_id: farmId, created_by: user.id });
    Object.assign(row, pick(merged as Record<string, unknown>, DOG_COLUMNS), {
      identification_type: (merged.identification_type as string) ?? (merged.chip_number ? 'puce' : null),
      attributes,
      param_version: resolved.param_version,
      updated_by: user.id,
      deleted_at: null,
      last_device_id: opts.deviceId ?? null,
      client_rev: Math.max(existing?.client_rev ?? 0, opts.clientRev ?? 0),
    });
    await repo.save(row);
    if (beforeBirth === undefined || beforeBirth !== row.birth_date) await this.reminders.recompute('dog', row.id);
    return (await repo.findOne({ where: { id: row.id } }))!;
  }

  async removeDog(user: AuthUser, id: string) {
    const d = await this.getDog(user, id);
    await this.ds.getRepository(Dog).softDelete({ id: d.id });
    await this.reminders.recompute('dog', d.id);
  }

  async dogHealthBook(dogId: string) {
    return this.ds.getRepository(HealthEvent).find({ where: { subject_type: 'dog', subject_id: dogId }, order: { event_date: 'DESC' } });
  }

  // ---- Animals (minimal) ---------------------------------------------------------------
  async listAnimals(user: AuthUser, farmId: string, offset: number, take: number) {
    await this.access.farm(user, farmId);
    return this.ds.getRepository(Animal).find({ where: { farm_id: farmId }, order: { tag: 'ASC' }, skip: offset, take });
  }

  async getAnimal(user: AuthUser, id: string): Promise<Animal> {
    const a = await this.ds.getRepository(Animal).findOne({ where: { id } });
    if (!a) throw Errors.notFound('Animal');
    await this.access.farm(user, a.farm_id);
    return a;
  }

  async upsertAnimal(user: AuthUser, farmId: string, input: AnimalInput, opts: WriteOpts = {}): Promise<Animal> {
    const farm = await this.access.farm(user, farmId);
    const repo = this.ds.getRepository(Animal);
    const existing = await repo.findOne({ where: { id: input.id }, withDeleted: true });
    if (existing && existing.farm_id !== farmId) throw Errors.conflict('Identifiant déjà utilisé', { existing_id: existing.id });
    const merged: Record<string, unknown> = { ...(existing ?? {}), ...input, attributes: { ...(existing?.attributes ?? {}), ...(input.attributes ?? {}) } };
    const resolved = await this.params.resolveFarm(farm);
    const { errors, attributes } = this.formErrors(resolved, 'animal', merged.species as string, merged, !!existing);
    if (!merged.species) errors.species = 'obligatoire';
    if (!merged.tag) errors.tag = 'obligatoire';
    if (!['M', 'F'].includes(merged.sex as string)) errors.sex = 'M ou F';
    await this.checkParents('animals', input.id, merged.sire_id, merged.dam_id, merged.birth_date, errors);
    if (Object.keys(errors).length) throw Errors.validation(errors);
    const row = existing ?? repo.create({ id: input.id, farm_id: farmId, created_by: user.id });
    Object.assign(row, pick(merged, ANIMAL_COLUMNS), {
      attributes,
      param_version: resolved.param_version,
      updated_by: user.id,
      deleted_at: null,
      last_device_id: opts.deviceId ?? null,
      client_rev: Math.max(existing?.client_rev ?? 0, opts.clientRev ?? 0),
    });
    await repo.save(row);
    if (!existing) await this.reminders.recompute('animal', row.id);
    return (await repo.findOne({ where: { id: row.id } }))!;
  }

  async removeAnimal(user: AuthUser, id: string) {
    const a = await this.getAnimal(user, id);
    await this.ds.getRepository(Animal).softDelete({ id: a.id });
  }
}
