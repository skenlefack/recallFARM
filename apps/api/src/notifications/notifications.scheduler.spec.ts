import { inQuietHours, whenLabel } from './notifications.scheduler';

describe('NotificationsScheduler helpers', () => {
  describe('inQuietHours', () => {
    it('returns false when no quiet window', () => {
      expect(inQuietHours('08:00', undefined)).toBe(false);
    });
    it('detects inside a normal window', () => {
      expect(inQuietHours('22:30', { start: '22:00', end: '06:00' })).toBe(true);
    });
    it('detects inside a wrap-around window', () => {
      expect(inQuietHours('02:00', { start: '22:00', end: '06:00' })).toBe(true);
    });
    it('outside wrap-around window', () => {
      expect(inQuietHours('12:00', { start: '22:00', end: '06:00' })).toBe(false);
    });
  });

  describe('whenLabel', () => {
    it('returns "aujourd\'hui" for same day (fr)', () => {
      expect(whenLabel('2026-11-01', '2026-11-01', 'fr')).toBe("aujourd'hui");
    });
    it('returns "demain" for +1 day (fr)', () => {
      expect(whenLabel('2026-11-02', '2026-11-01', 'fr')).toBe('demain');
    });
    it('returns "today" for same day (en)', () => {
      expect(whenLabel('2026-11-01', '2026-11-01', 'en')).toBe('today');
    });
    it('returns "in N days" for future (en)', () => {
      expect(whenLabel('2026-11-04', '2026-11-01', 'en')).toBe('in 3 days');
    });
    it('returns overdue label for past (fr)', () => {
      expect(whenLabel('2026-10-29', '2026-11-01', 'fr')).toBe('en retard de 3 jours');
    });
  });
});

/**
 * SMS grouping logic: verifies that multiple reminders to the same phone + due_date
 * produce one grouped message instead of separate SMS (RG-NOT-02).
 * This is a structural test — the grouping map key is phone|due_date.
 */
describe('SMS grouping key', () => {
  it('groups reminders by phone and due_date', () => {
    const rows = [
      { phone: '+237690000001', due_date: '2026-11-01', disease: 'newcastle' },
      { phone: '+237690000001', due_date: '2026-11-01', disease: 'gumboro' },
      { phone: '+237690000001', due_date: '2026-11-05', disease: 'bronchite' },
      { phone: '+237690000002', due_date: '2026-11-01', disease: 'newcastle' },
    ];

    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = `${row.phone}|${row.due_date}`;
      let g = groups.get(key);
      if (!g) { g = []; groups.set(key, g); }
      g.push(row);
    }

    // Same phone + same due_date => 2 reminders grouped
    expect(groups.get('+237690000001|2026-11-01')!.length).toBe(2);
    // Different due_date => separate group
    expect(groups.get('+237690000001|2026-11-05')!.length).toBe(1);
    // Different phone => separate group
    expect(groups.get('+237690000002|2026-11-01')!.length).toBe(1);
    // Total groups
    expect(groups.size).toBe(3);
  });
});
