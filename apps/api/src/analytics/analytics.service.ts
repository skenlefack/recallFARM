import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Errors } from '../common/errors';

export const EVENT_CATALOGUE = [
  'screen_view', 'reminder_confirmed', 'reminder_snoozed', 'login', 'signup',
  'animal_added', 'batch_created', 'health_event_created', 'sale_recorded',
  'sync_completed', 'subscription_started', 'app_opened', 'app_backgrounded',
] as const;

export type EventName = (typeof EVENT_CATALOGUE)[number];

export interface AnalyticsEvent {
  name: string;
  ts: string;
  props?: Record<string, unknown>;
  device_id_hash?: string;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  private readonly validNames = new Set<string>(EVENT_CATALOGUE);

  constructor(private readonly ds: DataSource) {}

  /** Validate and bulk-insert analytics events. Rejects unknown event names. */
  async ingest(userId: string, farmId: string | undefined, events: AnalyticsEvent[]): Promise<{ accepted: number; rejected: string[] }> {
    const rejected: string[] = [];
    const valid: AnalyticsEvent[] = [];

    for (const e of events) {
      if (!this.validNames.has(e.name)) {
        rejected.push(e.name);
      } else {
        valid.push(e);
      }
    }

    if (rejected.length) {
      throw Errors.validation(
        { events: `Noms non reconnus: ${[...new Set(rejected)].join(', ')}` },
        'Evenements invalides',
      );
    }

    if (valid.length) {
      const values: string[] = [];
      const params: unknown[] = [];
      let idx = 1;
      for (const e of valid) {
        values.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4})`);
        params.push(userId, e.device_id_hash ?? null, e.name, e.ts, JSON.stringify(e.props ?? {}));
        idx += 5;
      }
      await this.ds.query(
        `INSERT INTO analytics_events (user_id, device_id_hash, name, ts, props) VALUES ${values.join(', ')}`,
        params,
      );
    }

    this.logger.debug(`ingest: ${valid.length} event(s) from user ${userId}`);
    return { accepted: valid.length, rejected: [] };
  }
}
