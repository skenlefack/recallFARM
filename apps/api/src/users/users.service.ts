import { Injectable } from '@nestjs/common';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { EntitlementsService } from '../billing/entitlements.service';
import { AccessService } from '../common/access.service';
import { AuthUser } from '../common/auth';
import { Errors } from '../common/errors';
import { config } from '../config';
import { AccountRequest, Consent, User } from '../database/entities';

export const CONSENT_SCOPES = [
  'cgu_confidentialite', 'surveillance_agregats', 'partage_organisation', 'partage_veterinaire', 'partage_prestataire', 'messages_whatsapp', 'messages_sms',
];

@Injectable()
export class UsersService {
  constructor(
    private readonly ds: DataSource,
    private readonly access: AccessService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /** GET /me payload (MVP-SCOPE §4). */
  async me(userId: string) {
    const u = await this.ds.getRepository(User).findOne({ where: { id: userId } });
    if (!u) throw Errors.unauthenticated();
    const memberships: Array<{ organisation_id: string; organisation_name: string; role: string }> = await this.ds.query(
      `SELECT m.organisation_id, o.name AS organisation_name, m.role FROM memberships m JOIN organisations o ON o.id = m.organisation_id
        WHERE m.user_id = $1 AND m.status = 'actif' AND m.deleted_at IS NULL ORDER BY o.name`,
      [userId],
    );
    const authUser: AuthUser = { id: u.id, phone: u.phone, platform_roles: u.platform_roles };
    const ids = await this.access.farmIds(authUser);
    const farms: Array<{ id: string; name: string }> = ids.length
      ? await this.ds.query(`SELECT id, name FROM farms WHERE id = ANY($1) ORDER BY created_at`, [ids])
      : [];
    return {
      id: u.id,
      phone: u.phone,
      name: u.full_name,
      language: u.locale,
      country: u.country,
      default_currency: u.default_currency,
      platform_roles: u.platform_roles,
      memberships,
      farms,
      entitlements: await this.entitlements.forUser(u.id),
    };
  }

  async patch(user: AuthUser, body: { name?: string; language?: string; default_currency?: string }) {
    const repo = this.ds.getRepository(User);
    const u = (await repo.findOne({ where: { id: user.id } }))!;
    if (body.name !== undefined) u.full_name = body.name;
    if (body.language !== undefined) u.locale = body.language;
    if (body.default_currency !== undefined) u.default_currency = body.default_currency;
    await repo.save(u);
    return this.me(user.id);
  }

  async consents(user: AuthUser) {
    return this.ds.getRepository(Consent).find({ where: { user_id: user.id }, order: { created_at: 'DESC' } });
  }

  async addConsent(user: AuthUser, body: { id?: string; scope: string; granted: boolean; text_version: string; organisation_id?: string; farm_id?: string; channel?: string }) {
    const repo = this.ds.getRepository(Consent);
    const now = new Date();
    return repo.save(
      repo.create({
        ...(body.id ? { id: body.id } : {}),
        user_id: user.id,
        scope: body.scope,
        granted: body.granted,
        text_version: body.text_version,
        organisation_id: body.organisation_id ?? null,
        farm_id: body.farm_id ?? null,
        channel: body.channel ?? 'app',
        granted_at: now,
        revoked_at: body.granted ? null : now,
      }),
    );
  }

  /** Data portability: builds a JSON export of the user's data (signed link = local file in the MVP). */
  async requestExport(user: AuthUser) {
    const repo = this.ds.getRepository(AccountRequest);
    const req = await repo.save(repo.create({ user_id: user.id, type: 'export', status: 'en_cours' }));
    const farms: Array<{ id: string }> = await this.ds.query(`SELECT id FROM farms WHERE owner_id = $1`, [user.id]);
    const ids = farms.map((f) => f.id);
    const dump: Record<string, unknown> = { generated_at: new Date().toISOString(), user: await this.me(user.id), consents: await this.consents(user) };
    for (const t of ['farms', 'batches', 'dogs', 'animals', 'daily_logs', 'health_events', 'reminders', 'tasks', 'stock_movements', 'products_sales', 'expenses']) {
      dump[t] = ids.length ? await this.ds.query(`SELECT * FROM ${t} WHERE ${t === 'farms' ? 'id' : 'farm_id'} = ANY($1)`, [ids]) : [];
    }
    const dir = join(config().exportsDir, 'account');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${req.id}.json`);
    writeFileSync(file, JSON.stringify(dump, null, 2));
    req.status = 'prete';
    req.export_uri = `file://${file}`;
    req.completed_at = new Date();
    await repo.save(req);
    return { request_id: req.id, status: req.status, export_uri: req.export_uri };
  }

  async request(user: AuthUser, id: string) {
    const r = await this.ds.getRepository(AccountRequest).findOne({ where: { id, user_id: user.id } });
    if (!r) throw Errors.notFound('Demande');
    return r;
  }

  /** Account deletion with a 30-day withdrawal period (03 §8 account_requests). */
  async requestDeletion(user: AuthUser) {
    const repo = this.ds.getRepository(AccountRequest);
    const scheduled = new Date(Date.now() + 30 * 86400_000);
    const r = await repo.save(repo.create({ user_id: user.id, type: 'suppression', status: 'recue', scheduled_for: scheduled }));
    return { request_id: r.id, status: r.status, scheduled_for: scheduled.toISOString() };
  }

  async cancelRequest(user: AuthUser, id: string) {
    const r = await this.request(user, id);
    if (!['recue', 'en_cours'].includes(r.status)) throw Errors.business('RG-CON-01', 'Demande déjà traitée');
    r.status = 'annulee';
    await this.ds.getRepository(AccountRequest).save(r);
    return r;
  }

  /** Full data export for GET /me/export (RGPD portability). */
  async fullExport(userId: string) {
    const user = await this.me(userId);
    const consents = await this.consents({ id: userId, phone: '', platform_roles: [] });
    const farms: Array<{ id: string }> = await this.ds.query(`SELECT id FROM farms WHERE owner_id = $1`, [userId]);
    const farmIds = farms.map((f) => f.id);

    const dump: Record<string, unknown> = {
      generated_at: new Date().toISOString(),
      user,
      consents,
    };

    for (const t of ['farms', 'batches', 'dogs', 'animals', 'health_events', 'reminders', 'daily_logs', 'products_sales', 'expenses', 'stock_movements']) {
      dump[t] = farmIds.length ? await this.ds.query(`SELECT * FROM ${t} WHERE ${t === 'farms' ? 'id' : 'farm_id'} = ANY($1)`, [farmIds]) : [];
    }

    return dump;
  }

  /** Cancel a pending deletion request (within the 30-day withdrawal period). */
  async cancelDeletion(user: AuthUser) {
    const repo = this.ds.getRepository(AccountRequest);
    const pending = await repo.findOne({
      where: { user_id: user.id, type: 'suppression', status: 'recue' },
      order: { requested_at: 'DESC' },
    });
    if (!pending) throw Errors.notFound('Demande de suppression');
    pending.status = 'annulee';
    await repo.save(pending);
    return { request_id: pending.id, status: 'annulee' };
  }
}
