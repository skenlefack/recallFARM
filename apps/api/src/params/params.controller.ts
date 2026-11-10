import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { DataSource } from 'typeorm';
import { AccessService } from '../common/access.service';
import { AuthUser, CurrentUser, Public } from '../common/auth';
import { Errors } from '../common/errors';
import { KeysService } from '../common/keys.service';
import { ParamPackVersion } from '../database/entities';
import { ParamsService } from './params.service';

export class ManifestQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() farm_id?: string;
}

export class ResolvedQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() farm_id?: string;
  @ApiPropertyOptional({ example: 'CM' }) @IsOptional() @Matches(/^[A-Z]{2}$/) country?: string;
  @ApiPropertyOptional({ example: 'vaccination_protocol' }) @IsOptional() @IsString() kind?: string;
  @ApiPropertyOptional({ example: 'chien_cm' }) @IsOptional() @IsString() code?: string;
}

@ApiTags('params')
@Controller('params')
export class ParamsController {
  constructor(
    private readonly params: ParamsService,
    private readonly keys: KeysService,
    private readonly access: AccessService,
    private readonly ds: DataSource,
  ) {}

  /** Ed25519 public key used to verify entitlements (JWS), pack signatures and certificate QR codes offline. */
  @Public()
  @Get('public-key')
  async publicKey() {
    const jwk = await this.keys.publicJwk();
    return {
      alg: 'EdDSA',
      crv: 'Ed25519',
      kid: this.keys.kid,
      public_key: Buffer.from(String(jwk.x), 'base64url').toString('base64'), // raw 32-byte key, base64
      jwk,
      pem: this.keys.publicPem(),
    };
  }

  @ApiBearerAuth()
  @Get('manifest')
  async manifest(@CurrentUser() u: AuthUser, @Query() q: ManifestQuery) {
    if (q.farm_id) return this.params.manifest(await this.access.farm(u, q.farm_id));
    const ids = await this.access.farmIds(u);
    if (!ids.length) return this.params.manifest();
    const seen = new Map<string, Awaited<ReturnType<ParamsService['manifest']>>[number]>();
    for (const id of ids) {
      for (const m of await this.params.manifest(await this.access.farm(u, id))) seen.set(`${m.pack}@${m.version}`, m);
    }
    return [...seen.values()];
  }

  @ApiBearerAuth()
  @Get('packs/:code/versions/:version')
  async pack(@Param('code') code: string, @Param('version') version: string) {
    const rows: Array<ParamPackVersion & { code: string; level: string }> = await this.ds.query(
      `SELECT v.*, p.code, p.level FROM param_pack_versions v JOIN param_packs p ON p.id = v.pack_id WHERE p.code = $1 AND v.version = $2`,
      [code, version],
    );
    const v = rows[0];
    if (!v || !v.signature) throw Errors.notFound('Version publiée');
    return { pack: v.code, version: v.version, level: v.level, status: v.status, hash: v.content_hash, signature: v.signature, content: v.content, published_at: v.published_at };
  }

  /** Resolved objects with per-property provenance (EF-PAR-11). */
  @ApiBearerAuth()
  @Get('resolved')
  async resolved(@CurrentUser() u: AuthUser, @Query() q: ResolvedQuery) {
    const r = q.farm_id ? await this.params.resolveFarm(await this.access.farm(u, q.farm_id)) : await this.params.resolveBase(q.country ?? 'CM');
    const keys = Object.keys(r.objects).filter((k) => (!q.kind || r.objects[k].kind === q.kind) && (!q.code || r.objects[k].code === q.code));
    if (q.kind && q.code && !keys.length) throw Errors.notFound('Objet de paramétrage');
    return {
      param_version: r.param_version,
      objects: Object.fromEntries(keys.map((k) => [k, r.objects[k]])),
      provenance: Object.fromEntries(keys.map((k) => [k, r.provenance[k]])),
      rejected: r.rejected.filter((x) => (!q.kind || x.kind === q.kind) && (!q.code || x.code === q.code)),
      i18n: q.kind || q.code ? undefined : r.i18n,
    };
  }
}
