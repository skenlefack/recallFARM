import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { EntitlementsService, Entitlements } from '../billing/entitlements.service';
import { dateIn, daysBetween, timeIn } from '../common/dates';
import { KvService } from '../common/kv.service';
import { renderTemplate } from '../common/text';
import { config } from '../config';
import { Farm } from '../database/entities';
import { notificationPlan } from '../params/engine/reminders';
import { Resolved } from '../params/engine/types';
import { ParamsService } from '../params/params.service';
import { MessagingService } from './messaging.service';

interface DueRow {
  id: string;
  farm_id: string;
  due_date: string;
  status: string;
  priority: string;
  disease: string | null;
  subject_ref: string | null;
  short_code: string | null;
  owner_id: string;
  organisation_id: string | null;
  phone: string;
  locale: string;
  country: string;
  speculations: string[];
}

export interface SchedulerReport {
  skipped?: 'quiet_hours' | 'locked' | 'disabled';
  considered: number;
  sent: number;
  capped: number;
  push: number;
}

/** True when HH:MM `t` is inside a quiet window that may wrap midnight. */
export function inQuietHours(t: string, q?: { start: string; end: string }): boolean {
  if (!q) return false;
  return q.start <= q.end ? t >= q.start && t < q.end : t >= q.start || t < q.end;
}

export function whenLabel(due: string, today: string, lang = 'fr'): string {
  const d = daysBetween(today, due);
  if (lang === 'en') {
    if (d === 0) return 'today';
    if (d === 1) return 'tomorrow';
    return d > 0 ? `in ${d} days` : `overdue by ${-d} days`;
  }
  if (d === 0) return "aujourd'hui";
  if (d === 1) return 'demain';
  return d > 0 ? `dans ${d} jours` : `en retard de ${-d} jours`;
}

/**
 * Every minute (Redis lock when available): applies the country reminder plan (J-7, J-1, J, J+3),
 * quiet hours, the per-user SMS daily cap (RG-NOT-02) and the plan's monthly SMS quota.
 */
@Injectable()
export class NotificationsScheduler {
  private readonly logger = new Logger('NotificationsScheduler');

  constructor(
    private readonly ds: DataSource,
    private readonly kv: KvService,
    private readonly params: ParamsService,
    private readonly entitlements: EntitlementsService,
    private readonly messaging: MessagingService,
  ) {}

  /** Renders the SMS text for a single reminder row. */
  private renderReminderText(resolved: Resolved, row: DueRow, today: string, lang: string): string {
    return renderTemplate(
      this.params.template(resolved, 'rappel_sms', 'sms', lang) ?? 'RecallFarm: {{disease}} {{subject}} {{when}}. OK {{code}}',
      {
        disease: this.params.label(resolved, row.disease, lang),
        subject: row.subject_ref ?? '',
        when: whenLabel(row.due_date, today, lang),
        code: row.short_code ?? '',
      },
    );
  }

  @Cron(CronExpression.EVERY_MINUTE, { name: 'notifications' })
  async tick(): Promise<void> {
    if (!config().schedulerEnabled) return;
    try {
      const r = await this.kv.withLock('scheduler:notifications', 55_000, () => this.runOnce());
      if (r && r.sent + r.capped + r.push > 0) this.logger.log(`notifications: ${JSON.stringify(r)}`);
    } catch (e) {
      this.logger.error(`scheduler failed: ${(e as Error).message}`);
    }
  }

  async runOnce(now = new Date()): Promise<SchedulerReport> {
    const tz = config().tz;
    const today = dateIn(now, tz);
    const localTime = timeIn(now, tz);
    const report: SchedulerReport = { considered: 0, sent: 0, capped: 0, push: 0 };
    const rows: DueRow[] = await this.ds.query(
      `SELECT r.id, r.farm_id, r.due_date, r.status, r.priority, r.disease, r.subject_ref, r.short_code,
              f.owner_id, f.organisation_id, f.country, f.speculations, u.phone, u.locale
         FROM reminders r JOIN farms f ON f.id = r.farm_id JOIN users u ON u.id = f.owner_id
        WHERE r.status IN ('a_venir','envoye') AND r.deleted_at IS NULL AND f.deleted_at IS NULL
          AND r.due_date BETWEEN ($1::date - 3) AND ($1::date + 7)
          AND (r.snoozed_until IS NULL OR r.snoozed_until <= $1::date)
        ORDER BY r.priority DESC, r.due_date LIMIT 5000`,
      [today],
    );
    const resolvedCache = new Map<string, Resolved>();
    const entCache = new Map<string, Entitlements>();
    const startOfDay = new Date(`${today}T00:00:00`).toISOString();
    const period = today.slice(0, 7);

    // ---- Phase 1: collect eligible reminders and group SMS by (phone + due_date) ----
    interface Eligible {
      row: DueRow;
      entry: { offset: number; channels: string[]; send_date: string };
      resolved: Resolved;
      ent: Entitlements;
      plan: ReturnType<ParamsService['reminderPlan']>;
      lang: string;
      doneCh: Set<string>;
    }
    const eligible: Eligible[] = [];

    for (const row of rows) {
      report.considered++;
      const farmLike = { id: row.farm_id, country: row.country, speculations: row.speculations, organisation_id: row.organisation_id };
      const stackKey = `${row.country}|${row.speculations.join(',')}|${row.organisation_id ?? ''}`;
      let resolved = resolvedCache.get(stackKey);
      if (!resolved) {
        resolved = await this.params.resolve(farmLike);
        resolvedCache.set(stackKey, resolved);
      }
      const plan = this.params.reminderPlan(resolved);
      if (!plan) continue;
      if (inQuietHours(localTime, plan.quiet_hours)) {
        report.skipped = 'quiet_hours';
        return report;
      }
      const entKey = `${row.owner_id}|${row.organisation_id ?? ''}`;
      let ent = entCache.get(entKey);
      if (!ent) {
        ent = await this.entitlements.forFarm({ owner_id: row.owner_id, organisation_id: row.organisation_id } as Farm);
        entCache.set(entKey, ent);
      }
      const entry = notificationPlan(plan, row.due_date, ent.features).find((p) => p.send_date === today);
      if (!entry) continue;
      const already: Array<{ channel: string }> = await this.ds.query(
        `SELECT channel FROM outbound_messages WHERE reminder_id = $1 AND plan_offset = $2`,
        [row.id, entry.offset],
      );
      const doneCh = new Set(already.map((a) => a.channel));
      const lang = row.locale === 'en' ? 'en' : 'fr';
      eligible.push({ row, entry, resolved, ent, plan, lang, doneCh });
    }

    // ---- Phase 2: push notifications (one per reminder, no grouping) ----
    for (const e of eligible) {
      for (const ch of e.entry.channels) {
        if (ch !== 'app') continue;
        if (e.doneCh.has('push')) continue;
        const text = this.renderReminderText(e.resolved, e.row, today, e.lang);
        await this.messaging.send({ phone: e.row.phone, text, user_id: e.row.owner_id, reminder_id: e.row.id, organisation_id: e.row.organisation_id, plan_offset: e.entry.offset, lang: e.lang, channel: 'push', template_code: 'rappel_push' });
        report.push++;
      }
    }

    // ---- Phase 3: group SMS by (phone + due_date) — RG-NOT-02 same-day grouping ----
    const smsGroups = new Map<string, Eligible[]>();
    for (const e of eligible) {
      const hasSms = e.entry.channels.some((ch) => ch === 'sms' || ch === 'whatsapp');
      if (!hasSms) continue;
      const groupKey = `${e.row.phone}|${e.row.due_date}`;
      let group = smsGroups.get(groupKey);
      if (!group) { group = []; smsGroups.set(groupKey, group); }
      group.push(e);
    }

    for (const [, group] of smsGroups) {
      const first = group[0];
      const channel: 'sms' | 'whatsapp' = first.entry.channels.includes('whatsapp') ? 'whatsapp' : 'sms';
      // Skip items already sent on this channel
      const unsent = group.filter((e) => !e.doneCh.has(channel));
      if (!unsent.length) continue;

      // RG-NOT-02 daily cap
      const sentToday = await this.messaging.smsSentToday(first.row.phone, startOfDay);
      const cap = (first.plan as any).max_sms_per_day ?? 3;
      const anyHigh = unsent.some((e) => e.row.priority === 'haute' || e.row.priority === 'critique');
      const capped = anyHigh ? sentToday.high >= 1 && sentToday.total >= cap : sentToday.total >= cap;
      const account = first.ent.source.account_type === 'organisation' ? { t: 'organisation', id: first.ent.source.account_id! } : { t: 'user', id: first.row.owner_id };
      const used = await this.messaging.usage(account.t, account.id, period);
      const quota = first.ent.quotas.sms_per_month ?? 0;

      if (capped || used >= quota) {
        for (const e of unsent) {
          await this.messaging.record({ phone: e.row.phone, text: '', channel, template_code: 'rappel_sms', user_id: e.row.owner_id, reminder_id: e.row.id, organisation_id: e.row.organisation_id, plan_offset: e.entry.offset, lang: e.lang }, 'plafonne', { error_code: capped ? 'daily_cap' : 'monthly_quota' });
          report.capped++;
        }
        continue;
      }

      // Build grouped SMS text: one line per reminder in the group
      const lines = unsent.map((e) => this.renderReminderText(e.resolved, e.row, today, e.lang));
      const text = lines.length === 1 ? lines[0] : lines.join('\n');

      // Send one grouped SMS, journaled against the first reminder
      const msg = await this.messaging.send({ phone: first.row.phone, text, channel, template_code: 'rappel_sms', user_id: first.row.owner_id, reminder_id: first.row.id, organisation_id: first.row.organisation_id, plan_offset: first.entry.offset, lang: first.lang });
      if (msg.status === 'envoye') {
        await this.messaging.incrementUsage(account.t, account.id, period);
        report.sent++;
        // Record additional reminders in the group (without re-sending)
        for (const e of unsent.slice(1)) {
          await this.messaging.record({ phone: e.row.phone, text, channel, template_code: 'rappel_sms', user_id: e.row.owner_id, reminder_id: e.row.id, organisation_id: e.row.organisation_id, plan_offset: e.entry.offset, lang: e.lang }, 'envoye', { sent_at: new Date(), provider_ref: msg.provider_ref ?? 'grouped' });
        }
      }
    }

    // ---- Phase 4: mark reminders as sent ----
    for (const e of eligible) {
      if (e.row.status === 'a_venir') {
        await this.ds.query(`UPDATE reminders SET status = 'envoye', sent_at = now() WHERE id = $1 AND status = 'a_venir'`, [e.row.id]);
      }
    }
    return report;
  }
}
