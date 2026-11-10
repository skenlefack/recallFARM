import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useIsFetching, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/endpoints';
import {
  HBell,
  HChevron,
  HGear,
  HHelp,
  HSearch,
  HSync,
  IconAlert,
  IconBell,
  IconCampaign,
  IconCard,
  IconDashboard,
  IconDownload,
  IconFarm,
  IconMap,
  IconSliders,
  IconUsers,
} from '../components/icons';
import { LogoMark } from '../components/Logo';
import { Dialog, ErrorState, FieldErrors, Skeleton, useToast } from '../components/ui';
import { initials, num, PLAN_LABEL, ROLE_LABEL, shortName, since } from '../lib/format';
import { useAuth } from './auth';
import { PageMetaCtx, useOpenAlerts, useOrganisation, useOverdueCount, type PageMeta } from './hooks';

/* ------------------------------------------------------------ header bits */

export function IconButton({ label, onClick, children, badge, expanded, controls }: { label: string; onClick?: () => void; children: ReactNode; badge?: number; expanded?: boolean; controls?: string }) {
  return (
    <button type="button" className="icon-btn" aria-label={badge ? `${label} (${badge})` : label} title={label} onClick={onClick} aria-expanded={expanded} aria-controls={controls} aria-haspopup={controls ? 'true' : undefined}>
      {children}
      {!!badge && (
        <span className="icon-badge" aria-hidden="true">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );
}

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}

export function UserMenu({ roleLabel, onSettings }: { roleLabel: string; onSettings: () => void }) {
  const { me, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useOutside(open, close);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);
  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Tab') setOpen(false);
  };
  return (
    <div className="user-menu" ref={ref}>
      <button type="button" className="user-btn" aria-label={`Menu du compte : ${me?.name ?? ''}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="avatar">
          {me ? initials(me.name || me.phone) : ''}
          <span className="avatar-online" />
        </span>
        <span className="user-id">
          <span className="user-name">{me ? shortName(me.name || me.phone) : <Skeleton w={70} h={12} />}</span>
          <span className="user-role">{roleLabel}</span>
        </span>
        <HChevron />
      </button>
      {open && (
        <div className="menu" role="menu" tabIndex={-1} ref={menuRef} onKeyDown={onMenuKey} aria-label="Compte">
          <div className="menu-head">
            <b>{me?.name}</b>
            <span className="mono">{me?.phone}</span>
          </div>
          <button type="button" role="menuitem" onClick={() => (setOpen(false), onSettings())}>
            Mon profil et préférences
          </button>
          <Link to="/" role="menuitem" onClick={() => setOpen(false)}>
            Voir le site public
          </Link>
          <button type="button" role="menuitem" className="danger" onClick={signOut}>
            Se déconnecter
          </button>
        </div>
      )}
    </div>
  );
}

function NotificationsButton() {
  const alerts = useOpenAlerts();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useOutside(open, close);
  const n = alerts.data?.length ?? 0;
  return (
    <div className="pop-wrap" ref={ref}>
      <IconButton label="Notifications" badge={n} onClick={() => setOpen((o) => !o)} expanded={open} controls="notif-pop">
        <HBell />
      </IconButton>
      {open && (
        <div className="popover" id="notif-pop" role="dialog" aria-label="Notifications">
          <div className="popover-head">
            <b>Alertes ouvertes</b>
            <Link to="/admin/alertes" onClick={close}>
              Tout voir
            </Link>
          </div>
          {alerts.isLoading && <Skeleton h={40} />}
          {alerts.isError && <ErrorState compact error={alerts.error} />}
          {alerts.data?.length === 0 && <p className="muted small">Aucune alerte ouverte. Tout est calme.</p>}
          <ul className="notif-list">
            {alerts.data?.slice(0, 5).map((a) => (
              <li key={a.id}>
                <Link to={`/admin/alertes?focus=${a.id}`} onClick={close}>
                  <span className={`sev-dot-only sev-${a.severity}`} aria-hidden="true" />
                  <span>
                    <b>{a.title ?? a.rule_code}</b> · {a.farm_name}
                    <br />
                    <span className="muted small">
                      {a.message} · il y a {since(a.opened_at)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function SyncButton() {
  const qc = useQueryClient();
  const fetching = useIsFetching();
  const toast = useToast();
  const [spin, setSpin] = useState(false);
  return (
    <span className={spin || fetching > 0 ? 'spin' : ''}>
      <IconButton
        label="Synchroniser"
        onClick={async () => {
          setSpin(true);
          try {
            await qc.refetchQueries({ type: 'active' });
            toast('Données à jour.');
          } catch {
            toast('Synchronisation incomplète, réessayez.', 'err');
          } finally {
            setSpin(false);
          }
        }}
      >
        <HSync />
      </IconButton>
    </span>
  );
}

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Aide" footer={<button type="button" className="btn btn-primary" onClick={onClose}>Compris</button>}>
      <div className="stack">
        <p>Besoin d'un coup de main ? L'équipe RecallFarm répond du lundi au samedi, de 8 h à 18 h (heure de Yaoundé).</p>
        <ul className="help-list">
          <li>
            <b>WhatsApp et appel</b> · <span className="mono">+237 6 90 00 00 00</span>
          </li>
          <li>
            <b>E-mail</b> · <span className="mono">aide@recallfarm.app</span>
          </li>
        </ul>
        <h3 className="h-sm">Raccourcis clavier</h3>
        <ul className="help-list">
          <li>
            <kbd>/</kbd> rechercher un éleveur, un animal ou un lot
          </li>
          <li>
            <kbd>Échap</kbd> fermer une fenêtre ou un menu
          </li>
          <li>
            <kbd>Tab</kbd> passer d'un élément à l'autre ; tous les écrans se pilotent au clavier
          </li>
        </ul>
      </div>
    </Dialog>
  );
}

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(me?.name ?? '');
  const [lang, setLang] = useState(me?.language ?? 'fr');
  useEffect(() => {
    if (open) {
      setName(me?.name ?? '');
      setLang(me?.language ?? 'fr');
    }
  }, [open, me]);
  const m = useMutation({
    mutationFn: () => api.patchMe({ name: name.trim(), language: lang }),
    onSuccess: (r) => {
      qc.setQueryData(['me'], r);
      toast('Profil enregistré.');
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Profil et préférences"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" form="settings-form" className="btn btn-primary" disabled={m.isPending || !name.trim()}>
            {m.isPending ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </>
      }
    >
      <form id="settings-form" className="stack" onSubmit={submit}>
        <div className="field">
          <label htmlFor="set-name">Nom affiché</label>
          <input id="set-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="set-lang">Langue de l'interface</label>
          <select id="set-lang" className="input" value={lang} onChange={(e) => setLang(e.target.value)}>
            <option value="fr">Français</option>
            <option value="en">English (bientôt)</option>
          </select>
        </div>
        <div className="field">
          <span className="label">Téléphone</span>
          <span className="mono">{me?.phone}</span>
        </div>
        <FieldErrors error={m.error} />
      </form>
    </Dialog>
  );
}

function HeaderSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <form
      role="search"
      className="head-search"
      onSubmit={(e) => {
        e.preventDefault();
        navigate(`/admin/exploitations?q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <HSearch size={15} />
      <label htmlFor="head-q" className="sr-only">
        Rechercher un éleveur, un animal ou un n° de lot
      </label>
      <input ref={ref} id="head-q" type="search" placeholder="Éleveur, animal, n° de lot" value={q} onChange={(e) => setQ(e.target.value)} />
    </form>
  );
}

/* ------------------------------------------------------------ sidebar */

type Tile = { to: string; label: string; icon: ReactNode; badge?: number; tone?: 'amber' | 'coral'; end?: boolean };

export function TileNav({ tiles, label }: { tiles: Tile[]; label: string }) {
  return (
    <>
      <span className="nav-group">{label}</span>
      <ul className="tiles">
        {tiles.map((t) => (
          <li key={t.to}>
            <NavLink to={t.to} end={t.end} className="tile">
              <span className="tile-icon">{t.icon}</span>
              <span className="tile-label">{t.label}</span>
              {!!t.badge && (
                <span className={`tile-badge tile-badge-${t.tone ?? 'amber'}`} aria-label={`${t.badge} à traiter`}>
                  {t.badge > 99 ? '99+' : t.badge}
                </span>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </>
  );
}

function OrgCard() {
  const { membership } = useAuth();
  const org = useOrganisation();
  if (!membership) return null;
  return (
    <div className="org-card">
      <span className="org-k">ORGANISATION</span>
      <span className="org-name">{org.data?.name ?? membership.organisation_name}</span>
      <span className="org-sub">
        {org.data ? (
          <>
            {PLAN_LABEL[org.data.plan ?? 'structure'] ?? org.data.plan}
            {org.data.farmers_count !== undefined && ` · ${num(org.data.farmers_count)} éleveurs`}
          </>
        ) : (
          'Structure'
        )}
      </span>
    </div>
  );
}

/* --------------------------------------------------------------- shell */

export default function AdminShell() {
  const { me, membership, isLoading, error } = useAuth();
  const [meta, setMeta] = useState<PageMeta>({ title: 'Tableau de bord' });
  const setMetaStable = useCallback((m: PageMeta) => setMeta((p) => (p.title === m.title && p.subtitle === m.subtitle ? p : m)), []);
  const alerts = useOpenAlerts();
  const overdue = useOverdueCount();
  const [help, setHelp] = useState(false);
  const [settings, setSettings] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setNavOpen(false), [loc.pathname]);
  const mainRef = useRef<HTMLElement>(null);

  const roleLabel = membership ? (ROLE_LABEL[membership.role] ?? membership.role) : me?.platform_roles[0] ? (ROLE_LABEL[me.platform_roles[0]] ?? '') : '';

  const pilotage: Tile[] = [
    { to: '/admin', label: 'Tableau de bord', icon: <IconDashboard />, end: true },
    { to: '/admin/exploitations', label: 'Exploitations', icon: <IconFarm /> },
    { to: '/admin/rappels', label: 'Rappels', icon: <IconBell />, badge: overdue.data, tone: 'amber' },
    { to: '/admin/alertes', label: 'Alertes', icon: <IconAlert />, badge: alerts.data?.length, tone: 'coral' },
    { to: '/admin/campagnes', label: 'Campagnes', icon: <IconCampaign /> },
    { to: '/admin/surveillance', label: 'Surveillance', icon: <IconMap /> },
  ];
  const config: Tile[] = [
    { to: '/admin/studio', label: 'Studio', icon: <IconSliders /> },
    { to: '/admin/abonnements', label: 'Abonnements', icon: <IconCard /> },
    { to: '/admin/exports', label: 'Exports', icon: <IconDownload /> },
    { to: '/admin/utilisateurs', label: 'Utilisateurs', icon: <IconUsers /> },
  ];

  return (
    <PageMetaCtx.Provider value={setMetaStable}>
      <div className="admin">
        <a href="#admin-main" className="skip-link">
          Aller au contenu
        </a>
        <header className="admin-header">
          <Link to="/admin" className="logo-zone" aria-label="RecallFarm, tableau de bord">
            <LogoMark size={26} live={false} />
            <span>RecallFarm</span>
          </Link>
          <button type="button" className="burger" aria-label="Menu" aria-expanded={navOpen} aria-controls="admin-sidebar" onClick={() => setNavOpen((o) => !o)}>
            <span className="bars" aria-hidden="true" />
          </button>
          <div className="header-main">
            <div className="header-title">
              {meta.subtitle && <span className="header-sub">{meta.subtitle}</span>}
              <h1>{meta.title}</h1>
            </div>
            <HeaderSearch />
            <div className="header-actions">
              <SyncButton />
              <NotificationsButton />
              <IconButton label="Aide" onClick={() => setHelp(true)}>
                <HHelp />
              </IconButton>
              <IconButton label="Paramètres" onClick={() => setSettings(true)}>
                <HGear />
              </IconButton>
              <span className="header-div" aria-hidden="true" />
              <UserMenu roleLabel={roleLabel} onSettings={() => setSettings(true)} />
            </div>
          </div>
        </header>
        <div className="admin-body">
          <aside id="admin-sidebar" className={`sidebar${navOpen ? ' open' : ''}`}>
            <span className="sidebar-shine" aria-hidden="true" />
            <OrgCard />
            <nav aria-label="Administration" className="side-nav">
              <TileNav label="PILOTAGE" tiles={pilotage} />
              <TileNav label="CONFIGURATION" tiles={config} />
            </nav>
          </aside>
          {navOpen && <div className="sidebar-scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />}
          <main id="admin-main" ref={mainRef} className="admin-main" tabIndex={-1}>
            {isLoading ? (
              <div className="stack">
                <Skeleton h={40} w={320} />
                <div className="kpi-grid">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} h={110} r={18} />
                  ))}
                </div>
              </div>
            ) : error && !me ? (
              <ErrorState error={error} onRetry={() => location.reload()} />
            ) : (
              <Outlet />
            )}
          </main>
        </div>
        <HelpDialog open={help} onClose={() => setHelp(false)} />
        <SettingsDialog open={settings} onClose={() => setSettings(false)} />
      </div>
    </PageMetaCtx.Provider>
  );
}
