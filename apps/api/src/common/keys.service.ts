import { Injectable, Logger } from '@nestjs/common';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, KeyObject, sign, verify } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { exportJWK, JWK } from 'jose';
import { join } from 'path';
import { config } from '../config';

export function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

/** Canonical JSON (sorted keys) used for hashing and signing packs. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(',')}}`;
}

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Ed25519 platform key: signs entitlements (JWS EdDSA), parameter packs and certificate QR payloads.
 * The key pair lives in KEYS_DIR (mounted volume); it is generated at first start if absent.
 */
@Injectable()
export class KeysService {
  private readonly logger = new Logger('Keys');
  private privateKey: KeyObject;
  private publicKey: KeyObject;
  readonly kid: string;

  constructor() {
    const dir = config().keysDir;
    const privPath = join(dir, 'ed25519-private.pem');
    const pubPath = join(dir, 'ed25519-public.pem');
    if (!existsSync(privPath)) {
      mkdirSync(dir, { recursive: true });
      const { privateKey, publicKey } = generateKeyPairSync('ed25519');
      writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
      writeFileSync(pubPath, publicKey.export({ type: 'spki', format: 'pem' }));
      this.logger.log(`Generated a new Ed25519 key pair in ${dir}`);
    }
    this.privateKey = createPrivateKey(readFileSync(privPath));
    this.publicKey = existsSync(pubPath) ? createPublicKey(readFileSync(pubPath)) : createPublicKey(this.privateKey);
    this.kid = sha256Hex(this.publicKey.export({ type: 'spki', format: 'der' })).slice(0, 16);
  }

  get private(): KeyObject {
    return this.privateKey;
  }

  get public(): KeyObject {
    return this.publicKey;
  }

  publicPem(): string {
    return this.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  }

  async publicJwk(): Promise<JWK> {
    const jwk = await exportJWK(this.publicKey);
    return { ...jwk, kid: this.kid, alg: 'EdDSA', use: 'sig' };
  }

  /** Raw Ed25519 signature (base64url) of a UTF-8 string. */
  sign(data: string): string {
    return b64url(sign(null, Buffer.from(data, 'utf8'), this.privateKey));
  }

  verify(data: string, signature: string): boolean {
    try {
      return verify(null, Buffer.from(data, 'utf8'), this.publicKey, Buffer.from(signature, 'base64url'));
    } catch {
      return false;
    }
  }

  /** Pack signature: Ed25519 over the hex SHA-256 of the canonical JSON content. */
  signPack(content: unknown): { hash: string; signature: string } {
    const hash = sha256Hex(canonicalJson(content));
    return { hash, signature: this.sign(hash) };
  }
}
