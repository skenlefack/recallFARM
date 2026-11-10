import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('text', { unique: true }) phone: string;
  @Column('text', { nullable: true }) email: string | null;
  @Column('text', { nullable: true }) full_name: string | null;
  @Column('text', { default: 'fr' }) locale: string;
  @Column('text', { default: 'CM' }) country: string;
  @Column('text', { default: 'XAF' }) default_currency: string;
  @Column('boolean', { default: false }) otp_verified: boolean;
  @Column('text', { default: 'actif' }) account_status: string;
  @Column('text', { array: true, default: () => "'{}'" }) platform_roles: string[];
  @Column('boolean', { default: true }) has_smartphone: boolean;
  @Column('boolean', { default: false }) analytics_opt_out: boolean;
  @Column('timestamptz', { nullable: true }) last_active_at: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updated_at: Date;
  @DeleteDateColumn({ type: 'timestamptz', nullable: true }) deleted_at: Date | null;
}

@Entity('otp_codes')
export class OtpCode {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('text') phone: string;
  @Column('text') code_hash: string;
  @Column('timestamptz') expires_at: Date;
  @Column('int', { default: 0 }) attempts: number;
  @Column('timestamptz', { nullable: true }) consumed_at: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
}

@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryColumn('uuid') id: string;
  @Column('uuid') user_id: string;
  @Column('timestamptz') expires_at: Date;
  @Column('timestamptz', { nullable: true }) revoked_at: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
}

@Entity('organisations')
export class Organisation {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('text') name: string;
  @Column('text', { default: 'cooperative' }) type: string;
  @Column('text', { default: 'CM' }) country: string;
  @Column('text', { nullable: true }) region: string | null;
  @Column('text', { default: 'XAF' }) currency: string;
  @Column('text', { default: 'decouverte' }) plan: string;
  @Column('text', { default: 'standard' }) data_hosting: string;
  @Column('jsonb', { default: () => "'{}'::jsonb" }) settings: Record<string, any>;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updated_at: Date;
  @DeleteDateColumn({ type: 'timestamptz', nullable: true }) deleted_at: Date | null;
}

@Entity('memberships')
export class Membership {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') user_id: string;
  @Column('uuid') organisation_id: string;
  @Column('text') role: string;
  @Column('jsonb', { default: () => "'[]'::jsonb" }) farmer_scope: string[];
  @Column('text', { default: 'actif' }) status: string;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updated_at: Date;
  @DeleteDateColumn({ type: 'timestamptz', nullable: true }) deleted_at: Date | null;
}

@Entity('consents')
export class Consent {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') user_id: string;
  @Column('uuid', { nullable: true }) farm_id: string | null;
  @Column('uuid', { nullable: true }) organisation_id: string | null;
  @Column('text') scope: string;
  @Column('boolean') granted: boolean;
  @Column('text') text_version: string;
  @Column('timestamptz') granted_at: Date;
  @Column('timestamptz', { nullable: true }) revoked_at: Date | null;
  @Column('text', { default: 'app' }) channel: string;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
}

@Entity('account_requests')
export class AccountRequest {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') user_id: string;
  @Column('text') type: string;
  @Column('text') status: string;
  @CreateDateColumn({ type: 'timestamptz' }) requested_at: Date;
  @Column('timestamptz', { nullable: true }) scheduled_for: Date | null;
  @Column('text', { nullable: true }) export_uri: string | null;
  @Column('timestamptz', { nullable: true }) completed_at: Date | null;
}
