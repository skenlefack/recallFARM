import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { api, listOf } from '../../api/endpoints';
import { IconPaw } from '../../components/icons';
import { Card, EmptyState, ErrorState, Pill, Skeleton, SkeletonRows } from '../../components/ui';
import { dateShort, money, num, phone, since, SPECULATION_LABEL } from '../../lib/format';
import { usePageMeta } from '../hooks';
import { ReminderTable } from './Reminders';

const RABIES: Record<string, { tone: 'ok' | 'crit' | 'neutral'; label: string }> = {
  a_jour: { tone: 'ok', label: 'Rage à jour' },
  expire: { tone: 'crit', label: 'Rage expirée' },
  inconnu: { tone: 'neutral', label: 'Rage inconnue' },
};
const KPI_TONE: Record<string, string> = { ok: '', amber: ' tone-warn', red: ' tone-crit' };

export default function FarmDetail() {
  const { id = '' } = useParams();
  const farm = useQuery({ queryKey: ['farm', id], queryFn: () => api.farm(id) });
  const owner = farm.data?.owner_name ?? farm.data?.manager_name ?? null;
  const place = farm.data ? [farm.data.locality, farm.data.region].filter(Boolean).join(', ') : '';
  usePageMeta(farm.data?.name ?? 'Exploitation', farm.data ? [owner, place].filter(Boolean).join(' · ') || 'Fiche exploitation' : 'Fiche exploitation');
  const batches = useQuery({ queryKey: ['batches', id], queryFn: () => api.batches(id), select: listOf });
  const dogs = useQuery({ queryKey: ['dogs', id], queryFn: () => api.dogs(id), select: listOf });
  const kpis = useQuery({ queryKey: ['farm-kpis', id], queryFn: () => api.farmKpis(id, '7d') });
  const logs = useQuery({ queryKey: ['logs', id], queryFn: () => api.dailyLogs(id), select: listOf });
  const reminders = useQuery({ queryKey: ['reminders', { farm_id: id }], queryFn: () => api.reminders({ farm_id: id, status: 'en_retard,aujourdhui,a_venir' }), select: listOf });

  if (farm.isError)
    return (
      <>
        <nav className="breadcrumb" aria-label="Fil d'Ariane">
          <Link to="/admin/exploitations">Exploitations</Link>
        </nav>
        {farm.error instanceof ApiError && farm.error.status === 404 ? (
          <EmptyState title="Exploitation introuvable" action={<Link to="/admin/exploitations" className="btn btn-primary">Retour à la liste</Link>}>
            Elle a peut-être été retirée de l'organisation.
          </EmptyState>
        ) : (
          <ErrorState error={farm.error} onRetry={() => farm.refetch()} />
        )}
      </>
    );

  const f = farm.data;
  return (
    <>
      <nav className="breadcrumb" aria-label="Fil d'Ariane">
        <Link to="/admin/exploitations">Exploitations</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{f?.name ?? '…'}</span>
      </nav>

      <div className="farm-head">
        {f ? (
          <div className="stack" style={{ gap: 6 }}>
            <h2>{f.name}</h2>
            {(owner || f.owner_phone) && (
              <span className="muted">
                {owner}
                {f.owner_phone && (
                  <>
                    {owner ? ' · ' : ''}
                    <span className="mono">{phone(f.owner_phone)}</span>
                  </>
                )}
                {f.has_smartphone === false && ' · sans smartphone (SMS, USSD)'}
              </span>
            )}
            <div className="tags">
              {f.speculations.map((s) => (
                <Pill key={s} tone="blue">
                  {SPECULATION_LABEL[s] ?? s}
                </Pill>
              ))}
              {place && <Pill>{place}</Pill>}
              {f.last_sync_at !== undefined && (
                <Pill tone={f.last_sync_at && Date.now() - Date.parse(f.last_sync_at) < 48 * 3600e3 ? 'ok' : 'warn'}>
                  synchro {f.last_sync_at ? `il y a ${since(f.last_sync_at)}` : 'jamais'}
                </Pill>
              )}
            </div>
          </div>
        ) : (
          <div className="stack" style={{ gap: 8, width: 320 }}>
            <Skeleton h={28} w="80%" />
            <Skeleton h={14} w="60%" />
          </div>
        )}
        {f?.owner_phone && (
          <a href={`tel:${f.owner_phone}`} className="btn btn-ghost">
            Appeler l'éleveur
          </a>
        )}
      </div>

      <section className="kpi-grid" aria-label="Indicateurs de la semaine">
        {kpis.isLoading &&
          [0, 1, 2, 3].map((i) => (
            <div key={i} className="kpi">
              <Skeleton w="60%" h={12} />
              <Skeleton w="40%" h={30} />
            </div>
          ))}
        {kpis.isError && (
          <div style={{ gridColumn: '1 / -1' }}>
            <ErrorState compact error={kpis.error} onRetry={() => kpis.refetch()} />
          </div>
        )}
        {kpis.data?.kpis.map((k) => (
          <div key={k.code + (k.subject_name ?? '')} className="kpi">
            <span className="kpi-label">
              {k.label}
              {k.subject_name && ` · ${k.subject_name}`}
            </span>
            <span className={`kpi-value${KPI_TONE[k.status ?? 'ok'] ?? ''}`}>
              {typeof k.value === 'number' ? num(k.value, Number.isInteger(k.value) ? 0 : 1) : (k.value ?? '—')}
              {k.unit && <small> {k.unit}</small>}
            </span>
            <span className="kpi-sub">7 derniers jours</span>
          </div>
        ))}
        {kpis.data?.margin && (
          <div className="kpi">
            <span className="kpi-label">Marge du mois</span>
            <span className={`kpi-value${kpis.data.margin.margin.amount_minor < 0 ? ' tone-crit' : ''}`} style={{ fontSize: 26 }}>
              {money(kpis.data.margin.margin.amount_minor, kpis.data.margin.margin.currency)}
            </span>
            <span className="kpi-sub">
              ventes {money(kpis.data.margin.revenue.amount_minor)} · dépenses {money(kpis.data.margin.expenses.amount_minor)}
            </span>
          </div>
        )}
      </section>

      <div className="grid-main">
        <Card id="rem" title="Rappels ouverts" actions={<Link to="/admin/rappels" className="link">Tous les rappels</Link>}>
          {reminders.isLoading ? (
            <SkeletonRows rows={3} cols={4} />
          ) : reminders.isError ? (
            <ErrorState error={reminders.error} onRetry={() => reminders.refetch()} />
          ) : reminders.data?.length ? (
            <ReminderTable rows={reminders.data} showFarm={false} />
          ) : (
            <EmptyState title="Aucun rappel ouvert">Tous les actes sanitaires de cette exploitation sont à jour.</EmptyState>
          )}
        </Card>
        <div className="stack">
          <Card id="cheptel" title="Cheptel">
            {batches.isLoading || dogs.isLoading ? (
              <SkeletonRows rows={2} cols={2} />
            ) : batches.isError || dogs.isError ? (
              <ErrorState compact error={batches.error ?? dogs.error} onRetry={() => (batches.refetch(), dogs.refetch())} />
            ) : !batches.data?.length && !dogs.data?.length ? (
              <EmptyState title="Aucun animal enregistré">L'éleveur n'a pas encore saisi de lot ni de chien.</EmptyState>
            ) : (
              <div className="subject-list">
                {batches.data?.map((b) => (
                  <div key={b.id} className="subject">
                    <span className="subject-badge">{b.name}</span>
                    <div>
                      <b>
                        Bande {b.name} · {b.production_type === 'ponte' ? 'pondeuses' : b.production_type === 'chair' ? 'poulets de chair' : b.production_type}
                      </b>
                      <div className="muted">
                        {num(b.current_count)} sujets sur {num(b.initial_count)} · depuis le {dateShort(b.start_date)}
                        {typeof b.attributes?.strain === 'string' && ` · ${b.attributes.strain}`}
                      </div>
                    </div>
                  </div>
                ))}
                {dogs.data?.map((d) => (
                  <div key={d.id} className="subject">
                    <span className="subject-badge" aria-hidden="true">
                      <IconPaw size={18} />
                    </span>
                    <div>
                      <b>
                        « {d.name} » · {d.breed ?? 'race inconnue'}
                      </b>
                      <div className="muted">
                        {d.sex === 'M' ? 'Mâle' : 'Femelle'}
                        {d.chip_number && (
                          <>
                            {' '}
                            · puce <span className="mono">{d.chip_number}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <Pill tone={RABIES[d.rabies_status]?.tone}>
                      {RABIES[d.rabies_status]?.label}
                      {d.rabies_valid_until && d.rabies_status === 'a_jour' && ` · ${dateShort(d.rabies_valid_until, false)}`}
                    </Pill>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <Card id="logs" title="Journal récent" actions={<span className="card-meta">10 dernières saisies</span>}>
        {logs.isLoading ? (
          <SkeletonRows rows={4} cols={6} />
        ) : logs.isError ? (
          <ErrorState error={logs.error} onRetry={() => logs.refetch()} />
        ) : !logs.data?.length ? (
          <EmptyState title="Aucune saisie récente">Le journal du jour se remplit depuis l'application mobile, même hors ligne.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Sujet</th>
                  <th scope="col">Présents</th>
                  <th scope="col">Morts</th>
                  <th scope="col">Œufs</th>
                  <th scope="col">Aliment</th>
                  <th scope="col">Notes</th>
                </tr>
              </thead>
              <tbody>
                {logs.data.slice(0, 10).map((l) => (
                  <tr key={l.id}>
                    <td className="num">{dateShort(l.log_date, false)}</td>
                    <td>{l.subject_name ?? l.subject_type}</td>
                    <td className="num">{num(l.present_count)}</td>
                    <td className={`num${(l.mortality ?? 0) >= 3 ? ' tone-crit' : ''}`}>{num(l.mortality)}</td>
                    <td className="num">{l.eggs == null ? '—' : num(l.eggs)}</td>
                    <td className="num">{l.feed_kg == null ? '—' : `${num(l.feed_kg)} kg`}</td>
                    <td className="soft">{l.notes ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
