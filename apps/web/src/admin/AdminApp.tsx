import { Route, Routes } from 'react-router-dom';
import '../styles/admin.css';
import '../styles/studio.css';
import { RequireAuth } from './auth';
import AdminShell from './Shell';
import Alerts from './pages/Alerts';
import Dashboard from './pages/Dashboard';
import Exports from './pages/Exports';
import FarmDetail from './pages/FarmDetail';
import Farms from './pages/Farms';
import Login from './pages/Login';
import Reminders from './pages/Reminders';
import Payments from './pages/Payments';
import Subscriptions from './pages/Subscriptions';
import Users from './pages/Users';
import { Campaigns, Surveillance } from './pages/V2Pages';
import Catalogue, { OpenPack, StudioIndex } from '../studio/Catalogue';
import Workspace from '../studio/Workspace';
import { EmptyState } from '../components/ui';
import { Link } from 'react-router-dom';

function AdminNotFound() {
  return (
    <EmptyState title="Écran introuvable" action={<Link to="/admin" className="btn btn-primary">Retour au tableau de bord</Link>}>
      Cette adresse ne correspond à aucun écran de l'administration.
    </EmptyState>
  );
}

/** Everything under /admin (lazy-loaded chunk). */
export default function AdminApp() {
  return (
    <Routes>
      <Route path="login" element={<Login />} />
      <Route
        path="studio/*"
        element={
          <RequireAuth>
            <Routes>
              <Route index element={<StudioIndex />} />
              <Route path="packs" element={<Catalogue />} />
              <Route path="p/:code" element={<OpenPack />} />
              <Route path="v/:versionId" element={<Workspace />} />
              <Route path="v/:versionId/:section" element={<Workspace />} />
              <Route path="*" element={<StudioIndex />} />
            </Routes>
          </RequireAuth>
        }
      />
      <Route
        element={
          <RequireAuth>
            <AdminShell />
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="exploitations" element={<Farms />} />
        <Route path="exploitations/:id" element={<FarmDetail />} />
        <Route path="rappels" element={<Reminders />} />
        <Route path="alertes" element={<Alerts />} />
        <Route path="campagnes" element={<Campaigns />} />
        <Route path="surveillance" element={<Surveillance />} />
        <Route path="abonnements" element={<Subscriptions />} />
        <Route path="paiements" element={<Payments />} />
        <Route path="exports" element={<Exports />} />
        <Route path="utilisateurs" element={<Users />} />
        <Route path="*" element={<AdminNotFound />} />
      </Route>
    </Routes>
  );
}
