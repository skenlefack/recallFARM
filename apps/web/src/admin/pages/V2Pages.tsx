import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { coverageColor } from '../../components/charts';
import { Card, EmptyState, ErrorState, Pill, Seg, Skeleton, SkeletonRows } from '../../components/ui';
import { asPercent, DISEASE_LABEL, num, weekCode } from '../../lib/format';
import { useAuth } from '../auth';
import { usePageMeta } from '../hooks';
import { CoverageCard } from './Dashboard';

export function Campaigns() {
  usePageMeta('Campagnes', 'Prévu en V2');
  return (
    <>
      <section className="v2-hero" aria-labelledby="v2-title">
        <div>
          <span className="v2-tag">PRÉVU EN V2</span>
          <h2 id="v2-title">Les campagnes de vaccination arrivent bientôt.</h2>
          <p>
            Aujourd'hui, RecallFarm programme les rappels exploitation par exploitation. Avec les campagnes, votre coopérative pourra lancer une opération collective (Newcastle avant la saison des pluies, rage autour d'un foyer) et suivre la couverture zone par zone.
          </p>
        </div>
        <Link to="/admin/rappels?status=en_retard" className="btn btn-ghost" style={{ background: '#fff' }}>
          Traiter les rappels en retard
        </Link>
      </section>
      <Card id="what" title="Ce que fera l'écran Campagnes">
        <ul className="feature-list">
          <li>
            <b>Ciblage</b>
            <span>Par zone, filière, type de production et âge des lots, avec le nombre d'animaux concernés avant envoi.</span>
          </li>
          <li>
            <b>Convocations</b>
            <span>SMS, USSD et WhatsApp aux éleveurs, y compris sans smartphone, avec date, lieu et prix du vaccin.</span>
          </li>
          <li>
            <b>Équipes de terrain</b>
            <span>Répartition des exploitations entre agents et vétérinaires, tournées optimisées, saisie hors ligne.</span>
          </li>
          <li>
            <b>Suivi en direct</b>
            <span>Couverture atteinte par zone, stocks de vaccins consommés, exploitations à relancer.</span>
          </li>
          <li>
            <b>Bilan</b>
            <span>Rapport agrégé et anonymisé, exportable vers DHIS2 et ARIS pour les services vétérinaires.</span>
          </li>
        </ul>
      </Card>
      <p className="footnote">Vous souhaitez piloter la première campagne avec nous ? Écrivez à aide@recallfarm.app.</p>
    </>
  );
}

type Sort = 'rate' | 'zone';

export function Surveillance() {
  usePageMeta('Surveillance', 'Couverture vaccinale par zone · V2 en préparation');
  const { orgId } = useAuth();
  const [spec, setSpec] = useState<'volaille' | 'chien'>('volaille');
  const [sort, setSort] = useState<Sort>('rate');
  const q = useQuery({
    queryKey: ['dashboard', orgId, spec],
    queryFn: () => api.dashboard(orgId!, { week: weekCode(), speculation: spec }),
    enabled: !!orgId,
  });
  const cells = useMemo(() => {
    const c = [...(q.data?.coverage.cells ?? [])];
    return c.sort((a, b) => (sort === 'zone' ? a.zone.localeCompare(b.zone, 'fr') : (a.rate ?? 2) - (b.rate ?? 2)));
  }, [q.data, sort]);

  if (!orgId) return <EmptyState title="Aucune organisation">Ce compte n'administre pas de Structure.</EmptyState>;

  const visible = cells.filter((c) => !c.masked && c.rate !== null);
  const low = visible.filter((c) => asPercent(c.rate!) < 70).length;

  return (
    <>
      <div className="toolbar">
        <Seg
          label="Filière"
          value={spec}
          onChange={setSpec}
          options={[
            { value: 'volaille', label: 'Volaille · Newcastle' },
            { value: 'chien', label: 'Canin · rage' },
          ]}
        />
        <Pill tone="blue">Aperçu V2</Pill>
      </div>
      {q.isLoading ? (
        <div className="grid-main">
          <div className="card">
            <SkeletonRows rows={6} cols={4} />
          </div>
          <div className="card">
            <Skeleton h={240} r={12} />
          </div>
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data ? (
        <div className="grid-main">
          <Card
            id="zones"
            title={`Couverture ${DISEASE_LABEL[q.data.coverage.disease] ?? q.data.coverage.disease} par zone`}
            actions={
              <Seg<Sort>
                label="Tri"
                value={sort}
                onChange={setSort}
                options={[
                  { value: 'rate', label: 'Plus faibles' },
                  { value: 'zone', label: 'A → Z' },
                ]}
              />
            }
          >
            <p className="muted small">
              {visible.length} zones publiées · {low} sous 70 % · {cells.length - visible.length} masquée{cells.length - visible.length > 1 ? 's' : ''} (moins de 5 exploitations).
            </p>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Zone</th>
                    <th scope="col">Exploitations</th>
                    <th scope="col">Couverture ({q.data.coverage.window_days ?? 30} j)</th>
                    <th scope="col" style={{ width: '34%' }}>
                      <span className="sr-only">Jauge</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {cells.map((c) => (
                    <tr key={c.zone}>
                      <td>{c.zone}</td>
                      <td className="num">{c.masked ? '< 5' : num(c.farms ?? null)}</td>
                      <td className="num">{c.masked || c.rate === null ? 'masquée' : `${Math.round(asPercent(c.rate))} %`}</td>
                      <td>
                        {!c.masked && c.rate !== null && (
                          <div className="bar" aria-hidden="true">
                            <span style={{ width: `${asPercent(c.rate)}%`, background: coverageColor(c.rate) }} />
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <div className="stack">
            <CoverageCard data={q.data} title="Carte" id="smap" />
            <Card id="next" title="Bientôt dans Surveillance">
              <ul className="help-list muted">
                <li>Carte de la rage et des foyers déclarés</li>
                <li>Signalements de suspicion transmis aux services vétérinaires</li>
                <li>Exports DHIS2 et ARIS, données agrégées et consenties</li>
              </ul>
            </Card>
          </div>
        </div>
      ) : null}
    </>
  );
}
