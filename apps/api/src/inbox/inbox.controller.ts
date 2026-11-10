import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DataSource, In, LessThanOrEqual } from 'typeorm';
import { ALERT_OPEN } from '../alerts/alerts.service';
import { AccessService } from '../common/access.service';
import { AuthUser, CurrentUser } from '../common/auth';
import { addDays, todayIn } from '../common/dates';
import { AlertEvent, Reminder, Task } from '../database/entities';
import { InboxQuery } from '../health/dto';
import { OPEN_STATUSES, RemindersService } from '../health/reminders.service';
import { ParamsService } from '../params/params.service';
import { StockSalesService } from '../stock-sales/stock-sales.service';

/** GET /inbox — home screen: today, upcoming, alerts, tasks, week KPIs (05 §Ajouts v2.2). */
@ApiTags('inbox')
@ApiBearerAuth()
@Controller('inbox')
export class InboxController {
  constructor(
    private readonly ds: DataSource,
    private readonly access: AccessService,
    private readonly reminders: RemindersService,
    private readonly stock: StockSalesService,
    private readonly params: ParamsService,
  ) {}

  @Get()
  async inbox(@CurrentUser() user: AuthUser, @Query() q: InboxQuery) {
    const farm = await this.access.farm(user, q.farm_id);
    const today = todayIn();
    const resolved = await this.params.resolveFarm(farm);
    const open = await this.ds.getRepository(Reminder).find({
      where: { farm_id: farm.id, status: In(OPEN_STATUSES), due_date: LessThanOrEqual(addDays(today, 14)) },
      order: { due_date: 'ASC' },
    });
    const prio = (p: string) => (p === 'critique' ? 0 : p === 'haute' ? 1 : 2);
    const label = (r: Reminder) => ({ ...this.reminders.serialize(r, today), disease_label: this.params.label(resolved, r.disease) });
    const todayList = open
      .filter((r) => r.due_date <= today && (!r.snoozed_until || r.snoozed_until <= today))
      .sort((a, b) => prio(a.priority) - prio(b.priority) || a.due_date.localeCompare(b.due_date))
      .map(label);
    const upcoming = open.filter((r) => r.due_date > today).map(label);
    const alerts = await this.ds.getRepository(AlertEvent).find({ where: { farm_id: farm.id, status: In(ALERT_OPEN) }, order: { opened_at: 'DESC' }, take: 20 });
    const tasks = await this.ds.getRepository(Task).find({
      where: { farm_id: farm.id, status: 'a_faire', due_date: LessThanOrEqual(addDays(today, 7)) },
      order: { due_date: 'ASC' },
    });

    // Week KPIs: laying rate (daily trend) and month margin.
    const trendRows: Array<{ d: string; eggs: number | null; present: number | null }> = await this.ds.query(
      `SELECT l.log_date::text AS d, sum(l.eggs)::float AS eggs, sum(l.present_count)::float AS present
         FROM daily_logs l JOIN batches b ON b.id = l.subject_id
        WHERE l.farm_id = $1 AND l.deleted_at IS NULL AND b.production_type = 'ponte' AND l.log_date > $2::date - 7
        GROUP BY 1 ORDER BY 1`,
      [farm.id, today],
    );
    const week_kpis: Array<{ code: string; label: string; value: number | null; unit: string; trend: number[]; delta_pct?: number | null }> = [];
    if (trendRows.length) {
      const trend = trendRows.map((r) => (r.present ? Math.round(((r.eggs ?? 0) / r.present) * 1000) / 10 : 0));
      const eggs = trendRows.reduce((s, r) => s + (r.eggs ?? 0), 0);
      const present = trendRows.reduce((s, r) => s + (r.present ?? 0), 0);
      week_kpis.push({ code: 'taux_ponte', label: this.params.label(resolved, 'taux_ponte'), value: present ? Math.round((eggs / present) * 1000) / 10 : null, unit: '%', trend });
    }
    const margin = await this.stock.monthMargin(farm);
    const prevMonth = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
    const prev = await this.stock.monthMargin(farm, prevMonth);
    const prevVal = prev.margin.amount_minor;
    week_kpis.push({
      code: 'marge_mois',
      label: 'Marge du mois',
      value: margin.margin.amount_minor,
      unit: farm.currency,
      trend: [prevVal, margin.margin.amount_minor],
      delta_pct: prevVal ? Math.round(((margin.margin.amount_minor - prevVal) / Math.abs(prevVal)) * 100) : null,
    });
    return {
      farm: { id: farm.id, name: farm.name, currency: farm.currency },
      today: todayList,
      upcoming,
      alerts,
      tasks,
      week_kpis,
    };
  }
}
