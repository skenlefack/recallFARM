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
    };

export interface SmsSpec {
  send: SmsSendSpec;
  /** Sender id or short code sent as {{sender}}. */
  sender_id?: string;
  cost?: CostSpec;
  /** Mapping of an inbound SMS (POST to /v1/connectors/:name/sms). */
  inbound?: { from: JsonPath; text: JsonPath };
  /** Mapping of a delivery report (POST to /v1/connectors/:name/dlr). */
  dlr?: { ref: JsonPath; status: JsonPath; status_map: Record<string, 'delivre' | 'echoue' | 'envoye'>; error?: JsonPath };
}

export interface UssdSpec {
  /** Mapping of an inbound USSD hop (POST to /v1/connectors/:name/ussd). */
  inbound: { session_id: JsonPath; phone: JsonPath; text: JsonPath };
  /**
   * "text": plain text response "CON ..." / "END ..." (most aggregators).
   * "json": templated body with {{message}} (without prefix), {{continue}} (boolean) and {{session_id}}.
   */
  response: { type: 'text' } | { type: 'json'; body: unknown };
}

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
    /** Body returned to the aggregator (default {"received": true}). */
    ack?: unknown;
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
