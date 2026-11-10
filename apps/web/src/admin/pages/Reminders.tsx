import { useState, type FormEvent } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import { api, listOf } from '../../api/endpoints';
import type { Reminder } from '../../api/types';
import { Dialog, EmptyState, ErrorState, FieldErrors, Pill, Seg, SkeletonRows, useToast } from '../../components/ui';
import { addDaysISO, dateShort, DISEASE_LABEL, relDays, todayISO } from '../../lib/format';
import { useAuth } from '../auth';
import { usePageMeta } from '../hooks';

type Filter = 'todo' | 'en_retard' | 'aujourdhui' | 'a_venir' | 'confirme';
const FILTER_STATUS: Record<Filter, string> = {
  todo: 'en_retard,aujourdhui',
  en_retard: 'en_retard',
  aujourdhui: 'aujourdhui',
  a_venir: 'a_venir,envoye',
  confirme: 'confirme',
};

const STATUS: Record<string, { tone: 'ok' | 'warn' | 'crit' | 'info' | 'neutral' | 'blue'; label: string }> = {
  en_retard: { tone: 'warn', label: 'En retard' },
  manque: { tone: 'crit', label: 'Manqué' },
  aujourdhui: { tone: 'blue', label: "Aujourd'hui" },
  a_venir: { tone: 'neutral', label: 'À venir' },
  envoye: { tone: 'neutral', label: 'Envoyé' },
  confirme: { tone: 'ok', label: 'Confirmé' },
  annule: { tone: 'neutral', label: 'Annulé' },
  clos: { tone: 'neutral', label: 'Clos' },
  reporte: { tone: 'neutral', label: 'Reporté' },
};

function useReminderActions() {
  const qc = useQueryClient();
  const toast = useToast();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['org-reminders'] });
    qc.invalidateQueries({ queryKey: ['reminders'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const confirm = useMutation({
    mutationFn: (r: Reminder) => api.confirmReminder(r.id),
    onSuccess: (_x, r) => {
      toast(`Rappel ${DISEASE_LABEL[r.disease] ?? r.disease} confirmé pour ${r.subject_ref ?? 'le sujet'}.`);
      refresh();
    },
    onError: (e) => toast(errorMessage(e), 'err'),
  });
  const snooze = useMutation({
    mutationFn: ({ r, until }: { r: Reminder; until: string }) => api.snoozeReminder(r.id, until),
    onSuccess: (_x, v) => {
      toast(`Rappel reporté au ${dateShort(v.until)}.`);
      refresh();
    },
  });
  return { confirm, snooze };
}

function SnoozeDialog({ reminder, onClose, snooze }: { reminder: Reminder | null; onClose: () => void; snooze: ReturnType<typeof useReminderActions>['snooze'] }) {
  const [until, setUntil] = useState(addDaysISO(todayISO(), 3));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!reminder) return;
    snooze.mutate({ r: reminder, until }, { onSuccess: onClose });
  };
  return (
    <Dialog
      open={!!reminder}
      onClose={() => (snooze.reset(), onClose())}
      title="Reporter le rappel"
      description={reminder ? `${DISEASE_LABEL[reminder.disease] ?? reminder.disease} · ${reminder.subject_ref ?? ''} · ${reminder.farm_name ?? ''}` : undefined}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" form="snooze-form" className="btn btn-primary" disabled={snooze.isPending}>
            {snooze.isPending ? 'Report…' : 'Reporter'}
          </button>
        </>
      }
    >
      <form id="snooze-form" className="stack" onSubmit={submit}>
        <div className="row" role="group" aria-label="Raccourcis">
          {[1, 3, 7].map((n) => (
            <button key={n} type="button" className="btn btn-ghost btn-sm" aria-pressed={until === addDaysISO(todayISO(), n)} onClick={() => setUntil(addDaysISO(todayISO(), n))}>
              +{n} jour{n > 1 ? 's' : ''}
            </button>
          ))}
        </div>
        <div className="field">
          <label htmlFor="snooze-date">Nouvelle échéance</label>
          <input id="snooze-date" type="date" className="input" min={addDaysISO(todayISO(), 1)} value={until} onChange={(e) => setUntil(e.target.value)} required />
        </div>
        <p className="muted small">Le plan d'envoi (J-7, J-1, J, J+3) est recalculé à partir de la nouvelle date.</p>
        <FieldErrors error={snooze.error} />
      </form>
    </Dialog>
  );
}

export function ReminderTable({ rows, showFarm = true }: { rows: Reminder[]; showFarm?: boolean }) {
  const { confirm, snooze } = useReminderActions();
  const [snoozing, setSnoozing] = useState<Reminder | null>(null);
  const today = todayISO();
  return (
    <>
      <div className="table-wrap">
        <table className="table table-stack">
          <thead>
            <tr>
              <th scope="col">Échéance</th>
              {showFarm && <th scope="col">Exploitation</th>}
              <th scope="col">Sujet</th>
              <th scope="col">Acte</th>
              <th scope="col">Statut</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const open = !['confirme', 'annule', 'clos', 'manque'].includes(r.status);
              const shown = open && r.timing ? r.timing : r.status;
              const st = STATUS[shown] ?? { tone: 'neutral' as const, label: shown };
              const act = DISEASE_LABEL[r.disease] ?? (r.label ? r.label.split(' · ')[0] : r.disease);
              const busy = confirm.isPending && confirm.variables?.id === r.id;
              return (
                <tr key={r.id}>
                  <td className="num">
                    {dateShort(r.due_date, false)}
                    <span className="cell-sub">{r.due_date === today ? "aujourd'hui" : relDays(r.due_date, today)}</span>
                  </td>
                  {showFarm && (
                    <td>
                      <Link to={`/admin/exploitations/${r.farm_id}`} className="cell-link" style={{ fontWeight: 400 }}>
                        {r.farm_name}
                      </Link>
                    </td>
                  )}
                  <td>{r.subject_ref ?? '—'}</td>
                  <td>
                    {act}
                    {(r.priority === 'haute' || r.priority === 'critique') && (
                      <span className="cell-sub tone-crit">{r.priority === 'critique' ? 'obligatoire' : 'prioritaire'}</span>
                    )}
                  </td>
                  <td>
                    <Pill tone={st.tone}>{st.label}</Pill>
                  </td>
                  <td className="right">
                    {open && (
                      <div className="actions">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => confirm.mutate(r)} disabled={busy || r.subject_id === null} title={r.subject_id === null ? "Rappel sans sujet rattaché : confirmez l'acte depuis l'application de l'éleveur" : undefined} aria-label={`Confirmer le rappel ${act} pour ${r.subject_ref ?? ''}`}>
                          {busy ? 'Confirmation…' : 'Confirmer'}
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSnoozing(r)} aria-label={`Reporter le rappel ${act} pour ${r.subject_ref ?? ''}`}>
                          Reporter
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <SnoozeDialog reminder={snoozing} onClose={() => setSnoozing(null)} snooze={snooze} />
    </>
  );
}

export default function Reminders() {
  usePageMeta('Rappels', 'Actes sanitaires dus dans les exploitations suivies');
  const { orgId } = useAuth();
  const [params, setParams] = useSearchParams();
  const filter = (params.get('status') as Filter) in FILTER_STATUS ? (params.get('status') as Filter) : 'todo';
  const q = useQuery({
    queryKey: ['org-reminders', orgId, FILTER_STATUS[filter]],
    queryFn: () => api.orgReminders(orgId!, FILTER_STATUS[filter]),
    select: listOf,
    enabled: !!orgId,
    placeholderData: keepPreviousData,
  });
  const [page, setPage] = useState(1);
  const PER = 25;
  const rows = q.data ?? [];
  const shown = rows.slice(0, page * PER);

  if (!orgId) return <EmptyState title="Aucune organisation">Ce compte n'administre pas de Structure.</EmptyState>;

  return (
    <>
      <div className="toolbar">
        <Seg<Filter>
          label="Statut"
          value={filter}
          onChange={(v) => {
            setPage(1);
            setParams(v === 'todo' ? {} : { status: v });
          }}
          options={[
            { value: 'todo', label: 'À traiter' },
            { value: 'en_retard', label: 'En retard' },
            { value: 'aujourdhui', label: "Aujourd'hui" },
            { value: 'a_venir', label: 'À venir' },
            { value: 'confirme', label: 'Confirmés' },
          ]}
        />
        <span className="muted" aria-live="polite">
          {q.isSuccess && `${rows.length} rappel${rows.length > 1 ? 's' : ''}`}
        </span>
      </div>
      <section className="card" aria-label="Liste des rappels">
        {q.isLoading ? (
          <SkeletonRows rows={8} cols={6} />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title={filter === 'confirme' ? 'Aucun rappel confirmé récemment' : 'Rien à traiter'}>
            {filter === 'confirme' ? 'Les confirmations par SMS, USSD ou application apparaîtront ici.' : 'Tous les rappels de cette catégorie sont à jour. Beau travail.'}
          </EmptyState>
        ) : (
          <div style={{ opacity: q.isPlaceholderData ? 0.6 : 1 }}>
            <ReminderTable rows={shown} />
            {shown.length < rows.length && (
              <div className="row" style={{ justifyContent: 'center', paddingTop: 12 }}>
                <button type="button" className="btn btn-ghost" onClick={() => setPage((p) => p + 1)}>
                  Afficher {Math.min(PER, rows.length - shown.length)} de plus
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </>
  );
}
