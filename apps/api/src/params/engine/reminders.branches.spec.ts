/**
 * Moteur de rappels : branches non couvertes par les vecteurs communs (EF-VAC-02, EF-VAC-04, RG-VAC-01, RG-VAC-02,
 * RG-VAC-04, RG-NOT-01, T-01, T-02, T-03). Protocoles synthetiques : aucune espece codee en dur.
 */
import { computeManualReminders, computeProtocolReminders, notificationPlan, Protocol, sortReminders, timing } from './reminders';

const diseases = { rage: { code: 'rage', notifiable: true }, toux: { code: 'toux' } };
const proto: Protocol = {
  code: 'p',
  reference: 'birth_date',
  steps: [
    { code: 's1', disease: 'toux', offset_days: 10 },
    { code: 's2', disease: 'rage', offset_days: 90, route: 'sc' },
  ],
  recurring: { disease: 'rage', every_days: 365, after_step: 's2' },
};

describe('timing (RG-VAC-02)', () => {
  it('classifies overdue, today and upcoming', () => {
    expect(timing('2026-01-01', '2026-01-02')).toBe('en_retard');
    expect(timing('2026-01-01', '2026-01-01')).toBe('aujourdhui');
    expect(timing('2026-01-02', '2026-01-01')).toBe('a_venir');
  });
});

describe('protocol reminders (RG-VAC-01, RG-VAC-04)', () => {
  it('returns nothing without a reference date', () => {
    expect(computeProtocolReminders(proto, {}, [], '2026-01-01', diseases)).toEqual([]);
    expect(computeProtocolReminders(proto, { birth_date: null }, [], '2026-01-01', diseases)).toEqual([]);
  });

  it('plans each open step at reference + offset, priority high for notifiable diseases', () => {
    const r = computeProtocolReminders(proto, { birth_date: '2026-01-01' }, [], '2026-01-05', diseases);
    expect(r.map((x) => [x.step, x.due_date, x.status, x.priority, x.route])).toEqual([
      ['s1', '2026-01-11', 'a_venir', 'normale', undefined],
      ['s2', '2026-04-01', 'a_venir', 'haute', 'sc'],
    ]);
  });

  it('makes every step of a mandatory protocol high priority', () => {
    const r = computeProtocolReminders({ ...proto, mandatory: true, recurring: undefined }, { birth_date: '2026-01-01' }, [], '2026-01-05', diseases);
    expect(r.every((x) => x.priority === 'haute')).toBe(true);
  });

  it('skips done steps and steps due long before the subject was registered', () => {
    const done = [{ protocol_step: 's1', event_date: '2026-01-11' }];
    expect(computeProtocolReminders({ ...proto, recurring: undefined }, { birth_date: '2026-01-01' }, done, '2026-01-12', diseases).map((x) => x.step)).toEqual(['s2']);
    // registered a year after birth: s1 (due +10 d) is ignored, s2 (+90 d) too
    const late = computeProtocolReminders({ ...proto, recurring: undefined }, { birth_date: '2026-01-01', created_at: '2027-01-01T10:00:00Z' }, [], '2027-01-01', diseases);
    expect(late).toEqual([]);
  });

  it('adds a recurring reminder after the last act of the step (RG-VAC-01)', () => {
    const events = [{ protocol_step: 's2', disease: 'rage', event_date: '2026-04-01' }];
    const r = computeProtocolReminders(proto, { birth_date: '2026-01-01' }, events, '2026-06-01', diseases);
    const rec = r.find((x) => x.kind === 'recurrent')!;
    expect(rec).toMatchObject({ step: 'rage_recurrent', due_date: '2027-04-01', status: 'a_venir', priority: 'haute' });
  });

  it('restarts the recurrence from a later act of the same disease outside the protocol', () => {
    const events = [
      { protocol_step: 's2', disease: 'rage', event_date: '2026-04-01' },
      { protocol_step: null, disease: 'rage', event_date: '2026-09-01' },
      { protocol_step: null, disease: 'rage', event_date: '2026-10-01' },
      { protocol_step: null, disease: 'toux', event_date: '2026-11-01' },
    ];
    const r = computeProtocolReminders(proto, { birth_date: '2026-01-01' }, events, '2026-11-02', diseases);
    expect(r.find((x) => x.kind === 'recurrent')).toMatchObject({ due_date: '2027-10-01' });
  });

  it('has no recurrence before the anchor step is done, or when every_days is not positive', () => {
    const none = computeProtocolReminders(proto, { birth_date: '2026-01-01' }, [], '2026-01-05', diseases);
    expect(none.some((x) => x.kind === 'recurrent')).toBe(false);
    const zero = { ...proto, recurring: { disease: 'rage', every_days: 0, after_step: 's2' } };
    expect(computeProtocolReminders(zero, { birth_date: '2026-01-01' }, [{ protocol_step: 's2', disease: 'rage', event_date: '2026-04-01' }], '2026-06-01', diseases).some((x) => x.kind === 'recurrent')).toBe(false);
  });

  it('recurs from the last act of the disease when there is no anchor step', () => {
    const p: Protocol = { ...proto, steps: undefined as never, recurring: { disease: 'rage', every_days: 30, route: 'im' } };
    expect(computeProtocolReminders(p, { birth_date: '2026-01-01' }, [], '2026-02-01', diseases)).toEqual([]);
    const r = computeProtocolReminders(
      p,
      { birth_date: '2026-01-01' },
      [
        { disease: 'rage', event_date: '2026-01-10' },
        { disease: 'rage', event_date: '2026-01-20' },
      ],
      '2026-02-01',
      diseases,
    );
    expect(r).toEqual([expect.objectContaining({ step: 'rage_recurrent', due_date: '2026-02-19', route: 'im', status: 'a_venir' })]);
  });
});

describe('manual reminders (EF-VAC-04)', () => {
  it('creates one reminder for an act outside any protocol with next_due', () => {
    const events = [{ disease: 'toux', event_date: '2026-01-10T08:00:00Z', next_due: '2026-07-10' }];
    expect(computeManualReminders(events, '2026-07-11', diseases)).toEqual([
      { step: 'toux_manuel_2026-01-10', disease: 'toux', due_date: '2026-07-10', status: 'en_retard', priority: 'normale', kind: 'manuel' },
    ]);
  });

  it('ignores protocol acts, acts without next_due or disease, and superseded acts', () => {
    const events = [
      { protocol_step: 's1', disease: 'toux', event_date: '2026-01-01', next_due: '2026-02-01' },
      { disease: 'toux', event_date: '2026-01-02' },
      { disease: null, event_date: '2026-01-03', next_due: '2026-02-01' },
      { disease: 'rage', event_date: '2026-01-04', next_due: '2027-01-04' },
      { disease: 'rage', event_date: '2026-06-04', next_due: '2027-06-04' },
    ];
    expect(computeManualReminders(events, '2026-07-01', diseases).map((x) => x.step)).toEqual(['rage_manuel_2026-06-04']);
    expect(computeManualReminders(events, '2026-07-01', diseases)[0].priority).toBe('haute');
  });
});

describe('sortReminders', () => {
  it('orders by due date then keeps input order (stable)', () => {
    const mk = (step: string, due_date: string) => ({ step, disease: 'x', due_date, status: 'a_venir' as const, priority: 'normale' as const, kind: 'protocole' as const });
    expect(sortReminders([mk('b', '2026-02-01'), mk('a', '2026-01-01'), mk('c', '2026-02-01'), mk('d', '2026-01-01')]).map((x) => x.step)).toEqual(['a', 'd', 'b', 'c']);
  });
});

describe('notification plan (RG-NOT-01)', () => {
  const plan = { offsets_days: [0, -7, 3], channels: { '-7': ['app', 'sms'], '0': ['sms'], '3': ['whatsapp'] } };

  it('sorts offsets, filters paid channels without entitlement and falls back to the app', () => {
    expect(notificationPlan(plan, '2026-03-10', [])).toEqual([
      { offset: -7, send_date: '2026-03-03', channels: ['app'] },
      { offset: 0, send_date: '2026-03-10', channels: ['app'] },
      { offset: 3, send_date: '2026-03-13', channels: ['app'] },
    ]);
  });

  it('keeps sms and whatsapp with the entitlement or the wildcard', () => {
    expect(notificationPlan(plan, '2026-03-10', ['rappels_sms']).map((n) => n.channels)).toEqual([['app', 'sms'], ['sms'], ['whatsapp']]);
    expect(notificationPlan(plan, '2026-03-10', ['*']).map((n) => n.channels)).toEqual([['app', 'sms'], ['sms'], ['whatsapp']]);
  });

  it('defaults to the app when an offset has no channel list', () => {
    expect(notificationPlan({ offsets_days: [1], channels: {} }, '2026-03-10', [])).toEqual([{ offset: 1, send_date: '2026-03-11', channels: ['app'] }]);
  });
});
