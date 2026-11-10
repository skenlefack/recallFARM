import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { dateIn } from '../common/dates';
import { Errors } from '../common/errors';
import { Animal, Batch, Dog } from '../database/entities';

export type SubjectType = 'batch' | 'dog' | 'animal';
export const SUBJECT_TYPES: SubjectType[] = ['batch', 'dog', 'animal'];

export interface SubjectInfo {
  type: SubjectType;
  id: string;
  farm_id: string;
  species: string;
  production_type: string | null;
  label: string;
  created_date: string;
  start_date: string | null;
  birth_date: string | null;
  entity: Batch | Dog | Animal;
  /** Expression context for `subject` (form conditions, alert rules, KPIs). */
  ctx: Record<string, unknown>;
}

/** Polymorphic subject lookup (03 §0.3, RG-MDD-04). */
@Injectable()
export class SubjectsService {
  constructor(private readonly ds: DataSource) {}

  async load(type: string, id: string, opts: { withDeleted?: boolean } = {}): Promise<SubjectInfo> {
    if (type === 'batch') {
      const b = await this.ds.getRepository(Batch).findOne({ where: { id }, withDeleted: opts.withDeleted });
      if (!b) throw Errors.notFound('Lot');
      return this.fromBatch(b);
    }
    if (type === 'dog') {
      const d = await this.ds.getRepository(Dog).findOne({ where: { id }, withDeleted: opts.withDeleted });
      if (!d) throw Errors.notFound('Chien');
      return this.fromDog(d);
    }
    if (type === 'animal') {
      const a = await this.ds.getRepository(Animal).findOne({ where: { id }, withDeleted: opts.withDeleted });
      if (!a) throw Errors.notFound('Animal');
      return {
        type: 'animal', id: a.id, farm_id: a.farm_id, species: a.species, production_type: null,
        label: a.name ? `${a.tag} « ${a.name} »` : a.tag, created_date: dateIn(a.created_at ?? new Date()),
        start_date: null, birth_date: a.birth_date, entity: a,
        ctx: { ...a, ...(a.attributes ?? {}), sexe: a.sex },
      };
    }
    throw Errors.validation({ subject_type: 'batch, dog ou animal attendu' });
  }

  fromBatch(b: Batch): SubjectInfo {
    const count = b.current_count ?? b.initial_count;
    return {
      type: 'batch', id: b.id, farm_id: b.farm_id, species: b.species, production_type: b.production_type,
      label: `Bande ${b.name} · ${count} sujets`, created_date: dateIn(b.created_at ?? new Date()),
      start_date: b.start_date, birth_date: null, entity: b,
      ctx: {
        ...(b.attributes ?? {}), ...b, count, cumulative_mortality: b.mortality_total,
      },
    };
  }

  fromDog(d: Dog): SubjectInfo {
    return {
      type: 'dog', id: d.id, farm_id: d.farm_id, species: 'chien', production_type: null,
      label: d.name, created_date: dateIn(d.created_at ?? new Date()),
      start_date: null, birth_date: d.birth_date, entity: d,
      ctx: { ...(d.attributes ?? {}), ...d, species: 'chien', sexe: d.sex },
    };
  }
}
