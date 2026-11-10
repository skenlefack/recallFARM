import { Link } from 'react-router-dom';
import { SiteFooter, SiteHeader, useDocumentTitle } from './SiteChrome';

export default function NotFound() {
  useDocumentTitle('Page introuvable · RecallFarm');
  return (
    <div className="site">
      <SiteHeader />
      <main id="main" className="simple-main on-light">
        <div className="wrap simple-inner">
          <div className="nf-code" aria-hidden="true">
            404
          </div>
          <h1 className="h2">Cette page s'est égarée du troupeau.</h1>
          <p className="lead-dark">Le lien est peut-être ancien, ou la page a changé d'adresse. Revenez à l'accueil ou connectez-vous à votre espace.</p>
          <div className="verify-actions">
            <Link to="/" className="btn-navy" style={{ textDecoration: 'none' }}>
              Retour à l'accueil
            </Link>
            <Link to="/admin" className="btn-link">
              Espace d'administration
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
