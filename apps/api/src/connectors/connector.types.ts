/**
 * Declarative description of an external aggregator (SMS, WhatsApp, USSD, mobile money).
 * A connector file holds no secret: secrets are referenced as `${env:NAME}` and read at run time.
 * See docs/adr/ADR-002-connecteurs-parametrables.md and infra/providers/README.md.
 */

/** Dot path into a JSON document, e.g. "data.messages.0.id". */
export type JsonPath = string;

export type AuthSpec =
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'header'; name: string; value: string }
  | { type: 'query'; name: string; value: string }
  | {
      type: 'oauth2_client_credentials';
      token_url: string;
      client_id: string;
      client_secret: string;
      scope?: string;
      /** "basic" (client id/secret in Authorization) or "body" (in the form). Default "basic". */
      client_auth?: 'basic' | 'body';
      /** Extra form fields for the token request. */
      extra?: Record<string, string>;
      /** Path of the token in the response (default "access_token"). */
      token_path?: JsonPath;
      /** Path of the lifetime in seconds (default "expires_in"). */
      expires_path?: JsonPath;
    };

export interface SuccessSpec {
  /** Accepted HTTP status codes (default: any 2xx). */
  http?: number[];
  /** Optional business check: value at `path` must be one of `equals`. */
  path?: JsonPath;
  equals?: Array<string | number | boolean>;
}

export interface RequestSpec {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  /** Absolute URL or path appended to the connector base_url. Templated. */
  url: string;
  /** "json" (default), "form" (application/x-www-form-urlencoded) or "none". */
  format?: 'json' | 'form' | 'none';
  headers?: Record<string, string>;
  /** Templated body. A string equal to a single "{{var}}" keeps the variable's type. */
  body?: unknown;
  /** Overrides the connector-level auth for this call. */
  auth?: AuthSpec;
  success?: SuccessSpec;
  timeout_ms?: number;
}

export interface SmsSendSpec extends RequestSpec {
  /** Paths read in the response. */
  result?: { ref?: JsonPath; cost_minor?: JsonPath };
}

export interface CostSpec {
  /** Fallback cost per SMS segment when the response gives none. */
  per_segment_minor: number;
  /** ISO 4217 code. */
  currency: string;
}

/** Shared-secret or signature check on calls the aggregator makes to us. */
export type InboundAuthSpec =
  | { type: 'none' }
  | { type: 'header'; name: string; value: string }
  | { type: 'query'; name: string; value: string }
  | {
      type: 'hmac_sha256' | 'hmac_sha512';
      header: string;
      secret: string;
      encoding?: 'hex' | 'base64';
      /** Prefix stripped from the header value, e.g. "sha256=". */
      prefix?: string;
      /**
       * Anti-replay (recommended): header carrying the signing time (Unix seconds or milliseconds, or ISO 8601).
       * Calls older or newer than `tolerance_s` are refused, and a signature is accepted only once within the window.
       */
      timestamp_header?: string;
      /** Accepted clock difference in seconds (default 300). */
      tolerance_s?: number;
      /** What is signed: "{{body}}" (default) or e.g. "{{timestamp}}.{{body}}". Must contain {{body}} exactly once. */
      signed_payload?: string;
    };

export interface SmsSpec {
  send: SmsSendSpec;
  /** Sender id or short code sent as {{sender}}. */
  sender_id?: string;
  cost?: CostSpec;
  /** Mapping of an inbound SMS (POST, or GET with query parameters, to /v1/connectors/:name/sms). */
  inbound?: { from: JsonPath; text: JsonPath };
  /** Mapping of a delivery report (POST or GET /v1/connectors/:name/dlr; WhatsApp: ?channel=whatsapp). */
  dlr?: { ref: JsonPath; status: JsonPath; status_map: Record<string, 'delivre' | 'echoue' | 'envoye'>; error?: JsonPath };
}

/** Scalar value written for {{continue}} in a USSD response (e.g. true/false, "CON"/"END", "FC"/"FB"). */
export type UssdFlag = string | number | boolean;

export interface UssdSpec {
  /** Mapping of an inbound USSD hop (POST to /v1/connectors/:name/ussd). */
  inbound: {
    session_id: JsonPath;
    phone: JsonPath;
    text: JsonPath;
    /**
     * "cumulative" (default): the aggregator sends every input of the session, e.g. "1*2*4821".
     * "last": only the input of the last screen; the session state is kept on our side.
     */
    text_mode?: 'cumulative' | 'last';
    /** Separator of the cumulative input (default "*"). */
    separator?: string;
  };
  /** Maximum characters of one screen (default 160). Longer screens are paged with "0. Suite". */
  max_chars?: number;
  /** Lifetime of a session on our side, in seconds (default 180). */
  session_ttl_s?: number;
  /** Key and label of the "next page" choice (default "0" and "Suite"). */
  more?: { key?: string; label?: string };
  /**
   * "text": plain text, `continue_prefix` / `end_prefix` before the message (default "CON " / "END ").
   * "json": templated body with {{message}}, {{continue}} and {{session_id}}; {{continue}} is
   * `continue_values.continue` or `continue_values.end` (default true / false).
   * `headers` (templated, same variables) are added to the response, e.g. {"Freeflow": "{{continue}}"}.
   */
  response:
    | { type: 'text'; continue_prefix?: string; end_prefix?: string; headers?: Record<string, string>; continue_values?: { continue: UssdFlag; end: UssdFlag } }
    | { type: 'json'; body: unknown; headers?: Record<string, string>; continue_values?: { continue: UssdFlag; end: UssdFlag } };
}

export type PaymentStatusMap = Record<string, 'confirme' | 'echoue' | 'en_attente'>;

export interface PaymentSpec {
  initiate: RequestSpec & {
    result: { ref: JsonPath; redirect_url?: JsonPath };
    /** True when the operator pushes a USSD prompt to the payer's phone (default true). */
    ussd_push?: boolean;
  };
  /** Mapping of the asynchronous result (POST to /v1/connectors/:name/payment). */
  webhook: {
    /** Our payment id echoed back by the aggregator (we send it as {{reference}}). */
    payment_id?: JsonPath;
    /** Aggregator transaction reference (as returned by initiate). */
    ref?: JsonPath;
    status: JsonPath;
    /** Aggregator status → our status. Unlisted or "en_attente" statuses are acknowledged and ignored. */
    status_map: Record<string, 'confirme' | 'echoue' | 'en_attente'>;
    fees_minor?: JsonPath;
    /** When given, a confirmation is refused if the amount (minor units) or currency differ from the request. */
    amount_minor?: JsonPath;
    currency?: JsonPath;
    /** Body returned to the aggregator (default {"received": true}). */
    ack?: unknown;
  };
  /**
   * Optional status query (variables: payment_id, reference, provider_ref, method). Used for payments
   * left pending and for the daily reconciliation when `list` is absent.
   */
  status?: RequestSpec & {
    result: { status: JsonPath; status_map: PaymentStatusMap; fees_minor?: JsonPath; amount_minor?: JsonPath; currency?: JsonPath };
  };
  /**
   * Optional refund of a confirmed payment (variables: payment_id, reference, provider_ref, refund_id,
   * amount_minor, amount, currency, phone, phone_e164, method, reason). `refund_id` is stable for a
   * payment: a retried refund carries the same key.
   */
  refund?: RequestSpec & {
    result?: { ref?: JsonPath; status?: JsonPath; status_map?: Record<string, 'rembourse' | 'echoue' | 'en_attente'> };
  };
  /**
   * Optional list of the aggregator transactions of one day, for the daily reconciliation
   * (variables: date "YYYY-MM-DD", from and to in UTC ISO 8601). One page is read.
   */
  list?: RequestSpec & {
    result: {
      items: JsonPath;
      payment_id?: JsonPath;
      ref?: JsonPath;
      status: JsonPath;
      status_map: PaymentStatusMap;
      amount_minor?: JsonPath;
      currency?: JsonPath;
    };
  };
}

export interface ConnectorSpec {
  label?: string;
  base_url?: string;
  auth?: AuthSpec;
  /** How phone numbers are written in requests: "+237..." (default), "237..." or national digits. */
  phone_format?: 'e164' | 'e164_no_plus' | 'national';
  /** Country calling code stripped by "national", e.g. "237". */
  national_prefix?: string;
  /** Check applied to every inbound call (SMS, DLR, USSD, payment webhook). */
  inbound_auth?: InboundAuthSpec;
  sms?: SmsSpec;
  whatsapp?: SmsSpec;
  ussd?: UssdSpec;
  payment?: PaymentSpec;
}

export interface ProvidersConfig {
  connectors: Record<string, ConnectorSpec>;
  /** Which connector serves which channel; payment is routed by method code (pack pays.*). */
  routing?: {
    sms?: string;
    whatsapp?: string;
    ussd?: string;
    payment?: Record<string, string>;
  };
}
