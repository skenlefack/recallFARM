import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { api } from '../../api/endpoints';
import { LogoMark } from '../../components/Logo';
import { phone as fmtPhone } from '../../lib/format';
import { useDocumentTitle } from '../../pages/public/SiteChrome';
import { useAuth } from '../auth';
import { useSessionState } from '../useSession';

const DEMO = [
  ['+237690000002', 'Aïcha Nana', 'Administratrice, Coop. avicole du Centre'],
  ['+237690000003', 'Jean-Marc', 'Référent paramétrage (studio)'],
  ['+237690000004', 'Dr Mbarga', 'Réviseur et publieur (studio)'],
];

export function normalizePhone(raw: string): string {
  const d = raw.replace(/[\s.()-]/g, '');
  if (d.startsWith('+')) return d;
  if (d.startsWith('00')) return '+' + d.slice(2);
  if (/^6\d{8}$/.test(d)) return '+237' + d;
  return d;
}

export default function Login() {
  useDocumentTitle('Connexion · RecallFarm');
  const [params] = useSearchParams();
  const next = params.get('next') || '/admin';
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const authed = useSessionState();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [phoneErr, setPhoneErr] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const req = useMutation({
    mutationFn: (p: string) => api.requestOtp(p),
    onSuccess: (r) => {
      setDevCode(r.dev_code ?? null);
      setWait(r.retry_after_s ?? 30);
      setStep('code');
      setTimeout(() => codeRef.current?.focus(), 0);
    },
  });
  const verify = useMutation({
    mutationFn: () => api.verifyOtp(normalizePhone(phone), code.trim()),
    onSuccess: (r) => {
      signIn(r);
      const u = r.user;
      const studioOnly = !u.memberships?.length && u.platform_roles?.some((x) => x.startsWith('param_'));
      navigate(studioOnly && next === '/admin' ? '/admin/studio' : next, { replace: true });
    },
  });

  if (authed && !verify.isSuccess) return <Navigate to={next} replace />;

  function submitPhone(e: FormEvent) {
    e.preventDefault();
    const p = normalizePhone(phone);
    if (!/^\+\d{9,15}$/.test(p)) {
      req.reset();
      setPhoneErr('Numéro au format international, par exemple +237 6 90 00 00 02.');
      return;
    }
    setPhoneErr(null);
    req.mutate(p);
  }
  function submitCode(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{4,8}$/.test(code.trim())) return;
    verify.mutate();
  }

  const rateMsg = (e: unknown) => {
    if (!(e instanceof ApiError) || e.code !== 'RATE_LIMITED') return null;
    const s = Number(e.details?.retry_after_s);
    return `Trop de demandes de code pour ce numéro. Réessayez ${s > 0 ? `dans ${Math.ceil(s / 60)} min` : 'dans quelques minutes'}.`;
  };
  const reqErr = phoneErr ?? rateMsg(req.error) ?? (req.error instanceof ApiError ? (req.error.fields?.phone ?? req.error.message) : req.error ? 'Envoi impossible. Réessayez.' : null);
  const codeErr = verify.error instanceof ApiError ? (verify.error.fields?.code ?? verify.error.message) : verify.error ? 'Vérification impossible. Réessayez.' : null;

  return (
    <div className="login">
      <aside className="login-side" aria-hidden="true">
        <div className="login-brand">
          <LogoMark size={34} />
          <span>RecallFarm</span>
        </div>
        <div className="login-pitch">
          <p className="login-kicker">Espace d'administration</p>
          <p className="login-big">Rappels, alertes et paramétrage de vos exploitations, au même endroit.</p>
        </div>
        <svg className="login-rings" viewBox="0 0 400 400">
          <circle cx="200" cy="200" r="190" fill="none" stroke="rgba(255,255,255,0.18)" />
          <circle cx="200" cy="200" r="130" fill="none" stroke="rgba(255,255,255,0.22)" strokeDasharray="2 6" />
          <circle cx="200" cy="200" r="70" fill="none" stroke="rgba(200,241,105,0.6)" />
          <circle cx="200" cy="200" r="10" fill="#C8F169" />
        </svg>
      </aside>
      <main className="login-main">
        <div className="login-card">
          <Link to="/" className="login-back">
            ← Retour au site
          </Link>
          <h1>Se connecter</h1>
          {params.get('expired') && step === 'phone' && (
            <p className="notice notice-warn" role="status">
              Votre session a expiré. Reconnectez-vous pour continuer.
            </p>
          )}
          {step === 'phone' ? (
            <form onSubmit={submitPhone} noValidate className="stack">
              <p className="muted">Nous envoyons un code à usage unique par SMS. Pas de mot de passe à retenir.</p>
              <div className="field">
                <label htmlFor="login-phone">Numéro de téléphone</label>
                <input
                  id="login-phone"
                  className="input input-lg"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+237 6 90 00 00 02"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  aria-invalid={!!reqErr}
                  aria-describedby={reqErr ? 'login-phone-err' : undefined}
                  autoFocus
                />
                {reqErr && (
                  <span id="login-phone-err" className="field-err" role="alert">
                    {reqErr}
                  </span>
                )}
              </div>
              <button type="submit" className="btn btn-primary btn-lg" disabled={req.isPending}>
                {req.isPending ? 'Envoi du code…' : 'Recevoir le code'}
              </button>
              {import.meta.env.VITE_MOCK === '1' && (
                <div className="demo-accounts">
                  <p className="muted small">Comptes de démonstration</p>
                  {DEMO.map(([p, n, r]) => (
                    <button key={p} type="button" className="demo-acc" onClick={() => setPhone(fmtPhone(p))}>
                      <b>{n}</b>
                      <span>{r}</span>
                      <span className="mono">{fmtPhone(p)}</span>
                    </button>
                  ))}
                </div>
              )}
            </form>
          ) : (
            <form onSubmit={submitCode} noValidate className="stack">
              <p className="muted">
                Code envoyé au <b>{fmtPhone(normalizePhone(phone))}</b>.{' '}
                <button type="button" className="link-btn" onClick={() => (setStep('phone'), setCode(''), verify.reset())}>
                  Modifier
                </button>
              </p>
              {devCode && (
                <p className="notice notice-info" role="status">
                  Mode développement : le code est <b className="mono">{devCode}</b>.
                </p>
              )}
              <div className="field">
                <label htmlFor="login-code">Code reçu par SMS</label>
                <input
                  ref={codeRef}
                  id="login-code"
                  className="input input-lg input-code mono"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={8}
                  placeholder="••••••"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  aria-invalid={!!codeErr}
                  aria-describedby={codeErr ? 'login-code-err' : undefined}
                />
                {codeErr && (
                  <span id="login-code-err" className="field-err" role="alert">
                    {codeErr}
                  </span>
                )}
              </div>
              <button type="submit" className="btn btn-primary btn-lg" disabled={verify.isPending || code.length < 4}>
                {verify.isPending ? 'Vérification…' : 'Se connecter'}
              </button>
              <button type="button" className="link-btn" disabled={wait > 0 || req.isPending} onClick={() => req.mutate(normalizePhone(phone))}>
                {wait > 0 ? `Renvoyer le code dans ${wait} s` : 'Renvoyer le code'}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
