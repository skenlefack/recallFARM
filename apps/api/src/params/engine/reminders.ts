import { addDays, daysBetween } from '../../common/dates';

/** Reminder engine (ENGINES.md §2, dossier 12 §6.2, 01 EF-VAC). Pure and deterministic. */

export interface ProtocolStep {
  code: string;
  disease: string;
  offset_days: number;
  route?: string;
  certificate?: boolean;
  [k: string]: unknown;
}

export interface Protocol {
  kind?: string;
  code: string;
  species?: string;
  production_type?: string;
  reference: string;
  mandatory?: boolean;
  steps: ProtocolStep[];
  recurring?: { disease: string; every_days: number; after_step?: string; route?: string; certificate?: boolean };
}

export interface EngineSubject {
  type?: string;
  start_date?: string | null;
  birth_date?: string | null;
  created_at?: string | null;
  [k: string]: unknown;
}

export interface EngineEvent {
  protocol_step?: string | null;
  disease?: string | null;
  event_date: string;
  next_due?: string | null;
}

export type ReminderTiming = 'en_retard' | 'aujourdhui' | 'a_venir';

export interface ComputedReminder {
  step: string;
  disease: string;
  due_date: string;
  status: ReminderTiming;
  priority: 'haute' | 'normale';
  kind: 'protocole' | 'recurrent' | 'manuel';
  protocol?: string;
  route?: string;
}

export interface DiseaseInfo {
  code: string;
  notifiable?: boolean;
}

/** Steps due more than this many days before the subject was registered are ignored (rule 7). */
export const IGNORE_PAST_DAYS = 30;

export function timing(dueDate: string, today: string): ReminderTiming {
  if (today > dueDate) return 'en_retard';
  if (today === dueDate) return 'aujourdhui';
  return 'a_venir';
}

function priorityOf(disease: string, protocol: Protocol | null, diseases: Record<string, DiseaseInfo>): 'haute' | 'normale' {
  if (diseases[disease]?.notifiable) return 'haute';
  if (protocol?.mandatory) return 'haute';
  return 'normale';
}

export function computeProtocolReminders(
  protocol: Protocol,
  subject: EngineSubject,
  events: EngineEvent[],
  today: string,
  diseases: Record<string, DiseaseInfo>,
): ComputedReminder[] {
  const ref = subject[protocol.reference] as string | null | undefined;
  if (!ref) return [];
  const refDate = ref.slice(0, 10);
  const createdAt = (subject.created_at ?? refDate).slice(0, 10);
  const done = new Set(events.filter((e) => e.protocol_step).map((e) => e.protocol_step as string));
  const out: ComputedReminder[] = [];

  for (const step of protocol.steps ?? []) {
    if (done.has(step.code)) continue;
    const due = addDays(refDate, Number(step.offset_days));
    if (daysBetween(due, createdAt) > IGNORE_PAST_DAYS) continue; // registered "en cours de vie"
    out.push({
      step: step.code,
      disease: step.disease,
      due_date: due,
      status: timing(due, today),
      priority: priorityOf(step.disease, protocol, diseases),
      kind: 'protocole',
      protocol: protocol.code,
      route: step.route,
    });
  }

  const rec = protocol.recurring;
  if (rec && rec.every_days > 0) {
    let last: string | null = null;
    if (rec.after_step) {
      const afterDates = events.filter((e) => e.protocol_step === rec.after_step).map((e) => e.event_date.slice(0, 10));
      if (afterDates.length > 0) {
        last = afterDates.sort().at(-1)!;
        const later = events
          .filter((e) => e.disease === rec.disease && e.event_date.slice(0, 10) > last!)
          .map((e) => e.event_date.slice(0, 10))
          .sort();
        if (later.length) last = later.at(-1)!;
      }
    } else {
      const dates = events.filter((e) => e.disease === rec.disease).map((e) => e.event_date.slice(0, 10)).sort();
      if (dates.length) last = dates.at(-1)!;
    }
    if (last) {
      const due = addDays(last, rec.every_days);
      out.push({
        step: `${rec.disease}_recurrent`,
        disease: rec.disease,
        due_date: due,
        status: timing(due, today),
        priority: priorityOf(rec.disease, protocol, diseases),
        kind: 'recurrent',
        protocol: protocol.code,
        route: rec.route,
      });
    }
  }
  return sortReminders(out);
}

/** Rule 4: an act outside any protocol with `next_due` creates a manual reminder (until a later act of the same disease). */
export function computeManualReminders(
  events: EngineEvent[],
  today: string,
  diseases: Record<string, DiseaseInfo>,
): ComputedReminder[] {
  const out: ComputedReminder[] = [];
  for (const e of events) {
    if (e.protocol_step || !e.next_due || !e.disease) continue;
    const superseded = events.some((o) => o !== e && o.disease === e.disease && o.event_date.slice(0, 10) > e.event_date.slice(0, 10));
    if (superseded) continue;
    const due = e.next_due.slice(0, 10);
    out.push({
      step: `${e.disease}_manuel_${e.event_date.slice(0, 10)}`,
      disease: e.disease,
      due_date: due,
      status: timing(due, today),
      priority: priorityOf(e.disease, null, diseases),
      kind: 'manuel',
    });
  }
  return sortReminders(out);
}

export function sortReminders(list: ComputedReminder[]): ComputedReminder[] {
  return list
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.due_date < b.r.due_date ? -1 : a.r.due_date > b.r.due_date ? 1 : a.i - b.i))
    .map((x) => x.r);
}

export interface ReminderPlan {
  offsets_days: number[];
  channels: Record<string, string[]>;
  quiet_hours?: { start: string; end: string };
  max_sms_per_day?: number;
}

export interface PlannedNotification {
  offset: number;
  send_date: string;
  channels: string[];
}

/** Rule 6: notification plan of an open reminder. sms/whatsapp require the `rappels_sms` entitlement. */
export function notificationPlan(plan: ReminderPlan, dueDate: string, entitlements: string[]): PlannedNotification[] {
  const smsAllowed = entitlements.includes('rappels_sms') || entitlements.includes('*');
  return [...plan.offsets_days]
    .sort((a, b) => a - b)
    .map((offset) => {
      const raw = plan.channels[String(offset)] ?? ['app'];
      const channels = raw.filter((c) => (c === 'sms' || c === 'whatsapp' ? smsAllowed : true));
      return { offset, send_date: addDays(dueDate, offset), channels: channels.length ? channels : ['app'] };
    });
}
