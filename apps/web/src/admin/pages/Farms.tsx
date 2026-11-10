import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { api, listOf } from '../../api/endpoints';
import { HSearch } from '../../components/icons';
import { EmptyState, ErrorState, Pill, SkeletonRows } from '../../components/ui';
import { num, phone, since, SPECULATION_LABEL } from '../../lib/format';
import { useAuth } from '../auth';
import { usePageMeta } from '../hooks';

export function useDebounced<T>(v: T, ms = 300): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

export default function Farms() {
  usePageMeta('Exploitations', 'Éleveurs suivis par la Structure');
  const { orgId, me } = useAuth();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  useEffect(() => setQ(params.get('q') ?? ''), [params]);
  const dq = useDebounced(q.trim());

  const farms = useQuery({
    queryKey: ['org-farms', orgId, dq],
    queryFn: () => api.orgFarms(orgId!, dq || undefined),
    select: listOf,
    enabled: !!orgId,
    placeholderData: keepPreviousData,
  });

  if (!orgId)
    return me?.farms.length ? (
      <section className="card" aria-label="Mes exploitations">
        <div className="list-rows">
          {me.farms.map((f) => (
            <div key={f.id}>
              <Link to={`/admin/exploitations/${f.id}`} className="cell-link">
                {f.name}
              </Link>
              <span className="muted small">exploitation personnelle</span>
            </div>
          ))}
        </div>
      </section>
    ) : (
      <EmptyState title="Aucune exploitation">Ce compte n'administre pas de Structure et ne possède pas d'exploitation.</EmptyState>
    );

  const list = farms.data ?? [];
  return (
    <>
      <div className="toolbar">
        <div className="search-box">
          <HSearch size={15} />
          <label htmlFor="farm-q" className="sr-only">
            Rechercher une exploitation
          </label>
          <input
            id="farm-q"
            type="search"
            placeholder="Nom, éleveur, zone ou téléphone"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setParams(e.target.value ? { q: e.target.value } : {}, { replace: true });
            }}
          />
        </div>
        <span className="muted" aria-live="polite">
          {farms.isSuccess && `${num(list.length)} exploitation${list.length > 1 ? 's' : ''}${dq ? ` pour « ${dq} »` : ''}`}
        </span>
      </div>
      <section className="card card-flush" aria-label="Liste des exploitations">
        {farms.isLoading ? (
          <div style={{ padding: 20 }}>
            <SkeletonRows rows={8} cols={6} />
          </div>
        ) : farms.isError ? (
          <div style={{ padding: 20 }}>
            <ErrorState error={farms.error} onRetry={() => farms.refetch()} />
          </div>
        ) : list.length === 0 ? (
          dq ? (
            <EmptyState title="Aucune exploitation ne correspond" action={<button type="button" className="btn btn-ghost" onClick={() => (setQ(''), setParams({}))}>Effacer la recherche</button>}>
              Essayez le nom de l'éleveur, une localité ou les derniers chiffres du téléphone.
            </EmptyState>
          ) : (
            <EmptyState title="Aucune exploitation suivie" action={<Link to="/admin/exports" className="btn btn-primary">Importer des éleveurs</Link>}>
              Importez la liste de vos membres en CSV pour démarrer le suivi.
            </EmptyState>
          )
        ) : (
          <div className="table-wrap">
            <table className="table table-boxed table-stack" style={{ opacity: farms.isPlaceholderData ? 0.6 : 1 }}>
              <thead>
                <tr>
                  <th scope="col">Exploitation</th>
                  <th scope="col">Zone</th>
                  <th scope="col">Filières</th>
                  <th scope="col">Rappels</th>
                  <th scope="col">Alertes</th>
                  <th scope="col">Dernière synchro</th>
                </tr>
              </thead>
              <tbody>
                {list.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <Link to={`/admin/exploitations/${f.id}`} className="cell-link">
                        {f.name}
                      </Link>
                      <span className="cell-sub">
                        {f.owner_name} · <span className="mono">{phone(f.owner_phone)}</span>
                        {f.has_smartphone === false && ' · SMS/USSD'}
                      </span>
                    </td>
                    <td className="soft">{f.locality ?? f.region?.replace(/^Centre · /, '') ?? '—'}</td>
                    <td>
                      <div className="tags">
                        {f.speculations.map((s) => (
                          <Pill key={s} tone="blue">
                            {SPECULATION_LABEL[s] ?? s}
                          </Pill>
                        ))}
                      </div>
                    </td>
                    <td className="num">
                      {num(f.open_reminders ?? 0)}
                      {!!f.overdue_reminders && <span className="tone-warn"> · {num(f.overdue_reminders)} en retard</span>}
                    </td>
                    <td>{f.open_alerts ? <Pill tone="crit">{f.open_alerts} ouverte{f.open_alerts > 1 ? 's' : ''}</Pill> : <span className="muted">—</span>}</td>
                    <td className="num">{f.last_sync_at ? `il y a ${since(f.last_sync_at)}` : 'jamais'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
