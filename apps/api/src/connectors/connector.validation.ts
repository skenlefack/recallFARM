import { AuthSpec, ConnectorSpec, InboundAuthSpec, ProvidersConfig, RequestSpec } from './connector.types';
import { envRefs, usesVar } from './template';

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
    if (a.timestamp_header !== undefined && (typeof a.timestamp_header !== 'string' || !a.timestamp_header)) errs.push(`${where}.timestamp_header: texte requis`);
    if (a.tolerance_s !== undefined && (!Number.isInteger(a.tolerance_s) || a.tolerance_s < 10 || a.tolerance_s > 3600)) errs.push(`${where}.tolerance_s: entre 10 et 3600`);
    if (a.signed_payload !== undefined) {
      if (typeof a.signed_payload !== 'string' || a.signed_payload.split('{{body}}').length !== 2) errs.push(`${where}.signed_payload: doit contenir {{body}} une seule fois`);
      else if (a.signed_payload.includes('{{timestamp}}') && !a.timestamp_header) errs.push(`${where}.signed_payload: {{timestamp}} demande timestamp_header`);
    }
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
    checkStatusMap(s.dlr.status_map, ['delivre', 'echoue', 'envoye'], `${where}.dlr.status_map`, errs);
  }
}

function isFlag(v: unknown): boolean {
  return ['string', 'number', 'boolean'].includes(typeof v);
}

function checkStatusMap(m: unknown, allowed: string[], where: string, errs: string[]) {
  if (!isObj(m)) return void errs.push(`${where}: objet requis`);
  const list = `${allowed.slice(0, -1).join(', ')} ou ${allowed[allowed.length - 1]}`;
  for (const [k, v] of Object.entries(m)) if (!allowed.includes(v as string)) errs.push(`${where}.${k}: ${list}`);
}

function checkUssd(u: ConnectorSpec['ussd'], w: string, errs: string[]) {
  if (!isObj(u)) return void errs.push(`${w}.ussd: objet attendu`);
  if (!isObj(u.inbound) || ['session_id', 'phone', 'text'].some((k) => typeof (u.inbound as unknown as Record<string, unknown>)[k] !== 'string'))
    errs.push(`${w}.ussd.inbound: session_id, phone et text requis`);
  else {
    if (u.inbound.text_mode !== undefined && !['cumulative', 'last'].includes(u.inbound.text_mode)) errs.push(`${w}.ussd.inbound.text_mode: "cumulative" ou "last"`);
    if (u.inbound.separator !== undefined && (typeof u.inbound.separator !== 'string' || u.inbound.separator.length !== 1)) errs.push(`${w}.ussd.inbound.separator: un caractere`);
  }
  if (u.max_chars !== undefined && (!Number.isInteger(u.max_chars) || u.max_chars < 60 || u.max_chars > 1000)) errs.push(`${w}.ussd.max_chars: entier entre 60 et 1000`);
  if (u.session_ttl_s !== undefined && (!Number.isInteger(u.session_ttl_s) || u.session_ttl_s < 30 || u.session_ttl_s > 900)) errs.push(`${w}.ussd.session_ttl_s: entre 30 et 900`);
  if (u.more !== undefined) {
    if (!isObj(u.more)) errs.push(`${w}.ussd.more: objet attendu`);
    else {
      if (u.more.key !== undefined && (typeof u.more.key !== 'string' || !/^[0-9#*]{1,2}$/.test(u.more.key))) errs.push(`${w}.ussd.more.key: 1 ou 2 touches (chiffres, * ou #)`);
      if (u.more.label !== undefined && (typeof u.more.label !== 'string' || !u.more.label || u.more.label.length > 20)) errs.push(`${w}.ussd.more.label: 1 a 20 caracteres`);
    }
  }
  if (!isObj(u.response) || !['text', 'json'].includes(u.response.type)) return void errs.push(`${w}.ussd.response.type: "text" ou "json"`);
  const r = u.response;
  if (r.type === 'json' && r.body === undefined) errs.push(`${w}.ussd.response.body: requis pour "json"`);
  if (r.type === 'text') {
    for (const k of ['continue_prefix', 'end_prefix'] as const)
      if (r[k] !== undefined && typeof r[k] !== 'string') errs.push(`${w}.ussd.response.${k}: texte attendu`);
  }
  if (r.headers !== undefined && (!isObj(r.headers) || Object.values(r.headers).some((v) => typeof v !== 'string'))) errs.push(`${w}.ussd.response.headers: objet de textes`);
  if (r.continue_values !== undefined && (!isObj(r.continue_values) || !isFlag(r.continue_values.continue) || !isFlag(r.continue_values.end)))
    errs.push(`${w}.ussd.response.continue_values: continue et end requis (texte, nombre ou booleen)`);
}

function checkPayment(p: NonNullable<ConnectorSpec['payment']>, w: string, c: ConnectorSpec, errs: string[]) {
  const PAY = ['confirme', 'echoue', 'en_attente'];
  checkRequest(p.initiate, `${w}.payment.initiate`, c, errs);
  if (!isObj(p.initiate?.result) || typeof p.initiate.result.ref !== 'string') errs.push(`${w}.payment.initiate.result.ref: requis`);
  if (!isObj(p.webhook)) errs.push(`${w}.payment.webhook: requis`);
  else {
    if (!p.webhook.payment_id && !p.webhook.ref) errs.push(`${w}.payment.webhook: payment_id ou ref requis`);
    if (typeof p.webhook.status !== 'string') errs.push(`${w}.payment.webhook.status: requis`);
    checkStatusMap(p.webhook.status_map, PAY, `${w}.payment.webhook.status_map`, errs);
  }
  if (p.status !== undefined) {
    checkRequest(p.status, `${w}.payment.status`, c, errs);
    if (!isObj(p.status.result) || typeof p.status.result.status !== 'string') errs.push(`${w}.payment.status.result.status: requis`);
    else checkStatusMap(p.status.result.status_map, PAY, `${w}.payment.status.result.status_map`, errs);
  }
  const REFUND = ['rembourse', 'echoue', 'en_attente'];
  if (p.refund !== undefined) {
    checkRequest(p.refund, `${w}.payment.refund`, c, errs);
    // The refund key must reach the aggregator, or a retry could refund twice (M3).
    if (isObj(p.refund) && !usesVar([p.refund.url, p.refund.headers, p.refund.body], 'refund_id'))
      errs.push(`${w}.payment.refund: {{refund_id}} requis (url, headers ou body) comme cle d'idempotence`);
    const r = p.refund.result;
    if (r !== undefined && !isObj(r)) errs.push(`${w}.payment.refund.result: objet attendu`);
    else {
      if (r?.status !== undefined || r?.status_map !== undefined) {
        if (typeof r.status !== 'string') errs.push(`${w}.payment.refund.result.status: requis avec status_map`);
        checkStatusMap(r.status_map, REFUND, `${w}.payment.refund.result.status_map`, errs);
      }
      if (r?.http_map !== undefined) {
        checkStatusMap(r.http_map, REFUND, `${w}.payment.refund.result.http_map`, errs);
        if (isObj(r.http_map)) for (const k of Object.keys(r.http_map)) if (!/^[1-5]\d\d$/.test(k)) errs.push(`${w}.payment.refund.result.http_map.${k}: code HTTP attendu`);
      }
    }
  }
  if (p.refund_status !== undefined) {
    checkRequest(p.refund_status, `${w}.payment.refund_status`, c, errs);
    if (!p.refund) errs.push(`${w}.payment.refund_status: demande payment.refund`);
    if (!isObj(p.refund_status.result) || typeof p.refund_status.result.status !== 'string') errs.push(`${w}.payment.refund_status.result.status: requis`);
    else checkStatusMap(p.refund_status.result.status_map, REFUND, `${w}.payment.refund_status.result.status_map`, errs);
  }
  if (p.list !== undefined) {
    checkRequest(p.list, `${w}.payment.list`, c, errs);
    const r = p.list.result;
    if (!isObj(r) || typeof r.items !== 'string' || typeof r.status !== 'string') errs.push(`${w}.payment.list.result: items et status requis`);
    else {
      if (!r.payment_id && !r.ref) errs.push(`${w}.payment.list.result: payment_id ou ref requis`);
      checkStatusMap(r.status_map, PAY, `${w}.payment.list.result.status_map`, errs);
    }
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
    if (c.ussd !== undefined) checkUssd(c.ussd, w, errs);
    if (c.payment !== undefined) checkPayment(c.payment, w, c, errs);
    const receives = !!(c.payment || c.ussd || c.sms?.inbound || c.sms?.dlr || c.whatsapp?.inbound || c.whatsapp?.dlr);
    if (receives && (!c.inbound_auth || c.inbound_auth.type === 'none'))
      errs.push(`${w}.inbound_auth: obligatoire des que le connecteur recoit des appels (sms, dlr, ussd, paiement)`);
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
