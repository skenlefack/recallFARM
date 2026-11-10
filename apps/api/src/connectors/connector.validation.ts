import { AuthSpec, ConnectorSpec, InboundAuthSpec, ProvidersConfig, RequestSpec } from './connector.types';
import { envRefs } from './template';

const NAME = /^[a-z0-9][a-z0-9_-]{1,40}$/;
const CODE = /^[a-z0-9_]{2,30}$/;
const ISO4217 = /^[A-Z]{3}$/;

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function checkAuth(a: AuthSpec | undefined, where: string, errs: string[]) {
  if (a === undefined) return;
  if (!isObj(a)) return void errs.push(`${where}: objet attendu`);
  const need = (...keys: string[]) => keys.forEach((k) => typeof (a as Record<string, unknown>)[k] !== 'string' && errs.push(`${where}.${k}: texte requis`));
  switch (a.type) {
    case 'none':
      break;
    case 'bearer':
      need('token');
      break;
    case 'basic':
      need('username', 'password');
      break;
    case 'header':
    case 'query':
      need('name', 'value');
      break;
    case 'oauth2_client_credentials':
      need('token_url', 'client_id', 'client_secret');
      if (a.client_auth && !['basic', 'body'].includes(a.client_auth)) errs.push(`${where}.client_auth: "basic" ou "body"`);
      break;
    default:
      errs.push(`${where}.type: inconnu (${String((a as { type?: unknown }).type)})`);
  }
}

function checkInboundAuth(a: InboundAuthSpec | undefined, where: string, errs: string[]) {
  if (a === undefined) return;
  if (!isObj(a)) return void errs.push(`${where}: objet attendu`);
  if (a.type === 'none') return;
  if (a.type === 'header' || a.type === 'query') {
    if (typeof a.name !== 'string' || typeof a.value !== 'string') errs.push(`${where}: name et value requis`);
    return;
  }
  if (a.type === 'hmac_sha256' || a.type === 'hmac_sha512') {
    if (typeof a.header !== 'string' || typeof a.secret !== 'string') errs.push(`${where}: header et secret requis`);
    if (a.encoding && !['hex', 'base64'].includes(a.encoding)) errs.push(`${where}.encoding: "hex" ou "base64"`);
    return;
  }
  errs.push(`${where}.type: inconnu`);
}

function checkRequest(r: RequestSpec | undefined, where: string, c: ConnectorSpec, errs: string[]) {
  if (!isObj(r)) return void errs.push(`${where}: requete requise`);
  if (typeof r.url !== 'string' || !r.url) errs.push(`${where}.url: requis`);
  else if (!/^https?:\/\//.test(r.url) && !c.base_url) errs.push(`${where}.url: chemin relatif sans base_url`);
  if (r.method && !['GET', 'POST', 'PUT', 'PATCH'].includes(r.method)) errs.push(`${where}.method: invalide`);
  if (r.format && !['json', 'form', 'none'].includes(r.format)) errs.push(`${where}.format: "json", "form" ou "none"`);
  if (r.headers && !isObj(r.headers)) errs.push(`${where}.headers: objet attendu`);
  if (r.timeout_ms !== undefined && (!Number.isInteger(r.timeout_ms) || r.timeout_ms < 1000 || r.timeout_ms > 60000))
    errs.push(`${where}.timeout_ms: entre 1000 et 60000`);
  checkAuth(r.auth, `${where}.auth`, errs);
}

function checkMessaging(s: ConnectorSpec['sms'], where: string, c: ConnectorSpec, errs: string[]) {
  if (s === undefined) return;
  if (!isObj(s)) return void errs.push(`${where}: objet attendu`);
  checkRequest(s.send, `${where}.send`, c, errs);
  if (s.cost) {
    if (!Number.isInteger(s.cost.per_segment_minor) || s.cost.per_segment_minor < 0) errs.push(`${where}.cost.per_segment_minor: entier >= 0`);
    if (!ISO4217.test(s.cost.currency ?? '')) errs.push(`${where}.cost.currency: code ISO 4217`);
  }
  if (s.inbound && (typeof s.inbound.from !== 'string' || typeof s.inbound.text !== 'string')) errs.push(`${where}.inbound: from et text requis`);
  if (s.dlr) {
    if (typeof s.dlr.ref !== 'string' || typeof s.dlr.status !== 'string') errs.push(`${where}.dlr: ref et status requis`);
    if (!isObj(s.dlr.status_map)) errs.push(`${where}.dlr.status_map: objet requis`);
    else
      for (const [k, v] of Object.entries(s.dlr.status_map))
        if (!['delivre', 'echoue', 'envoye'].includes(v as string)) errs.push(`${where}.dlr.status_map.${k}: delivre, echoue ou envoye`);
  }
}

/** Structural validation of a providers configuration. Returns readable French errors. */
export function validateProvidersConfig(cfg: unknown): string[] {
  const errs: string[] = [];
  if (!isObj(cfg)) return ['la configuration doit etre un objet JSON'];
  const conf = cfg as unknown as ProvidersConfig;
  if (!isObj(conf.connectors)) return ['"connectors" requis'];
  for (const [name, entry] of Object.entries(conf.connectors as Record<string, unknown>)) {
    const w = `connectors.${name}`;
    if (!NAME.test(name)) errs.push(`${w}: nom invalide (minuscules, chiffres, _ ou -)`);
    if (!isObj(entry)) {
      errs.push(`${w}: objet attendu`);
      continue;
    }
    const c = entry as unknown as ConnectorSpec;
    if (c.base_url !== undefined && (typeof c.base_url !== 'string' || !/^https?:\/\//.test(c.base_url))) errs.push(`${w}.base_url: URL http(s)`);
    if (c.phone_format && !['e164', 'e164_no_plus', 'national'].includes(c.phone_format)) errs.push(`${w}.phone_format: invalide`);
    if (c.phone_format === 'national' && !c.national_prefix) errs.push(`${w}.national_prefix: requis avec phone_format "national"`);
    checkAuth(c.auth, `${w}.auth`, errs);
    checkInboundAuth(c.inbound_auth, `${w}.inbound_auth`, errs);
    checkMessaging(c.sms, `${w}.sms`, c, errs);
    checkMessaging(c.whatsapp, `${w}.whatsapp`, c, errs);
    if (c.ussd !== undefined) {
      const u = c.ussd;
      if (!isObj(u.inbound) || ['session_id', 'phone', 'text'].some((k) => typeof (u.inbound as unknown as Record<string, unknown>)[k] !== 'string'))
        errs.push(`${w}.ussd.inbound: session_id, phone et text requis`);
      if (!isObj(u.response) || !['text', 'json'].includes(u.response.type)) errs.push(`${w}.ussd.response.type: "text" ou "json"`);
      else if (u.response.type === 'json' && u.response.body === undefined) errs.push(`${w}.ussd.response.body: requis pour "json"`);
    }
    if (c.payment !== undefined) {
      const p = c.payment;
      checkRequest(p.initiate, `${w}.payment.initiate`, c, errs);
      if (!isObj(p.initiate?.result) || typeof p.initiate.result.ref !== 'string') errs.push(`${w}.payment.initiate.result.ref: requis`);
      if (!isObj(p.webhook)) errs.push(`${w}.payment.webhook: requis`);
      else {
        if (!p.webhook.payment_id && !p.webhook.ref) errs.push(`${w}.payment.webhook: payment_id ou ref requis`);
        if (typeof p.webhook.status !== 'string') errs.push(`${w}.payment.webhook.status: requis`);
        if (!isObj(p.webhook.status_map)) errs.push(`${w}.payment.webhook.status_map: objet requis`);
        else
          for (const [k, v] of Object.entries(p.webhook.status_map))
            if (!['confirme', 'echoue', 'en_attente'].includes(v as string)) errs.push(`${w}.payment.webhook.status_map.${k}: confirme, echoue ou en_attente`);
      }
      if (!c.inbound_auth || c.inbound_auth.type === 'none') errs.push(`${w}.inbound_auth: obligatoire pour recevoir des paiements`);
    }
  }
  const r = conf.routing ?? {};
  const route = (channel: 'sms' | 'whatsapp' | 'ussd', name: string | undefined) => {
    if (name === undefined) return;
    const c = conf.connectors[name];
    if (!c) errs.push(`routing.${channel}: connecteur "${name}" inconnu`);
    else if (!c[channel]) errs.push(`routing.${channel}: le connecteur "${name}" ne declare pas "${channel}"`);
  };
  route('sms', r.sms);
  route('whatsapp', r.whatsapp);
  route('ussd', r.ussd);
  if (r.payment !== undefined) {
    if (!isObj(r.payment)) errs.push('routing.payment: objet { moyen: connecteur } attendu');
    else
      for (const [method, name] of Object.entries(r.payment)) {
        if (!CODE.test(method)) errs.push(`routing.payment.${method}: code de moyen invalide`);
        const c = conf.connectors[name as string];
        if (!c) errs.push(`routing.payment.${method}: connecteur "${String(name)}" inconnu`);
        else if (!c.payment) errs.push(`routing.payment.${method}: le connecteur "${String(name)}" ne declare pas "payment"`);
      }
  }
  return errs;
}

/** Environment variables referenced by the configuration that are not set. */
export function missingEnv(cfg: ProvidersConfig, env: NodeJS.ProcessEnv = process.env): string[] {
  return [...envRefs(cfg)].filter((n) => env[n] === undefined || env[n] === '').sort();
}
