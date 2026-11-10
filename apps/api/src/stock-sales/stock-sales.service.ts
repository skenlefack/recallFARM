import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AccessService } from '../common/access.service';
import { AuthUser } from '../common/auth';
import { addDays, isDateString, todayIn } from '../common/dates';
import { Errors } from '../common/errors';
import { money } from '../common/pagination';
import { Expense, Farm, Sale, StockMovement } from '../database/entities';
import { WriteOpts } from '../health/health-events.service';
import { SubjectsService } from '../health/subjects.service';
import { evaluate } from '../params/expr';
import { objectsOfKind } from '../params/engine/resolution';
import { ParamsService } from '../params/params.service';

/** Products affected by each withdrawal period (RG-VEN-02). */
const WITHDRAWAL_BY_PRODUCT: Record<string, 'withdrawal_meat_until' | 'withdrawal_milk_until' | 'withdrawal_eggs_until'> = {
  oeufs_plateau: 'withdrawal_eggs_until',
  oeuf_unite: 'withdrawal_eggs_until',
  lait: 'withdrawal_milk_until',
  poulet_vif: 'withdrawal_meat_until',
  poulet_abattu: 'withdrawal_meat_until',
  poule_reforme: 'withdrawal_meat_until',
  lapin_vif: 'withdrawal_meat_until',
  lapin_carcasse: 'withdrawal_meat_until',
  porc_vif: 'withdrawal_meat_until',
  porcelet: 'withdrawal_meat_until',
  porc_carcasse: 'withdrawal_meat_until',
  petit_ruminant_vif: 'withdrawal_meat_until',
  bovin_vif: 'withdrawal_meat_until',
  animal_reforme: 'withdrawal_meat_until',
};

export const PRODUCTS = [
  'oeufs_plateau', 'oeuf_unite', 'poulet_vif', 'poulet_abattu', 'poule_reforme', 'lapin_vif', 'lapin_carcasse', 'porc_vif', 'porcelet', 'porc_carcasse',
  'petit_ruminant_vif', 'bovin_vif', 'animal_reforme', 'reproducteur', 'lait', 'fumier', 'peau', 'chiot', 'prestation', 'autre',
];
export const UNITS = ['kg', 'sac', 'litre', 'tete', 'unite', 'plateau', 'dose', 'seance', 'jour'];
export const EXPENSE_CATEGORIES = [
  'achat_animaux', 'aliment', 'fourrage', 'veterinaire', 'reproduction', 'main_oeuvre', 'energie_eau', 'equipement', 'batiment_entretien', 'transport',
  'litiere', 'biosecurite', 'frais_marche_taxes', 'communication', 'abonnement', 'divers',
];
export const PAYMENT_METHODS = ['orange_money', 'mtn_momo', 'moov_money', 'wave', 'free_money', 'airtel_money', 'mpesa', 'mvola', 'especes', 'virement', 'credit', 'cheque'];

export interface MovementInput {
  id: string;
  item_id: string;
  movement_date: string;
  direction: 'entree' | 'sortie' | 'ajustement';
  quantity: number;
  unit_cost?: { amount_minor: number; currency: string } | null;
  supplier?: string | null;
  lot_no?: string | null;
  expiry_date?: string | null;
  subject_type?: string | null;
  subject_id?: string | null;
  notes?: string | null;
}

export interface SaleInput {
  id: string;
  product: string;
  species?: string | null;
  quantity: number;
  unit: string;
  unit_price: { amount_minor: number; currency: string };
  client_id?: string | null;
  client_name?: string | null;
  payment?: string | null;
  payment_status?: string;
  sale_date: string;
  subject_type?: string | null;
  subject_id?: string | null;
  attributes?: Record<string, unknown>;
}

export interface ExpenseInput {
  id: string;
  category: string;
  description?: string | null;
  quantity?: number | null;
  amount: { amount_minor: number; currency: string };
  payment_method?: string | null;
  supplier?: string | null;
  expense_date: string;
  subject_type?: string | null;
  subject_id?: string | null;
  attributes?: Record<string, unknown>;
}

@Injectable()
export class StockSalesService {
  constructor(
    private readonly ds: DataSource,
    private readonly access: AccessService,
    private readonly params: ParamsService,
    private readonly subjects: SubjectsService,
  ) {}

  // ---- Stock ---------------------------------------------------------------------------
  async stockItems(user: AuthUser, farmId?: string) {
    const r = farmId ? await this.params.resolveFarm(await this.access.farm(user, farmId)) : await this.params.resolveBase();
    return objectsOfKind<{ code: string; category: string; unit: string; species?: string[] }>(r, 'stock_item').map((i) => ({
      id: i.code,
      code: i.code,
      label: this.params.label(r, i.code),
      category: i.category,
      unit: i.unit,
      species: i.species ?? null,
    }));
  }

  serializeMovement(m: StockMovement) {
    const { unit_cost_minor, currency, ...rest } = m;
    return { ...rest, unit_cost: money(unit_cost_minor, currency), sync_version: Number(m.sync_version) };
  }

  async listMovements(user: AuthUser, farmId: string, offset: number, take: number) {
    await this.access.farm(user, farmId);
    return this.ds.getRepository(StockMovement).find({ where: { farm_id: farmId }, order: { movement_date: 'DESC', created_at: 'DESC' }, skip: offset, take });
  }

  async upsertMovement(user: AuthUser, farmId: string, input: MovementInput, opts: WriteOpts = {}) {
    const farm = await this.access.farm(user, farmId);
    const items = await this.stockItems(user, farmId);
    const fields: Record<string, string> = {};
    if (!items.some((i) => i.id === input.item_id)) fields.item_id = 'intrant inconnu du référentiel';
    if (!isDateString(input.movement_date)) fields.movement_date = 'date attendue (AAAA-MM-JJ)';
    if (!(input.quantity > 0) && input.direction !== 'ajustement') fields.quantity = 'quantité > 0';
    if (input.expiry_date && !isDateString(input.expiry_date)) fields.expiry_date = 'date attendue (AAAA-MM-JJ)';
    if (Object.keys(fields).length) throw Errors.validation(fields);
    const repo = this.ds.getRepository(StockMovement);
    const existing = await repo.findOne({ where: { id: input.id }, withDeleted: true });
    if (existing && existing.farm_id !== farmId) throw Errors.conflict('Identifiant déjà utilisé', { existing_id: existing.id });
    const row = existing ?? repo.create({ id: input.id, farm_id: farmId, created_by: user.id });
    Object.assign(row, {
      item_id: input.item_id,
      movement_date: input.movement_date,
      direction: input.direction,
      quantity: input.quantity,
      unit_cost_minor: input.unit_cost?.amount_minor ?? null,
      currency: input.unit_cost?.currency ?? (input.unit_cost ? farm.currency : null),
      supplier: input.supplier ?? null,
      lot_no: input.lot_no ?? null,
      expiry_date: input.expiry_date ?? null,
      subject_type: input.subject_type ?? null,
      subject_id: input.subject_id ?? null,
      notes: input.notes ?? null,
      updated_by: user.id,
      deleted_at: null,
      last_device_id: opts.deviceId ?? null,
      client_rev: Math.max(existing?.client_rev ?? 0, opts.clientRev ?? 0),
    });
    await repo.save(row);
    return this.serializeMovement((await repo.findOne({ where: { id: row.id } }))!);
  }

  /** RG-STK-01 stock = Σ entries − Σ outputs ± adjustments; autonomy from the last 14 days of outputs. */
  async summary(user: AuthUser, farmId: string) {
    await this.access.farm(user, farmId);
    const items = await this.stockItems(user, farmId);
    const today = todayIn();
    const rows: Array<{ item_id: string; qty: number; out14: number }> = await this.ds.query(
      `SELECT item_id,
              sum(CASE direction WHEN 'entree' THEN quantity WHEN 'sortie' THEN -quantity ELSE quantity END)::float AS qty,
              sum(CASE WHEN direction = 'sortie' AND movement_date > $2::date - 14 THEN quantity ELSE 0 END)::float AS out14
         FROM stock_movements WHERE farm_id = $1 AND deleted_at IS NULL GROUP BY item_id`,
      [farmId, today],
    );
    const thresholds: Array<{ item_id: string; min_quantity: number }> = await this.ds.query(`SELECT item_id, min_quantity FROM stock_thresholds WHERE farm_id = $1`, [farmId]);
    const expiring: Array<{ item_id: string; lot_no: string | null; expiry_date: string; quantity: number }> = await this.ds.query(
      `SELECT item_id, lot_no, expiry_date::text, quantity::float FROM stock_movements
        WHERE farm_id = $1 AND deleted_at IS NULL AND direction = 'entree' AND expiry_date IS NOT NULL AND expiry_date <= $2::date
        ORDER BY expiry_date`,
      [farmId, addDays(today, 30)],
    );
    return rows.map((r) => {
      const item = items.find((i) => i.id === r.item_id);
      const daily = r.out14 / 14;
      const min = thresholds.find((t) => t.item_id === r.item_id)?.min_quantity;
      return {
        item_id: r.item_id,
        label: item?.label ?? r.item_id,
        quantity: Math.round(r.qty * 1000) / 1000,
        unit: item?.unit ?? null,
        autonomy_days: daily > 0 ? Math.floor(r.qty / daily) : null,
        below_threshold: min !== undefined ? r.qty < Number(min) : false,
        expiring_soon: expiring.filter((e) => e.item_id === r.item_id).map((e) => ({ lot_no: e.lot_no, expiry_date: e.expiry_date, quantity: e.quantity, expired: e.expiry_date < today })),
      };
    });
  }

  // ---- Sales ---------------------------------------------------------------------------
  serializeSale(s: Sale) {
    const { unit_price_minor, amount_minor, currency, ...rest } = s;
    return { ...rest, unit_price: money(unit_price_minor, currency), amount: money(amount_minor, currency), sync_version: Number(s.sync_version) };
  }

  async listSales(user: AuthUser, farmId: string, offset: number, take: number) {
    await this.access.farm(user, farmId);
    return this.ds.getRepository(Sale).find({ where: { farm_id: farmId }, order: { sale_date: 'DESC', created_at: 'DESC' }, skip: offset, take });
  }

  async upsertSale(user: AuthUser, farmId: string, input: SaleInput, opts: WriteOpts = {}) {
    const farm = await this.access.farm(user, farmId);
    const fields: Record<string, string> = {};
    if (!PRODUCTS.includes(input.product)) fields.product = 'produit inconnu';
    if (!UNITS.includes(input.unit)) fields.unit = 'unité inconnue';
    if (!(input.quantity > 0)) fields.quantity = 'quantité > 0';
    if (!isDateString(input.sale_date)) fields.sale_date = 'date attendue (AAAA-MM-JJ)';
    if (input.payment && !PAYMENT_METHODS.includes(input.payment)) fields.payment = 'moyen de paiement inconnu';
    if (input.payment_status && !['paye', 'partiel', 'a_credit'].includes(input.payment_status)) fields.payment_status = 'statut inconnu';
    if (input.unit_price.currency !== farm.currency) fields['unit_price.currency'] = `devise de l’exploitation attendue (${farm.currency})`;
    if (Object.keys(fields).length) throw Errors.validation(fields);
    if (input.subject_type && input.subject_id) {
      const subject = await this.subjects.load(input.subject_type, input.subject_id);
      if (subject.farm_id !== farmId) throw Errors.validation({ subject_id: 'sujet d’une autre exploitation' });
      const col = WITHDRAWAL_BY_PRODUCT[input.product];
      if (col) {
        const rows: Array<{ until: string }> = await this.ds.query(
          `SELECT max(${col})::text AS until FROM health_events WHERE subject_type = $1 AND subject_id = $2 AND deleted_at IS NULL AND ${col} >= $3::date`,
          [subject.type, subject.id, input.sale_date],
        );
        if (rows[0]?.until) {
          throw Errors.business('RG-VEN-02', `Vente impossible : délai d’attente en cours jusqu’au ${rows[0].until}`, { until: rows[0].until, withdrawal: col });
        }
      }
    }
    const repo = this.ds.getRepository(Sale);
    const existing = await repo.findOne({ where: { id: input.id }, withDeleted: true });
    if (existing && existing.farm_id !== farmId) throw Errors.conflict('Identifiant déjà utilisé', { existing_id: existing.id });
    const row = existing ?? repo.create({ id: input.id, farm_id: farmId, created_by: user.id });
    Object.assign(row, {
      product: input.product,
      species: input.species ?? null,
      quantity: input.quantity,
      unit: input.unit,
      unit_price_minor: input.unit_price.amount_minor,
      amount_minor: Math.round(input.quantity * input.unit_price.amount_minor), // RG-VEN-01, derived
      currency: input.unit_price.currency,
      client_id: input.client_id ?? null,
      client_name: input.client_name ?? null,
      payment: input.payment ?? null,
      payment_status: input.payment_status ?? 'paye',
      sale_date: input.sale_date,
      subject_type: input.subject_type ?? null,
      subject_id: input.subject_id ?? null,
      attributes: { ...(existing?.attributes ?? {}), ...(input.attributes ?? {}) },
      updated_by: user.id,
      deleted_at: null,
      last_device_id: opts.deviceId ?? null,
      client_rev: Math.max(existing?.client_rev ?? 0, opts.clientRev ?? 0),
    });
    await repo.save(row);
    return this.serializeSale((await repo.findOne({ where: { id: row.id } }))!);
  }

  // ---- Expenses ------------------------------------------------------------------------
  serializeExpense(e: Expense) {
    const { amount_minor, currency, ...rest } = e;
    return { ...rest, amount: money(amount_minor, currency), sync_version: Number(e.sync_version) };
  }

  async listExpenses(user: AuthUser, farmId: string, offset: number, take: number) {
    await this.access.farm(user, farmId);
    return this.ds.getRepository(Expense).find({ where: { farm_id: farmId }, order: { expense_date: 'DESC', created_at: 'DESC' }, skip: offset, take });
  }

  async upsertExpense(user: AuthUser, farmId: string, input: ExpenseInput, opts: WriteOpts = {}) {
    const farm = await this.access.farm(user, farmId);
    const fields: Record<string, string> = {};
    if (!EXPENSE_CATEGORIES.includes(input.category)) fields.category = 'catégorie inconnue';
    if (!isDateString(input.expense_date)) fields.expense_date = 'date attendue (AAAA-MM-JJ)';
    if (input.payment_method && !PAYMENT_METHODS.includes(input.payment_method)) fields.payment_method = 'moyen de paiement inconnu';
    if (input.amount.currency !== farm.currency) fields['amount.currency'] = `devise de l’exploitation attendue (${farm.currency})`;
    if (Object.keys(fields).length) throw Errors.validation(fields);
    const repo = this.ds.getRepository(Expense);
    const existing = await repo.findOne({ where: { id: input.id }, withDeleted: true });
    if (existing && existing.farm_id !== farmId) throw Errors.conflict('Identifiant déjà utilisé', { existing_id: existing.id });
    const row = existing ?? repo.create({ id: input.id, farm_id: farmId, created_by: user.id });
    Object.assign(row, {
      category: input.category,
      description: input.description ?? null,
      quantity: input.quantity ?? null,
      amount_minor: input.amount.amount_minor,
      currency: input.amount.currency,
      payment_method: input.payment_method ?? null,
      supplier: input.supplier ?? null,
      expense_date: input.expense_date,
      subject_type: input.subject_type ?? null,
      subject_id: input.subject_id ?? null,
      attributes: { ...(existing?.attributes ?? {}), ...(input.attributes ?? {}) },
      updated_by: user.id,
      deleted_at: null,
      last_device_id: opts.deviceId ?? null,
      client_rev: Math.max(existing?.client_rev ?? 0, opts.clientRev ?? 0),
    });
    await repo.save(row);
    return this.serializeExpense((await repo.findOne({ where: { id: row.id } }))!);
  }

  // ---- KPIs ----------------------------------------------------------------------------
  async monthMargin(farm: Farm, month = todayIn().slice(0, 7)) {
    const rows: Array<{ rev: number; exp: number }> = await this.ds.query(
      `SELECT
         (SELECT COALESCE(sum(amount_minor),0) FROM products_sales WHERE farm_id = $1 AND deleted_at IS NULL AND to_char(sale_date,'YYYY-MM') = $2 AND currency = $3)::bigint AS rev,
         (SELECT COALESCE(sum(amount_minor),0) FROM expenses WHERE farm_id = $1 AND deleted_at IS NULL AND to_char(expense_date,'YYYY-MM') = $2 AND currency = $3)::bigint AS exp`,
      [farm.id, month, farm.currency],
    );
    const rev = Number(rows[0].rev);
    const exp = Number(rows[0].exp);
    return { month, revenue: money(rev, farm.currency)!, expenses: money(exp, farm.currency)!, margin: money(rev - exp, farm.currency)! };
  }

  /** Pack `kpi` objects evaluated server-side per subject over the period, plus the month margin. */
  async kpis(user: AuthUser, farmId: string, period: '7d' | '30d' = '7d') {
    const farm = await this.access.farm(user, farmId);
    const resolved = await this.params.resolveFarm(farm);
    const days = period === '30d' ? 30 : 7;
    const today = todayIn();
    const from = addDays(today, -(days - 1));
    const kpis = objectsOfKind<{ code: string; expr: string; unit?: string; thresholds?: { red?: string; amber?: string }; production_type?: string }>(resolved, 'kpi');
    const out: Array<Record<string, unknown>> = [];
    const batches: Array<Record<string, any>> = await this.ds.query(`SELECT * FROM batches WHERE farm_id = $1 AND deleted_at IS NULL AND status = 'en_cours'`, [farmId]);
    for (const b of batches) {
      const agg: Array<{ eggs: number | null; present: number | null; mortality: number; feed: number | null; n: number }> = await this.ds.query(
        `SELECT sum(eggs)::float AS eggs, sum(present_count)::float AS present, sum(mortality)::int AS mortality, sum(feed_kg)::float AS feed, count(*)::int AS n
           FROM daily_logs WHERE subject_type = 'batch' AND subject_id = $1 AND deleted_at IS NULL AND log_date BETWEEN $2 AND $3`,
        [b.id, from, today],
      );
      const a = agg[0];
      const feedAll: Array<{ feed: number | null }> = await this.ds.query(
        `SELECT sum(feed_kg)::float AS feed FROM daily_logs WHERE subject_type = 'batch' AND subject_id = $1 AND deleted_at IS NULL`,
        [b.id],
      );
      const ctx = {
        log: { eggs: a.n ? a.eggs : null, present_count: a.n ? a.present : 0, mortality: a.mortality },
        subject: { ...b.attributes, ...b, cumulative_mortality: b.mortality_total, cumulative_feed_kg: feedAll[0].feed ?? 0, weight_gain_kg: b.attributes?.weight_gain_kg ?? null },
        now: today,
      };
      for (const k of kpis) {
        if (k.production_type && k.production_type !== b.production_type) continue;
        if (!k.expr.includes('log.') && !k.expr.includes('subject.')) continue;
        if (k.code === 'statut_rage') continue;
        const r = evaluate(k.expr, ctx);
        const value = r.ok ? (r.value as number | null) : null;
        if (k.code === 'taux_ponte' && !a.n) continue;
        out.push({ code: k.code, label: this.params.label(resolved, k.code), subject_type: 'batch', subject_id: b.id, subject_name: b.name, value, unit: k.unit ?? null, status: this.status(value, k.thresholds) });
      }
    }
    const margin = await this.monthMargin(farm);
    return { period, from, to: today, kpis: out, margin, margin_month: margin };
  }

  status(value: unknown, t?: { red?: string; amber?: string }): 'red' | 'amber' | 'ok' | null {
    if (typeof value !== 'number') return null;
    const test = (rule?: string) => {
      if (!rule) return false;
      const m = /^(<=|>=|<|>)\s*(-?\d+(\.\d+)?)$/.exec(rule.trim());
      if (!m) return false;
      const n = Number(m[2]);
      return m[1] === '<' ? value < n : m[1] === '<=' ? value <= n : m[1] === '>' ? value > n : value >= n;
    };
    if (test(t?.red)) return 'red';
    if (test(t?.amber)) return 'amber';
    return 'ok';
  }
}
