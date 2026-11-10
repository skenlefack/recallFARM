import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ApiError, errorMessage } from '../api/client';
import { Close } from './icons';

/* ------------------------------------------------------------ skeleton */

export function Skeleton({ w = '100%', h = 14, r = 8, style }: { w?: number | string; h?: number | string; r?: number; style?: React.CSSProperties }) {
  return <span className="skel" aria-hidden="true" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

export function SkeletonRows({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="skel-rows" role="status" aria-label="Chargement">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skel-row">
          {Array.from({ length: cols }, (_, j) => (
            <Skeleton key={j} w={j === 0 ? '18%' : j === cols - 1 ? '12%' : `${22 + ((i + j) % 3) * 8}%`} />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------- empty and error */

export function EmptyState({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon" aria-hidden="true">
        {icon ?? (
          <svg width="28" height="28" viewBox="0 0 30 30">
            <circle cx="15" cy="15" r="13" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="15" cy="15" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" />
            <circle cx="15" cy="15" r="2.4" fill="currentColor" />
          </svg>
        )}
      </span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

const ERROR_TITLES: Record<string, string> = {
  NETWORK: 'Pas de connexion',
  FORBIDDEN: 'Accès refusé',
  PLAN_REQUIRED: 'Fonction non incluse dans votre formule',
  NOT_FOUND: 'Introuvable',
  RATE_LIMITED: 'Trop de demandes',
  SERVER_ERROR: 'Le serveur ne répond pas correctement',
};

export function ErrorState({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  const e = error instanceof ApiError ? error : null;
  const title = (e && ERROR_TITLES[e.code]) ?? 'Chargement impossible';
  const plan = e?.code === 'PLAN_REQUIRED' ? String(e.details?.required_plan ?? '') : '';
  return (
    <div className={`error-state${compact ? ' compact' : ''}`} role="alert">
      <span className="error-icon" aria-hidden="true">
        !
      </span>
      <div>
        <h3>{title}</h3>
        <p>
          {errorMessage(error)}
          {plan && ` Formule requise : ${plan}.`}
        </p>
        {e && e.code !== 'NETWORK' && <p className="error-code mono">{e.code}</p>}
      </div>
      {onRetry && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
          Réessayer
        </button>
      )}
    </div>
  );
}

/** Inline field error list for VALIDATION_ERROR responses. */
export function FieldErrors({ error }: { error: unknown }) {
  if (!(error instanceof ApiError)) return error ? <p className="form-error" role="alert">{errorMessage(error)}</p> : null;
  return (
    <div className="form-error" role="alert">
      <p>{error.message}</p>
      {error.fields && Object.keys(error.fields).length > 0 && (
        <ul>
          {Object.entries(error.fields).map(([k, v]) => (
            <li key={k}>{v}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- dialog */

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  description,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  description?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>('[data-autofocus]') ?? node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
      if (e.key === 'Tab' && node) {
        const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.offsetParent !== null || x === document.activeElement);
        if (!items.length) return;
        const a = items[0];
        const z = items[items.length - 1];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          z.focus();
        } else if (!e.shiftKey && document.activeElement === z) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`dialog dialog-${size}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descId : undefined} tabIndex={-1}>
        <div className="dialog-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn-light" aria-label="Fermer" onClick={onClose}>
            <Close />
          </button>
        </div>
        {description && (
          <p id={descId} className="dialog-desc">
            {description}
          </p>
        )}
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- toasts */

type Toast = { id: number; text: string; tone: 'ok' | 'err' | 'info' };
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-2), { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/* ------------------------------------------------------------- bits */

export function Card({ title, actions, children, className = '', id, padded = true, as = 'section' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string; padded?: boolean; as?: 'section' | 'div' }) {
  const Tag = as;
  const hid = id ? `${id}-title` : undefined;
  return (
    <Tag className={`card${padded ? '' : ' card-flush'} ${className}`} aria-labelledby={title ? hid : undefined}>
      {(title || actions) && (
        <div className="card-head">
          {title && <h2 id={hid}>{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </Tag>
  );
}

export function Seg<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[]; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count !== undefined && <span className="seg-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

const SEV: Record<string, { label: string; cls: string }> = {
  critique: { label: 'Critique', cls: 'sev-crit' },
  elevee: { label: 'Élevée', cls: 'sev-high' },
  attention: { label: 'Attention', cls: 'sev-high' },
  haute: { label: 'Haute', cls: 'sev-high' },
  info: { label: 'Info', cls: 'sev-info' },
  normale: { label: 'Normale', cls: 'sev-info' },
};
export function SeverityDot({ severity }: { severity: string }) {
  const s = SEV[severity] ?? { label: severity, cls: 'sev-info' };
  return (
    <span className={`sev ${s.cls}`}>
      <span className="sev-dot" aria-hidden="true" />
      {s.label}
    </span>
  );
}

export function Pill({ tone = 'neutral', children }: { tone?: 'ok' | 'warn' | 'crit' | 'info' | 'neutral' | 'blue'; children: ReactNode }) {
  return <span className={`pill-s pill-${tone}`}>{children}</span>;
}

export function Spinner({ label = 'Chargement' }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h2 className="page-title">{title}</h2>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
