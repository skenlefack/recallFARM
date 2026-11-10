import { Column, CreateDateColumn, DeleteDateColumn, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Columns common to every synchronised table (03 §0.1). `sync_version` is set by a DB trigger. */
export abstract class SyncedEntity {
  @PrimaryColumn('uuid') id: string;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updated_at: Date;
  @DeleteDateColumn({ type: 'timestamptz', nullable: true }) deleted_at: Date | null;
  @Column({ type: 'uuid', nullable: true }) created_by: string | null;
  @Column({ type: 'uuid', nullable: true }) updated_by: string | null;
  @Column({ type: 'bigint', insert: false, update: false, default: () => "nextval('sync_version_seq')" }) sync_version: number;
  @Column({ type: 'int', default: 0 }) client_rev: number;
  @Column({ type: 'text', nullable: true }) last_device_id: string | null;
}

/** Entities captured by parametrised forms carry `attributes` + `param_version` (03 §0.4). */
export abstract class ParametrisedEntity extends SyncedEntity {
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) attributes: Record<string, unknown>;
  @Column({ type: 'text', nullable: true }) param_version: string | null;
}
