import { useRef, useState, type DragEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../../api/client';
import { api } from '../../api/endpoints';
import type { ExportScope, ImportResult } from '../../api/types';
import { IconDownload } from '../../components/icons';
import { Card, EmptyState, FieldErrors, Pill, Seg, useToast } from '../../components/ui';
import { num } from '../../lib/format';
import { useAuth } from '../auth';
import { usePageMeta } from '../hooks';

export const TEMPLATE_CSV = 'phone,name,farm_name,region,speculations\n+237677000001,Ruth Abena,Ferme Abena,Soa,volaille\n+237677000002,Paul Mvondo,GIC Avenir,Mfou,volaille|chien\n';
const COLUMNS = ['phone', 'name', 'farm_name', 'region', 'speculations'];
const COL_LABEL: Record<string, string> = { phone: 'Téléphone', name: 'Nom', farm_name: 'Exploitation', region: 'Zone', speculations: 'Filières' };

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function filenameFrom(res: Response, fallback: string): string {
  const cd = res.headers.get('Content-Disposition') ?? '';
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  return m ? decodeURIComponent(m[1]) : fallback;
}

function Importer() {
  const { orgId } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: (f: File) => api.importCsv(f, orgId!),
    onSuccess: (r) => setResult(r),
  });
  const commit = useMutation({
    mutationFn: () => api.commitImport(result!.job_id),
    onSuccess: (r) => {
      const msg = `${num(r.created)} éleveur${r.created > 1 ? 's' : ''} importé${r.created > 1 ? 's' : ''}${r.updated ? `, ${num(r.updated)} mis à jour` : ''}.`;
      setDone(msg);
      toast(msg);
      qc.invalidateQueries({ queryKey: ['org-farms'] });
      setResult(null);
      setFile(null);
    },
  });

  const pick = (f: File | undefined | null) => {
    if (!f) return;
    setDone(null);
    setResult(null);
    upload.reset();
    commit.reset();
    setFile(f);
    upload.mutate(f);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    pick(e.dataTransfer.files?.[0]);
  };

  const errByRow = new Map<number, { field: string; message: string }[]>();
  result?.errors.forEach((e) => errByRow.set(e.row, [...(errByRow.get(e.row) ?? []), e]));
  const step = result ? 2 : 1;

  return (
    <Card id="imp" title="Importer des éleveurs (CSV)" actions={<button type="button" className="btn btn-ghost btn-sm" onClick={() => download(new Blob(['\uFEFF' + TEMPLATE_CSV], { type: 'text/csv' }), 'modele-eleveurs.csv')}>Télécharger le modèle</button>}>
      <ol className="steps" aria-label="Étapes de l'import">
        <li style={{ listStyle: 'none' }}>
          <span aria-current={step === 1 ? 'step' : undefined}>1. Fichier</span>
        </li>
        <li style={{ listStyle: 'none' }} aria-hidden="true">→</li>
        <li style={{ listStyle: 'none' }}>
          <span aria-current={step === 2 ? 'step' : undefined}>2. Vérification</span>
        </li>
        <li style={{ listStyle: 'none' }} aria-hidden="true">→</li>
        <li style={{ listStyle: 'none' }}>
          <span>3. Import</span>
        </li>
      </ol>
      {done && (
        <p className="notice notice-ok" role="status">
          <b>Import terminé.</b> {done} Les éleveurs reçoivent un SMS d'invitation.
        </p>
      )}
      {!result && (
        <div className={`dropzone${over ? ' over' : ''}`} onDragOver={(e) => (e.preventDefault(), setOver(true))} onDragLeave={() => setOver(false)} onDrop={onDrop}>
          <IconDownload size={28} style={{ transform: 'rotate(180deg)', color: 'var(--blue-500)' }} />
          <b>{upload.isPending ? `Analyse de ${file?.name}…` : 'Glissez votre fichier CSV ici'}</b>
          <span>
            Colonnes attendues : <span className="mono">{COLUMNS.join(', ')}</span>. Filières séparées par « | ».
          </span>
          <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" id="csv-file" onChange={(e) => pick(e.target.files?.[0])} />
          <label htmlFor="csv-file" className="btn btn-primary" style={{ cursor: 'pointer' }}>
            Choisir un fichier
          </label>
        </div>
      )}
      {upload.isError && <FieldErrors error={upload.error} />}
      {result && (
        <div className="stack">
          <div className="row">
            <Pill tone="ok">{num(result.valid_rows)} ligne{result.valid_rows > 1 ? 's' : ''} valide{result.valid_rows > 1 ? 's' : ''}</Pill>
            {result.errors.length > 0 && <Pill tone="crit">{num(errByRow.size)} ligne{errByRow.size > 1 ? 's' : ''} en erreur</Pill>}
            <span className="muted small">{file?.name}</span>
          </div>
          {result.errors.length > 0 && (
            <p className="notice notice-warn">Les lignes en erreur seront ignorées. Corrigez-les dans votre fichier puis importez-le de nouveau, ou importez seulement les lignes valides.</p>
          )}
          {result.preview && result.preview.length > 0 ? (
            <div className="table-wrap" style={{ maxHeight: 380, overflowY: 'auto' }}>
              <table className="table">
                <caption className="sr-only">Aperçu du fichier</caption>
                <thead>
                  <tr>
                    <th scope="col">Ligne</th>
                    {COLUMNS.map((c) => (
                      <th key={c} scope="col">
                        {COL_LABEL[c]}
                      </th>
                    ))}
                    <th scope="col">Erreurs</th>
                  </tr>
                </thead>
                <tbody>
                  {result.preview.map((r, i) => {
                    const n = i + 2;
                    const errs = errByRow.get(n);
                    return (
                      <tr key={n} className={errs ? 'row-err' : undefined}>
                        <td className="num">{n}</td>
                        {COLUMNS.map((c) => (
                          <td key={c} className={errs?.some((e) => e.field === c) ? 'tone-crit' : undefined}>
                            {r[c] || <span className="muted">—</span>}
                          </td>
                        ))}
                        <td className="err-cell">{errs?.map((e) => e.message).join(' · ')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            result.errors.length > 0 && (
              <ul className="help-list">
                {result.errors.map((e, i) => (
                  <li key={i}>
                    Ligne {e.row} · {e.field} : {e.message}
                  </li>
                ))}
              </ul>
            )
          )}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={() => (setResult(null), setFile(null))}>
              Changer de fichier
            </button>
            <button type="button" className="btn btn-primary" disabled={result.valid_rows === 0 || commit.isPending} onClick={() => commit.mutate()}>
              {commit.isPending ? 'Import…' : `Importer ${num(result.valid_rows)} éleveur${result.valid_rows > 1 ? 's' : ''}`}
            </button>
          </div>
          {commit.isError && <FieldErrors error={commit.error} />}
        </div>
      )}
    </Card>
  );
}

const SCOPES: { scope: ExportScope; title: string; desc: string }[] = [
  { scope: 'farms', title: 'Exploitations', desc: 'Éleveurs, téléphones, zones et filières suivies.' },
  { scope: 'reminders', title: 'Rappels', desc: 'Échéances, statuts et confirmations, pour la tournée ou un rapport.' },
  { scope: 'health_events', title: 'Actes sanitaires', desc: 'Vaccinations et traitements enregistrés, avec la date et le sujet.' },
];

function Exporter() {
  const { orgId } = useAuth();
  const toast = useToast();
  const [period, setPeriod] = useState('30d');
  const [busy, setBusy] = useState<ExportScope | null>(null);
  const run = async (scope: ExportScope) => {
    setBusy(scope);
    try {
      const res = await api.exportCsv({ kind: 'csv', scope, period, organisation_id: orgId ?? undefined });
      const blob = await res.blob();
      download(blob, filenameFrom(res, `recallfarm-${scope}-${period}.csv`));
      toast('Export prêt : le fichier est téléchargé.');
    } catch (e) {
      toast(errorMessage(e), 'err');
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card
      id="exp"
      title="Exporter en CSV"
      actions={
        <Seg
          label="Période"
          value={period}
          onChange={setPeriod}
          options={[
            { value: '7d', label: '7 j' },
            { value: '30d', label: '30 j' },
            { value: '90d', label: '90 j' },
            { value: '365d', label: '12 mois' },
          ]}
        />
      }
    >
      <div className="list-rows">
        {SCOPES.map((s) => (
          <div key={s.scope} style={{ alignItems: 'center' }}>
            <span>
              <b style={{ fontWeight: 600 }}>{s.title}</b>
              <span className="cell-sub">{s.desc}</span>
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => run(s.scope)} disabled={busy !== null} aria-label={`Exporter ${s.title.toLowerCase()} en CSV`}>
              {busy === s.scope ? 'Préparation…' : 'Exporter'}
            </button>
          </div>
        ))}
      </div>
      <p className="note">Fichiers encodés en UTF-8, séparateur virgule, lisibles dans Excel et LibreOffice. Les champs marqués sensibles ne sortent jamais de l'exploitation.</p>
    </Card>
  );
}

export default function Exports() {
  usePageMeta('Exports et imports', 'Membres de la Structure et données consolidées');
  const { orgId } = useAuth();
  if (!orgId) return <EmptyState title="Aucune organisation">Ce compte n'administre pas de Structure.</EmptyState>;
  return (
    <div className="grid-main">
      <Importer />
      <Exporter />
    </div>
  );
}
