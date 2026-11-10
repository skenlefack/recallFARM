import { useEffect, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { api } from '../../api/endpoints';
import { Check, Close } from '../../components/icons';
import { dateShort, DISEASE_LABEL, relDays, todayISO } from '../../lib/format';
import { SiteFooter, SiteHeader, useDocumentTitle } from './SiteChrome';

const REASONS: Record<string, string> = {
  signature_invalide: 'la signature électronique ne correspond pas (document modifié ou contrefait)',
  expire: 'la vaccination a expiré',
  certificat_expire: 'la vaccination a expiré',
  inconnu: 'certificat inconnu',
};
const SPECIES: Record<string, string> = { chien: 'Chien', volaille: 'Volaille', porcin: 'Porcin', bovin: 'Bovin' };

/** Accepts a raw payload or a full URL copied from the QR (…/verifier?payload=…). */
export function extractPayload(input: string): string {
  const s = input.trim();
  try {
    const u = new URL(s);
    return u.searchParams.get('payload') ?? s;
  } catch {
    return s;
  }
}

export default function Verify() {
  useDocumentTitle('Vérifier un certificat · RecallFarm');
  const [params, setParams] = useSearchParams();
  const payload = params.get('payload') ?? '';
  const [draft, setDraft] = useState(payload);
  useEffect(() => setDraft(payload), [payload]);

  const q = useQuery({
    queryKey: ['certificate', payload],
    queryFn: () => api.verifyCertificate(payload),
    enabled: payload.length > 0,
    retry: false,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const p = extractPayload(draft);
    if (p) setParams({ payload: p });
  }

  async function sample() {
    // dead branch outside mock mode: the fixtures chunk is not emitted in production builds
    if (import.meta.env.VITE_MOCK === '1') {
      const m = await import('../../mocks/server');
      setParams({ payload: m.sampleCertificatePayload() });
    }
  }

  const r = q.data;
  const err = q.error instanceof ApiError ? q.error : null;

  return (
    <div className="site">
      <a href="#main" className="skip-link">
        Aller au contenu
      </a>
      <SiteHeader />
      <main id="main" className="simple-main on-light">
        <div className="wrap simple-inner">
          <div className="eyebrow">Certificat antirabique · QR code</div>
          <h1 className="h2">Vérifier un certificat de vaccination</h1>
          <p className="lead-dark">
            Scannez le QR code du certificat avec l'appareil photo de votre téléphone, ou collez ici son contenu. La signature électronique est contrôlée par RecallFarm ; aucune donnée personnelle de l'éleveur n'est affichée.
          </p>

          <form className="verify-form" onSubmit={submit}>
            <label htmlFor="payload">Contenu du QR code</label>
            <textarea
              id="payload"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="eyJhIjoiUmV4Ii… (ou le lien complet https://…/verifier?payload=…)"
              spellCheck={false}
              aria-describedby="payload-help"
            />
            <span id="payload-help" className="sr-only">
              Format attendu : données encodées, un point, puis la signature.
            </span>
            <div className="verify-actions">
              <button type="submit" className="btn-navy" disabled={!draft.trim() || q.isFetching}>
                {q.isFetching ? 'Vérification…' : 'Vérifier'}
              </button>
              {import.meta.env.VITE_MOCK === '1' && (
                <button type="button" className="btn-link" onClick={sample}>
                  Essayer avec un certificat d'exemple
                </button>
              )}
            </div>
          </form>

          <div aria-live="polite">
            {q.isFetching && <p className="lead-dark">Contrôle de la signature…</p>}
            {!q.isFetching && r && (
              <section className={`verdict ${r.valid ? 'ok' : 'ko'}`} aria-labelledby="verdict-title">
                <div className="verdict-head">
                  <span className="verdict-icon">{r.valid ? <Check size={24} /> : <Close size={22} />}</span>
                  <div>
                    <h2 id="verdict-title">{r.valid ? 'Certificat valide' : 'Certificat non valide'}</h2>
                    <p className="lead-dark">
                      {r.valid
                        ? `Vaccination ${DISEASE_LABEL[r.disease ?? ''] ?? r.disease ?? ''} à jour${r.valid_until ? `, ${relDays(r.valid_until) === "aujourd'hui" ? "expire aujourd'hui" : `valable jusqu'au ${dateShort(r.valid_until)}`}` : ''}.`
                        : `Ce certificat ne peut pas être accepté${r.reason ? ` : ${REASONS[r.reason] ?? r.reason.replace(/_/g, ' ')}` : ''}.`}
                    </p>
                  </div>
                </div>
                {(r.animal_name || r.disease) && (
                  <dl>
                    <div>
                      <dt>Animal</dt>
                      <dd>
                        {r.animal_name ?? '—'}
                        {r.species ? ` · ${SPECIES[r.species] ?? r.species}` : ''}
                      </dd>
                    </div>
                    <div>
                      <dt>Vaccination</dt>
                      <dd>{DISEASE_LABEL[r.disease ?? ''] ?? r.disease ?? '—'}</dd>
                    </div>
                    <div>
                      <dt>Acte du</dt>
                      <dd>{dateShort(r.event_date)}</dd>
                    </div>
                    <div>
                      <dt>Valable jusqu'au</dt>
                      <dd>
                        {dateShort(r.valid_until)}
                        {r.valid_until && r.valid_until >= todayISO() ? ` (${relDays(r.valid_until)})` : ''}
                      </dd>
                    </div>
                  </dl>
                )}
              </section>
            )}
            {!q.isFetching && q.isError && (
              <section className="verdict ko" role="alert">
                <div className="verdict-head">
                  <span className="verdict-icon">
                    <Close size={22} />
                  </span>
                  <div>
                    <h2>{err?.code === 'VALIDATION_ERROR' ? 'Contenu illisible' : 'Vérification impossible'}</h2>
                    <p className="lead-dark">
                      {err?.code === 'VALIDATION_ERROR'
                        ? "Le texte collé n'est pas un certificat RecallFarm. Vérifiez qu'il est complet."
                        : (err?.message ?? 'Réessayez dans un instant.')}
                    </p>
                  </div>
                </div>
              </section>
            )}
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
