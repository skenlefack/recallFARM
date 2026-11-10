import { Injectable } from '@nestjs/common';
import { createHash, randomInt } from 'crypto';
import { DataSource, IsNull } from 'typeorm';
import { TokenService } from '../common/auth';
import { Errors } from '../common/errors';
import { KvService } from '../common/kv.service';
import { E164, normalisePhone, renderTemplate } from '../common/text';
import { config } from '../config';
import { OtpCode, RefreshToken, User } from '../database/entities';
import { MessagingService } from '../notifications/messaging.service';
import { ParamsService } from '../params/params.service';
import { UsersService } from './users.service';

const OTP_TTL_MS = 10 * 60_000; // RG-AUT-01
const OTP_MAX_ATTEMPTS = 5;

@Injectable()
export class AuthService {
  constructor(
    private readonly ds: DataSource,
    private readonly kv: KvService,
    private readonly tokens: TokenService,
    private readonly messaging: MessagingService,
    private readonly params: ParamsService,
    private readonly users: UsersService,
  ) {}

  private hash(phone: string, code: string): string {
    return createHash('sha256').update(`${config().jwtAccessSecret}:${phone}:${code}`).digest('hex');
  }

  private phone(raw: string): string {
    const p = normalisePhone(raw);
    if (!E164.test(p)) throw Errors.validation({ phone: 'format E.164 attendu (+237…)' });
    return p;
  }

  /** POST /auth/otp/request — 3 requests / 15 min / number (05 §22). */
  async requestOtp(rawPhone: string) {
    const phone = this.phone(rawPhone);
    const cfg = config();
    const hit = await this.kv.hit(`otp:req:${phone}`, cfg.otpWindowS * 1000);
    if (hit.count > cfg.otpMaxPerWindow) throw Errors.rateLimited(Math.ceil(hit.ttlMs / 1000));
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.ds.getRepository(OtpCode).save({ phone, code_hash: this.hash(phone, code), expires_at: new Date(Date.now() + OTP_TTL_MS) });
    const user = await this.ds.getRepository(User).findOne({ where: { phone } });
    const lang = user?.locale === 'en' ? 'en' : 'fr';
    const resolved = await this.params.resolveBase('CM');
    const text = renderTemplate(this.params.template(resolved, 'otp_sms', 'sms', lang) ?? 'RecallFarm: votre code est {{code}}.', { code });
    await this.messaging.send({ channel: 'sms', phone, text, template_code: 'otp_sms', lang, user_id: user?.id ?? null, sensitive: true });
    return { sent: true, retry_after_s: 60, ...(cfg.otpDevEcho ? { dev_code: code } : {}) };
  }

  async verifyOtp(rawPhone: string, code: string, provisionalUserId?: string) {
    const phone = this.phone(rawPhone);
    const repo = this.ds.getRepository(OtpCode);
    const otp = await repo.findOne({ where: { phone, consumed_at: IsNull() }, order: { created_at: 'DESC' } });
    if (!otp || otp.expires_at < new Date()) throw Errors.unauthenticated('Code expiré ou inconnu, demandez un nouveau code');
    if (otp.attempts >= OTP_MAX_ATTEMPTS) throw Errors.rateLimited(15 * 60);
    if (otp.code_hash !== this.hash(phone, code)) {
      otp.attempts += 1;
      await repo.save(otp);
      throw Errors.unauthenticated('Code invalide');
    }
    otp.consumed_at = new Date();
    await repo.save(otp);
    const users = this.ds.getRepository(User);
    let user = await users.findOne({ where: { phone }, withDeleted: true });
    if (!user) user = users.create({ phone, country: phone.startsWith('+237') ? 'CM' : 'CM', account_status: 'actif' });
    if (user.account_status === 'cloture' || user.account_status === 'suspendu') throw Errors.forbidden('Compte inactif');
    user.otp_verified = true;
    if (user.account_status === 'provisoire' || user.account_status === 'verifie') user.account_status = 'actif';
    user.last_active_at = new Date();
    user = await users.save(user);

    // Merge data from a provisional offline account into the now-authenticated user.
    if (provisionalUserId && provisionalUserId !== user.id) {
      await this.mergeProvisionalAccount(provisionalUserId, user.id);
    }

    return this.issue(user);
  }

  /**
   * Transfers all data owned by a provisional (offline-created) user to the real authenticated user.
   * The provisional user row is soft-deleted afterward.
   * Tables with owner_id / user_id foreign keys: farms, consents, memberships, refresh_tokens.
   * Tables with farm_id are transferred transitively (farms.owner_id changes).
   */
  private async mergeProvisionalAccount(provisionalId: string, targetId: string): Promise<void> {
    const users = this.ds.getRepository(User);
    const provisional = await users.findOne({ where: { id: provisionalId } });
    if (!provisional) return; // No such provisional user — silently ignore
    if (provisional.account_status !== 'provisoire') return; // Only merge truly provisional accounts

    // Reassign farms owned by the provisional user
    await this.ds.query(`UPDATE farms SET owner_id = $1, updated_by = $1 WHERE owner_id = $2 AND deleted_at IS NULL`, [targetId, provisionalId]);

    // Reassign memberships
    await this.ds.query(`UPDATE memberships SET user_id = $1 WHERE user_id = $2 AND deleted_at IS NULL`, [targetId, provisionalId]);

    // Reassign consents
    await this.ds.query(`UPDATE consents SET user_id = $1 WHERE user_id = $2`, [targetId, provisionalId]);

    // Reassign outbound messages
    await this.ds.query(`UPDATE outbound_messages SET recipient_user_id = $1 WHERE recipient_user_id = $2`, [targetId, provisionalId]);

    // Devices (sensors) belong to farms, not users: they follow the farms reassigned above.

    // Soft-delete the provisional user
    provisional.account_status = 'fusionne';
    provisional.deleted_at = new Date();
    await users.save(provisional);
  }

  async issue(user: User) {
    const access = await this.tokens.signAccess({ id: user.id, phone: user.phone, platform_roles: user.platform_roles ?? [] });
    const refresh = await this.tokens.signRefresh(user.id);
    await this.ds.getRepository(RefreshToken).save({ id: refresh.jti, user_id: user.id, expires_at: refresh.expiresAt });
    return { access_token: access, refresh_token: refresh.token, token_type: 'Bearer', expires_in: this.tokens.accessTtlS(), user: await this.users.me(user.id) };
  }

  async refresh(token: string) {
    const claims = await this.tokens.verifyRefresh(token);
    const rt = await this.ds.getRepository(RefreshToken).findOne({ where: { id: claims.jti } });
    if (!rt || rt.revoked_at || rt.expires_at < new Date() || rt.user_id !== claims.sub) throw Errors.unauthenticated('Session expirée');
    const user = await this.ds.getRepository(User).findOne({ where: { id: claims.sub } });
    if (!user) throw Errors.unauthenticated();
    return {
      access_token: await this.tokens.signAccess({ id: user.id, phone: user.phone, platform_roles: user.platform_roles ?? [] }),
      token_type: 'Bearer',
      expires_in: this.tokens.accessTtlS(),
    };
  }

  async logout(token: string) {
    const claims = await this.tokens.verifyRefresh(token);
    await this.ds.getRepository(RefreshToken).update({ id: claims.jti }, { revoked_at: new Date() });
    return { revoked: true };
  }
}
