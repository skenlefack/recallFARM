import { useEffect, useState, type FormEvent } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, errorMessage } from '../../api/client';
import { api, listOf } from '../../api/endpoints';
import type { Alert } from '../../api/types';
import { Dialog, EmptyState, ErrorState, FieldErrors, Pill, Seg, SeverityDot, SkeletonRows, useToast } from '../../components/ui';
import { dateTime, since } from '../../lib/format';
import { useAuth } from '../auth';
import { usePageMeta } from '../hooks';

type Filter = 'open' | 'acquittee' | 'resolue' | 'all';
const FILTERS: Record<Filter, string | undefined> = { open: 'ouverte,escaladee', acquittee: 'acquittee', resolue: 'resolue,close', all: undefined };
export const CAUSES: Record<string, string> = {
  maladie: 'Maladie (suspicion ou confirmée)',
  chaleur: 'Chaleur',
  panne_eau: "Panne d'eau",
  panne_electrique: 'Panne électrique',
  capteur_defectueux: 'Capteur défectueux',
  intrusion: 'Intrusion',
  fausse_alerte: 'Fausse alerte',
  autre: 'Autre',
};

const STATUS: Record<string, { tone: 'crit' | 'warn' | 'ok' | 'neutral' | 'blue'; label: string }> = {
  ouverte: { tone: 'crit', label: 'Ouverte' },
  escaladee: { tone: 'crit', label: 'Escaladée' },
  acquittee: { tone: 'blue', label: 'Prise en charge' },
  resolue: { tone: 'ok', label: 'Résolue' },
  close: { tone: 'neutral', label: 'Close' },
};

export function ResolveDialog({ alert, onClose }: { alert: Alert | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [cause, setCause] = useState('');
  const [action, setAction] = useState('');
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    setCause('');
    setAction('');
    setTouched(false);
  }, [alert?.id]);
  const critical = alert?.severity === 'critique';
  const m = useMutation({
    mutationFn: () => api.resolveAlert(alert!.id, { cause: cause.trim(), action: action.trim() }),
    onSuccess: () => {
      toast('Alerte résolue. Merci pour le suivi.');
      qc.invalidateQueries({ queryKey: ['alerts'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
  });
  const serverFields = m.error instanceof ApiError ? m.error.fields : undefined;
  const causeErr = (touched && critical && !cause.trim() ? 'La cause est obligatoire pour une alerte critique.' : undefined) ?? serverFields?.cause;
  const actionErr = (touched && critical && !action.trim() ? "L'action menée est obligatoire pour une alerte critique." : undefined) ?? serverFields?.action;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (critical && (!cause.trim() || !action.trim())) return;
    m.mutate();
  };
  return (
    <Dialog
      open={!!alert}
      onClose={() => (m.reset(), onClose())}
      title="Résoudre l'alerte"
      description={alert ? `${alert.title ?? alert.rule_code} · ${alert.farm_name ?? ''}` : undefined}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" form="resolve-form" className="btn btn-primary" disabled={m.isPending}>
            {m.isPending ? 'Enregistrement…' : 'Marquer comme résolue'}
          </button>
        </>
      }
    >
      <form id="resolve-form" className="stack" onSubmit={submit} noValidate>
        {critical && (
          <p className="notice notice-crit">
            Alerte <b>critique</b> : la cause et l'action menée sont obligatoires. Elles alimentent le registre sanitaire de l'exploitation.
          </p>
        )}
        <div className="field">
          <label htmlFor="res-cause">Cause identifiée{critical ? ' (obligatoire)' : ''}</label>
          <select id="res-cause" className="input" value={cause} onChange={(e) => setCause(e.target.value)} aria-invalid={!!causeErr} aria-describedby={causeErr ? 'res-cause-err' : undefined} required={critical} data-autofocus>
            <option value="">Choisir la cause…</option>
            {Object.entries(CAUSES).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          {causeErr && <span id="res-cause-err" className="field-err">{causeErr}</span>}
        </div>
        <div className="field">
          <label htmlFor="res-action">Action menée{critical ? ' (obligatoire)' : ''}</label>
          <textarea id="res-action" className="input" value={action} onChange={(e) => setAction(e.target.value)} aria-invalid={!!actionErr} aria-describedby={actionErr ? 'res-action-err' : undefined} placeholder="Ex. ventilateur remplacé, visite du Dr Mbarga, prélèvements envoyés" maxLength={1000} required={critical} />
          {actionErr && <span id="res-action-err" className="field-err">{actionErr}</span>}
        </div>
        {m.error && !serverFields && <FieldErrors error={m.error} />}
      </form>
    </Dialog>
  );
}

export default function Alerts() {
  usePageMeta('Alertes', 'Mortalité, capteurs, stocks et rappels critiques');
  const { orgId } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const focus = params.get('focus');
  const filter: Filter = (params.get('statut') as Filter) in FILTERS ? (params.get('statut') as Filter) : 'open';
  const setFilter = (f: Filter) => setParams(f === 'open' ? {} : { statut: f });
  const [resolving, setResolving] = useState<Alert | null>(null);
  const q = useQuery({
    queryKey: ['alerts', { status: FILTERS[filter], orgId, list: true }],
    queryFn: () => api.alerts({ status: FILTERS[filter], organisation_id: orgId! }),
    select: listOf,
    enabled: !!orgId,
    placeholderData: keepPreviousData,
  });
  const ack = useMutation({
    mutationFn: (a: Alert) => api.ackAlert(a.id),
    onSuccess: () => {
      toast('Alerte prise en charge. L\'escalade est arrêtée.');
      qc.invalidateQueries({ queryKey: ['alerts'] });
    },
    onError: (e) => toast(errorMessage(e), 'err'),
  });

  if (!orgId) return <EmptyState title="Aucune organisation">Ce compte n'administre pas de Structure.</EmptyState>;
  const rows = q.data ?? [];

  return (
    <>
      <div className="toolbar">
        <Seg<Filter>
          label="Statut"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'open', label: 'Ouvertes' },
            { value: 'acquittee', label: 'Prises en charge' },
            { value: 'resolue', label: 'Résolues' },
            { value: 'all', label: 'Toutes' },
          ]}
        />
      </div>
      <section className="card" aria-label="Liste des alertes">
        {q.isLoading ? (
          <SkeletonRows rows={5} cols={5} />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title={filter === 'open' ? 'Aucune alerte ouverte' : 'Aucune alerte'}>
            {filter === 'open' ? 'Tout est calme dans les exploitations suivies. Les nouvelles alertes apparaissent ici et dans la cloche.' : 'Rien dans cette catégorie pour le moment.'}
          </EmptyState>
        ) : (
          <div className="table-wrap" style={{ opacity: q.isPlaceholderData ? 0.6 : 1 }}>
            <table className="table table-stack">
              <thead>
                <tr>
                  <th scope="col">Gravité</th>
                  <th scope="col">Alerte</th>
                  <th scope="col">Exploitation</th>
                  <th scope="col">Depuis</th>
                  <th scope="col">Statut</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const st = STATUS[a.status] ?? { tone: 'neutral' as const, label: a.status };
                  const open = a.status === 'ouverte' || a.status === 'escaladee';
                  const resolvable = open || a.status === 'acquittee';
                  return (
                    <tr key={a.id} className={focus === a.id ? 'focused' : undefined}>
                      <td>
                        <SeverityDot severity={a.severity} />
                      </td>
                      <td>
                        <b style={{ fontWeight: 600 }}>{a.title ?? a.rule_code}</b>
                        {a.message && <span className="cell-sub alert-msg">{a.message}</span>}
                        {a.escalation && a.escalation.length > 0 && (
                          <ul className="escalation" aria-label="Escalade">
                            {a.escalation.map((e) => (
                              <li key={e.level} className={e.done ? 'done' : undefined}>
                                N{e.level} · {e.target}
                              </li>
                            ))}
                          </ul>
                        )}
                        {a.status === 'resolue' && a.cause && (
                          <span className="cell-sub">
                            Cause : {CAUSES[a.cause] ?? a.cause} · Action : {a.action}
                          </span>
                        )}
                      </td>
                      <td>
                        <Link to={`/admin/exploitations/${a.farm_id}`} className="cell-link" style={{ fontWeight: 400 }}>
                          {a.farm_name}
                        </Link>
                      </td>
                      <td className="num" title={dateTime(a.opened_at)}>
                        {since(a.opened_at)}
                      </td>
                      <td>
                        <Pill tone={st.tone}>{st.label}</Pill>
                        {a.acked_by && a.status === 'acquittee' && <span className="cell-sub">par {a.acked_by}</span>}
                      </td>
                      <td className="right">
                        <div className="actions">
                          {open && (
                            <button type="button" className="btn btn-ghost btn-sm" disabled={ack.isPending && ack.variables?.id === a.id} onClick={() => ack.mutate(a)}>
                              Prendre en charge
                            </button>
                          )}
                          {resolvable && (
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setResolving(a)}>
                              Résoudre
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <ResolveDialog alert={resolving} onClose={() => setResolving(null)} />
    </>
  );
}
