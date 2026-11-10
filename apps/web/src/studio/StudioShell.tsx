import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api, listOf } from '../api/endpoints';
import type { PackStatus } from '../api/types';
import { HGear, HHelp, HSearch } from '../components/icons';
import { LogoMark } from '../components/Logo';
import { HelpDialog, IconButton, SettingsDialog, SyncButton, UserMenu } from '../admin/Shell';
import { useAuth } from '../admin/auth';
import { ROLE_LABEL } from '../lib/format';

export const STATUS_CHIP: Record<PackStatus, { label: string; cls: string }> = {
  brouillon: { label: 'brouillon', cls: 'chip-draft' },
  en_revue: { label: 'en relecture', cls: 'chip-review' },
  teste: { label: 'approuvé', cls: 'chip-ok' },
  publie: { label: 'publié', cls: 'chip-ok' },
  retire: { label: 'retiré', cls: 'chip-off' },
};

function StudioBell() {
  const navigate = useNavigate();
  const packs = useQuery({ queryKey: ['studio-packs'], queryFn: api.studioPacks, select: listOf, staleTime: 30_000 });
  const n = packs.data?.filter((p) => p.draft?.status === 'en_revue').length ?? 0;
  return (
    <IconButton label="Versions en relecture" badge={n} onClick={() => navigate('/admin/studio/packs?statut=en_revue')}>
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 13V8.5a4.5 4.5 0 0 1 9 0V13l1.5 1.5H3z M7.5 16.5h3" />
      </svg>
    </IconButton>
  );
}

export function StudioShell({ crumbs, chip, nav, main, aside }: { crumbs: ReactNode; chip?: ReactNode; nav: ReactNode; main: ReactNode; aside?: ReactNode }) {
  const { me } = useAuth();
  const navigate = useNavigate();
  const [help, setHelp] = useState(false);
  const [settings, setSettings] = useState(false);
  const role = me?.platform_roles.includes('param_author')
    ? 'Référent paramétrage'
    : me?.platform_roles[0]
      ? (ROLE_LABEL[me.platform_roles[0]] ?? me.platform_roles[0])
      : me?.memberships[0]
        ? (ROLE_LABEL[me.memberships[0].role] ?? '')
        : '';
  return (
    <div className="studio">
      <a href="#studio-main" className="skip-link">
        Aller au contenu
      </a>
      <header className="studio-header">
        <Link to="/admin" className="studio-logo" aria-label="RecallFarm Studio, retour à l'administration">
          <LogoMark size={26} live={false} />
          <span className="studio-logo-text">
            <span className="studio-brand">RecallFarm</span>
            <span className="studio-k">STUDIO</span>
          </span>
        </Link>
        <nav className="studio-crumbs" aria-label="Fil d'Ariane">
          {crumbs}
          {chip}
        </nav>
        <div className="header-actions">
          <IconButton label="Rechercher un pack" onClick={() => navigate('/admin/studio/packs')}>
            <HSearch />
          </IconButton>
          <SyncButton />
          <StudioBell />
          <IconButton label="Aide" onClick={() => setHelp(true)}>
            <HHelp />
          </IconButton>
          <IconButton label="Paramètres" onClick={() => setSettings(true)}>
            <HGear />
          </IconButton>
          <span className="header-div" aria-hidden="true" />
          <UserMenu roleLabel={role} onSettings={() => setSettings(true)} />
        </div>
      </header>
      <div className={`studio-body${aside ? '' : ' no-aside'}`}>
        <nav className="studio-nav" aria-label="Objets du pack">
          <span className="sidebar-shine" aria-hidden="true" />
          {nav}
        </nav>
        <main id="studio-main" className="studio-main" tabIndex={-1}>
          {main}
        </main>
        {aside && (
          <aside className="studio-aside" aria-label="Relecture et publication">
            {aside}
          </aside>
        )}
      </div>
      <HelpDialog open={help} onClose={() => setHelp(false)} />
      <SettingsDialog open={settings} onClose={() => setSettings(false)} />
    </div>
  );
}
