import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Overview from './pages/Overview';
import ServerWakeNotice from './components/ServerWakeNotice';

// "/" (the Overview) is in the main bundle for a fast first paint; the other pages load on first visit.
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Forecast = lazy(() => import('./pages/Forecast'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Alerts = lazy(() => import('./pages/Alerts'));
const Reports = lazy(() => import('./pages/Reports'));
const Nowcast = lazy(() => import('./pages/Nowcast'));
const NowcastResults = lazy(() => import('./pages/NowcastResults'));
const NowcastApproach = lazy(() => import('./pages/NowcastApproach'));

const Loading = () => (
  <div className="h-screen flex items-center justify-center text-base text-slate-500" role="status">Loading…</div>
);

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/dashboard" element={<Dashboard />} />
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
