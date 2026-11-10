import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Farm, Membership } from '../database/entities';
import { AuthUser, hasPlatformRole } from './auth';
import { Errors } from './errors';

export const ORG_MANAGER_ROLES = ['admin', 'proprietaire', 'veterinaire'];

/** Role and scope checks: platform roles, membership roles, farm ownership and agent scope (05 §22). */
@Injectable()
export class AccessService {
  constructor(private readonly ds: DataSource) {}

  /** Farms the user works on directly: owned + agent scope (+ every org farm for org managers when asked). */
  async farmIds(user: AuthUser, opts: { includeOrgManaged?: boolean } = {}): Promise<string[]> {
    const rows: Array<{ id: string }> = await this.ds.query(
      `SELECT f.id FROM farms f
        WHERE f.deleted_at IS NULL AND (
          f.owner_id = $1 OR EXISTS (
            SELECT 1 FROM memberships m
             WHERE m.user_id = $1 AND m.deleted_at IS NULL AND m.status = 'actif' AND m.organisation_id = f.organisation_id
               AND ((m.role = 'agent' AND m.farmer_scope ? f.id::text) OR ($2::boolean AND m.role = ANY($3)))
          ))
        ORDER BY f.created_at`,
      [user.id, !!opts.includeOrgManaged, ORG_MANAGER_ROLES],
    );
    return rows.map((r) => r.id);
  }

  async canAccessFarm(user: AuthUser, farm: Farm): Promise<boolean> {
    if (farm.owner_id === user.id || hasPlatformRole(user, 'support')) return true;
    if (!farm.organisation_id) return false;
    const m = await this.ds.getRepository(Membership).findOne({
      where: { user_id: user.id, organisation_id: farm.organisation_id, status: 'actif' },
    });
    if (!m) return false;
    if (ORG_MANAGER_ROLES.includes(m.role)) return true;
    return m.role === 'agent' && (m.farmer_scope ?? []).includes(farm.id);
  }

  /** Loads a farm and checks access (404 when unknown, 403 when out of scope). */
  async farm(user: AuthUser, farmId: string): Promise<Farm> {
    const farm = await this.ds.getRepository(Farm).findOne({ where: { id: farmId } });
    if (!farm) throw Errors.notFound('Exploitation');
    if (!(await this.canAccessFarm(user, farm))) throw Errors.forbidden("Cette exploitation n'est pas dans votre périmètre");
    return farm;
  }

  async membership(user: AuthUser, organisationId: string): Promise<Membership | null> {
    return this.ds.getRepository(Membership).findOne({ where: { user_id: user.id, organisation_id: organisationId, status: 'actif' } });
  }

  async assertOrgMember(user: AuthUser, organisationId: string): Promise<Membership | null> {
    if (hasPlatformRole(user, 'support')) return null;
    const m = await this.membership(user, organisationId);
    if (!m) throw Errors.forbidden("Vous n'êtes pas membre de cette organisation");
    return m;
  }

  async assertOrgManager(user: AuthUser, organisationId: string): Promise<void> {
    if (hasPlatformRole(user, 'support')) return;
    const m = await this.membership(user, organisationId);
    if (!m || !ORG_MANAGER_ROLES.includes(m.role)) throw Errors.forbidden("Rôle d'administration de l'organisation requis");
  }
}
