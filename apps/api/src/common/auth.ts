import { CanActivate, createParamDecorator, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { jwtVerify, SignJWT } from 'jose';
import { DataSource } from 'typeorm';
import { config } from '../config';
import { User } from '../database/entities';
import { Errors } from './errors';

export interface AuthUser {
  id: string;
  phone: string;
  platform_roles: string[];
}

export const IS_PUBLIC = 'rf:public';
export const PLATFORM_ROLES = 'rf:platform_roles';

/** Route needs no authentication. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Route requires one of these platform roles (platform_admin always passes). */
export const PlatformRoles = (...roles: string[]) => SetMetadata(PLATFORM_ROLES, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

function ttlToSeconds(ttl: string): number {
  const m = /^(\d+)([smhd])?$/.exec(ttl.trim());
  if (!m) return 900;
  const n = Number(m[1]);
  return n * ({ s: 1, m: 60, h: 3600, d: 86400 } as Record<string, number>)[m[2] ?? 's'];
}

@Injectable()
export class TokenService {
  private enc(secret: string) {
    return new TextEncoder().encode(secret);
  }

  accessTtlS(): number {
    return ttlToSeconds(config().jwtAccessTtl);
  }

  refreshTtlS(): number {
    return ttlToSeconds(config().jwtRefreshTtl);
  }

  async signAccess(u: AuthUser): Promise<string> {
    return new SignJWT({ phone: u.phone, roles: u.platform_roles, typ: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(u.id)
      .setIssuedAt()
      .setIssuer('recallfarm')
      .setExpirationTime(`${this.accessTtlS()}s`)
      .sign(this.enc(config().jwtAccessSecret));
  }

  async signRefresh(userId: string): Promise<{ token: string; jti: string; expiresAt: Date }> {
    const jti = randomUUID();
    const ttl = this.refreshTtlS();
    const token = await new SignJWT({ typ: 'refresh' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setJti(jti)
      .setIssuedAt()
      .setIssuer('recallfarm')
      .setExpirationTime(`${ttl}s`)
      .sign(this.enc(config().jwtRefreshSecret));
    return { token, jti, expiresAt: new Date(Date.now() + ttl * 1000) };
  }

  async verifyAccess(token: string): Promise<{ sub: string; phone: string; roles: string[] }> {
    try {
      const { payload } = await jwtVerify(token, this.enc(config().jwtAccessSecret), { issuer: 'recallfarm' });
      if (payload.typ !== 'access' || !payload.sub) throw new Error('bad type');
      return { sub: payload.sub, phone: String(payload.phone), roles: (payload.roles as string[]) ?? [] };
    } catch {
      throw Errors.unauthenticated('Jeton invalide ou expiré');
    }
  }

  async verifyRefresh(token: string): Promise<{ sub: string; jti: string }> {
    try {
      const { payload } = await jwtVerify(token, this.enc(config().jwtRefreshSecret), { issuer: 'recallfarm' });
      if (payload.typ !== 'refresh' || !payload.sub || !payload.jti) throw new Error('bad type');
      return { sub: payload.sub, jti: payload.jti };
    } catch {
      throw Errors.unauthenticated('Jeton de rafraîchissement invalide');
    }
  }
}

/** Global guard: JWT bearer authentication + platform role check. */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly lastSeen = new Map<string, number>();

  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly ds: DataSource,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const handlers = [ctx.getHandler(), ctx.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, handlers);
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    if (isPublic) {
      // Optional authentication on public routes.
      if (header?.startsWith('Bearer ')) {
        try {
          req.user = await this.resolveUser(header.slice(7));
        } catch {
          /* ignore */
        }
      }
      return true;
    }
    if (!header?.startsWith('Bearer ')) throw Errors.unauthenticated();
    const user = await this.resolveUser(header.slice(7));
    req.user = user;
    const roles = this.reflector.getAllAndOverride<string[]>(PLATFORM_ROLES, handlers);
    if (roles?.length && !user.platform_roles.includes('platform_admin') && !roles.some((r) => user.platform_roles.includes(r))) {
      throw Errors.forbidden('Rôle insuffisant');
    }
    return true;
  }

  private async resolveUser(token: string): Promise<AuthUser> {
    const claims = await this.tokens.verifyAccess(token);
    const user = await this.ds.getRepository(User).findOne({ where: { id: claims.sub } });
    if (!user || user.account_status === 'cloture' || user.account_status === 'suspendu') throw Errors.unauthenticated('Compte inactif');
    const last = this.lastSeen.get(user.id) ?? 0;
    if (Date.now() - last > 5 * 60_000) {
      this.lastSeen.set(user.id, Date.now());
      void this.ds.query(`UPDATE users SET last_active_at = now() WHERE id = $1`, [user.id]).catch(() => undefined);
    }
    return { id: user.id, phone: user.phone, platform_roles: user.platform_roles ?? [] };
  }
}

export function hasPlatformRole(u: AuthUser | undefined, ...roles: string[]): boolean {
  if (!u) return false;
  return u.platform_roles.includes('platform_admin') || roles.some((r) => u.platform_roles.includes(r));
}
