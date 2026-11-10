import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AuthProvider } from './admin/auth';
import { ToastProvider } from './components/ui';
import Home from './pages/public/Home';

const Verify = lazy(() => import('./pages/public/Verify'));
const NotFound = lazy(() => import('./pages/public/NotFound'));
const AdminApp = lazy(() => import('./admin/AdminApp'));

function PageLoader() {
  return (
    <div className="page-loader" role="status" aria-label="Chargement">
      <span className="page-loader-ring" />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/verifier" element={<Verify />} />
            <Route path="/admin/*" element={<AdminApp />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </ToastProvider>
    </AuthProvider>
  );
}
