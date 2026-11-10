/** Studio workspace — S02/S03/S04/S07 on one version of a pack (reproduces Studio.dc.html). */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, NavLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, errorMessage } from '../api/client';
import { api, listOf } from '../api/endpoints';
import type { PackContent, PackObject, PackVersion } from '../api/types';
import { useAuth } from '../admin/auth';
import { Frise } from '../components/charts';
import { FormRenderer, type FormDef } from '../components/FormRenderer';
import {
  HSync,
  IconBars,
  IconCalendar,
  IconForm,
  IconGauge,
  IconGlobe,
  IconPaw,
  IconSensor,
  IconSyringe,
  IconTrend,
} from '../components/icons';
import { Dialog, EmptyState, ErrorState, Skeleton, SkeletonRows, useToast } from '../components/ui';
import { check } from '../lib/expr';
import { dateShort, num } from '../lib/format';
import { useDocumentTitle } from '../pages/public/SiteChrome';
import { StudioShell, STATUS_CHIP } from './StudioShell';

/* ------------------------------------------------------------ sections */

type SectionKey = 'especes' | 'protocoles' | 'formulaires' | 'indicateurs' | 'seuils' | 'calendriers' | 'capteurs' | 'projection' | 'libelles';
const SECTIONS: { key: SectionKey; label: string; kinds: string[]; icon: ReactNode }[] = [
  { key: 'especes', label: 'Espèces', kinds: ['species_profile', 'production_type'], icon: <IconPaw /> },
  { key: 'protocoles', label: 'Protocoles', kinds: ['vaccination_protocol'], icon: <IconSyringe /> },
  { key: 'formulaires', label: 'Formulaires', kinds: ['form'], icon: <IconForm /> },
  { key: 'indicateurs', label: 'Indicateurs', kinds: ['kpi'], icon: <IconBars /> },
  { key: 'seuils', label: "Seuils d'alerte", kinds: ['alert_rule'], icon: <IconGauge /> },
  { key: 'calendriers', label: 'Calendriers', kinds: ['task_template', 'reminder_plan'], icon: <IconCalendar /> },
  { key: 'capteurs', label: 'Capteurs', kinds: ['sensor_profile'], icon: <IconSensor /> },
  { key: 'projection', label: 'Projection', kinds: ['projection_model'], icon: <IconTrend /> },
  { key: 'libelles', label: 'Libellés et traductions', kinds: [], icon: <IconGlobe /> },
];

type Step = {
  code: string;
  label?: string;
  short_label?: string;
  type?: 'vaccin' | 'soin';
  disease?: string;
  offset_days: number;
  route?: string;
  condition?: string;
  after_step?: string;
  override?: { offset_days?: { policy?: string; min?: number; max?: number; min_delta?: number; max_delta?: number } };
};

const ROUTES = ['injection', 'oculaire', 'eau_de_boisson', 'orale', 'transfixion', 'chirurgie'];
const ROUTE_LABEL: Record<string, string> = {
  injection: 'injection',
  oculaire: 'voie oculaire',
  eau_de_boisson: 'eau de boisson',
  orale: 'voie orale',
  transfixion: 'transfixion alaire',
  chirurgie: 'acte chirurgical',
};
const POLICY_LABEL: Record<string, string> = { bornee: 'bornée', libre: 'libre', verrouillee: 'verrouillée', ajout_seulement: 'ajout seulement' };
const VALIDATOR_LABEL: Record<string, string> = { veterinaire: 'vétérinaire', referent: 'référent', aucun: 'aucun' };

function protocolTitle(p: PackObject, i18n: Record<string, string>): string {
  if (typeof p.title === 'string') return p.title;
  if (i18n[p.code]) return i18n[p.code];
  const sp = typeof p.species === 'string' ? (i18n[p.species] ?? p.species) : '';
  const pt = typeof p.production_type === 'string' ? (i18n[p.production_type] ?? p.production_type).toLowerCase() : '';
  return sp ? `Protocole ${sp.toLowerCase()}${pt ? ` · ${pt}` : ''}` : p.code;
}

function firstOfNextMonth(): string {
  const d = new Date();
  const n = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01`;
}

/* ----------------------------------------------------------- inheritance */

const LEVEL_ORDER: Record<string, number> = { global: 0, filiere: 1, pays: 2, org: 3, ferme: 4 };
type Inherited = { i18n: Record<string, string>; objects: Map<string, { pack: string; obj: PackObject }> };

/** Labels and objects of the published packs this pack builds on (global → filière → pays → org), for i18n and validation hints. */
export function useInherited(content: PackContent | null): Inherited {
  const packs = useQuery({ queryKey: ['studio-packs'], queryFn: api.studioPacks, select: listOf, staleTime: 60_000 });
  const level = LEVEL_ORDER[content?.level ?? 'org'] ?? 3;
  const parents = (packs.data ?? []).filter((p) => p.code !== content?.pack && p.published_version && (LEVEL_ORDER[p.level] ?? 9) <= level).sort((a, b) => (LEVEL_ORDER[a.level] ?? 9) - (LEVEL_ORDER[b.level] ?? 9));
  const contents = useQueries({
    queries: parents.map((p) => ({ queryKey: ['pack-content', p.code, p.published_version], queryFn: () => api.packContent(p.code, p.published_version!), staleTime: 10 * 60_000 })),
  });
  return useMemo(() => {
    const i18n: Record<string, string> = {};
    const objects = new Map<string, { pack: string; obj: PackObject }>();
    contents.forEach((q, i) => {
      const c = q.data?.content;
      if (!c) return;
      Object.assign(i18n, c.i18n?.fr ?? {});
      c.objects?.forEach((o) => objects.set(`${o.kind}:${o.code}`, { pack: parents[i].code, obj: o }));
    });
    Object.assign(i18n, content?.i18n?.fr ?? {});
    return { i18n, objects };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, contents.map((q) => q.dataUpdatedAt).join(',')]);
}

type ExplainedError = { path: string; message: string; where: string; inheritedFrom?: string };
function explainErrors(errors: { path: string; message: string }[], content: PackContent, inherited: Inherited): ExplainedError[] {
  return errors.map((e) => {
    const m = /^objects\[(\d+)\](?:\.([\w.[\]]+))?/.exec(e.path);
    const o = m ? content.objects[Number(m[1])] : undefined;
    if (!o) return { ...e, where: e.path };
    const prop = m?.[2]?.split(/[.[]/)[0];
    const parent = inherited.objects.get(`${o.kind}:${o.code}`);
    const inheritedFrom = parent && prop && !(prop in o) && prop in parent.obj ? parent.pack : undefined;
    return { ...e, where: `${o.kind} « ${o.code} »${m?.[2] ? ` · ${m[2]}` : ''}`, inheritedFrom };
  });
}

function ValidationNotice({ errors }: { errors: ExplainedError[] }) {
  if (!errors.length) return null;
  const real = errors.filter((e) => !e.inheritedFrom);
  return (
    <div className={`notice ${real.length ? 'notice-crit' : 'notice-warn'}`} role="status">
      <b>
        Validation du serveur : {errors.length} {errors.length > 1 ? 'remarques' : 'remarque'}
      </b>
      <ul className="help-list" style={{ marginTop: 6 }}>
        {errors.map((e, i) => (
          <li key={i}>
            <span className="mono">{e.where}</span> : {e.message}
            {e.inheritedFrom && (
              <span className="muted">
                {' '}
                (propriété héritée de <span className="mono">{e.inheritedFrom}</span> : cette version ne fait que surcharger l'objet, la remarque est probablement un faux positif du validateur)
              </span>
            )}
            <span className="muted mono small"> · {e.path}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------- right panel */

function DiffPanel({ versionId, rev }: { versionId: string; rev: string }) {
  const q = useQuery({ queryKey: ['studio-diff', versionId, rev], queryFn: () => api.diff(versionId) });
  const lines = useMemo(() => {
    const out: { cls: string; text: string }[] = [];
    for (const c of q.data?.changes ?? []) {
      const prim = (v: unknown) => v !== undefined && v !== null && typeof v !== 'object';
      if (c.op === 'add') out.push({ cls: 'd-add', text: `+ ${c.path}${prim(c.after) ? `: ${c.after}` : ''}` });
      else if (c.op === 'remove') out.push({ cls: 'd-rm', text: `− ${c.path}${prim(c.before) ? `: ${c.before}` : ''}` });
      else if (prim(c.before) && prim(c.after)) {
        out.push({ cls: 'd-rm', text: `− ${c.path}: ${c.before}` });
        out.push({ cls: 'd-add', text: `+ ${c.path}: ${c.after}` });
      } else out.push({ cls: 'd-mod', text: `~ ${c.path}` });
    }
    return out;
  }, [q.data]);
  return (
    <section className="aside-sec" aria-labelledby="diff-title">
      <h2 id="diff-title">{q.data?.base_version ? `Changements depuis ${q.data.base_version}` : 'Changements'}</h2>
      {q.isLoading ? (
        <Skeleton h={90} r={12} />
      ) : q.isError ? (
        <ErrorState compact error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <div className="diff-box mono" aria-label="Différences avec la version publiée">
            {lines.length ? lines.map((l, i) => (
              <div key={i} className={l.cls}>
                {l.text}
              </div>
            )) : <div className="muted">{q.data?.base_version ? 'Aucun changement pour le moment.' : 'Première version : tout est nouveau.'}</div>}
          </div>
          {q.data && lines.length > 0 && (
            <span className="aside-note">
              {q.data.major
                ? `Changement majeur : les rappels déjà planifiés seront recalculés pour ${num(q.data.impact?.subjects_recomputed ?? 0)} animaux.`
                : "Changement mineur : les rappels déjà planifiés ne sont pas modifiés."}
            </span>
          )}
        </>
      )}
    </section>
  );
}

function ReviewDialog({ open, onClose, version, onFourEyes }: { open: boolean; onClose: () => void; version: PackVersion; onFourEyes: (msg: string, action: 'relire' | 'publier') => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [decision, setDecision] = useState<'approuve' | 'refuse'>('approuve');
  const [comments, setComments] = useState('');
  const m = useMutation({
    mutationFn: () => api.reviewVersion(version.id, { decision, comments: comments.trim() }),
    onSuccess: (v) => {
      qc.setQueryData(['studio-version', version.id], (old: PackVersion | undefined) => ({ ...old, ...v, content: old?.content ?? v.content }));
      qc.invalidateQueries({ queryKey: ['studio-packs'] });
      toast(decision === 'approuve' ? 'Version approuvée : elle peut être publiée.' : 'Version renvoyée à son auteur avec vos commentaires.');
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.rule === 'RG-PAR-04') {
        onFourEyes(e.message, 'relire');
        onClose();
      }
    },
  });
  const needComment = decision === 'refuse' && !comments.trim();
  return (
    <Dialog
      open={open}
      onClose={() => (m.reset(), onClose())}
      title="Relecture vétérinaire"
      description={`${version.pack} ${version.version} · rédigé par ${version.author_name}`}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button type="button" className={`btn ${decision === 'approuve' ? 'btn-primary' : 'btn-danger'}`} disabled={m.isPending || needComment} onClick={() => m.mutate()}>
            {m.isPending ? 'Envoi…' : decision === 'approuve' ? 'Approuver' : 'Refuser'}
          </button>
        </>
      }
    >
      <div className="stack">
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 8 }}>
          <legend className="sr-only">Décision</legend>
          <label className="method">
            <input type="radio" name="decision" checked={decision === 'approuve'} onChange={() => setDecision('approuve')} data-autofocus />
            Approuver : les protocoles sont conformes
          </label>
          <label className="method">
            <input type="radio" name="decision" checked={decision === 'refuse'} onChange={() => setDecision('refuse')} />
            Refuser : renvoyer à l'auteur
          </label>
        </fieldset>
        <div className="field">
          <label htmlFor="rev-comments">Commentaires{decision === 'refuse' ? ' (obligatoires)' : ''}</label>
          <textarea id="rev-comments" className="input" value={comments} onChange={(e) => setComments(e.target.value)} placeholder="Ex. castration : préciser l'analgésie ; fer J3 conforme." />
        </div>
        {m.error && !(m.error instanceof ApiError && m.error.rule === 'RG-PAR-04') && <ErrorState compact error={m.error} />}
      </div>
    </Dialog>
  );
}

function PublishDialog({ open, onClose, version, onFourEyes }: { open: boolean; onClose: () => void; version: PackVersion; onFourEyes: (msg: string, action: 'relire' | 'publier') => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [pct, setPct] = useState(10);
  const m = useMutation({
    mutationFn: () => api.publishVersion(version.id, pct),
    onSuccess: (v) => {
      qc.setQueryData(['studio-version', version.id], (old: PackVersion | undefined) => ({ ...old, ...v, content: old?.content ?? v.content }));
      qc.invalidateQueries({ queryKey: ['studio-packs'] });
      toast(`${version.pack} ${version.version} publié pour ${pct} % des exploitations. Signature et diffusion en cours.`);
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.rule === 'RG-PAR-04') {
        onFourEyes(e.message, 'publier');
        onClose();
      }
    },
  });
  return (
    <Dialog
      open={open}
      onClose={() => (m.reset(), onClose())}
      title="Publier la version"
      description={`${version.pack} ${version.version} sera signée puis diffusée aux téléphones à la prochaine synchronisation.`}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button type="button" className="btn btn-primary" disabled={m.isPending} onClick={() => m.mutate()}>
            {m.isPending ? 'Publication…' : `Publier à ${pct} %`}
          </button>
        </>
      }
    >
      <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 8 }}>
        <legend style={{ fontSize: 13, color: 'var(--text-2)', fontWeight: 500, marginBottom: 6 }}>Déploiement progressif (RG-PAR-07)</legend>
        {[10, 50, 100].map((p) => (
          <label key={p} className="method">
            <input type="radio" name="rollout" checked={pct === p} onChange={() => setPct(p)} data-autofocus={p === 10 ? true : undefined} />
            {p} % des exploitations{p === 10 ? ' · recommandé pour commencer' : p === 100 ? ' · tout le monde' : ''}
          </label>
        ))}
      </fieldset>
      {m.error && !(m.error instanceof ApiError && m.error.rule === 'RG-PAR-04') && <div style={{ marginTop: 12 }}><ErrorState compact error={m.error} /></div>}
    </Dialog>
  );
}

export function FourEyesNotice({ message, action, reviewer, onClose }: { message: string; action: 'relire' | 'publier'; reviewer?: string; onClose: () => void }) {
  return (
    <div className="four-eyes" role="alert">
      <div className="four-eyes-icon" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
          <circle cx="7" cy="12" r="3.2" />
          <circle cx="17" cy="12" r="3.2" />
          <path d="M10.2 12h3.6M3.8 12H2M22 12h-1.8" />
        </svg>
      </div>
      <div>
        <b>Règle des quatre yeux · RG-PAR-04</b>
        <p>{message}</p>
        <p>
          Demandez à {reviewer ? <b>{reviewer}</b> : 'un autre référent'} de {action === 'publier' ? 'publier' : 'relire'} cette version{action === 'publier' ? ' (rôle publieur)' : ''}. Cette règle protège les éleveurs d'une erreur de protocole non relue.
        </p>
      </div>
      <button type="button" className="icon-btn-light" aria-label="Fermer le message" onClick={onClose}>
        ×
      </button>
    </div>
  );
}

function Circuit({ version, onReview, onPublish, fourEyes, clearFourEyes, isAuthor }: { version: PackVersion & { assigned_reviewer_name?: string }; onReview: () => void; onPublish: () => void; fourEyes: { message: string; action: 'relire' | 'publier' } | null; clearFourEyes: () => void; isAuthor: boolean }) {
  const review = [...version.reviews].reverse()[0];
  const reviewer = review?.reviewer_name ?? version.assigned_reviewer_name;
  const s = version.status;
  const approved = s === 'teste' || s === 'publie';
  const refused = s === 'brouillon' && review?.decision === 'refuse';
  return (
    <section className="aside-sec" aria-labelledby="circuit-title">
      <h2 id="circuit-title">Circuit de validation</h2>
      <ol className="circuit">
        <li>
          <span className="cdot cdot-done" aria-hidden="true" />
          <div>
            <span>Rédaction</span>
            <span className="csub">
              {version.author_name ?? (version.author_id ? 'auteur' : 'import initial')} · {dateShort(version.created_at, false)}
            </span>
          </div>
        </li>
        <li>
          <span className={`cdot ${approved ? 'cdot-done' : refused ? 'cdot-ko' : 'cdot-cur'}`} aria-hidden="true" />
          <div>
            <span>Relecture vétérinaire</span>
            <span className={`csub ${approved ? 'tone-ok' : refused ? 'tone-crit' : 'tone-warn'}`}>
              {approved ? `approuvée${reviewer ? ` · ${reviewer}` : ''}` : refused ? `refusée${reviewer ? ` · ${reviewer}` : ''}` : s === 'en_revue' ? `en cours · ${reviewer ?? 'référent vétérinaire'}` : `attendue · ${reviewer ?? 'référent vétérinaire'}`}
            </span>
            {review?.comments && <span className="csub quote">« {review.comments} »</span>}
            {s === 'en_revue' && (
              <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8, alignSelf: 'flex-start' }} onClick={onReview} title={isAuthor ? 'Relecture réservée à une autre personne que l’auteur' : undefined}>
                Relire et décider
              </button>
            )}
          </div>
        </li>
        <li>
          <span className={`cdot ${s === 'publie' ? 'cdot-done' : s === 'teste' ? 'cdot-cur' : 'cdot-todo'}`} aria-hidden="true" />
          <div>
            <span className={s === 'teste' || s === 'publie' ? undefined : 'muted'}>Publication progressive</span>
            <span className="csub muted2">{s === 'publie' ? `publiée à ${version.rollout_pct ?? 100} % · ${dateShort(version.published_at ?? null, false)}` : '10 % → 50 % → 100 %'}</span>
            {s === 'teste' && (
              <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: 8, alignSelf: 'flex-start' }} onClick={onPublish}>
                Publier
              </button>
            )}
          </div>
        </li>
      </ol>
      {fourEyes ? (
        <FourEyesNotice message={fourEyes.message} action={fourEyes.action} reviewer={fourEyes.action === 'publier' ? (version.assigned_reviewer_name ?? reviewer) : version.assigned_reviewer_name} onClose={clearFourEyes} />
      ) : (
        <p className="aside-note">L'auteur ne peut pas valider son propre pack (règle des quatre yeux).</p>
      )}
    </section>
  );
}

function JournalPreview({ content, i18n }: { content: PackContent; i18n: Record<string, string> }) {
  const forms = content.objects.filter((o) => o.kind === 'form') as unknown as (FormDef & { applies_to?: string; preview_subject?: string; species?: string })[];
  const f = forms.find((x) => x.applies_to === 'daily_log') ?? forms[0];
  if (!f) return null;
  return (
    <section className="aside-sec" aria-labelledby="pv-title">
      <h2 id="pv-title">Aperçu du journal</h2>
      <div className="phone-preview">
        <FormRenderer form={f} i18n={i18n} ctx={{ subject: { production_type: 'ponte', species: f.species } }} compact title={`${f.preview_subject ?? 'Sujet'} · aujourd'hui`} />
      </div>
    </section>
  );
}

/* --------------------------------------------------------- main panels */

function StepsTable({ steps, editable, errors, selected, onSelect, onChange, onAdd, onRemove, refLabel, labelOf, protoBounds }: { steps: Step[]; editable: boolean; errors: Map<number, string[]>; selected: string | null; onSelect: (c: string) => void; onChange: (i: number, patch: Partial<Step>) => void; onAdd: () => void; onRemove: (i: number) => void; refLabel: string; labelOf: (s: Step) => string; protoBounds?: { min_delta?: number; max_delta?: number } }) {
  return (
    <section className="card card-flush" aria-labelledby="st-title">
      <div className="card-head">
        <h2 id="st-title" style={{ fontSize: 15 }}>
          Étapes
        </h2>
        <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 13 }} onClick={onAdd} disabled={!editable} title={editable ? undefined : 'Version non modifiable'}>
          Ajouter une étape
        </button>
      </div>
      <div className="table-wrap">
        <table className="table table-boxed steps-table">
          <thead>
            <tr>
              <th scope="col">Acte</th>
              <th scope="col">Déclencheur</th>
              <th scope="col">Bornes pays</th>
              <th scope="col">Voie</th>
              <th scope="col">Condition (CEL)</th>
              {editable && (
                <th scope="col">
                  <span className="sr-only">Supprimer</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {steps.map((s, i) => {
              const b: { min?: number; max?: number; min_delta?: number; max_delta?: number } | undefined = s.override?.offset_days ?? protoBounds;
              const after = s.after_step ? steps.find((x) => x.code === s.after_step) : undefined;
              const cond = s.condition?.trim() ? check(s.condition) : null;
              const errs = errors.get(i);
              const sel = selected === s.code;
              return (
                <tr key={s.code + i} className={`${sel ? 'sel' : ''}${errs ? ' has-err' : ''}`} onFocusCapture={() => onSelect(s.code)}>
                  <td>
                    {editable ? (
                      <input className="cell-input" aria-label={`Libellé de l'étape ${i + 1}`} value={s.label ?? labelOf(s)} onChange={(e) => onChange(i, { label: e.target.value })} />
                    ) : (
                      <button type="button" className="cell-btn" onClick={() => onSelect(s.code)}>
                        {labelOf(s)}
                      </button>
                    )}
                    {errs && (
                      <span className="cell-sub tone-crit" role="alert">
                        {errs.join(' · ')}
                      </span>
                    )}
                  </td>
                  <td className="mono nowrap">
                    {after ? `${labelOf(after).replace(/^.*· /, '')} + ` : `${refLabel} + `}
                    {editable ? (
                      <input
                        className="cell-input cell-num mono"
                        type="number"
                        min={0}
                        aria-label={`Décalage en jours de « ${s.label} »`}
                        value={Number.isFinite(s.offset_days) ? s.offset_days : ''}
                        style={{ width: `${Math.max(1, String(Number.isFinite(s.offset_days) ? s.offset_days : '').length) + 0.4}ch` }}
                        onChange={(e) => onChange(i, { offset_days: e.target.value === '' ? NaN : Number(e.target.value) })}
                        aria-invalid={!!errs}
                      />
                    ) : (
                      s.offset_days
                    )}{' '}
                    j
                  </td>
                  <td className="mono muted">{b && b.min !== undefined ? `${b.min} – ${b.max} j` : b?.min_delta !== undefined ? `${b.min_delta} / +${b.max_delta} j` : '—'}</td>
                  <td>
                    {editable ? (
                      <select className="cell-input cell-select" aria-label={`Voie de « ${s.label} »`} value={s.route ?? ''} onChange={(e) => onChange(i, { route: e.target.value || undefined })}>
                        <option value="">—</option>
                        {ROUTES.map((r) => (
                          <option key={r} value={r}>
                            {ROUTE_LABEL[r]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="soft">{ROUTE_LABEL[s.route ?? ''] ?? s.route ?? '—'}</span>
                    )}
                  </td>
                  <td className="mono">
                    {editable ? (
                      <>
                        <input
                          className={`cell-input mono cond${cond ? (cond.ok ? ' ok' : ' bad') : ''}`}
                          aria-label={`Condition CEL de « ${s.label} »`}
                          placeholder="—"
                          value={s.condition ?? ''}
                          onChange={(e) => onChange(i, { condition: e.target.value || undefined })}
                          aria-invalid={cond ? !cond.ok : undefined}
                          spellCheck={false}
                        />
                        {cond && !cond.ok && <span className="cell-sub tone-crit">{cond.message}</span>}
                      </>
                    ) : (
                      <span className={s.condition ? 'tone-blue' : 'muted'}>{s.condition ?? '—'}</span>
                    )}
                  </td>
                  {editable && (
                    <td className="right">
                      <button type="button" className="icon-btn-light" style={{ width: 28, height: 28 }} aria-label={`Supprimer l'étape « ${s.label} »`} onClick={() => onRemove(i)}>
                        ×
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TestsBar({ versionId, rev }: { versionId: string; rev: string }) {
  const q = useQuery({ queryKey: ['studio-test', versionId, rev], queryFn: () => api.testVersion(versionId) });
  const [open, setOpen] = useState(false);
  const passed = q.data ? (typeof q.data.passed === 'number' ? q.data.passed : q.data.results.filter((r) => r.ok).length) : 0;
  const ok = q.data && passed === q.data.total;
  return (
    <section className="card tests-bar" aria-labelledby="tv-title">
      <h2 id="tv-title">Vecteurs de test</h2>
      {q.isFetching ? (
        <span className="mono small muted">exécution…</span>
      ) : q.isError ? (
        <span className="tone-crit small">{errorMessage(q.error)}</span>
      ) : q.data ? (
        <>
          <button type="button" className={`mono tv-result ${ok ? 'tone-ok' : 'tone-crit'}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {passed} / {q.data.total} réussis
          </button>
          <span className="small muted">{q.data.engines ? `moteurs ${q.data.engines.replace(/^serveur/, 'serveur')}` : 'moteurs serveur et mobile identiques'}</span>
        </>
      ) : null}
      <button type="button" className="icon-btn-light tv-rerun" onClick={() => q.refetch()} disabled={q.isFetching} aria-label="Relancer les vecteurs de test" title="Relancer les vecteurs de test">
        <HSync size={14} />
      </button>
      <span className="tv-meta mono">schéma protocol.v3 · signé à la publication</span>
      {open && q.data && (
        <ul className="tv-list">
          {q.data.results.map((r) => (
            <li key={r.name} className={r.ok ? 'tone-ok' : 'tone-crit'}>
              {r.ok ? '✓' : '✗'} <span className="mono">{r.name}</span>
              {r.message && <span className="muted"> · {r.message}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ProtocolEditor({ version, content, editable, update, rev, validation, primary, i18n }: { version: PackVersion; content: PackContent; editable: boolean; update: (fn: (c: PackContent) => void) => void; rev: string; validation: { path: string; message: string }[]; primary: ReactNode; i18n: Record<string, string> }) {
  const [params, setParams] = useSearchParams();
  const protocols = content.objects.map((o, i) => ({ o, i })).filter((x) => x.o.kind === 'vaccination_protocol');
  const current = protocols.find((p) => p.o.code === params.get('code')) ?? protocols[0];
  const steps = useMemo(() => ((current?.o.steps as Step[]) ?? []) as Step[], [current]);
  const [selected, setSelected] = useState<string | null>(null);
  const [birth, setBirth] = useState(firstOfNextMonth());
  const [editDate, setEditDate] = useState(false);
  const [sandbox, setSandbox] = useState(false);
  useEffect(() => {
    if (!selected && steps.length) setSelected((steps.find((s) => s.type === 'vaccin') ?? steps[0]).code);
  }, [steps, selected]);

  const sim = useQuery({
    queryKey: ['studio-sim', version.id, current?.o.code, birth, rev],
    queryFn: () => api.simulateProtocol({ version_id: version.id, protocol_code: current!.o.code, birth_or_start_date: birth }),
    enabled: !!current,
  });

  const errors = useMemo(() => {
    const m = new Map<number, string[]>();
    if (!current) return m;
    for (const e of validation) {
      const r = new RegExp(`^objects\\[${current.i}\\]\\.steps\\[(\\d+)\\]`).exec(e.path);
      if (r) m.set(Number(r[1]), [...(m.get(Number(r[1])) ?? []), e.message]);
    }
    return m;
  }, [validation, current]);

  if (!current)
    return (
      <EmptyState
        title="Ce pack ne contient pas de protocole"
        action={
          <div className="row" style={{ justifyContent: 'center' }}>
            <Link to="../formulaires" relative="path" className="btn btn-ghost">
              Voir ses formulaires
            </Link>
            <Link to="/admin/studio/p/pays.CM" className="btn btn-primary">
              Ouvrir les protocoles du pays
            </Link>
          </div>
        }
      >
        Les protocoles vaccinaux sont définis dans le pack pays (ici pays.CM) ; ce pack les reprend par héritage.
      </EmptyState>
    );

  const p = current.o;
  const policy = (p.override as { steps?: { policy?: string } } | undefined)?.steps?.policy ?? 'libre';
  const refLabel = p.reference === 'birth_date' ? 'naissance' : 'mise en place';
  const setStep = (i: number, patch: Partial<Step>) =>
    update((c) => {
      const s = (c.objects[current.i].steps as Step[])[i];
      Object.assign(s, patch);
      for (const k of Object.keys(patch) as (keyof Step)[]) if (patch[k] === undefined) delete s[k];
    });

  return (
    <>
      <div className="studio-title">
        <div>
          <span className="mono muted small">
            protocole ·{' '}
            {protocols.length > 1 ? (
              <>
                <label htmlFor="proto-sel" className="sr-only">
                  Protocole
                </label>
                <select id="proto-sel" className="inline-select mono" value={p.code} onChange={(e) => (setSelected(null), setParams({ code: e.target.value }))}>
                  {protocols.map((x) => (
                    <option key={x.o.code} value={x.o.code}>
                      {x.o.code}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              p.code
            )}
          </span>
          <h1>{protocolTitle(p, i18n)}</h1>
        </div>
        <div className="studio-title-right">
          <div className="row" style={{ gap: 6, fontSize: 12 }}>
            <span className="outline-chip">
              Surcharge : <span className="tone-blue">{POLICY_LABEL[policy] ?? policy}</span>
            </span>
            <span className="outline-chip">Valideur : {VALIDATOR_LABEL[(p.validator as string) ?? ''] ?? (p.mandatory ? 'vétérinaire' : 'référent')}</span>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <button type="button" className="btn btn-ghost" onClick={() => setSandbox(true)}>
              Bac à sable
            </button>
            {primary}
          </div>
        </div>
      </div>

      <section className="card" aria-labelledby="fr-title">
        <div className="card-head">
          <h2 id="fr-title" style={{ fontSize: 15 }}>
            Frise sur un animal fictif
          </h2>
          {editDate ? (
            <span className="row" style={{ gap: 6 }}>
              <label htmlFor="sim-date" className="small muted">
                {p.reference === 'birth_date' ? 'Né le' : 'Mis en place le'}
              </label>
              <input id="sim-date" type="date" className="input input-sm" style={{ width: 150 }} value={birth} onChange={(e) => e.target.value && setBirth(e.target.value)} onBlur={() => setEditDate(false)} autoFocus />
            </span>
          ) : (
            <button type="button" className="card-meta link-quiet" onClick={() => setEditDate(true)} title="Changer la date de référence">
              {p.reference === 'birth_date' ? 'né le' : 'mis en place le'} {dateShort(birth)} · simulation
            </button>
          )}
        </div>
        {sim.isLoading ? (
          <Skeleton h={120} r={12} />
        ) : sim.isError ? (
          <ErrorState compact error={sim.error} onRetry={() => sim.refetch()} />
        ) : sim.data ? (
          <div style={{ opacity: sim.isFetching ? 0.6 : 1, transition: 'opacity .2s' }}>
            <Frise events={sim.data.events} highlight={selected} />
          </div>
        ) : null}
        <div className="sim-meta">
          <span>
            Rappels générés : <span className="mono ink">{(sim.data?.reminder_offsets ?? sim.data?.events.find((e) => e.notifications?.length)?.notifications?.map((n) => n.offset) ?? [-7, -1, 0, 3]).map((o) => (o === 0 ? 'J' : o < 0 ? `J${o}` : `J+${o}`)).join(' · ')}</span>
          </span>
          <span>
            Délai d'attente viande appliqué : <span className="ink">{sim.data ? (sim.data.withdrawal_applied ? 'oui' : 'non') : '…'}</span>
          </span>
          {sim.data && sim.data.events.length > 0 && (
            <span>
              Dernier acte le <span className="ink">{dateShort(sim.data.events[sim.data.events.length - 1].due_date)}</span>
            </span>
          )}
        </div>
      </section>

      <StepsTable
        steps={steps}
        editable={editable}
        errors={errors}
        selected={selected}
        onSelect={setSelected}
        refLabel={refLabel}
        labelOf={(st) => st.label ?? i18n[st.code] ?? `${i18n[st.disease ?? ''] ?? st.disease ?? st.code}${st.route ? ` · ${ROUTE_LABEL[st.route] ?? st.route}` : ''}`}
        protoBounds={(p.override as { offset_days?: { min_delta?: number; max_delta?: number } } | undefined)?.offset_days}
        onChange={setStep}
        onAdd={() =>
          update((c) => {
            const list = c.objects[current.i].steps as Step[];
            const last = list[list.length - 1];
            const n = list.length + 1;
            const off = (last?.after_step ? 21 : (last?.offset_days ?? 0)) + 7;
            list.push({ code: `etape_${n}_${Date.now() % 1000}`, label: 'Nouvelle étape', short_label: 'Étape', type: 'vaccin', offset_days: off, route: 'injection', override: { offset_days: { policy: 'bornee', min: Math.max(0, off - 3), max: off + 3 } } });
          })
        }
        onRemove={(i) =>
          update((c) => {
            (c.objects[current.i].steps as Step[]).splice(i, 1);
          })
        }
      />

      <TestsBar versionId={version.id} rev={rev} />

      <Dialog open={sandbox} onClose={() => setSandbox(false)} title="Bac à sable · V2" footer={<button type="button" className="btn btn-primary" onClick={() => setSandbox(false)}>Compris</button>}>
        <p>
          Le bac à sable (S08) simulera 90 jours de saisie sur une exploitation fictive et montrera les rappels, alertes et indicateurs produits par cette version. Il arrive avec la V2. En attendant, la frise ci-dessus et les vecteurs de test couvrent le protocole.
        </p>
      </Dialog>
    </>
  );
}

function FormsPanel({ content, i18n }: { content: PackContent; i18n: Record<string, string> }) {
  const [params, setParams] = useSearchParams();
  const forms = content.objects.filter((o) => o.kind === 'form') as unknown as (FormDef & { applies_to?: string; title?: string; preview_subject?: string })[];
  const f = forms.find((x) => x.code === params.get('code')) ?? forms[0];
  const [pt, setPt] = useState('ponte');
  const [payload, setPayload] = useState<string | null>(null);
  useEffect(() => setPayload(null), [f?.code]);
  if (!f) return <EmptyState title="Aucun formulaire dans ce pack">Les formulaires sont définis au niveau filière, pays ou organisation.</EmptyState>;
  const usesPT = f.fields.some((x) => /subject\.production_type/.test(`${x.visible_if ?? ''}${x.required_if ?? ''}`));
  const ptOptions = content.objects.filter((o) => o.kind === 'production_type').map((o) => o.code);
  const opts = ptOptions.length ? ptOptions : ['ponte', 'chair'];
  return (
    <>
      <div className="studio-title">
        <div>
          <span className="mono muted small">formulaire · {f.code}</span>
          <h1>{f.title ?? i18n[f.code] ?? f.code}</h1>
        </div>
      </div>
      <div className="seg" role="group" aria-label="Formulaires du pack">
        {forms.map((x) => (
          <button key={x.code} type="button" aria-pressed={x.code === f.code} onClick={() => setParams({ code: x.code })}>
            {x.title ?? x.code}
          </button>
        ))}
      </div>
      <div className="forms-grid">
        <section className="card card-flush" aria-labelledby="fields-title">
          <div className="card-head">
            <h2 id="fields-title" style={{ fontSize: 15 }}>
              Champs
            </h2>
            <span className="card-meta">{f.fields.length} champs · s'applique à {f.applies_to ?? '—'}</span>
          </div>
          <div className="table-wrap">
            <table className="table table-boxed">
              <thead>
                <tr>
                  <th scope="col">Champ</th>
                  <th scope="col">Type</th>
                  <th scope="col">Règles</th>
                  <th scope="col">Affiché si (CEL)</th>
                </tr>
              </thead>
              <tbody>
                {f.fields.map((x) => (
                  <tr key={x.code}>
                    <td>
                      {i18n[x.label ?? ''] ?? x.label ?? x.code}
                      <span className="cell-sub mono">{x.maps_to ?? `attributes.${x.code}`}</span>
                    </td>
                    <td className="mono soft">
                      {x.type}
                      {x.unit ? ` · ${x.unit}` : ''}
                    </td>
                    <td className="small soft">
                      {[x.required && 'obligatoire', x.required_if && `obligatoire si ${x.required_if}`, x.min !== undefined && `min ${x.min}`, x.max !== undefined && `max ${x.max}`, x.pattern && `format ${x.pattern}`, x.expr && `= ${x.expr}`]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </td>
                    <td className="mono small">{x.visible_if ? <span className="tone-blue">{x.visible_if}</span> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card" aria-labelledby="mprev-title">
          <div className="card-head">
            <h2 id="mprev-title" style={{ fontSize: 15 }}>
              Aperçu mobile
            </h2>
            {usesPT && (
              <span className="row" style={{ gap: 6 }}>
                <label htmlFor="pt-sel" className="small muted">
                  Sujet
                </label>
                <select id="pt-sel" className="input input-sm" style={{ width: 'auto' }} value={pt} onChange={(e) => setPt(e.target.value)}>
                  {opts.map((o) => (
                    <option key={o} value={o}>
                      {i18n[o] ?? o}
                    </option>
                  ))}
                </select>
              </span>
            )}
          </div>
          <div className="phone-frame">
            <div className="phone-frame-screen">
              <FormRenderer
                key={`${f.code}-${pt}`}
                form={f}
                i18n={i18n}
                ctx={{ subject: { production_type: pt }, subjects: [{ id: 's1', label: 'Truie T-12' }, { id: 's2', label: 'Verrat V-03' }] }}
                title={`${f.preview_subject ?? f.title ?? 'Saisie'} · aujourd'hui`}
                onSubmit={(p) => setPayload(JSON.stringify(p, null, 2))}
              />
            </div>
          </div>
          {payload && (
            <div className="stack" style={{ gap: 6 }} role="status">
              <span className="small tone-ok">Saisie valide. Données envoyées à l'API :</span>
              <pre className="json-out mono">{payload}</pre>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function LabelsPanel({ content, editable, update }: { content: PackContent; editable: boolean; update: (fn: (c: PackContent) => void) => void }) {
  const [q, setQ] = useState('');
  const fr = content.i18n?.fr ?? {};
  const en = content.i18n?.en ?? {};
  const keys = Object.keys(fr).filter((k) => !q || `${k} ${fr[k]}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="studio-title">
        <div>
          <span className="mono muted small">i18n · {Object.keys(fr).length} clés</span>
          <h1>Libellés et traductions</h1>
        </div>
      </div>
      <div className="search-box" style={{ maxWidth: 360 }}>
        <label htmlFor="lbl-q" className="sr-only">
          Filtrer les libellés
        </label>
        <input id="lbl-q" type="search" placeholder="Filtrer par clé ou par texte" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <section className="card card-flush" aria-label="Libellés">
        <div className="table-wrap" style={{ maxHeight: 640, overflowY: 'auto' }}>
          <table className="table table-boxed">
            <thead>
              <tr>
                <th scope="col">Clé</th>
                <th scope="col">Français</th>
                <th scope="col">English</th>
              </tr>
            </thead>
            <tbody>
              {keys.slice(0, 300).map((k) => (
                <tr key={k}>
                  <td className="mono small">{k}</td>
                  <td>
                    {editable ? (
                      <input
                        className="cell-input"
                        aria-label={`Libellé français de ${k}`}
                        value={fr[k]}
                        onChange={(e) =>
                          update((c) => {
                            c.i18n = c.i18n ?? {};
                            c.i18n.fr = { ...(c.i18n.fr ?? {}), [k]: e.target.value };
                          })
                        }
                      />
                    ) : (
                      fr[k]
                    )}
                  </td>
                  <td className={en[k] ? undefined : 'muted small'}>{en[k] ?? 'à traduire'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function summary(o: PackObject): string {
  switch (o.kind) {
    case 'kpi':
      return [o.unit && `unité ${o.unit}`, o.expr && o.expr !== 'null' && `= ${o.expr}`].filter(Boolean).join(' · ') || '—';
    case 'alert_rule':
      return `${o.severity ?? ''} · quand ${o.when ?? '—'}`;
    case 'task_template': {
      const t = o.trigger as { type?: string; event?: string; offset_days?: number; every_days?: number } | undefined;
      return t ? (t.type === 'recurrent' ? `tous les ${t.every_days} j` : `${t.event ?? t.type} + ${t.offset_days ?? 0} j`) : '—';
    }
    case 'reminder_plan':
      return `envois ${(o.offsets_days as number[] | undefined)?.join(', ') ?? ''}`;
    case 'production_type':
      return ((o.phases as { code: string; max_days: number }[]) ?? []).map((p) => `${p.code} ${p.max_days} j`).join(' → ') || '—';
    case 'species_profile':
      return [o.management, (o.categories as string[] | undefined)?.join(', ')].filter(Boolean).join(' · ');
    default:
      return (o.title as string) ?? '—';
  }
}

function ObjectsPanel({ content, section, i18n }: { content: PackContent; section: (typeof SECTIONS)[number]; i18n: Record<string, string> }) {
  const objs = content.objects.filter((o) => section.kinds.includes(o.kind));
  return (
    <>
      <div className="studio-title">
        <div>
          <span className="mono muted small">{section.kinds.join(' · ')}</span>
          <h1>{section.label}</h1>
        </div>
      </div>
      <section className="card card-flush" aria-label={section.label}>
        {objs.length === 0 ? (
          <EmptyState title={`Aucun objet « ${section.label.toLowerCase()} » dans ce pack`}>Il est peut-être hérité d'un pack de niveau supérieur.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table table-boxed">
              <thead>
                <tr>
                  <th scope="col">Code</th>
                  <th scope="col">Libellé</th>
                  <th scope="col">Définition</th>
                </tr>
              </thead>
              <tbody>
                {objs.map((o) => (
                  <tr key={`${o.kind}:${o.code}`}>
                    <td className="mono small">{o.code}</td>
                    <td>{(o.title as string) ?? i18n[o.code] ?? o.code}</td>
                    <td className="mono small soft">{summary(o)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="footnote">Éditeurs dédiés (S04 indicateurs et règles, S05 projection, S06 messages) : en cours de livraison. La structure est validée côté serveur à chaque enregistrement.</p>
    </>
  );
}

/* ------------------------------------------------------------ workspace */

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export default function Workspace() {
  const { versionId = '', section = 'protocoles' } = useParams();
  const sec = SECTIONS.find((s) => s.key === section) ?? SECTIONS[1];
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const vq = useQuery({ queryKey: ['studio-version', versionId], queryFn: () => api.version(versionId) });
  const version = vq.data as (PackVersion & { assigned_reviewer_name?: string }) | undefined;
  useDocumentTitle(version ? `${version.pack} ${version.version} · Studio RecallFarm` : 'Studio RecallFarm');

  const [content, setContent] = useState<PackContent | null>(null);
  const [save, setSave] = useState<SaveState>('idle');
  const [saveErr, setSaveErr] = useState<unknown>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [reviewing, setReviewing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [fourEyes, setFourEyes] = useState<{ message: string; action: 'relire' | 'publier' } | null>(null);

  useEffect(() => {
    if (version?.content && (save === 'idle' || save === 'saved')) setContent(version.content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version?.id, version?.content]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => setFourEyes(null), [versionId]);

  const inherited = useInherited(content);
  // a pack without protocols (e.g. an organisation pack) opens on its forms
  const [params] = useSearchParams();
  useEffect(() => {
    if (!content || sec.key !== 'protocoles' || params.get('code')) return;
    const has = (k: string) => content.objects.some((o) => o.kind === k);
    if (!has('vaccination_protocol') && has('form')) navigate(`/admin/studio/v/${versionId}/formulaires`, { replace: true });
  }, [content, sec.key, versionId, navigate, params]);
  const editable = !!version && version.status === 'brouillon' && (version.author_id === me?.id || can('platform_admin'));
  const rev = version?.updated_at ?? '0';

  const patch = useMutation({
    mutationFn: (c: PackContent) => api.patchVersion(versionId, c),
    onMutate: () => setSave('saving'),
    onSuccess: (v) => {
      setSave('saved');
      setSaveErr(null);
      qc.setQueryData(['studio-version', versionId], (old: PackVersion | undefined) => ({ ...old, ...v, content: v.content ?? old?.content }));
    },
    onError: (e) => {
      setSave('error');
      setSaveErr(e);
    },
  });

  const update = useCallback(
    (fn: (c: PackContent) => void) => {
      setContent((prev) => {
        if (!prev) return prev;
        const next = structuredClone(prev);
        fn(next);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => patch.mutate(next), 700);
        return next;
      });
      setSave('dirty');
    },
    [patch],
  );

  const validation = useQuery({
    queryKey: ['studio-validate', versionId, rev],
    queryFn: () => api.validateVersion(versionId),
    enabled: !!version,
  });

  const submit = useMutation({
    mutationFn: () => api.submitVersion(versionId),
    onSuccess: (v) => {
      qc.setQueryData(['studio-version', versionId], (old: PackVersion | undefined) => ({ ...old, ...v, content: old?.content ?? v.content }));
      qc.invalidateQueries({ queryKey: ['studio-packs'] });
      toast(`Relecture demandée${version?.assigned_reviewer_name ? ` à ${version.assigned_reviewer_name}` : ''}.`);
    },
    onError: (e) => toast(errorMessage(e), 'err'),
  });
  const newDraft = useMutation({
    mutationFn: () => api.createDraft(version!.pack),
    onSuccess: (v) => {
      qc.invalidateQueries({ queryKey: ['studio-packs'] });
      navigate(`/admin/studio/v/${v.id}/${sec.key}`);
    },
    onError: (e) => toast(errorMessage(e), 'err'),
  });

  const chip = version ? <span className={`chip ${STATUS_CHIP[version.status]?.cls}`}>{version.version} · {STATUS_CHIP[version.status]?.label}</span> : null;
  const crumbs = (
    <>
      <Link to="/admin/studio/packs" className="crumb">
        Packs
      </Link>
      <span className="crumb-sep" aria-hidden="true">
        /
      </span>
      <span className="mono crumb-strong" aria-current="page">
        {version?.pack ?? '…'}
      </span>
    </>
  );

  const counts = (s: (typeof SECTIONS)[number]) => (s.key === 'libelles' ? Object.keys(content?.i18n?.fr ?? {}).length : (content?.objects.filter((o) => s.kinds.includes(o.kind)).length ?? 0));
  const nav = (
    <>
      <span className="nav-group" style={{ margin: '0 4px' }}>
        OBJETS DU PACK
      </span>
      <ul className="tiles">
        {SECTIONS.map((s) => (
          <li key={s.key} className={s.key === 'libelles' ? 'span2' : undefined}>
            <NavLink to={`/admin/studio/v/${versionId}/${s.key}`} className={({ isActive }) => `tile${s.key === 'libelles' ? ' row' : ''}${isActive || (s.key === 'protocoles' && !section) ? ' active' : ''}`}>
              <span className="tile-icon">{s.icon}</span>
              <span className="tile-label">{s.label}</span>
              {content && <span className="tile-count">{counts(s)}</span>}
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="inherit-card">
        <span className="org-k">HÉRITAGE</span>
        <div className="inherit mono">
          {['global.core', version?.pack?.startsWith('filiere') ? version.pack : 'filiere.*', 'pays.CM', version?.pack?.startsWith('org.') ? version.pack : 'org.*', 'ferme.*'].map((p, i) => (
            <span key={i} style={{ paddingLeft: i * 12 }} className={`${i > 0 ? 'inh-line' : ''}${p === version?.pack ? ' inh-cur' : ''}`}>
              {p}
            </span>
          ))}
        </div>
      </div>
    </>
  );

  const valErrors = validation.data?.errors ?? [];
  const explained = content ? explainErrors(valErrors, content, inherited) : [];
  const blocking = explained.filter((e) => !e.inheritedFrom);
  const status = version?.status;
  const primary =
    status === 'brouillon' ? (
      <button type="button" className="btn btn-primary" onClick={() => (clearTimeout(timer.current), content && save === 'dirty' ? patch.mutateAsync(content).then(() => submit.mutate()) : submit.mutate())} disabled={submit.isPending || !editable || blocking.length > 0} title={blocking.length ? 'Corrigez les erreurs de validation' : !editable ? 'Seul l’auteur peut demander la relecture' : undefined}>
        {submit.isPending ? 'Envoi…' : 'Demander la relecture'}
      </button>
    ) : status === 'en_revue' ? (
      <button type="button" className="btn btn-primary" onClick={() => (version?.author_id === me?.id ? setFourEyes({ message: "Vous êtes l'auteur de cette version : vous ne pouvez pas la relire vous-même.", action: 'relire' }) : setReviewing(true))}>
        Relire et décider
      </button>
    ) : status === 'teste' ? (
      <button type="button" className="btn btn-primary" onClick={() => setPublishing(true)}>
        Publier
      </button>
    ) : (
      <button type="button" className="btn btn-primary" onClick={() => newDraft.mutate()} disabled={newDraft.isPending}>
        Nouveau brouillon
      </button>
    );

  let main: ReactNode;
  if (vq.isLoading || (!content && !vq.isError)) main = <SkeletonRows rows={8} cols={4} />;
  else if (vq.isError || !version || !content) main = <ErrorState error={vq.error} onRetry={() => vq.refetch()} />;
  else {
    main = (
      <>
        <div className="save-line" aria-live="polite">
          {!editable && version.status === 'brouillon' && <span className="muted small">Lecture seule : brouillon de {version.author_name}.</span>}
          {!editable && version.status !== 'brouillon' && <span className="muted small">Lecture seule : version {({ publie: 'publiée', en_revue: 'en relecture', teste: 'approuvée', retire: 'retirée', brouillon: 'en brouillon' } as Record<string, string>)[version.status]}. Créez un brouillon pour la modifier.</span>}
          {editable && save === 'dirty' && <span className="muted small">Modifications en cours…</span>}
          {editable && save === 'saving' && <span className="muted small">Enregistrement…</span>}
          {editable && save === 'saved' && <span className="tone-ok small">Enregistré · validation en continu</span>}
          {save === 'error' && <span className="tone-crit small">Échec de l'enregistrement : {errorMessage(saveErr)}</span>}
        </div>
        <ValidationNotice errors={explained} />
        {sec.key === 'protocoles' ? (
          <ProtocolEditor version={version} content={content} editable={editable} update={update} rev={rev} validation={valErrors} primary={primary} i18n={inherited.i18n} />
        ) : sec.key === 'formulaires' ? (
          <FormsPanel content={content} i18n={inherited.i18n} />
        ) : sec.key === 'libelles' ? (
          <LabelsPanel content={content} editable={editable} update={update} />
        ) : (
          <ObjectsPanel content={content} section={sec} i18n={inherited.i18n} />
        )}
      </>
    );
  }

  const aside =
    version && content ? (
      <>
        <DiffPanel versionId={versionId} rev={rev} />
        <Circuit isAuthor={version.author_id === me?.id} version={version} onReview={() => (version.author_id === me?.id ? setFourEyes({ message: "Vous êtes l'auteur de cette version : vous ne pouvez pas la relire vous-même.", action: 'relire' }) : setReviewing(true))} onPublish={() => setPublishing(true)} fourEyes={fourEyes} clearFourEyes={() => setFourEyes(null)} />
        <JournalPreview content={content} i18n={inherited.i18n} />
        <ReviewDialog open={reviewing} onClose={() => setReviewing(false)} version={version} onFourEyes={(message, action) => setFourEyes({ message, action })} />
        <PublishDialog open={publishing} onClose={() => setPublishing(false)} version={version} onFourEyes={(message, action) => setFourEyes({ message, action })} />
      </>
    ) : (
      <Skeleton h={300} r={12} />
    );

  return <StudioShell crumbs={crumbs} chip={chip} nav={nav} main={main} aside={aside} />;
}


