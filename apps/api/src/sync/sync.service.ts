import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AccessService } from '../common/access.service';
import { AuthUser } from '../common/auth';
import { AppError, Errors } from '../common/errors';
import { FarmInput, FarmsService } from '../farms/farms.service';
import { HealthEventInput, HealthEventsService } from '../health/health-events.service';
import { TaskInput, TasksService } from '../health/tasks.service';
import { DailyLogInput, JournalService, mergeDailyLogs } from '../journal/journal.service';
import { AnimalInput, BatchInput, DogInput, LivestockService } from '../livestock/livestock.service';
import { ParamsService } from '../params/params.service';
import { ExpenseInput, MovementInput, SaleInput, StockSalesService } from '../stock-sales/stock-sales.service';

export const PUSH_ENTITIES = ['farms', 'batches', 'dogs', 'animals', 'daily_logs', 'health_events', 'tasks', 'stock_movements', 'sales', 'expenses'] as const;
export const PULL_ENTITIES = [...PUSH_ENTITIES, 'reminders', 'alerts', 'params'] as const;
const TABLE: Record<string, string> = {
  farms: 'farms', batches: 'batches', dogs: 'dogs', animals: 'animals', daily_logs: 'daily_logs', health_events: 'health_events', tasks: 'tasks',
  stock_movements: 'stock_movements', sales: 'products_sales', expenses: 'expenses', reminders: 'reminders', alerts: 'alert_events',
};
/** Derived aggregates are never accepted in push (RG-SYN-01). */
const DERIVED: Record<string, string[]> = {
  batches: ['current_count', 'mortality_total', 'mortality_pct', 'age_days'],
  dogs: ['rabies_status', 'rabies_valid_until', 'age_days'],
  sales: ['amount', 'amount_minor'],
  daily_logs: ['computed', 'alert_event_id'],
};
const SERVER_FIELDS = ['created_at', 'updated_at', 'deleted_at', 'created_by', 'updated_by', 'sync_version', 'client_rev', 'last_device_id', 'geog', 'param_version', 'owner_id'];

export interface PushChange {
  entity: string;
  op: 'upsert' | 'delete';
  id: string;
  client_rev: number;
  data?: Record<string, unknown>;
}

type Outcome =
  | { kind: 'applied'; entry: { id: string; sync_version: number } }
  | { kind: 'conflict'; entry: { id: string; server_data: unknown; merged_data: unknown } }
  | { kind: 'rejected'; entry: { id: string; error: unknown } };

function clean(row: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!row) return null;
  const { geog: _g, key_hash: _k, ...rest } = row;
  return rest;
}

/** Money fields accept both API (`{amount_minor, currency}`) and column (`*_minor` + currency) shapes. */
function normaliseMoney(entity: string, d: Record<string, unknown>): Record<string, unknown> {
  const out = { ...d };
  const m = (minor: unknown, currency: unknown) => (minor === null || minor === undefined ? undefined : { amount_minor: Number(minor), currency: String(currency ?? 'XAF') });
  if (entity === 'sales' && !out.unit_price) out.unit_price = m(out.unit_price_minor, out.currency);
  if (entity === 'expenses' && !out.amount) out.amount = m(out.amount_minor, out.currency);
  if (entity === 'health_events' && !out.cost && out.cost_minor !== undefined) out.cost = m(out.cost_minor, out.currency);
  if (entity === 'stock_movements' && !out.unit_cost && out.unit_cost_minor !== undefined) out.unit_cost = m(out.unit_cost_minor, out.currency);
  for (const k of ['unit_price_minor', 'amount_minor', 'cost_minor', 'unit_cost_minor']) delete out[k];
  if (['sales', 'expenses', 'health_events', 'stock_movements'].includes(entity)) delete out.currency;
  return out;
}

/** Offline-first synchronisation (05 §20): push with idempotency by (id, client_rev) and conflict merge, pull by global sync_version. */
@Injectable()
export class SyncService {
  private readonly logger = new Logger('Sync');

  constructor(
    private readonly ds: DataSource,
    private readonly access: AccessService,
    private readonly farms: FarmsService,
    private readonly livestock: LivestockService,
    private readonly journal: JournalService,
    private readonly health: HealthEventsService,
    private readonly tasks: TasksService,
    private readonly stock: StockSalesService,
    private readonly params: ParamsService,
  ) {}

  private async row(entity: string, id: string): Promise<Record<string, unknown> | null> {
    const rows = await this.ds.query(`SELECT * FROM ${TABLE[entity]} WHERE id = $1`, [id]);
    return clean(rows[0] ?? null);
  }

  async push(user: AuthUser, deviceId: string, changes: PushChange[]) {
    if (changes.length > 200) throw Errors.validation({ changes: '200 changements au maximum par lot' });
    const applied: Array<{ id: string; sync_version: number }> = [];
    const conflicts: Array<{ id: string; server_data: unknown; merged_data: unknown }> = [];
    const rejected: Array<{ id: string; error: unknown }> = [];
    for (const ch of changes) {
      const o = await this.one(user, deviceId, ch);
      if (o.kind === 'applied') applied.push(o.entry);
      else if (o.kind === 'conflict') conflicts.push(o.entry);
      else rejected.push(o.entry);
    }
    return { applied, conflicts, rejected, server_version: await this.serverVersion() };
  }

  private async one(user: AuthUser, deviceId: string, ch: PushChange): Promise<Outcome> {
    // Idempotent replay: same (id, client_rev) returns the recorded outcome.
    const prior: Array<{ outcome: Outcome }> = await this.ds.query(`SELECT outcome FROM sync_receipts WHERE entity_id = $1 AND client_rev = $2`, [ch.id, ch.client_rev]);
    if (prior.length) return prior[0].outcome;
    let outcome: Outcome;
    try {
      if (!(PUSH_ENTITIES as readonly string[]).includes(ch.entity)) {
        throw Errors.validation({ entity: `entité non modifiable par synchronisation : ${ch.entity}` });
      }
      outcome = ch.op === 'delete' ? await this.remove(user, ch) : await this.upsert(user, deviceId, ch);
    } catch (e) {
      const err = e instanceof AppError ? (e.getResponse() as { error: unknown }).error : { code: 'SERVER_ERROR', message: 'Erreur interne' };
      if (!(e instanceof AppError)) this.logger.error(`push ${ch.entity}/${ch.id}: ${(e as Error).stack}`);
      outcome = { kind: 'rejected', entry: { id: ch.id, error: err } };
    }
    // Rejections are not recorded so that a corrected change can be replayed with the same client_rev.
    if (outcome.kind !== 'rejected') {
      await this.ds.query(
        `INSERT INTO sync_receipts (entity, entity_id, client_rev, device_id, user_id, outcome) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [ch.entity, ch.id, ch.client_rev, deviceId, user.id, JSON.stringify(outcome)],
      );
    }
    return outcome;
  }

  private async remove(user: AuthUser, ch: PushChange): Promise<Outcome> {
    const existing = await this.row(ch.entity, ch.id);
    if (!existing) return { kind: 'applied', entry: { id: ch.id, sync_version: await this.serverVersion() } };
    const farmId = (ch.entity === 'farms' ? existing.id : existing.farm_id) as string;
    const farm = await this.access.farm(user, farmId);
    if (ch.entity === 'farms' && farm.owner_id !== user.id) throw Errors.forbidden('Seul le propriétaire peut supprimer');
    await this.ds.query(`UPDATE ${TABLE[ch.entity]} SET deleted_at = now(), updated_by = $2, client_rev = GREATEST(client_rev, $3) WHERE id = $1`, [ch.id, user.id, ch.client_rev]);
    if (ch.entity === 'batches' || ch.entity === 'dogs') {
      // Close reminders of removed subjects.
      await this.ds.query(`UPDATE reminders SET status = 'clos', cancel_reason = 'sujet supprimé' WHERE subject_id = $1 AND status IN ('a_venir','envoye')`, [ch.id]);
    }
    if (ch.entity === 'daily_logs' && existing.subject_type === 'batch') await this.livestock.recount(existing.subject_id as string);
    const after = await this.row(ch.entity, ch.id);
    return { kind: 'applied', entry: { id: ch.id, sync_version: Number(after!.sync_version) } };
  }

  private async apply(user: AuthUser, entity: string, data: Record<string, unknown>, opts: { deviceId: string; clientRev: number }): Promise<string> {
    const farmId = data.farm_id as string;
    switch (entity) {
      case 'farms':
        return (await this.farms.upsert(user, data as unknown as FarmInput, opts)).id;
      case 'batches':
        return (await this.livestock.upsertBatch(user, farmId, data as BatchInput, opts)).id;
      case 'dogs':
        return (await this.livestock.upsertDog(user, farmId, data as DogInput, opts)).id;
      case 'animals':
        return (await this.livestock.upsertAnimal(user, farmId, data as AnimalInput, opts)).id;
      case 'health_events':
        return (await this.health.upsert(user, data as unknown as HealthEventInput, opts)).id;
      case 'tasks':
        return (await this.tasks.upsert(user, farmId, data as unknown as TaskInput, opts)).id;
      case 'stock_movements':
        return (await this.stock.upsertMovement(user, farmId, data as unknown as MovementInput, opts)).id;
      case 'sales':
        return (await this.stock.upsertSale(user, farmId, data as unknown as SaleInput, opts)).id;
      case 'expenses':
        return (await this.stock.upsertExpense(user, farmId, data as unknown as ExpenseInput, opts)).id;
      case 'daily_logs':
        return (await this.journal.save(user, farmId ?? null, data as unknown as DailyLogInput, { ...opts, mode: 'upsert' })).id;
      default:
        throw Errors.validation({ entity: 'entité inconnue' });
    }
  }

  private async upsert(user: AuthUser, deviceId: string, ch: PushChange): Promise<Outcome> {
    const raw = { ...(ch.data ?? {}) };
    for (const k of [...SERVER_FIELDS, ...(DERIVED[ch.entity] ?? [])]) delete raw[k];
    const opts = { deviceId, clientRev: ch.client_rev };
    const existing = await this.row(ch.entity, ch.id);
    let data = normaliseMoney(ch.entity, { ...raw, id: ch.id });
    if (existing && ch.entity !== 'daily_logs') {
      // Partial changes: fields absent from the change keep the server value (field-level merge).
      const base: Record<string, unknown> = { ...existing };
      for (const k of [...SERVER_FIELDS, ...(DERIVED[ch.entity] ?? [])]) delete base[k];
      data = { ...normaliseMoney(ch.entity, base), ...data };
    }
    if (existing && ch.entity !== 'farms' && !data.farm_id) data.farm_id = existing.farm_id;

    if (ch.entity === 'daily_logs') {
      // Same subject and date under another id (two devices): merge into the server log.
      const other =
        data.subject_type && data.subject_id && data.log_date
          ? await this.journal.findBySubjectDate(String(data.subject_type), String(data.subject_id), String(data.log_date))
          : null;
      const server = other && other.id !== ch.id ? (other as unknown as Record<string, unknown>) : existing && this.isConflict(existing, ch, deviceId) ? existing : null;
      if (server) {
        const serverData = await this.row('daily_logs', server.id as string);
        const merged = mergeDailyLogs(serverData as never, data as never);
        const input = { ...merged, id: server.id, subject_type: serverData!.subject_type, subject_id: serverData!.subject_id, log_date: serverData!.log_date, farm_id: serverData!.farm_id };
        await this.journal.save(user, null, input as unknown as DailyLogInput, { ...opts, mode: 'upsert' });
        await this.ds.query(`INSERT INTO audit_log (entity, entity_id, action, actor_id, diff) VALUES ('daily_logs', $1, 'conflict_merge', $2, $3)`, [
          server.id, user.id, JSON.stringify({ incoming_id: ch.id, server: serverData, incoming: data }),
        ]);
        return { kind: 'conflict', entry: { id: ch.id, server_data: serverData, merged_data: await this.row('daily_logs', server.id as string) } };
      }
    } else if (existing && this.isConflict(existing, ch, deviceId)) {
      // Field-level last-write-wins: the incoming fields (latest write) win, the others keep the server value.
      const id = await this.apply(user, ch.entity, data, opts);
      await this.ds.query(`INSERT INTO audit_log (entity, entity_id, action, actor_id, diff) VALUES ($1, $2, 'conflict_merge', $3, $4)`, [
        ch.entity, id, user.id, JSON.stringify({ server: existing, incoming: data }),
      ]);
      return { kind: 'conflict', entry: { id: ch.id, server_data: existing, merged_data: await this.row(ch.entity, id) } };
    }
    const id = await this.apply(user, ch.entity, data, opts);
    const after = await this.row(ch.entity, id);
    return { kind: 'applied', entry: { id, sync_version: Number(after!.sync_version) } };
  }

  /** Concurrent edit: another device already wrote this revision (or a later one). */
  private isConflict(existing: Record<string, unknown>, ch: PushChange, deviceId: string): boolean {
    return Number(existing.client_rev ?? 0) >= ch.client_rev && !!existing.last_device_id && existing.last_device_id !== deviceId;
  }

  async serverVersion(): Promise<number> {
    const r: Array<{ v: string }> = await this.ds.query(`SELECT CASE WHEN is_called THEN last_value ELSE 0 END AS v FROM sync_version_seq`);
    return Number(r[0].v);
  }

  async pull(user: AuthUser, since: number, entities: string[], limit: number) {
    const unknown = entities.filter((e) => !(PULL_ENTITIES as readonly string[]).includes(e) && e !== 'ref');
    if (unknown.length) throw Errors.validation({ entities: `entités inconnues : ${unknown.join(', ')}` });
    const farmIds = await this.access.farmIds(user);
    type Change = { entity: string; op: 'upsert' | 'delete'; id: string; sync_version: number; data: Record<string, unknown> };
    const all: Change[] = [];
    let more = false;
    for (const e of entities.filter((x) => TABLE[x])) {
      if (!farmIds.length) break;
      const col = e === 'farms' ? 'id' : 'farm_id';
      const rows: Array<Record<string, unknown>> = await this.ds.query(
        `SELECT * FROM ${TABLE[e]} WHERE ${col} = ANY($1) AND sync_version > $2 ORDER BY sync_version LIMIT $3`,
        [farmIds, since, limit + 1],
      );
      if (rows.length > limit) more = true;
      for (const r of rows) {
        all.push({ entity: e, op: r.deleted_at ? 'delete' : 'upsert', id: r.id as string, sync_version: Number(r.sync_version), data: clean(r)! });
      }
    }
    let manifest: Awaited<ReturnType<ParamsService['manifest']>> | undefined;
    if (entities.includes('params') || entities.includes('ref')) {
      const farms = farmIds.length ? await Promise.all(farmIds.map((id) => this.access.farm(user, id))) : [];
      const entries = new Map<string, Awaited<ReturnType<ParamsService['manifest']>>[number]>();
      for (const f of farms.length ? farms : [undefined]) for (const m of await this.params.manifest(f)) entries.set(`${m.pack}@${m.version}`, m);
      manifest = [...entries.values()];
      const published = await this.params.publishedPacks();
      for (const m of manifest) {
        if (m.sync_version <= since) continue;
        const p = published.find((x) => x.doc.pack === m.pack && x.doc.version === m.version)!;
        all.push({ entity: 'params', op: 'upsert', id: `${m.pack}@${m.version}`, sync_version: m.sync_version, data: { ...m, content: p.doc } });
      }
    }
    all.sort((a, b) => a.sync_version - b.sync_version);
    const page = all.slice(0, limit);
    if (all.length > limit) more = true;
    const serverVersion = more && page.length ? page[page.length - 1].sync_version : await this.serverVersion();
    return { changes: page, server_version: serverVersion, has_more: more, ...(manifest ? { params_manifest: manifest } : {}) };
  }
}
