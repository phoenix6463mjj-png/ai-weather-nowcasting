// 3D view of the terrain around the shelter section's chosen point (lazy-loaded: three.js is only
// downloaded when this opens). Terrain: the 9" Copernicus DEM grid from /shelters/terrain, shaded by
// elevation, height exaggerated by EXAG (printed). Draped: the alerts on the map at the current lead, in
// their map colours. Rivers/streams (OpenStreetMap) in blue, the chosen point, numbered candidate pins as
// in the list. Drag to rotate, scroll to zoom, Reset; Esc / x closes. Observation and values only.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { X, RotateCcw } from 'lucide-react';
import { getShelterTerrain } from '../../services/nowcastApi';
import { HAZARD_STYLE, LEVEL_STYLE } from '../../utils/hazardLabels';

const EXAG = 2;
const KM_LAT = 110.57;
const KM_LON = 111.32;
const RAMP = [[0, [120, 160, 110]], [0.25, [176, 196, 120]], [0.5, [196, 170, 120]], [0.75, [150, 120, 100]], [1, [245, 245, 245]]];

function rampColour(t) {
    for (let i = 1; i < RAMP.length; i++) {
        if (t <= RAMP[i][0]) {
            const [t0, a] = RAMP[i - 1];
            const [t1, b] = RAMP[i];
            const f = (t - t0) / (t1 - t0);
            return a.map((v, k) => (v + f * (b[k] - v)) / 255);
        }
    }
    return RAMP[RAMP.length - 1][1].map((v) => v / 255);
}

function webglAvailable() {
    try {
        const c = document.createElement('canvas');
        return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch {
        return false;
    }
}

function label(text, filled, size) {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    g.beginPath(); g.arc(32, 32, 26, 0, Math.PI * 2);
    g.fillStyle = filled ? '#6d28d9' : '#ffffff'; g.fill();
    g.lineWidth = 6; g.strokeStyle = '#6d28d9'; g.stroke();
    g.fillStyle = filled ? '#ffffff' : '#5b21b6'; g.font = 'bold 26px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 32, 34);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
    s.scale.set(size, size, 1);
    return s;
}

function buildScene(t, point, pins, alerts) {
    const { nrows, ncols, bounds: b } = t;
    const lat0 = point.lat;
    const lon0 = point.lon;
    const kx = KM_LON * Math.cos((lat0 * Math.PI) / 180);
    const X = (lon) => (lon - lon0) * kx;
    const Z = (lat) => (lat0 - lat) * KM_LAT;
    const cellLat = (b.north - b.south) / nrows;
    const cellLon = (b.east - b.west) / ncols;
    const lo = t.min_m ?? 0;
    const hi = Math.max((t.max_m ?? 1), lo + 1);
    const h = (e) => ((e > 0 ? e : lo) / 1000) * EXAG;
    const elevAt = (lat, lon) => {
        const r = Math.min(nrows - 1, Math.max(0, Math.floor((b.north - lat) / cellLat)));
        const c = Math.min(ncols - 1, Math.max(0, Math.floor((lon - b.west) / cellLon)));
        return t.elev_m[r * ncols + c];
    };

    const pos = new Float32Array(nrows * ncols * 3);
    const col = new Float32Array(nrows * ncols * 3);
    const uv = new Float32Array(nrows * ncols * 2);
    for (let r = 0; r < nrows; r++) {
        const lat = b.north - (r + 0.5) * cellLat;
        for (let c = 0; c < ncols; c++) {
            const i = r * ncols + c;
            const e = t.elev_m[i];
            pos[3 * i] = X(b.west + (c + 0.5) * cellLon);
            pos[3 * i + 1] = h(e);
            pos[3 * i + 2] = Z(lat);
            const rgb = e > 0 ? rampColour((e - lo) / (hi - lo)) : [0.75, 0.78, 0.82];
            col.set(rgb, 3 * i);
            uv[2 * i] = c / (ncols - 1);
            uv[2 * i + 1] = 1 - r / (nrows - 1);
        }
    }
    const idx = [];
    for (let r = 0; r < nrows - 1; r++) {
        for (let c = 0; c < ncols - 1; c++) {
            const a = r * ncols + c;
            idx.push(a, a + ncols, a + 1, a + 1, a + ncols, a + ncols + 1);
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#e2e8f0');
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(-30, 40, -20);
    scene.add(sun);
    scene.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true })));

    // alerts at the current lead, drawn on a transparent canvas laid over the same surface
    if (alerts.length) {
        const cw = Math.min(2048, ncols * 6);
        const ch = Math.min(2048, nrows * 6);
        const cv = document.createElement('canvas');
        cv.width = cw; cv.height = ch;
        const g = cv.getContext('2d');
        const px = (lon) => ((lon - b.west) / (b.east - b.west)) * cw;
        const py = (lat) => ((b.north - lat) / (b.north - b.south)) * ch;
        for (const a of alerts) {
            const hz = HAZARD_STYLE[a.hazard];
            const lv = LEVEL_STYLE[a.level] || LEVEL_STYLE.Watch;
            const polys = a.geometry.type === 'Polygon' ? [a.geometry.coordinates] : a.geometry.coordinates;
            g.beginPath();
            for (const poly of polys) for (const ring of poly) ring.forEach(([lon, lat], k) => (k ? g.lineTo(px(lon), py(lat)) : g.moveTo(px(lon), py(lat))));
            g.globalAlpha = Math.min(0.75, lv.fillOpacity * 1.6);
            g.fillStyle = hz.color;
            g.fill('evenodd');
            g.globalAlpha = 1;
            g.lineWidth = 3;
            g.setLineDash(a.level === 'Warning' ? [] : [10, 8]);
            g.strokeStyle = hz.color;
            g.stroke();
        }
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        const drape = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false,
            polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
        drape.renderOrder = 1;
        scene.add(drape);
    }

    // rivers / streams
    for (const s of t.streams) {
        const p = s.coords.map(([lon, lat]) => new THREE.Vector3(X(lon), h(elevAt(lat, lon)) + 0.03, Z(lat)));
        if (p.length < 2) continue;
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(p),
            new THREE.LineBasicMaterial({ color: s.kind === 'river' ? '#1d4ed8' : '#3b82f6' }));
        line.renderOrder = 2;
        scene.add(line);
    }

    // the chosen point and the candidate pins (numbers as in the list); sized to the block (50 km -> 1, 100 km -> 2)
    const span = Math.max(Math.abs(X(b.east) - X(b.west)), Math.abs(Z(b.south) - Z(b.north)));
    const k = Math.max(1, span / 50);
    const stem = (x, z, y0, len, colour) => {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * k, 0.06 * k, len, 6), new THREE.MeshBasicMaterial({ color: colour }));
        m.position.set(x, y0 + len / 2, z);
        scene.add(m);
    };
    const yP = h(elevAt(point.lat, point.lon));
    stem(0, 0, yP, 2.2 * k, '#111827');
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.35 * k, 16, 12), new THREE.MeshBasicMaterial({ color: '#111827' }));
    dot.position.set(0, yP + 2.4 * k, 0);
    scene.add(dot);
    for (const c of pins) {
        const x = X(c.lon);
        const z = Z(c.lat);
        const y = h(elevAt(c.lat, c.lon));
        stem(x, z, y, 1.6 * k, '#6d28d9');
        const s = label(String(c.no ?? c.rank), c.outside_all_alerts, 1.6 * k);
        s.position.set(x, y + 2.3 * k, z);
        scene.add(s);
    }
    return { scene, yMid: h((lo + hi) / 2), span };
}

const Terrain3D = ({ point, radiusKm, pins, alerts, lead, wording, onClose }) => {
    const box = useRef(null);
    const ctl = useRef(null);
    const [state, setState] = useState({ status: webglAvailable() ? 'loading' : 'nowebgl', t: null, openMs: null });

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    useEffect(() => {
        if (state.status === 'nowebgl') return undefined;
        let live = true;
        const t0 = performance.now();
        getShelterTerrain(point.lat, point.lon, radiusKm > 25 ? 50 : 25)
            .then((t) => live && setState({ status: t.available ? 'data' : 'na', t, t0 }))
            .catch((e) => live && setState({ status: 'error', error: e.message }));
        return () => { live = false; };
    }, [point.lat, point.lon, radiusKm, state.status === 'nowebgl']); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (state.status !== 'data' || !box.current) return undefined;
        const el = box.current;
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(el.clientWidth, el.clientHeight);
        el.appendChild(renderer.domElement);
        const { scene, yMid, span } = buildScene(state.t, point, pins, alerts);
        const camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.1, 2000);
        camera.position.set(0, span * 0.7, span * 0.9);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.target.set(0, yMid, 0);
        controls.maxPolarAngle = Math.PI * 0.49;
        controls.update();
        controls.saveState();
        const draw = () => renderer.render(scene, camera);
        controls.addEventListener('change', draw);
        draw();
        const ro = new ResizeObserver(() => {
            camera.aspect = el.clientWidth / el.clientHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(el.clientWidth, el.clientHeight);
            draw();
        });
        ro.observe(el);
        // probe for the e2e / performance check: rotate for ms and count rendered frames
        const spin = (ms = 3000) => new Promise((resolve) => {
            let frames = 0;
            const start = performance.now();
            const tick = (now) => {
                controls.autoRotate = true;
                controls.autoRotateSpeed = 12;
                controls.update();
                draw();
                frames += 1;
                if (now - start < ms) requestAnimationFrame(tick);
                else { controls.autoRotate = false; resolve({ frames, ms: now - start, fps: (frames * 1000) / (now - start) }); }
            };
            requestAnimationFrame(tick);
        });
        window.__terrain3d = { spin };
        ctl.current = { reset: () => { controls.reset(); draw(); } };
        requestAnimationFrame(() => setState((s) => ({ ...s, openMs: Math.round(performance.now() - s.t0) })));
        return () => {
            ro.disconnect();
            controls.dispose();
            scene.traverse((o) => {
                o.geometry?.dispose?.();
                const m = o.material;
                if (m) (Array.isArray(m) ? m : [m]).forEach((x) => { x.map?.dispose?.(); x.dispose(); });
            });
            renderer.dispose();
            el.removeChild(renderer.domElement);
            delete window.__terrain3d;
        };
    }, [state.status, state.t]); // eslint-disable-line react-hooks/exhaustive-deps

    const hazards = [...new Set(alerts.map((a) => a.hazard))];
    const t = state.t;
    return (
        <div data-testid="terrain3d-overlay" className="fixed inset-0 z-[2000] bg-black/60 flex items-center justify-center p-3" onClick={onClose}>
            <div role="dialog" aria-label="3D view" onClick={(e) => e.stopPropagation()}
                className="bg-white dark:bg-[#0f172a] rounded-xl shadow-2xl flex flex-col w-[min(1200px,96vw)] h-[min(820px,94vh)]">
                <header className="flex items-center gap-3 px-4 py-2 border-b border-slate-200 dark:border-slate-700">
                    <h3 className="text-sm font-black text-slate-900 dark:text-white">3D view</h3>
                    <span data-testid="terrain3d-exaggeration" className="text-xs font-black px-2 py-0.5 rounded bg-slate-800 text-white">Height ×{EXAG}</span>
                    {t?.available && <span className="text-xs text-slate-600 dark:text-slate-300">{(t.half_km * 2).toFixed(0)} × {(t.half_km * 2).toFixed(0)} km around {point.lat.toFixed(3)}N {point.lon.toFixed(3)}E · alerts at +{lead} h as on the map</span>}
                    <button type="button" data-testid="terrain3d-reset" onClick={() => ctl.current?.reset()} disabled={state.status !== 'data'}
                        className="ml-auto flex items-center gap-1 px-2 py-1 rounded text-xs font-bold border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40">
                        <RotateCcw size={13} /> Reset view
                    </button>
                    <button type="button" data-testid="terrain3d-close" onClick={onClose} title="Close (Esc)" aria-label="Close 3D view"
                        className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"><X size={16} /></button>
                </header>
                <div className="relative flex-1 min-h-0">
                    <div ref={box} data-testid="terrain3d" data-status={state.status} data-open-ms={state.openMs ?? ''}
                        className="absolute inset-0 cursor-grab active:cursor-grabbing" />
                    {state.status === 'loading' && <p className="absolute inset-0 flex items-center justify-center text-sm text-slate-600">Loading terrain…</p>}
                    {state.status === 'nowebgl' && (
                        <p data-testid="terrain3d-fallback" className="absolute inset-0 flex items-center justify-center text-sm font-bold text-slate-700 dark:text-slate-200 px-6 text-center">
                            The 3D view needs WebGL, which this browser does not provide. The list and the elevation profiles show the same values.
                        </p>
                    )}
                    {state.status === 'na' && <p className="absolute inset-0 flex items-center justify-center text-sm">{t.message}</p>}
                    {state.status === 'error' && <p className="absolute inset-0 flex items-center justify-center text-sm text-red-600">{state.error}</p>}
                    {state.status === 'data' && <p className="absolute top-2 left-3 text-xs text-slate-700 bg-white/80 rounded px-2 py-1">Drag to rotate · scroll to zoom</p>}
                </div>
                <footer className="px-4 py-2 border-t border-slate-200 dark:border-slate-700 space-y-1 text-xs">
                    <div data-testid="terrain3d-legend" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-700 dark:text-slate-200">
                        {t?.available && (
                            <span className="flex items-center gap-1">
                                <span className="inline-block w-16 h-2.5 rounded-sm" style={{ background: 'linear-gradient(90deg, rgb(120,160,110), rgb(176,196,120), rgb(196,170,120), rgb(150,120,100), rgb(245,245,245))' }} />
                                {t.min_m.toLocaleString()}–{t.max_m.toLocaleString()} m
                            </span>
                        )}
                        {hazards.map((hz) => <span key={hz} className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: HAZARD_STYLE[hz].color, opacity: 0.7 }} />{HAZARD_STYLE[hz].name} alert</span>)}
                        <span className="flex items-center gap-1"><span className="inline-block w-4 h-0.5 bg-blue-700" />rivers / streams (OpenStreetMap)</span>
                        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-slate-900" />Your chosen location</span>
                        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full bg-violet-700" />Public building outside all alert areas</span>
                        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full border-2 border-violet-700" />Public building inside an alert area</span>
                    </div>
                    <p data-testid="terrain3d-wording" className="font-bold text-amber-950 dark:text-amber-100 bg-amber-100 dark:bg-amber-900/40 rounded px-2 py-1">{wording}</p>
                    <p className="text-xs text-slate-500">Terrain: Copernicus DEM GLO-90, 9″ grid{t?.stride > 1 ? ` (every ${t.stride}nd cell)` : ''}; rivers/streams © OpenStreetMap contributors (ODbL). Heights are drawn ×{EXAG}; distances are not.</p>
                </footer>
            </div>
        </div>
    );
};

export default Terrain3D;
