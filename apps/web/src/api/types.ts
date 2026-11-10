/**
 * API contract types, written by hand from docs/MVP-SCOPE.md §3–§4 (and dossier 05 / 03 for enums).
 * Fields marked "ASSUMPTION" go beyond MVP-SCOPE.md and are listed in apps/web/README.md.
 */

export type ISODate = string; // YYYY-MM-DD
export type ISODateTime = string;
export type UUID = string;

export interface Money {
  amount_minor: number;
  currency: string;
}

export interface Page<T> {
  data: T[];
  next_cursor: string | null;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    details?: Record<string, unknown>;
  };
}

/* ---------------------------------------------------------------- auth */

export interface OtpRequestResponse {
  sent: boolean;
  retry_after_s: number;
  dev_code?: string;
}

export interface Membership {
  organisation_id: UUID;
  organisation_name: string;
  role: OrgRole;
}

export type OrgRole = 'proprietaire' | 'membre' | 'agent' | 'veterinaire' | 'admin' | 'prestataire';
export type PlatformRole = 'param_author' | 'param_reviewer' | 'param_publisher' | 'referent_sanitaire' | 'platform_admin' | 'support' | 'ops';

export interface Entitlements {
  plan: PlanCode;
  features: string[];
  quotas: Record<string, number>;
  expires_at: ISODateTime | null;
  grace_until: ISODateTime | null;
  token: string;
}

export interface Me {
  id: UUID;
  phone: string;
  name: string;
  language: string;
  platform_roles: PlatformRole[];
  memberships: Membership[];
  farms: { id: UUID; name: string }[];
  entitlements: Entitlements;
}

export interface VerifyResponse {
  access_token: string;
  refresh_token: string;
  user: Pick<Me, 'id' | 'phone' | 'name'> & Partial<Me>;
}

/* -------------------------------------------------------- organisations */

export interface Organisation {
  id: UUID;
  name: string;
  /** ASSUMPTION: plan + counters for the sidebar card ("Structure · 312 éleveurs"). */
  plan?: PlanCode;
  farmers_count?: number;
  country?: string;
}

export interface Member {
  id: UUID;
  user_id?: UUID;
  name: string | null;
  phone: string;
  role: OrgRole;
  status: 'invite' | 'actif' | 'retire';
  /** ASSUMPTION */
  joined_at?: ISODateTime | null;
  last_seen_at?: ISODateTime | null;
}

export type Severity = 'critique' | 'elevee' | 'attention' | 'info';

export interface Dashboard {
  kpis: {
    confirmed_rate: number; // 0..1 or percent? → we accept both (see lib/format pct)
    confirmed_rate_delta_pts: number;
    target_rate: number;
    active_farmers_7d: number;
    total_farmers: number;
    farmers_without_smartphone: number;
    overdue_reminders: number;
    overdue_j3: number;
    avg_mortality_pct: number;
    batches_over_threshold: number;
    /** ASSUMPTION: threshold used for batches_over_threshold (design says 5 %). */
    mortality_threshold_pct?: number;
  };
  weekly: { week: string; due: number; confirmed: number }[];
  coverage: {
    disease: string;
    disease_label?: string;
    /** ASSUMPTION: window label, e.g. "30 j" */
    window_days?: number;
    cells: { zone: string; rate: number | null; masked: boolean; /** ASSUMPTION */ q?: number; r?: number; farms?: number }[];
  };
  todo: { id: string; severity: Severity; farm_name: string; reason: string; since: ISODateTime; action: string; /** ASSUMPTION */ farm_id?: UUID }[];
  params: { pack: string; version: string; status: PackStatus }[];
  pending_change?: { summary: string; reviewer_name?: string; pack?: string } | null;
  sms: { used: number; quota: number };
}

/* ------------------------------------------------------------ farms */

export type Speculation = 'volaille' | 'chien' | 'porcin' | 'petits_ruminants' | 'bovin' | 'lapin';

export interface Farm {
  id: UUID;
  name: string;
  speculations: Speculation[];
  country: string;
  region?: string | null;
  locality?: string | null;
  manager_name?: string | null;
  currency: string;
  gps_lat?: number | null;
  gps_lng?: number | null;
  organisation_id?: UUID | null;
  /** ASSUMPTION: list-only summary fields returned by GET /organisations/:id/farms */
  owner_name?: string;
  owner_phone?: string;
  has_smartphone?: boolean;
  last_sync_at?: ISODateTime | null;
  open_reminders?: number;
  overdue_reminders?: number;
  open_alerts?: number;
  subjects_count?: number;
}

export interface Batch {
  id: UUID;
  name: string;
  species: string;
  production_type: string;
  start_date: ISODate;
  initial_count: number;
  current_count: number;
  attributes: Record<string, unknown>;
  param_version: string;
}

export interface Dog {
  id: UUID;
  name: string;
  breed: string | null;
  sex: 'M' | 'F';
  birth_date: ISODate | null;
  chip_number: string | null;
  attributes: Record<string, unknown>;
  rabies_status: 'a_jour' | 'expire' | 'inconnu';
  rabies_valid_until: ISODate | null;
}

export interface DailyLog {
  id: UUID;
  subject_type: 'batch' | 'dog' | 'animal';
  subject_id: UUID;
  /** ASSUMPTION: denormalised label */
  subject_name?: string;
  log_date: ISODate;
  mortality?: number | null;
  present_count?: number | null;
  eggs?: number | null;
  feed_kg?: number | null;
  water_l?: number | null;
  notes?: string | null;
  attributes?: Record<string, unknown>;
}

export interface FarmKpis {
  period: '7d' | '30d';
  /** ASSUMPTION: shape of pack-kpi results */
  kpis: { code: string; label: string; value: number | string | null; unit?: string; status?: 'ok' | 'amber' | 'red'; subject_name?: string }[];
  margin?: { month: string; revenue: Money; expenses: Money; margin: Money };
}

/* ------------------------------------------------------- reminders */

export type ReminderStatus = 'a_venir' | 'aujourdhui' | 'en_retard' | 'envoye' | 'confirme' | 'manque' | 'annule' | 'clos' | 'reporte';

export interface Reminder {
  id: UUID;
  farm_id: UUID;
  /** ASSUMPTION: denormalised for org lists */
  farm_name?: string;
  subject_type: 'batch' | 'dog' | 'animal';
  subject_id: UUID;
  subject_ref?: string;
  step?: string;
  disease: string;
  /** ASSUMPTION: human label from i18n */
  label?: string;
  due_date: ISODate;
  status: ReminderStatus;
  /** engine status (API): en_retard | aujourdhui | a_venir */
  timing?: 'en_retard' | 'aujourdhui' | 'a_venir' | null;
  days_late?: number;
  priority: 'normale' | 'haute' | 'critique';
  kind?: 'protocole' | 'recurrent' | 'manuel';
  snoozed_until?: ISODate | null;
  confirmed_at?: ISODateTime | null;
}

/* ----------------------------------------------------------- alerts */

export type AlertStatus = 'ouverte' | 'escaladee' | 'acquittee' | 'resolue' | 'close';

export interface Alert {
  id: UUID;
  farm_id: UUID;
  farm_name?: string;
  rule_code: string;
  title?: string;
  message?: string;
  severity: 'info' | 'attention' | 'critique';
  status: AlertStatus;
  opened_at: ISODateTime;
  acked_at?: ISODateTime | null;
  acked_by?: string | null;
  resolved_at?: ISODateTime | null;
  cause?: string | null;
  action?: string | null;
  escalation?: { level: number; target: string; at: ISODateTime; done: boolean }[];
}

/* ---------------------------------------------------- plans, payments */

export type PlanCode = 'decouverte' | 'pro' | 'structure' | 'institution';

export interface Plan {
  code: PlanCode;
  name?: string;
  rank?: number;
  features: string[];
  quotas: Record<string, number>;
  /** ASSUMPTION: prices in minor units; null = "sur devis". */
  price?: { monthly: Money | null; yearly: Money | null; from?: boolean } | null;
  monthly_minor?: number | null;
  yearly_minor?: number | null;
  currency?: string;
}

export interface Subscription {
  plan: PlanCode;
  period: 'monthly' | 'yearly' | 'mensuel' | 'annuel';
  status: string;
  started_at?: ISODateTime | null;
  expires_at?: ISODateTime | null;
  grace_until?: ISODateTime | null;
  account_type?: 'user' | 'organisation';
  account_id?: UUID;
  entitlements?: { source?: { account_type?: 'user' | 'organisation' | 'none'; account_id?: UUID | null } };
}

/** Code d'un moyen de paiement declare dans le pack pays (GET /plans -> payment_methods). */
export type PaymentMethod = string;

export interface PaymentMethodOption {
  code: PaymentMethod;
  label: string;
}

/** GET /plans : `data` = formules, `payment_methods` = moyens du pack pays. */
export interface PlansResponse extends Page<Plan> {
  country?: string;
  currency?: string;
  payment_methods?: PaymentMethodOption[];
}

export interface CheckoutRequest {
  account_type: 'user' | 'organisation';
  account_id: UUID;
  plan: PlanCode;
  period: 'monthly' | 'yearly';
  method: PaymentMethod;
  phone: string;
}

export type PaymentStatus = 'initie' | 'en_attente' | 'confirme' | 'echoue' | 'rembourse';

export interface Payment {
  id: UUID;
  status: PaymentStatus;
  amount_minor?: number;
  currency?: string;
  method?: PaymentMethod;
  updated_at?: ISODateTime;
}

/* ------------------------------------------------------ certificates */

export interface CertificateCheck {
  valid: boolean;
  animal_name?: string;
  species?: string;
  disease?: string;
  event_date?: ISODate;
  valid_until?: ISODate;
  /** ASSUMPTION: why invalid */
  reason?: string;
}

/* ----------------------------------------------------- import/export */

export interface ImportResult {
  job_id: UUID;
  valid_rows: number;
  errors: { row: number; field: string; message: string }[];
  /** ASSUMPTION: first rows echoed back for the preview table */
  preview?: Record<string, string>[];
  total_rows?: number;
}

export interface ImportCommitResult {
  /** ASSUMPTION */
  created: number;
  updated?: number;
  skipped?: number;
}

export type ExportScope = 'reminders' | 'farms' | 'health_events';

/* --------------------------------------------------------- studio */

export type PackStatus = 'brouillon' | 'en_revue' | 'teste' | 'publie' | 'retire';
export type PackLevel = 'global' | 'filiere' | 'pays' | 'org' | 'ferme';

export interface PackObject {
  kind: string;
  code: string;
  [k: string]: unknown;
}

export interface PackContent {
  pack: string;
  version: string;
  level: PackLevel;
  requires?: Record<string, string>;
  objects: PackObject[];
  i18n?: Record<string, Record<string, string>>;
  tests?: unknown[];
  [k: string]: unknown;
}

/** ASSUMPTION: catalogue row of GET /studio/packs */
export interface StudioPack {
  code: string;
  level: PackLevel;
  title?: string;
  published_version: string | null;
  draft?: { id: UUID; version: string; status: PackStatus } | null;
  requires?: Record<string, string>;
  adoption_farms?: number;
  updated_at?: ISODateTime;
}

export interface Review {
  id: UUID;
  reviewer_id: UUID;
  reviewer_name: string;
  decision: 'approuve' | 'refuse';
  comments: string;
  created_at: ISODateTime;
}

/** ASSUMPTION: GET /studio/versions/:id (and items of /studio/packs/:code/versions) */
export interface PackVersion {
  id: UUID;
  pack: string;
  version: string;
  status: PackStatus;
  author_id: UUID;
  author_name: string;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  submitted_at?: ISODateTime | null;
  published_at?: ISODateTime | null;
  rollout_pct?: number | null;
  reviews: Review[];
  content?: PackContent;
}

/** ASSUMPTION: GET /studio/versions/:id/diff */
export interface PackDiff {
  base_version: string | null;
  changes: { op: 'add' | 'remove' | 'change'; path: string; before?: unknown; after?: unknown }[];
  major: boolean;
  impact?: { subjects_recomputed?: number };
}

/** ASSUMPTION: POST /studio/simulate-protocol */
export interface ProtocolSimulation {
  protocol_code: string;
  reference_date: ISODate;
  events: {
    step: string;
    disease?: string;
    label: string;
    offset_days: number;
    due_date: ISODate;
    kind: 'vaccin' | 'soin' | 'jalon' | 'recurrent';
    conditional?: boolean;
    after_step?: string | null;
    route?: string;
    notifications?: { offset: number; send_date: string; channels: string[] }[];
  }[];
  reminder_offsets?: number[];
  withdrawal_applied?: boolean;
}

/** ASSUMPTION: POST /studio/versions/:id/test */
export interface PackTestRun {
  /** number of passed cases, or a global boolean (API) */
  passed: number | boolean;
  total: number;
  results: { name: string; ok: boolean; message?: string }[];
  engines?: string;
}

export interface ValidationResult {
  errors: { path: string; message: string }[];
}
