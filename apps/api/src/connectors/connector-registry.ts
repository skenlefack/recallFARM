import { readFileSync } from 'fs';
import { ConnectorHttp, FetchFn } from './connector-http';
import { ConnectorSpec, ProvidersConfig } from './connector.types';
import { missingEnv, validateProvidersConfig } from './connector.validation';

export class ConnectorConfigError extends Error {}

/** Parses and validates a providers configuration (file content or inline JSON). */
export function parseProvidersConfig(json: string, env: NodeJS.ProcessEnv = process.env, source = 'configuration'): ProvidersConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    throw new ConnectorConfigError(`${source}: JSON invalide (${(e as Error).message})`);
  }
  const errs = validateProvidersConfig(raw);
  if (errs.length) throw new ConnectorConfigError(`${source} invalide :\n- ${errs.join('\n- ')}`);
  const cfg = raw as ProvidersConfig;
  const missing = missingEnv(cfg, env);
  if (missing.length) throw new ConnectorConfigError(`${source} : variables d'environnement absentes : ${missing.join(', ')}`);
  return cfg;
}

/** The configured connectors, keyed by name, with channel routing. */
export class ConnectorRegistry {
  private readonly clients = new Map<string, ConnectorHttp>();

  constructor(
    readonly config: ProvidersConfig,
    fetchFn?: FetchFn,
  ) {
    for (const [name, spec] of Object.entries(config.connectors)) this.clients.set(name, new ConnectorHttp(name, spec, fetchFn));
  }

  static empty(): ConnectorRegistry {
    return new ConnectorRegistry({ connectors: {} });
  }

  /** Loads PROVIDERS_CONFIG (inline JSON) or PROVIDERS_CONFIG_FILE (path). Empty registry when neither is set. */
  static fromEnv(env: NodeJS.ProcessEnv = process.env, fetchFn?: FetchFn): ConnectorRegistry {
    if (env.PROVIDERS_CONFIG) return new ConnectorRegistry(parseProvidersConfig(env.PROVIDERS_CONFIG, env, 'PROVIDERS_CONFIG'), fetchFn);
    if (env.PROVIDERS_CONFIG_FILE) {
      let content: string;
      try {
        content = readFileSync(env.PROVIDERS_CONFIG_FILE, 'utf8');
      } catch (e) {
        throw new ConnectorConfigError(`PROVIDERS_CONFIG_FILE illisible (${env.PROVIDERS_CONFIG_FILE}) : ${(e as Error).message}`);
      }
      return new ConnectorRegistry(parseProvidersConfig(content, env, env.PROVIDERS_CONFIG_FILE), fetchFn);
    }
    return ConnectorRegistry.empty();
  }

  get(name: string): { client: ConnectorHttp; spec: ConnectorSpec } | null {
    const client = this.clients.get(name);
    return client ? { client, spec: client.spec } : null;
  }

  route(channel: 'sms' | 'whatsapp' | 'ussd'): string | undefined {
    return this.config.routing?.[channel];
  }

  paymentRoute(method: string): string | undefined {
    return this.config.routing?.payment?.[method];
  }

  /** Public summary (no secrets, no URLs) for the administration. */
  summary() {
    return Object.entries(this.config.connectors).map(([name, c]) => ({
      name,
      label: c.label ?? name,
      channels: (['sms', 'whatsapp', 'ussd', 'payment'] as const).filter((k) => !!c[k]),
      routed_for: [
        ...(['sms', 'whatsapp', 'ussd'] as const).filter((k) => this.config.routing?.[k] === name),
        ...Object.entries(this.config.routing?.payment ?? {})
          .filter(([, n]) => n === name)
          .map(([m]) => `payment:${m}`),
      ],
    }));
  }
}

/**
 * Without Redis, each USSD hop holds a PostgreSQL connection for its session lock and needs a second
 * one for its work: a few simultaneous sessions can exhaust the pool and freeze the whole API
 * (payment webhooks included). Production therefore requires REDIS_URL as soon as a connector serves USSD.
 */
export function assertUssdLockBackend(registry: ConnectorRegistry, env: NodeJS.ProcessEnv = process.env): void {
  const production = (env.NODE_ENV || 'development') === 'production';
  const ussd = Object.entries(registry.config.connectors).filter(([, c]) => !!c.ussd).map(([n]) => n);
  if (production && ussd.length && !env.REDIS_URL) {
    throw new ConnectorConfigError(`REDIS_URL requis en production : le connecteur ${ussd.join(', ')} sert l'USSD (verrous de session)`);
  }
}

export const CONNECTOR_REGISTRY = 'CONNECTOR_REGISTRY';
