import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ParametrisedEntity, SyncedEntity } from './base';

@Entity('stock_movements')
export class StockMovement extends SyncedEntity {
  @Column('uuid') farm_id: string;
  @Column('text') item_id: string;
  @Column('date') movement_date: string;
  @Column('text') direction: string;
  @Column('numeric') quantity: number;
  @Column('bigint', { nullable: true }) unit_cost_minor: number | null;
  @Column('text', { nullable: true }) currency: string | null;
  @Column('text', { nullable: true }) supplier: string | null;
  @Column('text', { nullable: true }) lot_no: string | null;
  @Column('date', { nullable: true }) expiry_date: string | null;
  @Column('text', { nullable: true }) subject_type: string | null;
  @Column('uuid', { nullable: true }) subject_id: string | null;
  @Column('uuid', { nullable: true }) expense_id: string | null;
  @Column('uuid', { nullable: true }) health_event_id: string | null;
  @Column('text', { nullable: true }) notes: string | null;
}

@Entity('stock_thresholds')
export class StockThreshold {
  @PrimaryColumn('uuid') farm_id: string;
  @PrimaryColumn('text') item_id: string;
  @Column('numeric') min_quantity: number;
}

@Entity('products_sales')
export class Sale extends ParametrisedEntity {
  @Column('uuid') farm_id: string;
  @Column('text') product: string;
  @Column('text', { nullable: true }) species: string | null;
  @Column('numeric') quantity: number;
  @Column('text') unit: string;
  @Column('bigint') unit_price_minor: number;
  @Column('bigint') amount_minor: number;
  @Column('text') currency: string;
  @Column('uuid', { nullable: true }) client_id: string | null;
  @Column('text', { nullable: true }) client_name: string | null;
  @Column('text', { nullable: true }) payment: string | null;
  @Column('text', { default: 'paye' }) payment_status: string;
  @Column('date') sale_date: string;
  @Column('text', { nullable: true }) subject_type: string | null;
  @Column('uuid', { nullable: true }) subject_id: string | null;
}

@Entity('expenses')
export class Expense extends ParametrisedEntity {
  @Column('uuid') farm_id: string;
  @Column('text') category: string;
  @Column('text', { nullable: true }) description: string | null;
  @Column('numeric', { nullable: true }) quantity: number | null;
  @Column('bigint') amount_minor: number;
  @Column('text') currency: string;
  @Column('text', { nullable: true }) payment_method: string | null;
  @Column('text', { nullable: true }) supplier: string | null;
  @Column('date') expense_date: string;
  @Column('text', { nullable: true }) subject_type: string | null;
  @Column('uuid', { nullable: true }) subject_id: string | null;
}

@Entity('subscriptions')
export class Subscription {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('text') account_type: string;
  @Column('uuid') account_id: string;
  @Column('text') plan: string;
  @Column('text', { default: 'mensuel' }) period: string;
  @Column('bigint', { nullable: true }) price_minor: number | null;
  @Column('text', { nullable: true }) currency: string | null;
  @Column('text', { nullable: true }) payment_provider: string | null;
  @Column('timestamptz', { nullable: true }) started_at: Date | null;
  @Column('timestamptz', { nullable: true }) expires_at: Date | null;
  @Column('timestamptz', { nullable: true }) grace_until: Date | null;
  @Column('text', { default: 'actif' }) status: string;
  @Column('jsonb', { default: () => "'{}'::jsonb" }) entitlements_snapshot: Record<string, unknown>;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updated_at: Date;
}

@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('text') payer_type: string;
  @Column('uuid') payer_id: string;
  @Column('text', { default: 'abonnement' }) purpose: string;
  @Column('uuid', { nullable: true }) subscription_id: string | null;
  @Column('text', { nullable: true }) plan: string | null;
  @Column('text', { nullable: true }) period: string | null;
  @Column('bigint') amount_minor: number;
  @Column('text') currency: string;
  @Column('text') method: string;
  @Column('text', { nullable: true }) phone: string | null;
  @Column('text', { nullable: true }) provider_ref: string | null;
  @Column('text', { default: 'initie' }) status: string;
  @Column('timestamptz', { nullable: true }) paid_at: Date | null;
  @Column('bigint', { nullable: true }) fees_minor: number | null;
  @Column('uuid', { nullable: true }) created_by: string | null;
  @Column('jsonb', { default: () => "'{}'::jsonb" }) raw: Record<string, unknown>;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updated_at: Date;
}

@Entity('alert_events')
export class AlertEvent extends SyncedEntity {
  @Column('uuid', { nullable: true }) farm_id: string | null;
  @Column('uuid', { nullable: true }) organisation_id: string | null;
  @Column('text') rule_code: string;
  @Column('text') source: string;
  @Column('text') severity: string;
  @Column('text', { default: 'ouverte' }) status: string;
  @Column('text', { nullable: true }) title: string | null;
  @Column('text', { nullable: true }) reason: string | null;
  @Column('text', { nullable: true }) action_label: string | null;
  @Column('jsonb', { default: () => "'{}'::jsonb" }) trigger_value: Record<string, unknown>;
  @Column('text', { nullable: true }) subject_type: string | null;
  @Column('uuid', { nullable: true }) subject_id: string | null;
  @Column('uuid', { nullable: true }) device_id: string | null;
  @Column('timestamptz') opened_at: Date;
  @Column('timestamptz', { nullable: true }) last_triggered_at: Date | null;
  @Column('int', { default: 0 }) repeat_count: number;
  @Column('uuid', { nullable: true }) acknowledged_by: string | null;
  @Column('timestamptz', { nullable: true }) acknowledged_at: Date | null;
  @Column('timestamptz', { nullable: true }) resolved_at: Date | null;
  @Column('text', { nullable: true }) resolution_cause: string | null;
  @Column('text', { nullable: true }) resolution_action: string | null;
  @Column('jsonb', { default: () => "'[]'::jsonb" }) escalation: Array<{ level: number; target: string; at: string; done: boolean; channel?: string }>;
  @Column('text', { default: 'serveur' }) origin: string;
  @Column('text', { nullable: true }) param_version: string | null;
}

@Entity('devices')
export class Device {
  @PrimaryColumn('uuid') id: string;
  @Column('uuid') farm_id: string;
  @Column('text') type: string;
  @Column('text') name: string;
  @Column('text', { nullable: true }) serial: string | null;
  @Column('text', { nullable: true }) housing: string | null;
  @Column('text', { nullable: true }) sensor_profile_code: string | null;
  @Column('text', { nullable: true }) metric: string | null;
  @Column('text', { nullable: true }) unit: string | null;
  @Column('jsonb', { default: () => "'{}'::jsonb" }) config: Record<string, any>;
  @Column('text', { nullable: true, select: false }) key_hash: string | null;
  @Column('text', { default: 'en_ligne' }) status: string;
  @Column('timestamptz', { nullable: true }) last_seen_at: Date | null;
  @Column('double precision', { nullable: true }) last_value: number | null;
  @Column('timestamptz', { nullable: true }) breach_since: Date | null;
  @Column('int', { nullable: true }) battery_pct: number | null;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updated_at: Date;
  @DeleteDateColumn({ type: 'timestamptz', nullable: true }) deleted_at: Date | null;
}

@Entity('telemetry')
export class Telemetry {
  @PrimaryColumn('uuid') device_id: string;
  @PrimaryColumn('text') metric: string;
  @PrimaryColumn('timestamptz') ts: Date;
  @Column('double precision') value: number;
  @Column('smallint', { default: 1 }) quality: number;
}

@Entity('mating_checks')
export class MatingCheck {
  @PrimaryColumn('uuid') id: string;
  @Column('uuid', { nullable: true }) farm_id: string | null;
  @Column('text') species: string;
  @Column('text') sire_type: string;
  @Column('uuid') sire_id: string;
  @Column('text') dam_type: string;
  @Column('uuid') dam_id: string;
  @Column('numeric') expected_coef: number;
  @Column('boolean') complete: boolean;
  @Column('int') generations_used: number;
  @Column('numeric') threshold: number;
  @Column('text') verdict: string;
  @Column('jsonb', { default: () => "'[]'::jsonb" }) common_ancestors: unknown[];
  @CreateDateColumn({ type: 'timestamptz' }) checked_at: Date;
  @Column('uuid', { nullable: true }) checked_by: string | null;
}

@Entity('outbound_messages')
export class OutboundMessage {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { nullable: true }) reminder_id: string | null;
  @Column('uuid', { nullable: true }) alert_event_id: string | null;
  @Column('uuid', { nullable: true }) organisation_id: string | null;
  @Column('uuid', { nullable: true }) recipient_user_id: string | null;
  @Column('text') recipient_phone: string;
  @Column('text') channel: string;
  @Column('text') template_code: string;
  @Column('text', { default: 'fr' }) lang: string;
  @Column('text', { nullable: true }) body: string | null;
  @Column('text', { default: 'en_file' }) status: string;
  @Column('int', { nullable: true }) plan_offset: number | null;
  /** Adapter that sent the message (connector name, "simulator", "http"); scopes delivery reports. */
  @Column('text', { nullable: true }) provider: string | null;
  @Column('text', { nullable: true }) provider_ref: string | null;
  @Column('bigint', { nullable: true }) cost_minor: number | null;
  @Column('text', { nullable: true }) currency: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) queued_at: Date;
  @Column('timestamptz', { nullable: true }) sent_at: Date | null;
  @Column('timestamptz', { nullable: true }) delivered_at: Date | null;
  @Column('text', { nullable: true }) error_code: string | null;
}

@Entity('leads')
export class Lead {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('text') phone: string;
  @Column('text', { nullable: true }) name: string | null;
  @Column('text') source: string;
  @Column('text', { nullable: true }) ip_hash: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
}

@Entity('feature_flags')
export class FeatureFlag {
  @PrimaryColumn('text') key: string;
  @Column('text', { nullable: true }) description: string | null;
  @Column('jsonb', { default: () => "'{}'::jsonb" }) rules: { countries?: string[]; plans?: string[]; percent?: number };
  @Column('boolean', { default: true }) enabled: boolean;
  @Column('uuid', { nullable: true }) updated_by: string | null;
  @UpdateDateColumn({ type: 'timestamptz' }) updated_at: Date;
}

@Entity('import_jobs')
export class ImportJob {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('text') kind: string;
  @Column('uuid', { nullable: true }) organisation_id: string | null;
  @Column('uuid', { nullable: true }) farm_id: string | null;
  @Column('text', { default: 'valide' }) status: string;
  @Column('int', { default: 0 }) rows_total: number;
  @Column('int', { default: 0 }) rows_ok: number;
  @Column('jsonb', { default: () => "'[]'::jsonb" }) rows: Array<Record<string, any>>;
  @Column('jsonb', { default: () => "'[]'::jsonb" }) errors: Array<{ row: number; field: string; message: string }>;
  @Column('uuid', { nullable: true }) created_by: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
  @Column('timestamptz', { nullable: true }) committed_at: Date | null;
}

@Entity('export_jobs')
export class ExportJob {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('text') kind: string;
  @Column('uuid', { nullable: true }) requested_by: string | null;
  @Column('jsonb', { default: () => "'{}'::jsonb" }) scope: Record<string, unknown>;
  @Column('text', { default: 'en_file' }) status: string;
  @Column('text', { nullable: true }) file_uri: string | null;
  @Column('text', { nullable: true }) file_hash: string | null;
  @Column('int', { nullable: true }) rows: number | null;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
  @Column('timestamptz', { nullable: true }) completed_at: Date | null;
}

@Entity('param_packs')
export class ParamPack {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('text', { unique: true }) code: string;
  @Column('text') level: string;
  @Column('text', { nullable: true }) scope_ref: string | null;
  @Column('text', { nullable: true }) title: string | null;
  @Column('uuid', { nullable: true }) owner_user_id: string | null;
  @Column('boolean', { default: false }) review_required: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
}

@Entity('param_pack_versions')
export class ParamPackVersion {
  @PrimaryGeneratedColumn('uuid') id: string;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updated_at: Date;
  @Column({ type: 'bigint', insert: false, update: false, default: () => "nextval('sync_version_seq')" }) sync_version: number;
  @Column('uuid') pack_id: string;
  @Column('text') version: string;
  @Column('text', { default: 'brouillon' }) status: string;
  @Column('jsonb') content: Record<string, any>;
  @Column('text', { nullable: true }) content_hash: string | null;
  @Column('text', { nullable: true }) signature: string | null;
  @Column('jsonb', { default: () => "'{}'::jsonb" }) requires: Record<string, string>;
  @Column('text', { nullable: true }) changelog: string | null;
  @Column('uuid', { nullable: true }) author_id: string | null;
  @Column('uuid', { nullable: true }) published_by: string | null;
  @Column('timestamptz', { nullable: true }) published_at: Date | null;
  @Column('timestamptz', { nullable: true }) retired_at: Date | null;
  @Column('jsonb', { nullable: true }) rollout: { percent?: number; farm_ids?: string[] } | null;
}

@Entity('param_reviews')
export class ParamReview {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') version_id: string;
  @Column('uuid') reviewer_id: string;
  @Column('text') decision: string;
  @Column('text', { nullable: true }) comments: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) reviewed_at: Date;
}

@Entity('param_test_runs')
export class ParamTestRun {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') version_id: string;
  @Column('text') kind: string;
  @Column('boolean') passed: boolean;
  @Column('jsonb', { default: () => "'{}'::jsonb" }) report: Record<string, unknown>;
  @CreateDateColumn({ type: 'timestamptz' }) ran_at: Date;
}

@Entity('param_publications')
export class ParamPublication {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') version_id: string;
  @Column('text') action: string;
  @Column('uuid', { nullable: true }) actor_id: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) at: Date;
  @Column('text', { nullable: true }) reason: string | null;
}

