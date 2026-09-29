// Base URL of the lgbm_v0 nowcast API as seen by the browser.
// Default: through the team backend's /ml proxy. If that backend is down, point the
// frontend straight at the ML serving API instead, e.g.
//   VITE_ML_API_BASE=http://127.0.0.1:8001/api npm run dev
// Base URL of the team backend (Dashboard /alerts and /predict, services/api.js), as seen by the browser.
export const API_BASE = (import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000').replace(/\/+$/, '');

export const ML_API_BASE =(import.meta.env.VITE_ML_API_BASE || 'http://127.0.0.1:8000/ml').replace(/\/+$/, '');
