import { useEffect } from 'react';
import { MapContainer, TileLayer, GeoJSON, CircleMarker, Tooltip, ImageOverlay, Rectangle, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { HAZARD_STYLE, LEVEL_STYLE, VERIFY_STYLE, valueText } from '../../utils/hazardLabels';

const FitBounds = ({ bounds }) => {
    const map = useMap();
    const key = JSON.stringify(bounds);
    useEffect(() => {
        if (bounds) map.fitBounds(bounds, { padding: [12, 12] });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, map]);
    return null;
};

/**
 * Leaflet map of model alert polygons.
 *  - fill/stroke colour = hazard; Warning = solid & opaque, Watch = dashed & light
 *  - dot at the alert's peak cell = contract sec. 7 verification (green = verified, grey = false alarm)
 *  - overlays: PNG rasters already resampled to Web-Mercator rows by the API, placed at `bounds`
 */
const AlertMap = ({ bounds, alerts = [], selectedId, onSelect, site, overlays = [], showDomain = true }) => (
    <MapContainer center={[30, 79]} zoom={6} className="w-full h-full z-0" zoomControl={true}>
        <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        <FitBounds bounds={bounds} />
        {showDomain && bounds && (
            <Rectangle bounds={bounds} pathOptions={{ color: '#334155', weight: 1, dashArray: '2 4', fill: false }}
                interactive={false} />
        )}
        {bounds && overlays.map((o) => (
            <ImageOverlay key={o.url} url={o.url} bounds={bounds} opacity={o.opacity ?? 1} zIndex={o.zIndex ?? 1} />
        ))}
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
                        fillColor: hz.color, fillOpacity: lv.fillOpacity,
                        className: `nowcast-alert-poly hazard-${a.hazard} level-${a.level}`,
                    }}
                    eventHandlers={{ click: () => onSelect && onSelect(a) }}
                >
                    <Tooltip sticky>
                        <div className="text-xs">
                            <b>{hz.name} {a.level}</b> · L{a.lead_time_h} h · {valueText(a)}
                            <br />{a.display.kind === 'probability' ? 'probability' : a.display.kind === 'risk_index' ? 'risk index — not a probability' : 'risk ratio — not a probability'}
                            {a.verification && <><br />{VERIFY_STYLE[a.verification.status]?.label}</>}
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
        {site && (
            <CircleMarker center={[site.lat, site.lon]} radius={7}
                pathOptions={{ color: '#111827', weight: 2.5, fillColor: '#facc15', fillOpacity: 1 }}>
                <Tooltip direction="top" offset={[0, -6]} permanent={false}>
                    <div className="text-xs"><b>Documented cloudburst: {site.name}</b><br />{site.date} (date only; hour not recorded)</div>
                </Tooltip>
            </CircleMarker>
        )}
    </MapContainer>
);

export default AlertMap;
