import { resolve } from 'path';
import { defaultPacksDir, defaultVectorsDir } from './params/engine/packs-loader';

function bool(v: string | undefined, def: boolean): boolean {
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

function int(v: string | undefined, def: number): number {
  const n = v === undefined || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : def;
}

const DEV_SECRET = 'dev-only-change-me';

/** Typed application configuration, read once from the environment. */
export function loadConfig() {
  const env = process.env;
  const nodeEnv = env.NODE_ENV || 'development';
  const production = nodeEnv === 'production';
  const cfg = {
    nodeEnv,
    production,
    port: int(env.PORT, 3000),
    databaseUrl: env.DATABASE_URL || 'postgres://recallfarm:recallfarm@localhost:5432/recallfarm',
    redisUrl: env.REDIS_URL || '',
    jwtAccessSecret: env.JWT_ACCESS_SECRET || (production ? '' : `${DEV_SECRET}-access`),
    jwtRefreshSecret: env.JWT_REFRESH_SECRET || (production ? '' : `${DEV_SECRET}-refresh`),
    jwtAccessTtl: env.JWT_ACCESS_TTL || '15m',
    jwtRefreshTtl: env.JWT_REFRESH_TTL || '30d',
    keysDir: env.KEYS_DIR || resolve(process.cwd(), 'var/keys'),
    exportsDir: env.EXPORTS_DIR || resolve(process.cwd(), 'var/exports'),
    packsDir: defaultPacksDir(),
    vectorsDir: defaultVectorsDir(),
    otpDevEcho: bool(env.OTP_DEV_ECHO, !production),
    smsProvider: (env.SMS_PROVIDER || 'simulator') as 'simulator' | 'http' | 'connector',
    smsHttpUrl: env.SMS_HTTP_URL || '',
    smsHttpToken: env.SMS_HTTP_TOKEN || '',
    smsSenderId: env.SMS_SENDER_ID || 'RecallFarm',
    /** Cost recorded by the SMS simulator per segment (ISO 4217 minor units). */
    smsSimCostMinor: int(env.SMS_SIM_COST_MINOR, 15),
    smsSimCurrency: env.SMS_SIM_CURRENCY || 'XAF',
    whatsappProvider: (env.WHATSAPP_PROVIDER || 'simulator') as 'simulator' | 'connector',
    paymentProvider: (env.PAYMENT_PROVIDER || 'simulator') as 'simulator' | 'connector',
    /** Public base URL of the API, used for aggregator callbacks (…/v1/connectors/:name/payment). */
    publicApiUrl: env.PUBLIC_API_URL || 'http://localhost:8080',
    publicAppUrl: env.PUBLIC_APP_URL || 'http://localhost:8080',
    paymentWebhookSecret: env.PAYMENT_WEBHOOK_SECRET || (production ? '' : `${DEV_SECRET}-webhook`),
    paymentSimAutoConfirmMs: int(env.PAYMENT_SIM_AUTOCONFIRM_MS, 5000),
    corsOrigins: (env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:8080')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    tz: env.TZ || 'Africa/Douala',
    seedOnStart: bool(env.SEED_ON_START, false),
    schedulerEnabled: bool(env.SCHEDULER_ENABLED, true),
    throttleLimit: int(env.THROTTLE_LIMIT, 300),
    throttleTtlMs: int(env.THROTTLE_TTL_S, 60) * 1000,
    otpMaxPerWindow: int(env.OTP_MAX_PER_WINDOW, 3),
    otpWindowS: int(env.OTP_WINDOW_S, 900),
    inboundSecret: env.INBOUND_SECRET || '',
    publicVerifyUrl: env.PUBLIC_VERIFY_URL || 'http://localhost:8080/verifier',
    devEndpoints: !production,
    openapiExport: bool(env.OPENAPI_EXPORT, false),
  };
  const allowed = { smsProvider: ['simulator', 'http', 'connector'], whatsappProvider: ['simulator', 'connector'], paymentProvider: ['simulator', 'connector'] };
  for (const [k, values] of Object.entries(allowed)) {
    const v = (cfg as Record<string, unknown>)[k] as string;
    if (!values.includes(v)) throw new Error(`${k} invalide : "${v}" (valeurs : ${values.join(', ')})`);
  }
  if (production) {
    const missing = ['jwtAccessSecret', 'jwtRefreshSecret', 'paymentWebhookSecret'].filter((k) => !(cfg as any)[k]);
    if (missing.length && !cfg.openapiExport) {
      throw new Error(`Missing required secrets in production: ${missing.join(', ')}`);
    }
  }
  return cfg;
}

export type AppConfig = ReturnType<typeof loadConfig>;

let cached: AppConfig | null = null;
export function config(): AppConfig {
  if (!cached) cached = loadConfig();
  return cached;
}

/** For tests: re-read the environment. */
export function reloadConfig(): AppConfig {
  cached = loadConfig();
  return cached;
}

export const APP_CONFIG = 'APP_CONFIG';
