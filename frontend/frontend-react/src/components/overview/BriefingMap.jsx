import { useEffect } from 'react';
import { MapContainer, TileLayer, ImageOverlay, CircleMarker, GeoJSON, Tooltip, ZoomControl, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { mlUrl } from '../../services/nowcastApi';
import { HAZARD_STYLE, LEVEL_STYLE } from '../../utils/hazardLabels';
import { terrainAttribution } from '../nowcast/useTerrain';
import AttributionHeight from '../nowcast/AttributionHeight';
import { stepViews, layerNames } from '../../utils/briefing';

// The Overview's pinned map. Each step shows its own layers; images are mounted only for the step that
// shows them (later steps' assets load when reached). Every layer is an existing ML API image or polygon.
const INSAT_CREDIT = 'INSAT: Data Source MOSDAC/SAC/ISRO';

// Moves the map to the step's view: flies (smooth) or jumps (reduced motion).
const Fly = ({ bounds, reduced }) => {
    const map = useMap();
    const key = JSON.stringify(bounds);
    useEffect(() => {
        if (!bounds) return;
        map.invalidateSize({ animate: false });
        if (reduced) map.fitBounds(bounds, { animate: false });
        else map.flyToBounds(bounds, { duration: 1.1 });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, reduced, map]);
    return null;
};

const SiteDots = ({ sites, sized, highlight }) => sites.map((s) => {
    const r = sized ? 3 + Math.sqrt(s.imerg_peak_mmhr) * 2.2 : 6;
    const ge30 = s.imerg_peak_mmhr >= 30;
    const colour = sized ? (ge30 ? '#dc2626' : '#2563eb') : (s.split === 'test' ? '#7c3aed' : '#0284c7');
    return (
        <CircleMarker key={s.episode} center={[s.lat, s.lon]} radius={r}
            pathOptions={{ color: '#fff', weight: 1.5, fillColor: colour, fillOpacity: highlight && !highlight.includes(s.episode) ? 0.25 : 0.85 }}>
            <Tooltip>{s.site} ({s.date}){sized ? ` · IMERG peak ${s.imerg_peak_mmhr} mm/hr` : ''}</Tooltip>
        </CircleMarker>
    );
});

const BriefingMap = ({ data, step, scrub, reduced }) => {
    const views = stepViews(data);
    const m = data?.malana;
    const [tsW, cbW] = m ? m.warnings : [null, null];
    const at = (iso) => scrub != null && iso && iso.slice(11, 16) <= scrub;
    const blindIds = data ? data.insat.events.map((e) => e.episode) : [];
    const snap = data?.realtime.snapshots[0];
    return (
        <div data-testid="briefing-map" data-step={step + 1} className="relative w-full h-full">
            <MapContainer center={[30.5, 78]} zoom={5} zoomControl={false} scrollWheelZoom={false} className="w-full h-full !rounded-none"
                attributionControl>
                <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' />
                <ZoomControl position="bottomright" />
                <AttributionHeight />
                {views && <Fly bounds={views[step]} reduced={reduced} />}
                {/* terrain: national hillshade (steps 1, 2, 6, 8), the Malana box (3-5) */}
                {data && [0, 1, 5, 7].includes(step) && (
                    <ImageOverlay url={mlUrl(data.terrain.path)} bounds={data.terrain.bounds} opacity={0.45}
                        attribution={terrainAttribution(data.terrain.notice)} />
                )}
                {data && [2, 3, 4].includes(step) && (
                    <ImageOverlay url={mlUrl(m.terrain.path)} bounds={m.terrain.bounds} opacity={0.4}
                        attribution={terrainAttribution(data.terrain.notice)} />
                )}
                {data && step === 0 && <SiteDots sites={data.sites} />}
                {data && (step === 1 || step === 5) && <SiteDots sites={data.sites} sized />}
                {/* step 3: Malana, alerts appear with the scrubber; step 4 keeps the explained Warning */}
                {data && step === 2 && at(tsW.issue_time) && (
                    <GeoJSON key="ts" data={tsW.polygon} style={{ color: HAZARD_STYLE.thunderstorm.color, fillColor: HAZARD_STYLE.thunderstorm.color, ...LEVEL_STYLE.Warning }} />
                )}
                {data && (step === 3 || (step === 2 && at(cbW.issue_time))) && (
                    <GeoJSON key="cb" data={cbW.polygon} style={{ color: HAZARD_STYLE.cloudburst.color, fillColor: HAZARD_STYLE.cloudburst.color, ...LEVEL_STYLE.Warning }} />
                )}
                {data && step === 2 && at(m.imerg_first_ge30.t) && (
                    <ImageOverlay url={mlUrl(m.imerg_layer.path)} bounds={m.imerg_layer.bounds} opacity={0.5}
                        attribution="IMERG: NASA GES DISC" />
                )}
                {data && step === 4 && (
                    <ImageOverlay url={mlUrl(data.insat.path)} bounds={data.insat.bounds} opacity={0.75} attribution={INSAT_CREDIT} />
                )}
                {data && step === 6 && snap && (
                    <ImageOverlay url={mlUrl(snap.path)} bounds={snap.bounds} opacity={0.7} attribution={INSAT_CREDIT} />
                )}
                {data && [2, 3, 4].includes(step) && (
                    <CircleMarker center={[m.lat, m.lon]} radius={8} pathOptions={{ color: '#fff', weight: 2, fillColor: '#111827', fillOpacity: 1 }}>
                        <Tooltip permanent direction="right" offset={[10, 0]}>{m.site}</Tooltip>
                    </CircleMarker>
                )}
                {data && step === 4 && <SiteDots sites={data.sites.filter((s) => blindIds.includes(s.episode))} />}
            </MapContainer>
            {/* which layers this step shows (tests and screen readers) */}
            <span data-testid="briefing-layers" className="sr-only">{layerNames(step, data, scrub).join(', ')}</span>
        </div>
    );
};

export default BriefingMap;
