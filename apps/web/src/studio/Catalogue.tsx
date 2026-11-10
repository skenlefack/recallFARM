/** S01 — Catalogue des packs. */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, listOf } from '../api/endpoints';
import type { PackLevel, StudioPack } from '../api/types';
import { IconBack, IconFarm, IconGlobe, IconPackages, IconPaw, IconUsers } from '../components/icons';
import { EmptyState, ErrorState, FieldErrors, Pill, SkeletonRows } from '../components/ui';
import { num, since } from '../lib/format';
import { StudioShell, STATUS_CHIP } from './StudioShell';
import { useDocumentTitle } from '../pages/public/SiteChrome';

const LEVELS: { value: PackLevel | 'all'; label: string; icon: React.ReactNode }[] = [
  { value: 'all', label: 'Tous les packs', icon: <IconPackages /> },
  { value: 'global', label: 'Global', icon: <IconGlobe /> },
  { value: 'filiere', label: 'Filières', icon: <IconPaw /> },
  { value: 'pays', label: 'Pays', icon: <IconFarm /> },
  { value: 'org', label: 'Organisations', icon: <IconUsers /> },
];
const LEVEL_LABEL: Record<string, string> = { global: 'global', filiere: 'filière', pays: 'pays', org: 'organisation', ferme: 'ferme' };

/**
 * /admin/studio → open the most relevant pack: a draft being written, otherwise the country pack (it holds the
 * vaccination protocols, as in the design), otherwise any pack with an open version.
 */
export function pickDefaultPack(packs: StudioPack[]): StudioPack | undefined {
  return (
    packs.find((p) => p.draft?.status === 'brouillon' && p.level !== 'org') ??
    packs.find((p) => p.level === 'pays') ??
    packs.find((p) => p.draft) ??
    packs[0]
  );
}

export function StudioIndex() {
  const packs = useQuery({ queryKey: ['studio-packs'], queryFn: api.studioPacks, select: listOf });
  if (packs.isLoading) return <StudioShell crumbs={<span>Packs</span>} nav={null} main={<SkeletonRows rows={6} cols={4} />} />;
  if (packs.isError) return <StudioShell crumbs={<span>Packs</span>} nav={null} main={<ErrorState error={packs.error} onRetry={() => packs.refetch()} />} />;
  const p = pickDefaultPack(packs.data ?? []);
  if (!p) return <Navigate to="/admin/studio/packs" replace />;
  return <Navigate to={p.draft && p.draft.status === 'brouillon' ? `/admin/studio/v/${p.draft.id}/protocoles` : `/admin/studio/p/${p.code}`} replace />;
}

/** /admin/studio/p/:code → the open version of a pack, or its latest published one. */
export function OpenPack() {
  const { code = '' } = useParams();
  const versions = useQuery({ queryKey: ['studio-versions', code], queryFn: () => api.packVersions(code), select: listOf });
  if (versions.isLoading) return <StudioShell crumbs={<span>Packs</span>} nav={null} main={<SkeletonRows rows={6} cols={4} />} />;
  if (versions.isError) return <StudioShell crumbs={<span>Packs</span>} nav={null} main={<ErrorState error={versions.error} onRetry={() => versions.refetch()} />} />;
  const list = versions.data ?? [];
  const open = list.find((v) => ['brouillon', 'en_revue', 'teste'].includes(v.status));
  const pub = [...list].reverse().find((v) => v.status === 'publie') ?? list[list.length - 1];
  const v = open ?? pub;
  if (!v) return <Navigate to="/admin/studio/packs" replace />;
  return <Navigate to={`/admin/studio/v/${v.id}/protocoles`} replace />;
}

export default function Catalogue() {
  useDocumentTitle('Catalogue des packs · Studio RecallFarm');
  const [params, setParams] = useSearchParams();
  const level = (params.get('niveau') as PackLevel | 'all') ?? 'all';
  const onlyReview = params.get('statut') === 'en_revue';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const packs = useQuery({ queryKey: ['studio-packs'], queryFn: api.studioPacks, select: listOf });
  const [creating, setCreating] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: (code: string) => api.createDraft(code),
    onSuccess: (v) => {
      qc.invalidateQueries({ queryKey: ['studio-packs'] });
      navigate(`/admin/studio/v/${v.id}/protocoles`);
    },
    onSettled: () => setCreating(null),
  });

  const rows = (packs.data ?? []).filter((p) => (level === 'all' || p.level === level) && (!onlyReview || p.draft?.status === 'en_revue'));
  const counts = (lv: string) => (packs.data ?? []).filter((p) => lv === 'all' || p.level === lv).length;

  const nav = (
    <>
      <span className="nav-group" style={{ margin: '0 4px' }}>
        NIVEAUX
      </span>
      <ul className="tiles">
        {LEVELS.map((l) => (
          <li key={l.value} className={l.value === 'all' ? 'span2' : undefined}>
            <button type="button" className={`tile${l.value === 'all' ? ' row' : ''}${level === l.value ? ' active' : ''}`} aria-pressed={level === l.value} onClick={() => setParams(l.value === 'all' ? {} : { niveau: l.value })}>
              <span className="tile-icon">{l.icon}</span>
              <span className="tile-label">{l.label}</span>
              {packs.data && <span className="tile-count">{counts(l.value)}</span>}
            </button>
          </li>
        ))}
        <li className="span2">
          <Link to="/admin" className="tile row">
            <span className="tile-icon">
              <IconBack />
            </span>
            <span className="tile-label">Retour à l'administration</span>
          </Link>
        </li>
      </ul>
    </>
  );

  const main = (
    <>
      <div className="studio-title">
        <div>
          <span className="mono muted small">S01 · catalogue</span>
          <h1>Packs de paramétrage</h1>
        </div>
        {onlyReview && (
          <button type="button" className="btn btn-ghost" onClick={() => setParams({})}>
            Voir tous les packs
          </button>
        )}
      </div>
      <p className="muted" style={{ maxWidth: 720 }}>
        Chaque pack décrit protocoles, formulaires, indicateurs et seuils d'un niveau. Ils se combinent du plus général au plus particulier : global → filière → pays → organisation → ferme.
      </p>
      <section className="card card-flush" aria-label="Packs">
        {packs.isLoading ? (
          <div style={{ padding: 20 }}>
            <SkeletonRows rows={6} cols={5} />
          </div>
        ) : packs.isError ? (
          <div style={{ padding: 20 }}>
            <ErrorState error={packs.error} onRetry={() => packs.refetch()} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title={onlyReview ? 'Aucune version en relecture' : 'Aucun pack à ce niveau'}>{onlyReview ? 'Rien n’attend votre relecture pour le moment.' : 'Les packs publiés apparaîtront ici.'}</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table table-boxed table-stack">
              <thead>
                <tr>
                  <th scope="col">Pack</th>
                  <th scope="col">Niveau</th>
                  <th scope="col">Publiée</th>
                  <th scope="col">En cours</th>
                  <th scope="col">Dépendances</th>
                  <th scope="col">Adoption</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p: StudioPack) => (
                  <tr key={p.code}>
                    <td>
                      <span className="mono" style={{ fontWeight: 500 }}>
                        {p.code}
                      </span>
                      {p.title && <span className="cell-sub">{p.title}</span>}
                    </td>
                    <td className="soft">{LEVEL_LABEL[p.level] ?? p.level}</td>
                    <td className="num">{p.published_version ?? '—'}</td>
                    <td>
                      {p.draft ? (
                        <span className={`chip ${STATUS_CHIP[p.draft.status]?.cls}`}>
                          {p.draft.version} · {STATUS_CHIP[p.draft.status]?.label}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                      {p.updated_at && <span className="cell-sub">modifié il y a {since(p.updated_at)}</span>}
                    </td>
                    <td className="mono small soft">
                      {p.requires
                        ? Object.entries(p.requires)
                            .map(([k, v]) => `${k} ${v}`)
                            .join(', ')
                        : '—'}
                    </td>
                    <td className="num">{p.adoption_farms !== undefined ? `${num(p.adoption_farms)} exploit.` : '—'}</td>
                    <td className="right">
                      {p.draft ? (
                        <Link to={`/admin/studio/v/${p.draft.id}/protocoles`} className="btn btn-ghost btn-sm">
                          Ouvrir
                        </Link>
                      ) : (
                        <span className="actions">
                        <Link to={`/admin/studio/p/${p.code}`} className="btn btn-ghost btn-sm">
                          Consulter
                        </Link>
                        <button type="button" className="btn btn-ghost btn-sm" disabled={create.isPending} onClick={() => (setCreating(p.code), create.mutate(p.code))}>
                          {creating === p.code ? 'Création…' : 'Nouveau brouillon'}
                        </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {create.isError && <FieldErrors error={create.error} />}
      <p className="footnote">
        <Pill tone="info">S02 – S07</Pill> Éditeurs de formulaires, protocoles, indicateurs, messages et circuit de publication : ouvrez un brouillon.
      </p>
    </>
  );

  return <StudioShell crumbs={<span className="crumb-strong">Packs</span>} nav={nav} main={main} />;
}
