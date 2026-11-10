import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { ParametrisedEntity, SyncedEntity } from './base';

@Entity('farms')
export class Farm extends SyncedEntity {
  @Column('uuid') owner_id: string;
  @Column('uuid', { nullable: true }) organisation_id: string | null;
  @Column('text') name: string;
  @Column('text', { array: true, default: () => "'{}'" }) speculations: string[];
  @Column('text', { default: 'CM' }) country: string;
  @Column('text', { nullable: true }) region: string | null;
  @Column('text', { nullable: true }) locality: string | null;
  @Column('text', { default: 'XAF' }) currency: string;
  @Column('numeric', { precision: 9, scale: 6, nullable: true }) gps_lat: number | null;
  @Column('numeric', { precision: 9, scale: 6, nullable: true }) gps_lng: number | null;
  @Column('geometry', { spatialFeatureType: 'Point', srid: 4326, nullable: true, select: false }) location: object | null;
  @Column('numeric', { precision: 10, scale: 2, nullable: true }) area_ha: number | null;
  @Column('text', { nullable: true }) manager_name: string | null;
}

@Entity('farm_settings')
export class FarmSettings {
  @PrimaryColumn('uuid') farm_id: string;
  @Column('jsonb', { default: () => "'{}'::jsonb" }) overrides: Record<string, Record<string, unknown>>;
  @Column('jsonb', { default: () => "'{}'::jsonb" }) targets: Record<string, unknown>;
  @Column('text', { array: true, default: () => "'{}'" }) dashboard_kpis: string[];
  @Column('jsonb', { default: () => "'{}'::jsonb" }) oncall_default: Record<string, unknown>;
  @UpdateDateColumn({ type: 'timestamptz' }) updated_at: Date;
}

@Entity('batches')
export class Batch extends ParametrisedEntity {
  @Column('uuid') farm_id: string;
  @Column('text') code: string;
  @Column('text') name: string;
  @Column('text') species: string;
  @Column('text', { nullable: true }) production_type: string | null;
  @Column('text', { nullable: true }) strain: string | null;
  @Column('int') initial_count: number;
  @Column('int', { nullable: true }) current_count: number | null;
  @Column('int', { default: 0 }) mortality_total: number;
  @Column('date') start_date: string;
  @Column('text', { nullable: true }) housing: string | null;
  @Column('text', { default: 'en_cours' }) status: string;
}

@Entity('dogs')
export class Dog extends ParametrisedEntity {
  @Column('uuid') farm_id: string;
  @Column('text') name: string;
  @Column('text', { nullable: true }) breed: string | null;
  @Column('text') sex: string;
  @Column('date', { nullable: true }) birth_date: string | null;
  @Column('text', { nullable: true }) chip_number: string | null;
  @Column('text', { nullable: true }) identification_type: string | null;
  @Column('text', { nullable: true }) coat: string | null;
  @Column('text', { default: 'compagnie' }) status: string;
  @Column('uuid', { nullable: true }) sire_id: string | null;
  @Column('uuid', { nullable: true }) dam_id: string | null;
  @Column('text', { nullable: true }) photo_uri: string | null;
}

@Entity('animals')
export class Animal extends ParametrisedEntity {
  @Column('uuid') farm_id: string;
  @Column('text') species: string;
  @Column('text') tag: string;
  @Column('text', { nullable: true }) name: string | null;
  @Column('text') sex: string;
  @Column('text', { nullable: true }) breed: string | null;
  @Column('date', { nullable: true }) birth_date: string | null;
  @Column('text', { nullable: true }) role: string | null;
  @Column('text', { default: 'actif' }) status: string;
  @Column('uuid', { nullable: true }) batch_id: string | null;
  @Column('uuid', { nullable: true }) sire_id: string | null;
  @Column('uuid', { nullable: true }) dam_id: string | null;
}

@Entity('daily_logs')
export class DailyLog extends ParametrisedEntity {
  @Column('uuid') farm_id: string;
  @Column('text') subject_type: string;
  @Column('uuid') subject_id: string;
  @Column('date') log_date: string;
  @Column('int', { nullable: true }) present_count: number | null;
  @Column('int', { default: 0 }) mortality: number;
  @Column('int', { default: 0 }) culled: number;
  @Column('int', { nullable: true }) eggs: number | null;
  @Column('int', { nullable: true }) eggs_broken: number | null;
  @Column('numeric', { nullable: true }) milk_l: number | null;
  @Column('numeric', { nullable: true }) milk_sold_l: number | null;
  @Column('numeric', { nullable: true }) feed_kg: number | null;
  @Column('text', { nullable: true }) feed_item_id: string | null;
  @Column('numeric', { nullable: true }) water_l: number | null;
  @Column('numeric', { nullable: true }) temperature_c: number | null;
  @Column('text', { nullable: true }) notes: string | null;
  @Column('text', { array: true, default: () => "'{}'" }) measured_fields: string[];
  @Column('uuid', { nullable: true }) alert_event_id: string | null;
}

@Entity('health_events')
export class HealthEvent extends ParametrisedEntity {
  @Column('uuid') farm_id: string;
  @Column('text') subject_type: string;
  @Column('uuid') subject_id: string;
  @Column('text') event_type: string;
  @Column('text', { nullable: true }) disease: string | null;
  @Column('text', { nullable: true }) product: string | null;
  @Column('text', { nullable: true }) product_batch_no: string | null;
  @Column('text', { nullable: true }) dose_route: string | null;
  @Column('date') event_date: string;
  @Column('date', { nullable: true }) next_due: string | null;
  @Column('date', { nullable: true }) withdrawal_meat_until: string | null;
  @Column('date', { nullable: true }) withdrawal_milk_until: string | null;
  @Column('date', { nullable: true }) withdrawal_eggs_until: string | null;
  @Column('text', { nullable: true }) protocol_id: string | null;
  @Column('text', { nullable: true }) protocol_step: string | null;
  @Column('bigint', { nullable: true }) cost_minor: number | null;
  @Column('text', { nullable: true }) currency: string | null;
  @Column('text', { nullable: true }) performed_by: string | null;
  @Column('uuid', { nullable: true }) campaign_id: string | null;
  @Column('uuid', { nullable: true }) stock_movement_id: string | null;
  @Column('text', { nullable: true }) active_substance_code: string | null;
  @Column('numeric', { nullable: true }) quantity_value: number | null;
  @Column('text', { nullable: true }) quantity_unit: string | null;
  @Column('int', { nullable: true }) doses_count: number | null;
  @Column('text', { nullable: true }) notes: string | null;
}

@Entity('reminders')
export class Reminder extends SyncedEntity {
  @Column('uuid') farm_id: string;
  @Column('text', { default: 'health_event' }) source_type: string;
  @Column('uuid', { nullable: true }) source_id: string | null;
  @Column('text', { nullable: true }) subject_type: string | null;
  @Column('uuid', { nullable: true }) subject_id: string | null;
  @Column('text', { nullable: true }) subject_ref: string | null;
  @Column('text', { nullable: true }) protocol_code: string | null;
  @Column('text', { nullable: true }) step: string | null;
  @Column('text', { nullable: true }) disease: string | null;
  @Column('text', { default: 'protocole' }) kind: string;
  @Column('date') due_date: string;
  @Column('jsonb', { default: () => "'[]'::jsonb" }) channel_plan: unknown[];
  @Column('text', { default: 'a_venir' }) status: string;
  @Column('text', { default: 'normale' }) priority: string;
  @Column('text', { nullable: true }) short_code: string | null;
  @Column('timestamptz', { nullable: true }) sent_at: Date | null;
  @Column('timestamptz', { nullable: true }) confirmed_at: Date | null;
  @Column('uuid', { nullable: true }) confirmed_by: string | null;
  @Column('text', { nullable: true }) confirmed_via: string | null;
  @Column('date', { nullable: true }) snoozed_until: string | null;
  @Column('text', { nullable: true }) cancel_reason: string | null;
  @Column('uuid', { nullable: true }) health_event_id: string | null;
  @Column('text', { nullable: true }) param_version: string | null;
}

@Entity('tasks')
export class Task extends SyncedEntity {
  @Column('uuid') farm_id: string;
  @Column('text', { nullable: true }) template_id: string | null;
  @Column('text', { nullable: true }) subject_type: string | null;
  @Column('uuid', { nullable: true }) subject_id: string | null;
  @Column('text') title: string;
  @Column('text', { default: 'autre' }) category: string;
  @Column('date') due_date: string;
  @Column('text', { nullable: true }) recurrence: string | null;
  @Column('uuid', { nullable: true }) assignee_user_id: string | null;
  @Column('text', { default: 'a_faire' }) status: string;
  @Column('timestamptz', { nullable: true }) done_at: Date | null;
  @Column('text', { nullable: true }) notes: string | null;
}
