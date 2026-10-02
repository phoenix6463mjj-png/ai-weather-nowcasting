import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import ServerWakeNotice from './components/ServerWakeNotice';

// "/" (the team Dashboard) is in the main bundle; the other pages load on first visit.
const Overview = lazy(() => import('./pages/Overview'));
const Forecast = lazy(() => import('./pages/Forecast'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Alerts = lazy(() => import('./pages/Alerts'));
const Reports = lazy(() => import('./pages/Reports'));
const Nowcast = lazy(() => import('./pages/Nowcast'));
const NowcastResults = lazy(() => import('./pages/NowcastResults'));
const NowcastApproach = lazy(() => import('./pages/NowcastApproach'));

// old /dashboard links (and their ?city= search) go to "/"
const ToRoot = () => {
  const { search, hash } = useLocation();
  return <Navigate to={`/${search}${hash}`} replace />;
};

const Loading = () => (
  <div className="h-screen flex items-center justify-center text-base text-slate-500" role="status">Loading…</div>
);

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/overview" element={<Overview />} />
          <Route path="/dashboard" element={<ToRoot />} />
          <Route path="/forecast" element={<Forecast />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/nowcast" element={<Nowcast />} />
          <Route path="/nowcast/results" element={<NowcastResults />} />
          <Route path="/nowcast/approach" element={<NowcastApproach />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <ServerWakeNotice />
    </BrowserRouter>
  );
}

export default App;
