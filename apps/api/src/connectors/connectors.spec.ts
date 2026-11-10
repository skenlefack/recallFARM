import { createHmac } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ConnectorPaymentProvider, PaymentProviderError } from '../billing/payment.providers';
import { reloadConfig } from '../config';
import { Payment } from '../database/entities';
import { ConnectorMessageProvider } from '../notifications/providers';
import { ConnectorHttp, FetchFn, inspectInbound, parseTimestamp, verifyInbound } from './connector-http';
import { ConnectorConfigError, ConnectorRegistry, parseProvidersConfig } from './connector-registry';
import { ConnectorSpec, ProvidersConfig } from './connector.types';
import { missingEnv, validateProvidersConfig } from './connector.validation';
import { amountMajor, formatPhone, getPath, render, renderText, resolveEnv, smsSegments, TemplateError, toE164 } from './template';

const EXAMPLE = resolve(__dirname, '../../../../infra/providers/providers.example.json');

interface Call {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body?: string;
}

/** Fake fetch: records calls and answers from a queue. */
function fakeFetch(responses: Array<{ status?: number; body?: unknown } | Error>) {
  const calls: Call[] = [];
  const fn: FetchFn = async (input, init) => {
    calls.push({ url: String(input), method: init?.method, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body as string | undefined });
    const next = responses.shift();
    if (!next) throw new Error('no response queued');
    if (next instanceof Error) throw next;
    const text = typeof next.body === 'string' ? next.body : JSON.stringify(next.body ?? {});
    return new Response(text, { status: next.status ?? 200 });
  };
  return { fn, calls };
}

const ENV = {
  AGREGATEUR_API_TOKEN: 'tok-123',
  AGREGATEUR_CALLBACK_TOKEN: 'cb-456',
  OPERATEUR_CLIENT_ID: 'cid',
  OPERATEUR_CLIENT_SECRET: 'csecret',
  OPERATEUR_WEBHOOK_SECRET: 'whsecret',
};

describe('template helpers', () => {
  it('keeps the type of a single placeholder and interpolates strings', () => {
    expect(render({ a: '{{n}}', b: 'x-{{n}}', c: ['{{flag}}'], d: 3 }, { n: 2500, flag: true })).toEqual({ a: 2500, b: 'x-2500', c: [true], d: 3 });
  });

  it('rejects unknown variables', () => {
    expect(() => render('{{nope}}', {})).toThrow(TemplateError);
    expect(() => renderText('a {{nope}}', {})).toThrow(TemplateError);
  });

  it('resolves ${env:NAME} and refuses missing variables', () => {
    expect(resolveEnv('Bearer ${env:T}', { T: 'abc' })).toBe('Bearer abc');
    expect(() => resolveEnv('${env:ABSENT}', {})).toThrow(/ABSENT/);
  });

  it('never expands ${env:...} found inside inserted values (secret leak by SMS)', () => {
    const env = process.env;
    process.env = { ...env, RF_TEST_SECRET: 'TOP-SECRET', RF_TOKEN: 'tok' };
    try {
      const text = 'Lot ${env:RF_TEST_SECRET}';
      expect(renderText('RF: {{text}}', { text })).toBe('RF: Lot ${env:RF_TEST_SECRET}');
      expect(renderText('/send?k=${env:RF_TOKEN}&text={{text}}', { text })).toBe('/send?k=tok&text=Lot ${env:RF_TEST_SECRET}');
      expect(render({ m: 'x {{text}}' }, { text })).toEqual({ m: 'x Lot ${env:RF_TEST_SECRET}' });
      expect(renderText('/send?text={{text}}', { text: 'a&to=1' }, encodeURIComponent)).toBe('/send?text=a%26to%3D1');
      expect(renderText('{{text}}', { text: 'a b' }, encodeURIComponent)).toBe('a%20b');
    } finally {
      process.env = env;
    }
  });

  it('reads dot paths including array indexes', () => {
    const doc = { data: { items: [{ id: 'm1' }] }, n: 0 };
    expect(getPath(doc, 'data.items.0.id')).toBe('m1');
    expect(getPath(doc, 'n')).toBe(0);
    expect(getPath(doc, 'data.items.x')).toBeUndefined();
    expect(getPath(doc, 'data.missing.deep')).toBeUndefined();
    expect(getPath('text', 'a')).toBeUndefined();
  });

  it('formats and normalises phone numbers', () => {
    expect(formatPhone('+237690000001')).toBe('+237690000001');
    expect(formatPhone('+237690000001', 'e164_no_plus')).toBe('237690000001');
    expect(formatPhone('+237690000001', 'national', '237')).toBe('690000001');
    expect(toE164('237690000001')).toBe('+237690000001');
    expect(toE164('00237690000001')).toBe('+237690000001');
    expect(toE164('690000001', '237')).toBe('+237690000001');
    expect(toE164('+237 690 000 001')).toBe('+237690000001');
  });

  it('counts GSM-7 and UCS-2 segments', () => {
    expect(smsSegments('a'.repeat(160))).toEqual({ encoding: 'gsm7', units: 160, segments: 1 });
    expect(smsSegments('a'.repeat(161)).segments).toBe(2);
    expect(smsSegments('Rappel : vaccin Newcastle à faire, é è').encoding).toBe('gsm7');
    expect(smsSegments('€'.repeat(80))).toEqual({ encoding: 'gsm7', units: 160, segments: 1 });
    expect(smsSegments('Vacciné ê')).toMatchObject({ encoding: 'ucs2', segments: 1 });
    expect(smsSegments('ê'.repeat(71)).segments).toBe(2);
  });

  it('never splits an extension character or a surrogate pair across two segments (m14)', () => {
    // 152 septets then "€" (2 septets): the phone moves "€" to part 2, then 153 more septets need part 3.
    const gsm = `${'a'.repeat(152)}€${'a'.repeat(152)}`;
    expect(smsSegments(gsm)).toEqual({ encoding: 'gsm7', units: 306, segments: 3 });
    expect(smsSegments('a'.repeat(306)).segments).toBe(2);
    // 66 UTF-16 units then an emoji (2 units): the pair moves to part 2.
    const ucs = `${'ê'.repeat(66)}😀${'ê'.repeat(66)}`;
    expect(smsSegments(ucs)).toEqual({ encoding: 'ucs2', units: 134, segments: 3 });
    expect(smsSegments('ê'.repeat(134)).segments).toBe(2);
  });

  it('writes major-unit amounts without floating point', () => {
    expect(amountMajor(2500, 'XAF')).toBe('2500');
    expect(amountMajor(1999, 'EUR')).toBe('19.99');
    expect(amountMajor(5, 'EUR')).toBe('0.05');
    expect(amountMajor(-150, 'USD')).toBe('-1.50');
    expect(() => amountMajor(1.5, 'EUR')).toThrow(TemplateError);
  });
});

describe('providers configuration validation', () => {
  const example = JSON.parse(readFileSync(EXAMPLE, 'utf8')) as ProvidersConfig;

  it('accepts the documented example (infra/providers/providers.example.json)', () => {
    expect(validateProvidersConfig(example)).toEqual([]);
    expect(() => parseProvidersConfig(JSON.stringify(example), ENV)).not.toThrow();
  });

  it('lists missing environment variables', () => {
    expect(missingEnv(example, {})).toEqual(Object.keys(ENV).sort());
    expect(() => parseProvidersConfig(JSON.stringify(example), {})).toThrow(/AGREGATEUR_API_TOKEN/);
  });

  it('reports structural errors in French', () => {
    const bad = {
      connectors: {
        'Bad Name': {},
        p: { payment: { initiate: { url: '/x', result: {} }, webhook: { status: 's', status_map: { OK: 'paye' } } } },
        s: { sms: { send: { url: 'ftp://x', method: 'DELETE', format: 'xml', timeout_ms: 5 }, cost: { per_segment_minor: 1.5, currency: 'fcfa' } }, auth: { type: 'magic' } },
      },
      routing: { sms: 'absent', ussd: 's', payment: { orange_money: 's', 'Bad-Code': 'p' } },
    };
    const errs = validateProvidersConfig(bad);
    const joined = errs.join('\n');
    for (const fragment of [
      'connectors.Bad Name: nom invalide',
      'payment.initiate.url: chemin relatif sans base_url',
      'payment.initiate.result.ref: requis',
      'payment.webhook: payment_id ou ref requis',
      'status_map.OK: confirme, echoue ou en_attente',
      'inbound_auth: obligatoire des que le connecteur recoit des appels',
      'sms.send.method: invalide',
      'sms.send.format',
      'sms.send.timeout_ms',
      'cost.per_segment_minor',
      'cost.currency: code ISO 4217',
      'auth.type: inconnu',
      'routing.sms: connecteur "absent" inconnu',
      'routing.ussd: le connecteur "s" ne declare pas "ussd"',
      'routing.payment.orange_money: le connecteur "s" ne declare pas "payment"',
      'routing.payment.Bad-Code: code de moyen invalide',
    ])
      expect(joined).toContain(fragment);
  });

  it('requires inbound_auth for any connector that receives calls (sms, dlr, ussd)', () => {
    const base = { base_url: 'https://h.example', sms: { send: { url: '/s' } } };
    expect(validateProvidersConfig({ connectors: { ag: base } })).toEqual([]);
    const withInbound = { connectors: { ag: { ...base, sms: { ...base.sms, inbound: { from: 'f', text: 't' } } } } };
    expect(validateProvidersConfig(withInbound).join()).toContain('inbound_auth: obligatoire');
    const ussd = { connectors: { ag: { ...base, ussd: { inbound: { session_id: 's', phone: 'p', text: 't' }, response: { type: 'text' } } } } };
    expect(validateProvidersConfig(ussd).join()).toContain('inbound_auth: obligatoire');
    const authed = { connectors: { ag: { ...withInbound.connectors.ag, inbound_auth: { type: 'header', name: 'x', value: 'y' } } } };
    expect(validateProvidersConfig(authed)).toEqual([]);
  });

  it('validates the USSD options (text mode, screen size, session, response values)', () => {
    const auth = { type: 'header', name: 'x', value: 'y' };
    const ok = {
      connectors: {
        uu: {
          inbound_auth: auth,
          ussd: {
            inbound: { session_id: 's', phone: 'p', text: 't', text_mode: 'last', separator: '*' },
            max_chars: 182,
            session_ttl_s: 120,
            more: { key: '99', label: 'Plus' },
            response: { type: 'json', body: { m: '{{message}}', a: '{{continue}}' }, continue_values: { continue: 'request', end: 'end' }, headers: { Freeflow: '{{continue}}' } },
          },
        },
      },
    };
    expect(validateProvidersConfig(ok)).toEqual([]);
    const bad = {
      connectors: {
        uu: {
          inbound_auth: auth,
          ussd: {
            inbound: { session_id: 's', phone: 'p', text: 't', text_mode: 'diff', separator: '**' },
            max_chars: 20,
            session_ttl_s: 5,
            more: { key: 'x', label: '' },
            response: { type: 'text', continue_prefix: 1, headers: { a: 1 }, continue_values: { continue: {} } },
          },
        },
        vv: { inbound_auth: auth, ussd: { inbound: {}, response: { type: 'json' }, more: 'x' } },
      },
    };
    const joined = validateProvidersConfig(bad).join('\n');
    for (const f of [
      'ussd.inbound.text_mode',
      'ussd.inbound.separator',
      'ussd.max_chars',
      'ussd.session_ttl_s',
      'ussd.more.key',
      'ussd.more.label',
      'ussd.response.continue_prefix',
      'ussd.response.headers',
      'ussd.response.continue_values',
      'connectors.vv.ussd.inbound: session_id, phone et text requis',
      'connectors.vv.ussd.more: objet attendu',
      'connectors.vv.ussd.response.body: requis',
    ])
      expect(joined).toContain(f);
    expect(validateProvidersConfig({ connectors: { ww: { inbound_auth: auth, ussd: 'x' } } }).join()).toContain('ussd: objet attendu');
    expect(validateProvidersConfig({ connectors: { ww: { inbound_auth: auth, ussd: { inbound: { session_id: 's', phone: 'p', text: 't' }, response: { type: 'xml' } } } } }).join()).toContain(
      'ussd.response.type',
    );
  });

  it('validates the optional payment operations (status, refund, list)', () => {
    const base = {
      base_url: 'https://h.example',
      inbound_auth: { type: 'header', name: 'x', value: 'y' },
      payment: {
        initiate: { url: '/c', result: { ref: 'id' } },
        webhook: { ref: 'id', status: 's', status_map: { OK: 'confirme' } },
        status: { method: 'GET', url: '/p/{{provider_ref}}', result: { status: 'state', status_map: { OK: 'confirme', KO: 'echoue' } } },
        refund: { url: '/r', body: { key: '{{refund_id}}' }, result: { ref: 'id', status: 's', status_map: { DONE: 'rembourse' } } },
        list: { method: 'GET', url: '/tx?date={{date}}', result: { items: 'data', ref: 'id', status: 's', status_map: { OK: 'confirme' } } },
      },
    };
    expect(validateProvidersConfig({ connectors: { pp: base } })).toEqual([]);
    const bad = {
      connectors: {
        pp: {
          ...base,
          payment: {
            ...base.payment,
            status: { url: '/p', result: { status_map: {} } },
            refund: { url: '/r', result: { status_map: { DONE: 'paye' } } },
            list: { url: '/l', result: { items: 'data', status: 's', status_map: { OK: 'x' } } },
          },
        },
        qq: { ...base, payment: { ...base.payment, status: { url: '/p', result: { status: 's', status_map: [] } }, refund: { url: '/r', result: 'x' }, list: { url: '/l' } } },
      },
    };
    const joined = validateProvidersConfig(bad).join('\n');
    for (const f of [
      'connectors.pp.payment.status.result.status: requis',
      'connectors.pp.payment.refund.result.status: requis avec status_map',
      'payment.refund.result.status_map.DONE: rembourse, echoue ou en_attente',
      'connectors.pp.payment.list.result: payment_id ou ref requis',
      'payment.list.result.status_map.OK: confirme, echoue ou en_attente',
      'connectors.qq.payment.status.result.status_map: objet requis',
      'connectors.qq.payment.refund.result: objet attendu',
      'connectors.qq.payment.list.result: items et status requis',
    ])
      expect(joined).toContain(f);
  });

  it('validates the HMAC anti-replay options', () => {
    const c = (a: Record<string, unknown>) => ({ connectors: { hh: { inbound_auth: { type: 'hmac_sha256', header: 's', secret: 'k', ...a } } } });
    expect(validateProvidersConfig(c({ timestamp_header: 'x-ts', tolerance_s: 120, signed_payload: '{{timestamp}}.{{body}}' }))).toEqual([]);
    const joined = [
      ...validateProvidersConfig(c({ timestamp_header: '', tolerance_s: 1, signed_payload: 'x' })),
      ...validateProvidersConfig(c({ signed_payload: '{{timestamp}}.{{body}}' })),
    ].join('\n');
    for (const f of ['timestamp_header: texte requis', 'tolerance_s: entre 10 et 3600', 'signed_payload: doit contenir {{body}} une seule fois', '{{timestamp}} demande timestamp_header'])
      expect(joined).toContain(f);
  });

  it('rejects non-objects and invalid JSON', () => {
    expect(validateProvidersConfig(null)).toEqual(['la configuration doit etre un objet JSON']);
    expect(validateProvidersConfig({})).toEqual(['"connectors" requis']);
    expect(() => parseProvidersConfig('{', {})).toThrow(ConnectorConfigError);
  });

  it('loads from PROVIDERS_CONFIG, PROVIDERS_CONFIG_FILE or nothing', () => {
    expect(ConnectorRegistry.fromEnv({}).summary()).toEqual([]);
    const inline = ConnectorRegistry.fromEnv({ ...ENV, PROVIDERS_CONFIG: JSON.stringify(example) });
    expect(inline.route('sms')).toBe('agregateur_exemple');
    const file = ConnectorRegistry.fromEnv({ ...ENV, PROVIDERS_CONFIG_FILE: EXAMPLE });
    expect(file.paymentRoute('mtn_momo')).toBe('operateur_oauth_exemple');
    expect(file.summary()).toEqual([
      { name: 'agregateur_exemple', label: expect.any(String), channels: ['sms', 'ussd', 'payment'], routed_for: ['sms', 'ussd', 'payment:orange_money'] },
      { name: 'operateur_oauth_exemple', label: expect.any(String), channels: ['payment'], routed_for: ['payment:mtn_momo'] },
    ]);
    expect(() => ConnectorRegistry.fromEnv({ PROVIDERS_CONFIG_FILE: '/nope/providers.json' })).toThrow(/illisible/);
  });
});

describe('ConnectorHttp', () => {
  const env = process.env;
  beforeEach(() => {
    process.env = { ...env, ...ENV };
  });
  afterAll(() => {
    process.env = env;
  });

  it('posts JSON with bearer auth to base_url + path', async () => {
    const f = fakeFetch([{ status: 201, body: { id: 'x' } }]);
    const http = new ConnectorHttp('a', { base_url: 'https://h.example/v1/', auth: { type: 'bearer', token: '${env:AGREGATEUR_API_TOKEN}' } }, f.fn);
    const res = await http.call({ url: '/sms', body: { to: '{{to}}', n: '{{n}}' } }, { to: '+2376', n: 2 });
    expect(res).toEqual({ http_status: 201, ok: true, body: { id: 'x' } });
    expect(f.calls[0].url).toBe('https://h.example/v1/sms');
    expect(f.calls[0].headers.authorization).toBe('Bearer tok-123');
    expect(f.calls[0].headers['content-type']).toBe('application/json');
    expect(JSON.parse(f.calls[0].body!)).toEqual({ to: '+2376', n: 2 });
  });

  it('sends forms with basic auth, query auth and custom headers', async () => {
    const f = fakeFetch([{ body: 'OK' }, { body: {} }]);
    const http = new ConnectorHttp('a', { auth: { type: 'basic', username: 'u', password: 'p' } }, f.fn);
    const res = await http.call({ url: 'https://h.example/send', format: 'form', headers: { 'X-Ref': '{{id}}' }, body: { to: '{{to}}', skip: '{{none}}', o: { a: 1 } } }, { id: 'r1', to: '237', none: null });
    expect(res.body).toBe('OK');
    expect(f.calls[0].headers.authorization).toBe(`Basic ${Buffer.from('u:p').toString('base64')}`);
    expect(f.calls[0].headers['x-ref']).toBe('r1');
    expect(f.calls[0].body).toBe('to=237&o=%7B%22a%22%3A1%7D');
    await http.call({ url: 'https://h.example/q', method: 'GET', auth: { type: 'query', name: 'key', value: 'k1' } }, {});
    expect(f.calls[1].url).toBe('https://h.example/q?key=k1');
    expect(f.calls[1].body).toBeUndefined();
  });

  it('percent-encodes values inserted in the URL', async () => {
    const f = fakeFetch([{ body: {} }]);
    const http = new ConnectorHttp('a', { base_url: 'https://h.example' }, f.fn);
    await http.call({ url: '/send?to={{to}}&text={{text}}', method: 'GET' }, { to: '237', text: 'Lot A&B&to=999' });
    expect(f.calls[0].url).toBe('https://h.example/send?to=237&text=Lot%20A%26B%26to%3D999');
  });

  it('applies the success rule on HTTP codes and on a business field', async () => {
    const f = fakeFetch([{ status: 202, body: { status: 'REJECTED' } }, { status: 202, body: { status: 'ACCEPTED' } }, { status: 500 }]);
    const http = new ConnectorHttp('a', { base_url: 'https://h.example' }, f.fn);
    const req = { url: '/p', success: { http: [202], path: 'status', equals: ['ACCEPTED'] } };
    expect((await http.call(req, {})).ok).toBe(false);
    expect((await http.call(req, {})).ok).toBe(true);
    expect((await http.call({ url: '/p' }, {})).ok).toBe(false);
  });

  it('caches the OAuth2 token and renews it after expiry', async () => {
    let now = 1_000_000;
    const f = fakeFetch([
      { body: { access_token: 'T1', expires_in: 3600 } },
      { body: {} },
      { body: {} },
      { body: { access_token: 'T2', expires_in: 3600 } },
      { body: {} },
    ]);
    const spec: ConnectorSpec = {
      base_url: 'https://h.example',
      auth: { type: 'oauth2_client_credentials', token_url: 'https://h.example/token', client_id: '${env:OPERATEUR_CLIENT_ID}', client_secret: '${env:OPERATEUR_CLIENT_SECRET}', scope: 'pay' },
    };
    const http = new ConnectorHttp('o', spec, f.fn, () => now);
    await http.call({ url: '/a' }, {});
    await http.call({ url: '/b' }, {});
    expect(f.calls.map((c) => c.url)).toEqual(['https://h.example/token', 'https://h.example/a', 'https://h.example/b']);
    expect(f.calls[0].headers.authorization).toBe(`Basic ${Buffer.from('cid:csecret').toString('base64')}`);
    expect(f.calls[0].body).toBe('grant_type=client_credentials&scope=pay');
    expect(f.calls[1].headers.authorization).toBe('Bearer T1');
    now += 3600_000;
    await http.call({ url: '/c' }, {});
    expect(f.calls[3].url).toBe('https://h.example/token');
    expect(f.calls[4].headers.authorization).toBe('Bearer T2');
  });

  it('shares one OAuth2 token request between concurrent calls, and renews a revoked token on 401 (m7)', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((ok) => (release = ok));
    const calls: string[] = [];
    let tokenN = 0;
    const fn: FetchFn = async (input, init) => {
      const url = String(input);
      calls.push(`${url} ${(init?.headers as Record<string, string>).authorization ?? ''}`);
      if (url.endsWith('/token')) {
        await gate;
        tokenN++;
        return new Response(JSON.stringify({ access_token: `T${tokenN}`, expires_in: 3600 }));
      }
      const auth = (init?.headers as Record<string, string>).authorization;
      return new Response('{}', { status: auth === 'Bearer T1' && url.endsWith('/revoked') ? 401 : 200 });
    };
    const http = new ConnectorHttp('o', { base_url: 'https://h.example', auth: { type: 'oauth2_client_credentials', token_url: 'https://h.example/token', client_id: 'i', client_secret: 's' } }, fn);
    const all = Promise.all([http.call({ url: '/a' }, {}), http.call({ url: '/b' }, {}), http.call({ url: '/c' }, {})]);
    release();
    await all;
    expect(calls.filter((c) => c.includes('/token'))).toHaveLength(1);
    const res = await http.call({ url: '/revoked' }, {});
    expect(res.ok).toBe(true);
    expect(calls.slice(-3)).toEqual([
      expect.stringMatching(/\/revoked Bearer T1$/),
      expect.stringMatching(/\/token Basic /),
      expect.stringMatching(/\/revoked Bearer T2$/),
    ]);
    // Without OAuth2 a 401 is returned as is (no retry).
    const plain = fakeFetch([{ status: 401 }]);
    expect((await new ConnectorHttp('p', { base_url: 'https://h.example' }, plain.fn).call({ url: '/x' }, {})).http_status).toBe(401);
    expect(plain.calls).toHaveLength(1);
  });

  it('puts OAuth2 client credentials in the body when asked, and fails without a token', async () => {
    const f = fakeFetch([{ body: { token: 'T' } }, { body: {} }, { body: {} }]);
    const auth = { type: 'oauth2_client_credentials' as const, token_url: 'https://h.example/t2', client_id: 'id', client_secret: 's', client_auth: 'body' as const, token_path: 'token', extra: { audience: 'x' } };
    const http = new ConnectorHttp('o', { base_url: 'https://h.example', auth }, f.fn);
    await http.call({ url: '/a' }, {});
    expect(f.calls[0].headers.authorization).toBeUndefined();
    expect(f.calls[0].body).toBe('grant_type=client_credentials&audience=x&client_id=id&client_secret=s');
    const bad = new ConnectorHttp('o2', { base_url: 'https://h.example', auth: { ...auth, token_url: 'https://h.example/t3' } }, fakeFetch([{ body: {} }]).fn);
    await expect(bad.call({ url: '/a' }, {})).rejects.toThrow('oauth2_no_token');
    const down = new ConnectorHttp('o3', { base_url: 'https://h.example', auth: { ...auth, token_url: 'https://h.example/t4' } }, fakeFetch([{ status: 401 }]).fn);
    await expect(down.call({ url: '/a' }, {})).rejects.toThrow('oauth2_http_401');
  });
});

describe('verifyInbound', () => {
  const body = Buffer.from('{"status":"SUCCESS"}');
  const sig = createHmac('sha256', 'whsecret').update(body).digest('hex');
  const env = process.env;
  beforeAll(() => {
    process.env = { ...env, ...ENV };
  });
  afterAll(() => {
    process.env = env;
  });

  it('accepts no auth, header and query secrets', () => {
    expect(verifyInbound(undefined, { headers: {}, query: {} })).toBe(true);
    expect(verifyInbound({ type: 'none' }, { headers: {}, query: {} })).toBe(true);
    const h = { type: 'header' as const, name: 'X-Token', value: '${env:AGREGATEUR_CALLBACK_TOKEN}' };
    expect(verifyInbound(h, { headers: { 'x-token': 'cb-456' }, query: {} })).toBe(true);
    expect(verifyInbound(h, { headers: { 'x-token': ['cb-456'] }, query: {} })).toBe(true);
    expect(verifyInbound(h, { headers: { 'x-token': 'cb-45' }, query: {} })).toBe(false);
    expect(verifyInbound(h, { headers: {}, query: {} })).toBe(false);
    const q = { type: 'query' as const, name: 'token', value: 'abc' };
    expect(verifyInbound(q, { headers: {}, query: { token: 'abc' } })).toBe(true);
    expect(verifyInbound(q, { headers: {}, query: { token: 'abd' } })).toBe(false);
  });

  it('checks HMAC signatures (hex with prefix, base64, sha512)', () => {
    const a = { type: 'hmac_sha256' as const, header: 'x-signature', secret: '${env:OPERATEUR_WEBHOOK_SECRET}', prefix: 'sha256=' };
    expect(verifyInbound(a, { headers: { 'x-signature': `sha256=${sig}` }, query: {}, rawBody: body })).toBe(true);
    expect(verifyInbound(a, { headers: { 'x-signature': sig }, query: {}, rawBody: body })).toBe(true);
    expect(verifyInbound(a, { headers: { 'x-signature': `sha256=${sig.toUpperCase()}` }, query: {}, rawBody: body })).toBe(true);
    expect(verifyInbound(a, { headers: { 'x-signature': `sha256=${sig}` }, query: {}, rawBody: Buffer.from('{}') })).toBe(false);
    expect(verifyInbound(a, { headers: {}, query: {}, rawBody: body })).toBe(false);
    expect(verifyInbound(a, { headers: { 'x-signature': sig }, query: {} })).toBe(false);
    const b64 = createHmac('sha512', 'k').update(body).digest('base64');
    expect(verifyInbound({ type: 'hmac_sha512', header: 'sig', secret: 'k', encoding: 'base64' }, { headers: { sig: b64 }, query: {}, rawBody: body })).toBe(true);
  });

  it('refuses stale or future signing times and signs "{{timestamp}}.{{body}}" (anti-replay, m8)', () => {
    const now = Date.parse('2026-11-10T10:00:00Z');
    const ts = String(Math.floor(now / 1000));
    const a = { type: 'hmac_sha256' as const, header: 'x-sig', secret: 'k', timestamp_header: 'x-ts', tolerance_s: 60, signed_payload: '{{timestamp}}.{{body}}' };
    const sign = (t: string) => createHmac('sha256', 'k').update(`${t}.${body.toString()}`).digest('hex');
    const ok = inspectInbound(a, { headers: { 'x-sig': sign(ts), 'x-ts': ts }, query: {}, rawBody: body }, now);
    expect(ok).toEqual({ ok: true, replay_key: `sha256:${sign(ts)}`, replay_ttl_ms: 120_000 });
    const old = String(Math.floor(now / 1000) - 61);
    expect(inspectInbound(a, { headers: { 'x-sig': sign(old), 'x-ts': old }, query: {}, rawBody: body }, now)).toEqual({ ok: false, reason: 'timestamp' });
    expect(inspectInbound(a, { headers: { 'x-sig': sign(ts) }, query: {}, rawBody: body }, now)).toEqual({ ok: false, reason: 'timestamp' });
    // The time is part of the signature: changing it breaks the signature.
    const shifted = String(Number(ts) + 1);
    expect(inspectInbound(a, { headers: { 'x-sig': sign(ts), 'x-ts': shifted }, query: {}, rawBody: body }, now)).toEqual({ ok: false, reason: 'signature' });
    expect(inspectInbound({ type: 'header', name: 'x', value: 'v' }, { headers: { x: 'w' }, query: {} })).toEqual({ ok: false, reason: 'secret' });
  });

  it('reads signing times in seconds, milliseconds or ISO 8601', () => {
    expect(parseTimestamp('1762768800')).toBe(1762768800000);
    expect(parseTimestamp('1762768800123')).toBe(1762768800123);
    expect(parseTimestamp('2026-11-10T10:00:00Z')).toBe(Date.parse('2026-11-10T10:00:00Z'));
    expect(parseTimestamp('demain')).toBeNull();
    expect(parseTimestamp('2026-11-10')).toBeNull();
  });
});

describe('ConnectorMessageProvider (SMS through any aggregator)', () => {
  const env = process.env;
  beforeAll(() => {
    process.env = { ...env, ...ENV };
  });
  afterAll(() => {
    process.env = env;
  });
  const example = JSON.parse(readFileSync(EXAMPLE, 'utf8')) as ProvidersConfig;

  function provider(responses: Parameters<typeof fakeFetch>[0]) {
    const f = fakeFetch(responses);
    const registry = new ConnectorRegistry(example, f.fn);
    const { client, spec } = registry.get('agregateur_exemple')!;
    return { p: new ConnectorMessageProvider(client, spec.sms!), calls: f.calls };
  }

  it('sends with the described body and maps reference and cost', async () => {
    const { p, calls } = provider([{ body: { data: { id: 'MSG-1', cost: 25 } } }]);
    expect(p.name).toBe('agregateur_exemple');
    expect(p.storesBody).toBe(false);
    const res = await p.send('+237690000001', 'Rappel vaccin');
    expect(res).toEqual({ status: 'envoye', provider_ref: 'MSG-1', cost_minor: 25, currency: 'XAF' });
    const sent = JSON.parse(calls[0].body!);
    expect(sent).toMatchObject({ from: 'RecallFarm', to: '237690000001', message: 'Rappel vaccin' });
    expect(sent.client_ref).toMatch(/^[0-9a-f]{16}$/);
    expect(calls[0].url).toBe('https://api.agregateur.example/v1/sms/messages');
  });

  it('falls back to the per-segment cost', async () => {
    const { p } = provider([{ body: { data: { id: 'MSG-2' } } }]);
    const res = await p.send('+237690000001', 'a'.repeat(200));
    expect(res.cost_minor).toBe(30);
  });

  it('reports HTTP and network failures without throwing', async () => {
    const { p } = provider([{ status: 503 }, new TypeError('fetch failed'), Object.assign(new Error('t'), { name: 'TimeoutError' })]);
    expect(await p.send('+237690000001', 'x')).toEqual({ status: 'echoue', error_code: 'http_503' });
    expect(await p.send('+237690000001', 'x')).toEqual({ status: 'echoue', error_code: 'network' });
    expect(await p.send('+237690000001', 'x')).toEqual({ status: 'echoue', error_code: 'timeout' });
  });
});

describe('ConnectorPaymentProvider (mobile money through any aggregator)', () => {
  const env = process.env;
  beforeAll(() => {
    process.env = { ...env, ...ENV, PUBLIC_API_URL: 'https://farm.example/', PUBLIC_APP_URL: 'https://farm.example' };
    reloadConfig();
  });
  afterAll(() => {
    process.env = env;
    reloadConfig();
  });
  const example = JSON.parse(readFileSync(EXAMPLE, 'utf8')) as ProvidersConfig;
  const payment = (method: string) =>
    ({ id: '0b6f8a52-3d1e-4c8a-9f1e-2a4b6c8d0e1f', method, amount_minor: 2500, currency: 'XAF', phone: '+237690000001', plan: 'pro', period: 'mensuel', purpose: 'abonnement' }) as unknown as Payment;

  it('routes by method and renders the described request', async () => {
    const f = fakeFetch([{ body: { transaction_id: 'TX-9' } }]);
    const p = new ConnectorPaymentProvider(new ConnectorRegistry(example, f.fn));
    expect(p.methods()).toEqual(['orange_money', 'mtn_momo']);
    const res = await p.initiate(payment('orange_money'));
    expect(res).toEqual({ provider_ref: 'TX-9', ussd_push: true, connector: 'agregateur_exemple' });
    expect(JSON.parse(f.calls[0].body!)).toEqual({
      amount: 2500,
      currency: 'XAF',
      msisdn: '237690000001',
      operator: 'orange_money',
      reference: '0b6f8a52-3d1e-4c8a-9f1e-2a4b6c8d0e1f',
      description: 'RecallFarm pro mensuel',
      notify_url: 'https://farm.example/v1/connectors/agregateur_exemple/payment',
    });
  });

  it('supports OAuth2, forms, national numbers and redirect URLs', async () => {
    const f = fakeFetch([{ body: { access_token: 'T' } }, { body: { status: 'PENDING', data: { financialTransactionId: 'FT-1', payUrl: 'https://pay.example/1' } } }]);
    const p = new ConnectorPaymentProvider(new ConnectorRegistry(example, f.fn));
    const res = await p.initiate(payment('mtn_momo'));
    expect(res).toEqual({ provider_ref: 'FT-1', ussd_push: true, connector: 'operateur_oauth_exemple', redirect_url: 'https://pay.example/1' });
    expect(f.calls[1].headers['x-reference-id']).toBe('0b6f8a52-3d1e-4c8a-9f1e-2a4b6c8d0e1f');
    expect(f.calls[1].body).toContain('amount=2500');
    expect(f.calls[1].body).toContain('payer=690000001');
  });

  it('raises a typed error when routing, the aggregator or the reference fails', async () => {
    const none = new ConnectorPaymentProvider(new ConnectorRegistry(example, fakeFetch([]).fn));
    await expect(none.initiate(payment('wave'))).rejects.toMatchObject({ code: 'not_configured' });
    await expect(none.initiate(payment('wave'))).rejects.toMatchObject({ definitive: true });
    const refused = new ConnectorPaymentProvider(new ConnectorRegistry(example, fakeFetch([{ status: 402 }]).fn));
    await expect(refused.initiate(payment('orange_money'))).rejects.toMatchObject({ code: 'http_402', definitive: true, connector: 'agregateur_exemple' });
    const down = new ConnectorPaymentProvider(new ConnectorRegistry(example, fakeFetch([{ status: 503 }]).fn));
    await expect(down.initiate(payment('orange_money'))).rejects.toMatchObject({ code: 'http_503', definitive: false });
    const noRef = new ConnectorPaymentProvider(new ConnectorRegistry(example, fakeFetch([{ body: {} }]).fn));
    await expect(noRef.initiate(payment('orange_money'))).rejects.toBeInstanceOf(PaymentProviderError);
    await expect(new ConnectorPaymentProvider(new ConnectorRegistry(example, fakeFetch([{ body: {} }]).fn)).initiate(payment('orange_money'))).rejects.toMatchObject({ definitive: false });
  });
});
