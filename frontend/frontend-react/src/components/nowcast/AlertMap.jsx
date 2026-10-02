import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, CircleMarker, Circle, Tooltip, Popup, ImageOverlay, Rectangle, Pane, ZoomControl, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { HAZARD_STYLE, LEVEL_STYLE, VERIFY_STYLE, valueText } from '../../utils/hazardLabels';
import { terrainAttribution } from './useTerrain';
import AttributionHeight from './AttributionHeight';


// Fit the issue's bounds (4 px padding: India stays at zoom 4 at 1366x768); until the user pans or zooms, a container resize (the drawer opening on load, badges
// wrapping) fits them again, so the opening view always shows the whole domain.
const FitBounds = ({ bounds }) => {
    const map = useMap();
    const key = JSON.stringify(bounds);
    const touched = useRef(false);
    useEffect(() => {
        const el = map.getContainer();
        const touch = () => { touched.current = true; };
        el.addEventListener('pointerdown', touch);
        el.addEventListener('wheel', touch, { passive: true });
        el.addEventListener('keydown', touch);
        return () => { el.removeEventListener('pointerdown', touch); el.removeEventListener('wheel', touch); el.removeEventListener('keydown', touch); };
    }, [map]);
    useEffect(() => {
        touched.current = false;
        if (!bounds) return undefined;
        const box = map.getContainer();
        box.dataset.userView = '';
        const fit = () => { map.invalidateSize({ animate: false }); map.fitBounds(bounds, { padding: [4, 4], animate: false }); };
        fit();
        const ro = new ResizeObserver(() => { if (!touched.current && !box.dataset.userView) fit(); });
        ro.observe(map.getContainer());
        return () => ro.disconnect();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, map]);
    return null;
};

// The drawer pushes the map (it never covers it), so the container changes size: keep Leaflet in sync.
const TrackSize = () => {
    const map = useMap();
    useEffect(() => {
        const el = map.getContainer();
        const ro = new ResizeObserver(() => map.invalidateSize({ animate: false }))   // keeps the map centre;
        ro.observe(el);
        return () => ro.disconnect();
    }, [map]);
    return null;
};

// "Nearby shelter options" open: a map click (also on an alert) chooses the point; crosshair cursor.
const PickPoint = ({ onPick }) => {
    const map = useMap();
    useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lon: e.latlng.lng }) });
    useEffect(() => {
        const el = map.getContainer();
        el.classList.add('nowcast-pick-mode');
        el.style.cursor = 'crosshair';
        return () => { el.classList.remove('nowcast-pick-mode'); el.style.cursor = ''; };
    }, [map]);
    return null;
};

// A newly chosen shelter point: zoom to its search circle so the numbered candidates are readable.
const FitShelter = ({ point, radiusKm }) => {
    const map = useMap();
    useEffect(() => {
        if (!point) return;
        const dLat = radiusKm / 111.2;
        const dLon = radiusKm / (111.2 * Math.cos((point.lat * Math.PI) / 180));
        map.getContainer().dataset.userView = '1';         // a chosen shelter view is kept on resize
        map.fitBounds([[point.lat - dLat, point.lon - dLon], [point.lat + dLat, point.lon + dLon]], { padding: [16, 16] });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [point?.lat, point?.lon, radiusKm, map]);
    return null;
};

/**
 * Leaflet map of model alert polygons.
 *  - fill/stroke colour = hazard; Warning = solid & opaque, Watch = dashed & light
 *  - dot at the alert's peak cell = contract sec. 7 verification (green = confirmed by IMERG, white/grey = not
 *    confirmed: counted as a false alarm in the scores)
 *  - overlays: PNG rasters already resampled to Web-Mercator rows by the API, placed at `bounds`
 *  - terrain: hillshade PNGs (same row mapping) in the lowest pane, under every risk layer and alert
 *  - an alert's hover tooltip and click popup are compact (2 short lines: hazard, level, value, lead); the popup's
 *    "Details" calls onDetails (opens the Alert section); verification and explanations live in the drawer only
 *  - onPick (shelter section open): map clicks choose a point instead of selecting an alert;
 *    shelter = { point, radiusKm, candidates } draws the point, the radius and the numbered candidates
 */
// The two compact lines of an alert's tooltip / popup
const kindShort = (a) => (a.display.kind === 'probability' ? 'probability' : a.display.kind === 'risk_index' ? 'risk index, not a probability' : 'risk ratio, not a probability');
const AlertLines = ({ a }) => (
    <>
        <span className="block font-bold">{HAZARD_STYLE[a.hazard].name} {a.level} · {valueText(a)}</span>
        <span className="block">+{a.lead_time_h} h lead · {kindShort(a)}</span>
    </>
);

const AlertMap = ({ bounds, alerts = [], selectedId, onSelect: onSelectProp, onDetails = null, sites = [], overlays = [], showDomain = true, dimFill = false,
    terrain = [], terrainNotice, onPick = null, shelter = null }) => {
    const onSelect = onPick ? null : onSelectProp;
    const [popup, setPopup] = useState(null);            // { id, latlng } of the clicked alert
    const click = (a) => (e) => {
        if (!onSelect) return;
        onSelect(a);
        setPopup({ id: a.alert_id, latlng: e.latlng });
    };
    const popAlert = popup && !onPick ? alerts.find((a) => a.alert_id === popup.id) : null;
    return (
    <MapContainer center={[30, 79]} zoom={6} className="w-full h-full z-0" zoomControl={false}>
        {/* top-left is the Layers panel, bottom-right the legend */}
        <ZoomControl position="topright" />
        <TrackSize />
        <TileLayer
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        <FitBounds bounds={bounds} />
        <AttributionHeight />
        {showDomain && bounds && (
            <Rectangle bounds={bounds} pathOptions={{ color: '#334155', weight: 1, dashArray: '2 4', fill: false }}
                interactive={false} />
        )}
        {/* terrain pane (z 300) < forecast/observed rasters (z 350) < alert polygons (overlayPane, z 400) */}
        <Pane name="nowcast-terrain" style={{ zIndex: 300 }}>
            {terrain.map((t) => (
                <ImageOverlay key={t.url} url={t.url} bounds={t.bounds} opacity={t.opacity} className="nowcast-terrain"
                    attribution={terrainAttribution(terrainNotice)} />
            ))}
        </Pane>
        {/* rasters live in their own pane below the alert polygons (overlayPane is z 400) */}
        <Pane name="nowcast-rasters" style={{ zIndex: 350 }}>
            {bounds && overlays.map((o) => (
                <ImageOverlay key={o.url} url={o.url} bounds={bounds} opacity={o.opacity ?? 1} zIndex={o.zIndex ?? 1}
                    className={`nowcast-raster ${o.kind || ''}`} />
            ))}
        </Pane>
        {alerts.map((a) => {
            const hz = HAZARD_STYLE[a.hazard];
            const lv = LEVEL_STYLE[a.level] || LEVEL_STYLE.Watch;
            const sel = a.alert_id === selectedId;
            return (
                <GeoJSON
                    key={`${a.alert_id}-${sel}`}
                    data={a.geometry}
                    style={{
                        color: sel ? '#0f172a' : hz.color, weight: sel ? 4 : lv.weight, dashArray: sel ? null : lv.dashArray,
                        // with a forecast field shown, keep outlines but let the raster show through
                        fillColor: hz.color, fillOpacity: dimFill ? lv.fillOpacity * 0.15 : lv.fillOpacity,
                        className: `nowcast-alert-poly hazard-${a.hazard} level-${a.level}`,
                    }}
                    eventHandlers={{ click: click(a) }}
                >
                    {popAlert?.alert_id !== a.alert_id && (
                        <Tooltip sticky>
                            <div className="text-xs" style={{ whiteSpace: 'nowrap' }} data-testid="alert-tooltip"><AlertLines a={a} /></div>
                        </Tooltip>
                    )}
                </GeoJSON>
            );
        })}
        {alerts.filter((a) => a.verification && a.verification.status !== 'unavailable' && a.peak_cell).map((a) => {
            const v = VERIFY_STYLE[a.verification.status];
            return (
                <CircleMarker key={`v-${a.alert_id}`} center={a.peak_cell} radius={4.5}
                    pathOptions={{ color: v.color, weight: 2, fillColor: a.verification.status === 'verified' ? v.color : '#ffffff', fillOpacity: 1 }}
                    eventHandlers={{ click: click(a) }} />
            );
        })}
        {/* alerts without verification (live): hazard-coloured marker at the peak so a
            single 0.1-degree cell is still findable at national zoom */}
        {alerts.filter((a) => (!a.verification || a.verification.status === 'unavailable') && a.peak_cell).map((a) => (
            <CircleMarker key={`p-${a.alert_id}`} center={a.peak_cell} radius={7}
                pathOptions={{ color: '#111827', weight: 1.5, fillColor: HAZARD_STYLE[a.hazard].color, fillOpacity: 0.95,
                    className: 'nowcast-peak-marker' }}
                eventHandlers={{ click: click(a) }}>
                <Tooltip>
                    <div className="text-xs" style={{ whiteSpace: 'nowrap' }}><AlertLines a={a} /></div>
                </Tooltip>
            </CircleMarker>
        ))}
        {popAlert && (
            <Popup position={popup.latlng} eventHandlers={{ remove: () => setPopup(null) }} closeButton autoPan={false}>
                <div data-testid="alert-popup" data-alert-id={popAlert.alert_id} className="text-xs" style={{ whiteSpace: 'nowrap' }}>
                    <AlertLines a={popAlert} />
                    {onDetails && (
                        <button type="button" data-testid="alert-popup-details" onClick={() => { onDetails(popAlert); setPopup(null); }}
                            className="mt-1 font-bold text-blue-700 underline">Details</button>
                    )}
                </div>
            </Popup>
        )}
        {onPick && <PickPoint onPick={onPick} />}
        {shelter?.point && (
            <>
                <FitShelter point={shelter.point} radiusKm={shelter.radiusKm || 25} />
                <Circle center={[shelter.point.lat, shelter.point.lon]} radius={(shelter.radiusKm || 25) * 1000} interactive={false}
                    pathOptions={{ color: '#6d28d9', weight: 1.5, dashArray: '5 5', fill: false, className: 'nowcast-shelter-radius' }} />
                <CircleMarker center={[shelter.point.lat, shelter.point.lon]} radius={7} interactive={false}
                    pathOptions={{ color: '#111827', weight: 3, fillColor: '#ffffff', fillOpacity: 1, className: 'nowcast-shelter-point' }} />
            </>
        )}
        {(shelter?.candidates || []).map((c) => (
            <CircleMarker key={`sh-${c.osm_id}`} center={[c.lat, c.lon]} radius={8}
                pathOptions={{ color: '#6d28d9', weight: 2.5, fillColor: c.outside_all_alerts ? '#6d28d9' : '#ffffff', fillOpacity: 1,
                    className: `nowcast-shelter-marker ${c.outside_all_alerts ? 'outside' : 'inside'}` }}>
                <Tooltip permanent direction="right" offset={[7, 0]} className="nowcast-shelter-label">
                    <span className="text-xs font-black">{c.no ?? c.rank}</span>
                </Tooltip>
            </CircleMarker>
        ))}
        {sites.map((site) => (
            <CircleMarker key={`site-${site.episode || site.name}`} center={[site.lat, site.lon]} radius={7}
                pathOptions={{ color: '#111827', weight: 2.5, fillColor: '#facc15', fillOpacity: 1, className: 'nowcast-site-marker' }}>
                <Tooltip direction="top" offset={[0, -6]}>
                    <div className="text-xs"><b>Documented cloudburst: {site.name}</b><br />{site.date} (date only; hour not recorded)</div>
                </Tooltip>
            </CircleMarker>
        ))}
    </MapContainer>
    );
};

export default AlertMap;
