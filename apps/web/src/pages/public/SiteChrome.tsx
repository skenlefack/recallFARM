import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LogoMark } from '../../components/Logo';

/** Anchors work from any public page: on "/" they scroll, elsewhere they navigate to "/#id". */
function anchor(pathname: string, id: string) {
  return pathname === '/' ? `#${id}` : `/#${id}`;
}

export function SiteHeader() {
  const { pathname, hash } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname, hash]);
  useEffect(() => {
    if (!open) return;
    const onHash = () => setOpen(false);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [open]);
  const a = (id: string) => anchor(pathname, id);
  return (
    <header className="site-header">
      <nav aria-label="Navigation principale" className={`wrap site-nav${open ? ' open' : ''}`}>
        <Link to="/" className="brand" aria-label="RecallFarm, accueil">
          <LogoMark />
          <span className="brand-name">RecallFarm</span>
        </Link>
        <button type="button" className="nav-toggle" aria-expanded={open} aria-controls="site-menu" onClick={() => setOpen((o) => !o)}>
          <span className="bars" aria-hidden="true" />
          <span className="sr-only">{open ? 'Fermer le menu' : 'Ouvrir le menu'}</span>
        </button>
        <div className="nav-links" id="site-menu">
          <a href={a('produit')}>Produit</a>
          <a href={a('suivi')}>Suivi à distance</a>
          <a href={a('pourqui')}>Pour qui</a>
          <a href={a('tarifs')}>Tarifs</a>
          <a href={a('confiance')}>Normes et données</a>
        </div>
        <div className="nav-actions">
          <Link to="/admin/login" className="nav-login">
            Se connecter
          </Link>
          <a href={a('demarrer')} className="pill pill-lime nav-cta">
            Essayer gratuitement
          </a>
        </div>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  const { pathname } = useLocation();
  const a = (id: string) => anchor(pathname, id);
  return (
    <footer className="site-footer">
      <div className="wrap footer-inner">
        <div className="footer-brand">
          <b>RecallFarm</b>
          <span>Gestion d'élevage paramétrable pour l'Afrique. Yaoundé · Dakar · Abidjan.</span>
        </div>
        <nav className="footer-col" aria-labelledby="ft-produit">
          <h2 id="ft-produit">Produit</h2>
          <a href={a('produit')}>Fonctionnalités</a>
          <a href={a('suivi')}>Ferme connectée</a>
          <a href={a('tarifs')}>Tarifs</a>
        </nav>
        <nav className="footer-col" aria-labelledby="ft-res">
          <h2 id="ft-res">Ressources</h2>
          <a href={a('confiance')}>Charte des données</a>
          <a href={a('confiance')}>Fiches et audios</a>
          <a href={a('demo')}>Devenir partenaire</a>
          <Link to="/verifier">Vérifier un certificat</Link>
        </nav>
        <div className="footer-col">
          <h2>Langue</h2>
          <span>
            Français · <span lang="en">English</span>
          </span>
        </div>
      </div>
    </footer>
  );
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
