import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/endpoints';
import type { Dashboard as DashboardData } from '../../api/types';
import { GaugeBar, HexMap, WeeklyChart } from '../../components/charts';
import { Card, Dialog, EmptyState, ErrorState, Seg, SeverityDot, Skeleton, SkeletonRows, useToast } from '../../components/ui';
import { DISEASE_LABEL, num, pct, shortWeek, since, weekCode, weekLabel } from '../../lib/format';
import { useAuth } from '../auth';
import { usePageMeta } from '../hooks';

type Filter = 'all' | 'volaille' | 'chien';

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  publie: { label: 'publié', cls: 'tone-ok' },
  en_revue: { label: 'en relecture', cls: 'tone-warn' },
  brouillon: { label: 'brouillon', cls: 'muted' },
  teste: { label: 'testé', cls: 'tone-blue' },
  retire: { label: 'retiré', cls: 'muted' },
};

export function KpiCards({ data }: { data: DashboardData }) {
  const k = data.kpis;
  const prevWeek = data.weekly.length > 1 ? shortWeek(data.weekly[data.weekly.length - 2].week) : 'S-1';
  const delta = k.confirmed_rate_delta_pts;
  return (
    <section aria-label="Indicateurs clés" className="kpi-grid">
      <div className="kpi">
        <span className="kpi-label">Rappels confirmés</span>
        <span className="kpi-value">{pct(k.confirmed_rate)}</span>
        <span className={`kpi-sub ${delta >= 0 ? 'tone-ok' : 'tone-crit'}`}>
          {delta >= 0 ? '+' : '−'}
          {num(Math.abs(delta), 1)} pts vs {prevWeek} · cible {pct(k.target_rate, 0)}
        </span>
      </div>
      <div className="kpi">
        <span className="kpi-label">Éleveurs actifs (7 j)</span>
        <span className="kpi-value">
          {num(k.active_farmers_7d)}
          <small> / {num(k.total_farmers)}</small>
        </span>
        <span className="kpi-sub">dont {num(k.farmers_without_smartphone)} sans smartphone (SMS, USSD)</span>
      </div>
      <div className="kpi">
        <span className="kpi-label">Rappels en retard</span>
        <span className={`kpi-value${k.overdue_reminders > 0 ? ' tone-warn' : ''}`}>{num(k.overdue_reminders)}</span>
        <span className="kpi-sub">
          {k.overdue_j3 > 0 ? (
            <>
              {num(k.overdue_j3)} à J+3 · <Link to="/admin/rappels?status=en_retard" className="quiet-link">tournée proposée</Link>
            </>
          ) : (
            'aucun rappel à J+3'
          )}
        </span>
      </div>
      <div className="kpi">
        <span className="kpi-label">Mortalité moyenne (bandes)</span>
        <span className="kpi-value">{pct(k.avg_mortality_pct)}</span>
        <span className={`kpi-sub${k.batches_over_threshold > 0 ? ' tone-crit' : ''}`}>
          {k.batches_over_threshold > 0
            ? `${k.batches_over_threshold} bande${k.batches_over_threshold > 1 ? 's' : ''} au-dessus du seuil de ${pct(k.mortality_threshold_pct ?? 5, 0)}`
            : `aucune bande au-dessus du seuil de ${pct(k.mortality_threshold_pct ?? 5, 0)}`}
        </span>
      </div>
    </section>
  );
}

export function CoverageCard({ data, title = 'Couverture par zone', id = 'map' }: { data: DashboardData; title?: string; id?: string }) {
  const c = data.coverage;
  return (
    <Card id={id} title={title} actions={<span className="card-meta">{c.disease_label ?? DISEASE_LABEL[c.disease] ?? c.disease} · {c.window_days ?? 30} j</span>}>
      {c.cells.length === 0 ? (
        <EmptyState title="Pas encore de données de couverture">Les zones apparaissent dès que 5 exploitations y ont confirmé un rappel.</EmptyState>
      ) : (
        <HexMap cells={c.cells} disease={DISEASE_LABEL[c.disease] ?? c.disease} />
      )}
      <div className="coverage-scale" aria-hidden="true">
        <span>&lt;50 %</span>
        <span className="grad" />
        <span>&gt;90 %</span>
      </div>
      <p className="note">Zones de moins de 5 exploitations masquées (k-anonymat).</p>
    </Card>
  );
}

function TodoTable({ data }: { data: DashboardData }) {
  const toast = useToast();
  const navigate = useNavigate();
  const act = (t: DashboardData['todo'][number]) => {
    if (t.farm_id && /vétérinaire|appeler/i.test(t.action)) navigate(`/admin/exploitations/${t.farm_id}`);
    else toast(`« ${t.action} » : demande enregistrée pour ${t.farm_name}.`, 'info');
  };
  return (
    <Card id="al" title="À traiter aujourd'hui" actions={<Link to="/admin/alertes" className="link">Tout voir</Link>}>
      {data.todo.length === 0 ? (
        <EmptyState title="Rien d'urgent aujourd'hui">Les rappels sont à jour et aucune alerte n'est ouverte. Profitez-en pour préparer la prochaine campagne.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table table-stack table-tight">
            <thead>
              <tr>
                <th scope="col">Gravité</th>
                <th scope="col">Exploitation</th>
                <th scope="col">Motif</th>
                <th scope="col">Depuis</th>
                <th scope="col">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.todo.map((t) => (
                <tr key={t.id}>
                  <td>
                    <SeverityDot severity={t.severity} />
                  </td>
                  <td>{t.farm_id ? <Link className="cell-link" to={`/admin/exploitations/${t.farm_id}`} style={{ fontWeight: 400 }}>{t.farm_name}</Link> : t.farm_name}</td>
                  <td className="soft">{t.reason}</td>
                  <td className="num">{since(t.since)}</td>
                  <td className="right">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => act(t)}>
                      {t.action}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function ParamsCard({ data }: { data: DashboardData }) {
  return (
    <Card id="pk" title="Paramétrage actif">
      <div className="list-rows">
        {data.params.map((p) => (
          <div key={p.pack}>
            <span className="mono">
              {p.pack}@{p.version}
            </span>
            <span className={STATUS_LABEL[p.status]?.cls}>{STATUS_LABEL[p.status]?.label ?? p.status}</span>
          </div>
        ))}
      </div>
      {data.pending_change && (
        <div className="pending">
          {data.pending_change.summary}
          {data.pending_change.reviewer_name && !data.pending_change.summary.includes(data.pending_change.reviewer_name) && (
            <>
              {' '}
              Relecture demandée à <b>{data.pending_change.reviewer_name}</b>.
            </>
          )}
        </div>
      )}
      <div style={{ marginTop: 4 }}>
        <GaugeBar label="SMS consommés ce mois" value={data.sms.used} max={data.sms.quota} />
      </div>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <>
      <div className="kpi-grid" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="kpi">
            <Skeleton w="55%" h={12} />
            <Skeleton w="45%" h={34} />
            <Skeleton w="70%" h={10} />
          </div>
        ))}
      </div>
      <div className="grid-main">
        <div className="card">
          <Skeleton w="50%" h={14} />
          <Skeleton h={220} r={12} />
        </div>
        <div className="card">
          <Skeleton w="40%" h={14} />
          <Skeleton h={220} r={12} />
        </div>
      </div>
      <div className="grid-main">
        <div className="card">
          <SkeletonRows rows={4} cols={5} />
        </div>
        <div className="card">
          <SkeletonRows rows={4} cols={2} />
        </div>
      </div>
    </>
  );
}

export default function Dashboard() {
  usePageMeta('Tableau de bord', weekLabel());
  const { orgId } = useAuth();
  const [filter, setFilter] = useState<Filter>('all');
  const [v2, setV2] = useState(false);
  const q = useQuery({
    queryKey: ['dashboard', orgId, filter],
    queryFn: () => api.dashboard(orgId!, { week: weekCode(), speculation: filter === 'all' ? undefined : filter }),
    enabled: !!orgId,
    placeholderData: keepPreviousData,
  });

  if (!orgId)
    return (
      <EmptyState title="Aucune organisation rattachée à ce compte" action={<Link to="/admin/studio" className="btn btn-primary">Ouvrir le studio</Link>}>
        Le tableau de bord consolidé est réservé aux administrateurs d'une Structure. Votre compte donne accès au studio de paramétrage.
      </EmptyState>
    );

  return (
    <>
      <div className="dash-toolbar">
        <Seg<Filter>
          label="Filière"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Toutes filières' },
            { value: 'volaille', label: 'Volaille' },
            { value: 'chien', label: 'Canin' },
          ]}
        />
        <button type="button" className="btn btn-primary" onClick={() => setV2(true)}>
          Nouvelle campagne
        </button>
      </div>

      {q.isLoading ? (
        <DashboardSkeleton />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data ? (
        <div className="stack" style={{ gap: 22, opacity: q.isPlaceholderData ? 0.6 : 1, transition: 'opacity .2s' }} aria-busy={q.isFetching}>
          <KpiCards data={q.data} />
          <div className="grid-main">
            <Card id="ch" title="Rappels dus et confirmés, 12 dernières semaines" actions={
              <div className="chart-legend" aria-hidden="true">
                <span><span className="lg-line" />confirmés</span>
                <span><span className="lg-dash" />dus</span>
              </div>
            }>
              {q.data.weekly.length ? <WeeklyChart data={q.data.weekly} /> : <EmptyState title="Pas encore d'historique">La courbe apparaît après la première semaine de rappels.</EmptyState>}
            </Card>
            <CoverageCard data={q.data} />
          </div>
          <div className="grid-main">
            <TodoTable data={q.data} />
            <ParamsCard data={q.data} />
          </div>
          <p className="footnote">
            {import.meta.env.VITE_MOCK === '1' ? 'Données fictives à des fins d\'illustration.' : `Données arrêtées à ${new Date(q.dataUpdatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.`}
          </p>
        </div>
      ) : null}

      <Dialog
        open={v2}
        onClose={() => setV2(false)}
        title="Campagnes : disponible en V2"
        footer={
          <>
            <Link to="/admin/campagnes" className="btn btn-ghost" onClick={() => setV2(false)}>
              Voir ce qui est prévu
            </Link>
            <button type="button" className="btn btn-primary" onClick={() => setV2(false)} data-autofocus>
              Compris
            </button>
          </>
        }
      >
        <p>
          Les campagnes de vaccination (ciblage par zone et par filière, convocations SMS, suivi de la couverture en direct) arrivent avec la V2. En attendant, la tournée des rappels en retard se pilote depuis l'écran <Link to="/admin/rappels" onClick={() => setV2(false)}>Rappels</Link>.
        </p>
      </Dialog>
    </>
  );
}
