import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHash, randomUUID } from 'crypto';
import { DataSource, In } from 'typeorm';
import { AccessService } from '../common/access.service';
import { AuthUser } from '../common/auth';
import { todayIn } from '../common/dates';
import { Errors } from '../common/errors';
import { KvService } from '../common/kv.service';
import { config } from '../config';
import { AlertEvent, DailyLog, Device, Farm, FarmSettings, Telemetry, User } from '../database/entities';
import { evaluate, evaluateCondition } from '../params/expr';
import { ParamsService } from '../params/params.service';
import { MessagingService } from '../notifications/messaging.service';
import { SubjectInfo } from '../health/subjects.service';

export const ALERT_OPEN = ['ouverte', 'escaladee', 'acquittee'];
const COOLDOWN_MS = 3600_000; // RG-IOT-01
const ESCALATION_MS = 15 * 60_000;

export function parseDuration(s: unknown): number {
  if (typeof s === 'number') return s * 1000;
  const m = /^(\d+)\s*(s|m|h)?$/.exec(String(s ?? '').trim());
  if (!m) return 0;
  return Number(m[1]) * ({ s: 1000, m: 60_000, h: 3600_000 } as Record<string, number>)[m[2] ?? 's'];
}

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** Alert engine (dossier 12 §6.3, 13 §4): daily-log rules, telemetry rules with `for`, cooldown, escalation. */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger('Alerts');

  constructor(
    private readonly ds: DataSource,
    private readonly access: AccessService,
    private readonly params: ParamsService,
    private readonly messaging: MessagingService,
    private readonly kv: KvService,
  ) {}

  serialize(a: AlertEvent & { farm_name?: string | null }) {
    const tv = (a.trigger_value ?? {}) as Record<string, unknown>;
    const since = typeof tv.since === 'string' ? Date.parse(tv.since) : NaN;
    return {
      ...a,
      farm_name: a.farm_name ?? null,
      message: a.reason,
      value: (tv.value ?? tv.pct ?? tv.mortality ?? null) as number | null,
      unit: (tv.unit as string | undefined) ?? (tv.pct !== undefined ? '%' : null),
      housing_name: (tv.housing as string | undefined) ?? null,
      duration_min: Number.isNaN(since) ? null : Math.round(((a.last_triggered_at ?? new Date()).getTime() - since) / 60_000),
      sync_version: Number(a.sync_version),
    };
  }

  /** Adds farm names to a list of alerts. */
  async withFarmNames(list: AlertEvent[]): Promise<Array<AlertEvent & { farm_name: string | null }>> {
    const ids = [...new Set(list.map((a) => a.farm_id).filter((x): x is string => !!x))];
    const rows: Array<{ id: string; name: string }> = ids.length ? await this.ds.query(`SELECT id, name FROM farms WHERE id = ANY($1)`, [ids]) : [];
    const names = new Map(rows.map((r) => [r.id, r.name]));
    return list.map((a) => Object.assign(a, { farm_name: a.farm_id ? (names.get(a.farm_id) ?? null) : a.title }));
  }

  private async escalationPlan(opened: Date, farm: Farm) {
    const owner = await this.ds.getRepository(User).findOne({ where: { id: farm.owner_id } });
    const s = await this.ds.getRepository(FarmSettings).findOne({ where: { farm_id: farm.id } });
    const oncall = { name: (s?.oncall_default?.name as string | undefined) ?? owner?.full_name ?? null, phone: (s?.oncall_default?.phone as string | undefined) ?? owner?.phone ?? null };
    return [
      { level: 1, target: 'proprietaire', name: owner?.full_name ?? null, phone: owner?.phone ?? null, channel: 'push+sms', at: opened.toISOString(), done: true },
      { level: 2, target: 'astreinte', ...oncall, channel: 'sms', at: new Date(opened.getTime() + ESCALATION_MS).toISOString(), done: false },
      { level: 3, target: 'astreinte', ...oncall, channel: 'vocal', at: new Date(opened.getTime() + 2 * ESCALATION_MS).toISOString(), done: false },
    ];
  }

  /** Opens an alert or increments the repeat counter within the cooldown (RG-IOT-01). */
  async open(input: {
    farm: Farm;
    rule_code: string;
    source: string;
    severity: string;
    title: string;
    reason: string;
    action_label?: string | null;
    trigger_value: Record<string, unknown>;
    subject_type?: string | null;
    subject_id?: string | null;
    device_id?: string | null;
    param_version?: string | null;
  }): Promise<AlertEvent> {
    const repo = this.ds.getRepository(AlertEvent);
    const recent = await repo
      .createQueryBuilder('a')
      .where('a.farm_id = :farm AND a.rule_code = :rule', { farm: input.farm.id, rule: input.rule_code })
      .andWhere(input.subject_id ? 'a.subject_id = :sid' : input.device_id ? 'a.device_id = :did' : '1=1', { sid: input.subject_id, did: input.device_id })
      .andWhere(`(a.status IN (:...open) OR a.opened_at > :since)`, { open: ALERT_OPEN, since: new Date(Date.now() - COOLDOWN_MS) })
      .orderBy('a.opened_at', 'DESC')
      .getOne();
    if (recent) {
      recent.repeat_count += 1;
      recent.last_triggered_at = new Date();
      recent.trigger_value = input.trigger_value;
      return repo.save(recent);
    }
    const now = new Date();
    const alert = repo.create({
      id: randomUUID(),
      farm_id: input.farm.id,
      organisation_id: input.farm.organisation_id,
      rule_code: input.rule_code,
      source: input.source,
      severity: input.severity,
      status: 'ouverte',
      title: input.title,
      reason: input.reason,
      action_label: input.action_label ?? null,
      trigger_value: input.trigger_value,
      subject_type: input.subject_type ?? null,
      subject_id: input.subject_id ?? null,
      device_id: input.device_id ?? null,
      opened_at: now,
      last_triggered_at: now,
      escalation: input.severity === 'critique' ? await this.escalationPlan(now, input.farm) : [],
      param_version: input.param_version ?? null,
    });
    const saved = await repo.save(alert);
    await this.notify(saved, input.farm, 1);
    return saved;
  }

  private async notify(a: AlertEvent, farm: Farm, level: number): Promise<void> {
    let phone: string | null = null;
    let userId: string | null = null;
    if (level === 1) {
      const owner = await this.ds.getRepository(User).findOne({ where: { id: farm.owner_id } });
      phone = owner?.phone ?? null;
      userId = owner?.id ?? null;
    } else {
      const s = await this.ds.getRepository(FarmSettings).findOne({ where: { farm_id: farm.id } });
      phone = (s?.oncall_default?.phone as string | undefined) ?? null;
      if (!phone) {
        const owner = await this.ds.getRepository(User).findOne({ where: { id: farm.owner_id } });
        phone = owner?.phone ?? null;
      }
    }
    if (!phone) return;
    const text = `RecallFarm ALERTE ${a.severity.toUpperCase()}${level > 1 ? ` · NIVEAU ${level}` : ''} : ${a.title ?? a.rule_code} — ${a.reason ?? ''}`.slice(0, 300);
    await this.messaging.send({ channel: 'push', phone, text, template_code: 'alerte', user_id: userId, alert_event_id: a.id, organisation_id: farm.organisation_id });
    if (a.severity === 'critique') {
      await this.messaging.send({ channel: 'sms', phone, text, template_code: 'alerte', user_id: userId, alert_event_id: a.id, organisation_id: farm.organisation_id });
    }
  }

  /** Evaluates the resolved `alert_rule` objects with source daily_logs after a log is recorded. */
  async evaluateDailyLog(farm: Farm, subject: SubjectInfo, log: DailyLog, presentCount: number | null): Promise<AlertEvent[]> {
    const resolved = await this.params.resolveFarm(farm);
    const out: AlertEvent[] = [];
    const logCtx = { ...log.attributes, ...log, present_count: log.present_count ?? presentCount };
    for (const rule of this.params.alertRules(resolved, 'daily_logs')) {
      const ctx = { log: logCtx, subject: subject.ctx, params: rule.params ?? {}, now: todayIn(), farm: { id: farm.id, country: farm.country } };
      const r = evaluateCondition(rule.when, ctx);
      if (!r.value) continue;
      const pct = logCtx.present_count ? Math.round(((log.mortality ?? 0) / (logCtx.present_count as number)) * 1000) / 10 : null;
      const title = this.params.label(resolved, rule.code);
      const reason =
        rule.code.includes('mortal') && pct !== null
          ? `${subject.label} : ${log.mortality} morts le ${log.log_date} (${String(pct).replace('.', ',')} %)`
          : `${subject.label} : règle ${title} déclenchée le ${log.log_date}`;
      out.push(
        await this.open({
          farm,
          rule_code: rule.code,
          source: 'daily_logs',
          severity: rule.severity,
          title,
          reason,
          action_label: (rule.propose as string | undefined) === 'disease_signal' ? 'Signaler une suspicion' : null,
          trigger_value: { log_id: log.id, mortality: log.mortality, present_count: logCtx.present_count, eggs: log.eggs, pct, params: rule.params ?? {} },
          subject_type: subject.type,
          subject_id: subject.id,
          param_version: resolved.param_version,
        }),
      );
    }
    return out;
  }

  // ---- Telemetry -----------------------------------------------------------------------
  async ingest(deviceKey: string | undefined, body: { device_id: string; metric: string; value: number; ts?: string }) {
    if (!deviceKey) throw Errors.unauthenticated('Clé d’appareil requise (X-Device-Key)');
    const device = await this.ds.getRepository(Device).createQueryBuilder('d').addSelect('d.key_hash').where('d.id = :id', { id: body.device_id }).getOne();
    if (!device || !device.key_hash || device.key_hash !== hashKey(deviceKey)) throw Errors.unauthenticated('Appareil inconnu ou clé invalide');
    const ts = body.ts ? new Date(body.ts) : new Date();
    if (Number.isNaN(ts.getTime())) throw Errors.validation({ ts: 'horodatage invalide' });
    if (ts.getTime() > Date.now() + 5 * 60_000) throw Errors.validation({ ts: 'horodatage dans le futur' });
    await this.ds
      .createQueryBuilder()
      .insert()
      .into(Telemetry)
      .values({ device_id: device.id, metric: body.metric, ts, value: body.value, quality: 1 })
      .orIgnore()
      .execute();
    const gatewayUpdate = this.ds.query(`UPDATE devices SET last_seen_at = now(), status = 'en_ligne' WHERE farm_id = $1 AND type = 'gateway'`, [device.farm_id]);
    device.last_seen_at = ts;
    device.last_value = body.value;
    device.status = 'en_ligne';
    const farm = (await this.ds.getRepository(Farm).findOne({ where: { id: device.farm_id } }))!;
    const rule = await this.deviceRule(farm, device);
    let alert: AlertEvent | null = null;
    if (rule) {
      const breach = evaluateCondition(rule.when, { reading: { value: body.value, unit: device.unit, metric: body.metric }, now: todayIn() }).value;
      if (!breach) device.breach_since = null;
      else {
        device.breach_since = device.breach_since ?? ts;
        const held = ts.getTime() - new Date(device.breach_since).getTime();
        if (held >= rule.forMs) {
          const mins = Math.round(held / 60_000);
          alert = await this.open({
            farm,
            rule_code: `${device.sensor_profile_code ?? device.metric ?? 'capteur'}:${device.id}`,
            source: 'telemetry',
            severity: rule.severity,
            title: `${device.name}`,
            reason: `${device.name} : ${String(body.value).replace('.', ',')} ${device.unit ?? ''} depuis ${mins} min`.trim(),
            action_label: 'Je prends en charge',
            trigger_value: { value: body.value, unit: device.unit, metric: body.metric, housing: device.housing ?? device.name, since: new Date(device.breach_since).toISOString(), rule: rule.when },
            device_id: device.id,
          });
        }
      }
    }
    await this.ds.getRepository(Device).save(device);
    await gatewayUpdate;
    return { accepted: true, device_id: device.id, alert_id: alert?.id ?? null };
  }

  /** Device rule: device config overrides the pack sensor_profile default_alert. */
  async deviceRule(farm: Farm, d: Device): Promise<{ when: string; forMs: number; severity: string; warn?: string } | null> {
    const cfg = d.config ?? {};
    if (cfg.alert?.when) return { when: cfg.alert.when, forMs: parseDuration(cfg.alert.for), severity: cfg.alert.severity ?? 'critique', warn: cfg.warn_when };
    if (!d.sensor_profile_code) return null;
    const resolved = await this.params.resolveFarm(farm);
    const p = this.params.get<{ default_alert?: { when: string; for?: string; severity?: string } }>(resolved, 'sensor_profile', d.sensor_profile_code);
    if (!p?.default_alert) return null;
    return { when: p.default_alert.when, forMs: parseDuration(p.default_alert.for), severity: p.default_alert.severity ?? 'critique', warn: cfg.warn_when };
  }

  async live(user: AuthUser, farmId: string) {
    const farm = await this.access.farm(user, farmId);
    const devices = await this.ds.getRepository(Device).find({ where: { farm_id: farmId }, order: { created_at: 'ASC' } });
    const gw = devices.find((d) => d.type === 'gateway');
    const since = new Date(Date.now() - 24 * 3600_000);
    const series: Array<{ device_id: string; bucket: Date; v: number }> = devices.length
      ? await this.ds.query(
          `SELECT device_id, date_trunc('hour', ts) AS bucket, avg(value)::float AS v FROM telemetry
            WHERE device_id = ANY($1) AND ts >= $2 GROUP BY 1, 2 ORDER BY 2`,
          [devices.map((d) => d.id), since],
        )
      : [];
    const online = !!gw?.last_seen_at && Date.now() - new Date(gw.last_seen_at).getTime() < 15 * 60_000;
    const tiles = [];
    for (const d of devices.filter((x) => x.type !== 'gateway')) {
      const rule = await this.deviceRule(farm, d);
      let status: 'normal' | 'attention' | 'critique' | 'hors_ligne' = 'normal';
      if (d.last_value !== null && rule) {
        const reading = { reading: { value: d.last_value, unit: d.unit } };
        if (evaluateCondition(rule.when, reading).value) status = 'critique';
        else if (rule.warn && evaluateCondition(rule.warn, reading).value) status = 'attention';
      }
      if (!d.last_seen_at || Date.now() - new Date(d.last_seen_at).getTime() > 2 * 3600_000) status = 'hors_ligne';
      tiles.push({
        device_id: d.id,
        name: d.name,
        type: d.type,
        housing: d.housing,
        metric: d.metric,
        value: d.last_value,
        unit: d.unit,
        status,
        threshold: d.config?.threshold ?? null,
        last_seen: d.last_seen_at,
        battery_pct: d.battery_pct,
        auto_journal: !!d.config?.auto_journal,
        series: series.filter((s) => s.device_id === d.id).map((s) => ({ ts: new Date(s.bucket).toISOString(), value: Math.round(s.v * 10) / 10 })),
      });
    }
    const openAlerts = await this.ds.getRepository(AlertEvent).count({ where: { farm_id: farmId, status: In(ALERT_OPEN) } });
    return {
      gateway: gw ? { device_id: gw.id, name: gw.name, online, last_seen: gw.last_seen_at, sensors: devices.length - 1 } : { online: false, last_seen: null, sensors: 0 },
      tiles,
      open_alerts: openAlerts,
    };
  }

  // ---- Listing and lifecycle -----------------------------------------------------------
  async list(user: AuthUser, q: { farm_id?: string; status?: string; severity?: string; organisation_id?: string }, offset: number, take: number) {
    const qb = this.ds.getRepository(AlertEvent).createQueryBuilder('a');
    if (q.organisation_id) {
      await this.access.assertOrgManager(user, q.organisation_id);
      qb.where('a.organisation_id = :org', { org: q.organisation_id });
    } else if (q.farm_id) {
      qb.where('a.farm_id = :fid', { fid: (await this.access.farm(user, q.farm_id)).id });
    } else {
      // Without farm_id: the caller's farms plus every farm/org-level alert of organisations they manage.
      const ids = await this.access.farmIds(user, { includeOrgManaged: true });
      const orgs: Array<{ organisation_id: string }> = await this.ds.query(
        `SELECT organisation_id FROM memberships WHERE user_id = $1 AND status = 'actif' AND deleted_at IS NULL AND role = ANY($2)`,
        [user.id, ['admin', 'proprietaire', 'veterinaire']],
      );
      const orgIds = orgs.map((o) => o.organisation_id);
      if (!ids.length && !orgIds.length) return [];
      qb.where(
        `(${ids.length ? 'a.farm_id IN (:...ids)' : 'FALSE'} OR ${orgIds.length ? 'a.organisation_id IN (:...orgIds)' : 'FALSE'})`,
        { ids, orgIds },
      );
    }
    if (q.status) {
      // Comma-separated list; `open`/`ouvertes` expands to every open state.
      const st = [...new Set(q.status.split(',').map((x) => x.trim()).filter(Boolean).flatMap((x) => (x === 'open' || x === 'ouvertes' ? ALERT_OPEN : [x])))];
      qb.andWhere(st.length ? 'a.status IN (:...st)' : 'FALSE', { st });
    }
    if (q.severity) qb.andWhere('a.severity = :sev', { sev: q.severity });
    return qb
      .orderBy(`CASE a.severity WHEN 'critique' THEN 0 WHEN 'attention' THEN 1 ELSE 2 END`)
      .addOrderBy('a.opened_at', 'DESC')
      .skip(offset)
      .take(take)
      .getMany()
      .then((l) => this.withFarmNames(l));
  }

  private async load(user: AuthUser, id: string): Promise<AlertEvent> {
    const a = await this.ds.getRepository(AlertEvent).findOne({ where: { id } });
    if (!a) throw Errors.notFound('Alerte');
    if (a.farm_id) await this.access.farm(user, a.farm_id);
    else if (a.organisation_id) await this.access.assertOrgManager(user, a.organisation_id);
    return a;
  }

  async ack(user: AuthUser, id: string): Promise<AlertEvent> {
    const a = await this.load(user, id);
    if (['resolue', 'close'].includes(a.status)) return a;
    a.status = 'acquittee';
    a.acknowledged_by = user.id;
    a.acknowledged_at = new Date();
    a.escalation = (a.escalation ?? []).map((e) => (e.done ? e : { ...e, done: false, cancelled: true }) as never);
    return this.ds.getRepository(AlertEvent).save(a);
  }

  async resolve(user: AuthUser, id: string, body: { cause?: string; action?: string }): Promise<AlertEvent> {
    const a = await this.load(user, id);
    if (a.severity === 'critique' && (!body.cause || !body.action)) {
      throw Errors.business('RG-IOT-02', 'Une alerte critique ne peut être fermée sans cause et action renseignées');
    }
    a.status = 'resolue';
    a.resolved_at = new Date();
    a.acknowledged_at = a.acknowledged_at ?? new Date();
    a.acknowledged_by = a.acknowledged_by ?? user.id;
    a.resolution_cause = body.cause ?? null;
    a.resolution_action = body.action ?? null;
    return this.ds.getRepository(AlertEvent).save(a);
  }

  /** Escalation tick: unacknowledged critical alerts go to the on-call contact after 15 min. */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'alert-escalation' })
  async escalationTick(): Promise<void> {
    if (!config().schedulerEnabled) return;
    await this.kv.withLock('scheduler:escalation', 55_000, () => this.escalate()).catch((e) => this.logger.error(e.message));
  }

  async escalate(now = new Date()): Promise<number> {
    const alerts = await this.ds.getRepository(AlertEvent).find({ where: { status: In(['ouverte', 'escaladee']), severity: 'critique' } });
    let n = 0;
    for (const a of alerts) {
      const due = (a.escalation ?? []).filter((e) => !e.done && new Date(e.at) <= now);
      if (!due.length || !a.farm_id) continue;
      const farm = await this.ds.getRepository(Farm).findOne({ where: { id: a.farm_id } });
      if (!farm) continue;
      for (const step of due) {
        step.done = true;
        await this.notify(a, farm, step.level);
      }
      a.escalation = [...a.escalation];
      a.status = 'escaladee';
      await this.ds.getRepository(AlertEvent).save(a);
      n++;
    }
    return n;
  }

  /** Evaluates an expression for diagnostics (used by studio tests). */
  evaluate(expr: string, ctx: Record<string, unknown>) {
    return evaluate(expr, ctx);
  }
}
