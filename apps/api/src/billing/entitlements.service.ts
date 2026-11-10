import { Injectable } from '@nestjs/common';
import { SignJWT } from 'jose';
import { DataSource } from 'typeorm';
import { Errors } from '../common/errors';
import { KeysService } from '../common/keys.service';
import { Farm, Subscription } from '../database/entities';
import { ParamsService, PlanInfo } from '../params/params.service';

export interface Entitlements {
  plan: string;
  features: string[];
  quotas: Record<string, number>;
  expires_at: string | null;
  grace_until: string | null;
  status: 'actif' | 'grace' | 'expire' | 'gratuit';
  source: { account_type: 'user' | 'organisation' | 'none'; account_id: string | null };
  token?: string;
}

/** Feature gating (EF-ABO, RG-ABO-01): effective plan, features and quotas, signed for offline use. */
@Injectable()
export class EntitlementsService {
  constructor(
    private readonly ds: DataSource,
    private readonly params: ParamsService,
    private readonly keys: KeysService,
  ) {}

  async planCatalog(country = 'CM'): Promise<PlanInfo[]> {
    return this.params.plans(await this.params.resolveBase(country));
  }

  private allFeatures(plans: PlanInfo[]): string[] {
    return [...new Set(plans.flatMap((p) => p.features.filter((f) => f !== '*')))].sort();
  }

  private subState(s: Subscription, now = new Date()): 'actif' | 'grace' | 'expire' {
    if (s.status === 'suspendu' || s.status === 'cloture') return 'expire';
    if (!s.expires_at || s.expires_at > now) return 'actif';
    if (s.grace_until && s.grace_until > now) return 'grace';
    return 'expire';
  }

  private async build(subs: Subscription[]): Promise<Entitlements> {
    const plans = await this.planCatalog();
    const rank = (code: string) => plans.find((p) => p.code === code)?.rank ?? -1;
    const active = subs.filter((s) => this.subState(s) !== 'expire').sort((a, b) => rank(b.plan) - rank(a.plan));
    const best = active[0];
    const planCode = best?.plan ?? 'decouverte';
    const plan = plans.find((p) => p.code === planCode) ?? plans[0];
    const features = plan.features.includes('*') ? this.allFeatures(plans) : [...plan.features].sort();
    return {
      plan: plan.code,
      features,
      quotas: plan.quotas ?? {},
      expires_at: best?.expires_at?.toISOString() ?? null,
      grace_until: best?.grace_until?.toISOString() ?? null,
      status: best ? this.subState(best) as 'actif' | 'grace' : 'gratuit',
      source: best ? { account_type: best.account_type as 'user' | 'organisation', account_id: best.account_id } : { account_type: 'none', account_id: null },
    };
  }

  /** Effective entitlements of a user: own subscription or a subscription of an organisation they belong to. */
  async forUser(userId: string, withToken = true): Promise<Entitlements> {
    const subs: Subscription[] = await this.ds.query(
      `SELECT s.* FROM subscriptions s
        WHERE (s.account_type = 'user' AND s.account_id = $1)
           OR (s.account_type = 'organisation' AND s.account_id IN (
                SELECT organisation_id FROM memberships WHERE user_id = $1 AND status = 'actif' AND deleted_at IS NULL))`,
      [userId],
    );
    const e = await this.build(subs.map(rowToSub));
    if (withToken) e.token = await this.sign(userId, e);
    return e;
  }

  /** Entitlements governing a farm: the owner's subscription or the farm organisation's subscription. */
  async forFarm(farm: Pick<Farm, 'owner_id' | 'organisation_id'>): Promise<Entitlements> {
    const subs: Subscription[] = await this.ds.query(
      `SELECT * FROM subscriptions WHERE (account_type = 'user' AND account_id = $1) OR (account_type = 'organisation' AND account_id = $2)`,
      [farm.owner_id, farm.organisation_id ?? '00000000-0000-0000-0000-000000000000'],
    );
    return this.build(subs.map(rowToSub));
  }

  async forOrganisation(orgId: string): Promise<Entitlements> {
    const subs: Subscription[] = await this.ds.query(`SELECT * FROM subscriptions WHERE account_type = 'organisation' AND account_id = $1`, [orgId]);
    return this.build(subs.map(rowToSub));
  }

  async requiredPlanFor(feature: string): Promise<string> {
    const plans = await this.planCatalog();
    return plans.find((p) => p.features.includes(feature) || p.features.includes('*'))?.code ?? 'pro';
  }

  /** Throws 403 PLAN_REQUIRED when the feature is not included. */
  async assertFeature(e: Entitlements, feature: string): Promise<void> {
    if (e.features.includes(feature)) return;
    throw Errors.planRequired(await this.requiredPlanFor(feature), feature);
  }

  async sign(subject: string, e: Entitlements): Promise<string> {
    const exp = e.grace_until ? Math.floor(new Date(e.grace_until).getTime() / 1000) : Math.floor(Date.now() / 1000) + 30 * 86400;
    return new SignJWT({ plan: e.plan, features: e.features, quotas: e.quotas, expires_at: e.expires_at, grace_until: e.grace_until })
      .setProtectedHeader({ alg: 'EdDSA', kid: this.keys.kid, typ: 'JWT' })
      .setSubject(subject)
      .setIssuer('recallfarm')
      .setIssuedAt()
      .setExpirationTime(exp)
      .sign(this.keys.private);
  }
}

function rowToSub(r: any): Subscription {
  return {
    ...r,
    expires_at: r.expires_at ? new Date(r.expires_at) : null,
    grace_until: r.grace_until ? new Date(r.grace_until) : null,
    started_at: r.started_at ? new Date(r.started_at) : null,
  } as Subscription;
}
