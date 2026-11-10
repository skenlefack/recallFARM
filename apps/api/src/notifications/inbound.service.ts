import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { AccessService } from '../common/access.service';
import { AuthUser } from '../common/auth';
import { todayIn } from '../common/dates';
import { normalisePhone } from '../common/text';
import { User } from '../database/entities';
import { HealthEventsService } from '../health/health-events.service';
import { JournalService } from '../journal/journal.service';
import { ParamsService } from '../params/params.service';
import { MessagingService } from './messaging.service';

/**
 * Inbound channel logic shared by the generic endpoints (/inbound/*) and the declarative
 * connectors (/connectors/:name/*): SMS confirmation "OK <code>" and the pilot USSD menu (02 E80, EF-NOT-05).
 */
@Injectable()
export class InboundService {
  constructor(
    private readonly ds: DataSource,
    private readonly health: HealthEventsService,
    private readonly journal: JournalService,
    private readonly params: ParamsService,
    private readonly messaging: MessagingService,
    private readonly access: AccessService,
  ) {}

  private async userByPhone(raw: string): Promise<AuthUser | null> {
    const u = await this.ds.getRepository(User).findOne({ where: { phone: normalisePhone(raw) } });
    return u ? { id: u.id, phone: u.phone, platform_roles: u.platform_roles } : null;
  }

  private async openReminders(user: AuthUser, onlyDue: boolean) {
    const ids = await this.access.farmIds(user);
    if (!ids.length) return [];
    return this.ds.query(
      `SELECT id, short_code, disease, subject_ref, due_date::text AS due_date FROM reminders
        WHERE farm_id = ANY($1) AND status IN ('a_venir','envoye') AND deleted_at IS NULL ${onlyDue ? `AND due_date <= $2::date` : `AND $2::text IS NOT NULL`}
        ORDER BY due_date LIMIT 5`,
      [ids, todayIn()],
    ) as Promise<Array<{ id: string; short_code: string; disease: string; subject_ref: string; due_date: string }>>;
  }

  private async confirmByCode(user: AuthUser, code: string, via: string) {
    const ids = await this.access.farmIds(user);
    const rows: Array<{ id: string; disease: string; subject_ref: string }> = ids.length
      ? await this.ds.query(
          `SELECT id, disease, subject_ref FROM reminders WHERE farm_id = ANY($1) AND short_code = $2 AND status IN ('a_venir','envoye') AND deleted_at IS NULL LIMIT 1`,
          [ids, code],
        )
      : [];
    if (!rows.length) return null;
    await this.health.confirmReminder(user, rows[0].id, {}, via);
    return rows[0];
  }

  /** Handles an inbound SMS and replies by SMS. */
  async handleSms(from: string, text: string) {
    const user = await this.userByPhone(from);
    const m = /^\s*(OK|FAIT|DONE)\s+([A-Z0-9]{3,8})\s*$/i.exec(text);
    let reply: string;
    let reminderId: string | null = null;
    if (!user) reply = 'RecallFarm: numéro inconnu. Téléchargez l’application ou contactez votre coopérative.';
    else if (!m) reply = 'RecallFarm: message non compris. Répondez OK suivi du code reçu (ex. OK 4821).';
    else {
      const r = await this.confirmByCode(user, m[2].toUpperCase(), 'sms');
      if (!r) reply = `RecallFarm: code ${m[2]} introuvable ou déjà confirmé.`;
      else {
        reminderId = r.id;
        const resolved = await this.params.resolveBase();
        reply = `RecallFarm: merci, ${this.params.label(resolved, r.disease)} pour ${r.subject_ref} confirmé.`;
      }
    }
    await this.messaging.send({ channel: 'sms', phone: normalisePhone(from), text: reply, template_code: 'reponse_sms', user_id: user?.id ?? null, reminder_id: reminderId });
    return { handled: !!reminderId, reminder_id: reminderId, reply };
  }

  /** Handles one USSD hop; the response starts with "CON " (continue) or "END " (close). */
  async handleUssd(sessionId: string, phone: string, text: string): Promise<{ response: string }> {
    const user = await this.userByPhone(phone);
    if (!user) return { response: 'END Numéro inconnu de RecallFarm.' };
    const resolved = await this.params.resolveBase();
    const menu = Object.values(resolved.objects).find((o) => o.kind === 'ussd_menu') as { items?: string[] } | undefined;
    const items = menu?.items ?? ['rappels_du_jour', 'confirmer_rappel', 'declarer_mortalite'];
    const parts = text ? text.split('*') : [];
    if (!parts.length) {
      return { response: `CON RecallFarm\n${items.map((it, i) => `${i + 1}. ${this.params.label(resolved, it)}`).join('\n')}` };
    }
    const choice = items[Number(parts[0]) - 1];
    if (choice === 'rappels_du_jour') {
      const list = await this.openReminders(user, true);
      if (!list.length) return { response: 'END Aucun rappel pour aujourd’hui.' };
      return { response: `END ${list.map((r) => `${this.params.label(resolved, r.disease)} ${r.subject_ref} (code ${r.short_code})`).join('\n')}` };
    }
    if (choice === 'confirmer_rappel') {
      if (parts.length < 2) return { response: 'CON Entrez le code du rappel :' };
      const r = await this.confirmByCode(user, parts[1].trim().toUpperCase(), 'ussd');
      return { response: r ? `END Merci, rappel ${this.params.label(resolved, r.disease)} confirmé.` : 'END Code introuvable ou déjà confirmé.' };
    }
    if (choice === 'declarer_mortalite') {
      const ids = await this.access.farmIds(user);
      const batches: Array<{ id: string; name: string; farm_id: string }> = ids.length
        ? await this.ds.query(`SELECT id, name, farm_id FROM batches WHERE farm_id = ANY($1) AND deleted_at IS NULL AND status = 'en_cours' ORDER BY name LIMIT 8`, [ids])
        : [];
      if (!batches.length) return { response: 'END Aucun lot en cours.' };
      if (parts.length < 2) return { response: `CON Quel lot ?\n${batches.map((b, i) => `${i + 1}. ${b.name}`).join('\n')}` };
      const b = batches[Number(parts[1]) - 1];
      if (!b) return { response: 'END Choix invalide.' };
      if (parts.length < 3) return { response: `CON Nombre de morts aujourd’hui (${b.name}) :` };
      const n = Number(parts[2]);
      if (!Number.isInteger(n) || n < 0) return { response: 'END Nombre invalide.' };
      const today = todayIn();
      const existing = await this.journal.findBySubjectDate('batch', b.id, today);
      const res = await this.journal.save(
        user,
        b.farm_id,
        { id: existing?.id ?? randomUUID(), subject_type: 'batch', subject_id: b.id, log_date: today, mortality: (existing?.mortality ?? 0) + n, ...(existing?.eggs !== undefined && existing?.eggs !== null ? { eggs: existing.eggs } : {}) },
        { mode: 'upsert', deviceId: `ussd:${sessionId}` },
      ).catch((e) => ({ error: e }));
      if ('error' in res) return { response: 'END Saisie impossible, complétez le journal dans l’application.' };
      return { response: `END ${n} mort(s) enregistré(s) pour ${b.name}.${res.alerts.length ? ' Alerte transmise.' : ''}` };
    }
    return { response: 'END Choix invalide.' };
  }
}
