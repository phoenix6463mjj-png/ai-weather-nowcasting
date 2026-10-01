import { useEffect } from 'react';
import { MapContainer, TileLayer, GeoJSON, CircleMarker, Circle, Tooltip, ImageOverlay, Rectangle, Pane, ZoomControl, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { HAZARD_STYLE, LEVEL_STYLE, VERIFY_STYLE, valueText, FF_VERIFY_NOTE } from '../../utils/hazardLabels';
import { TERRAIN_ATTRIBUTION } from './useTerrain';

const esc = (t) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

const FitBounds = ({ bounds }) => {
    const map = useMap();
    const key = JSON.stringify(bounds);
    useEffect(() => {
        if (bounds) map.fitBounds(bounds, { padding: [12, 12] });
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
        map.fitBounds([[point.lat - dLat, point.lon - dLon], [point.lat + dLat, point.lon + dLon]], { padding: [16, 16] });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [point?.lat, point?.lon, map]);
    return null;
};

/**
 * Leaflet map of model alert polygons.
 *  - fill/stroke colour = hazard; Warning = solid & opaque, Watch = dashed & light
 *  - dot at the alert's peak cell = contract sec. 7 verification (green = verified, grey = false alarm)
 *  - overlays: PNG rasters already resampled to Web-Mercator rows by the API, placed at `bounds`
 *  - terrain: hillshade PNGs (same row mapping) in the lowest pane, under every risk layer and alert
 *  - onPick (shelter section open): map clicks choose a point instead of selecting an alert;
 *    shelter = { point, radiusKm, candidates } draws the point, the radius and the numbered candidates
 */
const AlertMap = ({ bounds, alerts = [], selectedId, onSelect: onSelectProp, sites = [], overlays = [], showDomain = true, dimFill = false,
    terrain = [], terrainNotice, onPick = null, shelter = null }) => {
    const onSelect = onPick ? null : onSelectProp;
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
        {showDomain && bounds && (
            <Rectangle bounds={bounds} pathOptions={{ color: '#334155', weight: 1, dashArray: '2 4', fill: false }}
                interactive={false} />
        )}
        {/* terrain pane (z 300) < forecast/observed rasters (z 350) < alert polygons (overlayPane, z 400) */}
        <Pane name="nowcast-terrain" style={{ zIndex: 300 }}>
            {terrain.map((t) => (
                <ImageOverlay key={t.url} url={t.url} bounds={t.bounds} opacity={t.opacity} className="nowcast-terrain"
                    attribution={`Terrain: <span title="${esc(terrainNotice)}">${TERRAIN_ATTRIBUTION}</span>`} />
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
                    eventHandlers={{ click: () => onSelect && onSelect(a) }}
                >
                    <Tooltip sticky>
                        <div className="text-xs">
                            <b>{hz.name} {a.level}</b> · L{a.lead_time_h} h · {valueText(a)}
                            <br />{a.display.kind === 'probability' ? 'probability' : a.display.kind === 'risk_index' ? 'risk index — not a probability' : 'risk ratio — not a probability'}
                            {a.verification && <><br />{VERIFY_STYLE[a.verification.status]?.label}</>}
                            {a.hazard === 'flash_flood' && a.verification && a.verification.status !== 'unavailable' && <><br /><i>{FF_VERIFY_NOTE}</i></>}
                        </div>
                    </Tooltip>
                </GeoJSON>
            );
        })}
        {alerts.filter((a) => a.verification && a.verification.status !== 'unavailable' && a.peak_cell).map((a) => {
            const v = VERIFY_STYLE[a.verification.status];
            return (
                <CircleMarker key={`v-${a.alert_id}`} center={a.peak_cell} radius={4.5}
                    pathOptions={{ color: v.color, weight: 2, fillColor: a.verification.status === 'verified' ? v.color : '#ffffff', fillOpacity: 1 }}
                    eventHandlers={{ click: () => onSelect && onSelect(a) }} />
            );
        })}
        {/* alerts without verification (live): hazard-coloured marker at the peak so a
            single 0.1-degree cell is still findable at national zoom */}
        {alerts.filter((a) => (!a.verification || a.verification.status === 'unavailable') && a.peak_cell).map((a) => (
            <CircleMarker key={`p-${a.alert_id}`} center={a.peak_cell} radius={7}
                pathOptions={{ color: '#111827', weight: 1.5, fillColor: HAZARD_STYLE[a.hazard].color, fillOpacity: 0.95,
                    className: 'nowcast-peak-marker' }}
                eventHandlers={{ click: () => onSelect && onSelect(a) }}>
                <Tooltip>
                    <div className="text-xs"><b>{HAZARD_STYLE[a.hazard].name} {a.level}</b> · L{a.lead_time_h} h · {valueText(a)}</div>
                </Tooltip>
            </CircleMarker>
        ))}
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
                    <span className="text-[10px] font-black">{c.rank}</span>
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
