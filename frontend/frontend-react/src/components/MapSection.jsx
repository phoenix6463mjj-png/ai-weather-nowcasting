import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, ImageOverlay, Marker, Popup, Tooltip, useMap } from 'react-leaflet';
import { primaryThreat, riskColour } from '../utils/dashboardRisk';
import { getTerrain, terrainUrl } from '../services/nowcastApi';
import MarkerClusterGroup from 'react-leaflet-cluster';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

// Fix Leaflet's default icon issue
import L from 'leaflet';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconUrl: markerIcon,
    iconRetinaUrl: markerIcon2x,
    shadowUrl: markerShadow,
});

// MapController centers and flies to selectedCity when selected
const MapController = ({ selectedCity }) => {
    const map = useMap();
    const isInitialMount = React.useRef(true);

    useEffect(() => {
        if (!selectedCity || selectedCity.lat == null || selectedCity.lon == null) return;
        const coords = [selectedCity.lat, selectedCity.lon];

        // Skip flying on very first mount so full India view is preserved initially
        if (isInitialMount.current) {
            isInitialMount.current = false;
            return;
        }

        map.flyTo(coords, 9, {
            animate: true,
            duration: 1.5,
            easeLinearity: 0.25
        });
    }, [selectedCity, map]);

    return null;
};

// Marker colours = the zone's rule-based risk level (same colours as the legend)
const getColor = riskColour;

// Base maps. Satellite: NASA GIBS VIIRS SNPP true colour of yesterday (UTC; today's tiles may be
// incomplete), no key. Terrain: OSM + our Copernicus DEM hillshade through the team backend's /ml proxy.
const OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const gibsDate = () => new Date(Date.now() - 86400e3).toISOString().slice(0, 10);
const gibsUrl = (date) => 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor'
    + `/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;
const gibsAttr = (date) => 'Imagery: <a href="https://nasa-gibs.github.io/gibs-api-docs/">NASA GIBS</a> '
    + `(ESDIS), VIIRS SNPP corrected reflectance, ${date}`;

let terrainIndex = null;
const useNationalHillshade = (on) => {
    const [idx, setIdx] = useState(terrainIndex);
    useEffect(() => {
        if (!on || terrainIndex) return undefined;
        let live = true;
        getTerrain().then((t) => { terrainIndex = t; if (live) setIdx(t); }).catch(() => {});
        return () => { live = false; };
    }, [on]);
    const lay = on && idx?.available ? idx.layers.national : null;
    return lay ? { url: terrainUrl('national'), bounds: lay.bounds, credit: idx.attribution, notice: idx.attribution_full } : null;
};

// Custom Icon for Stations
const createStationIcon = (risk) => {
    const color = getColor(risk);
    const size = 14;
    const offset = size / 2;
    return L.divIcon({
        className: 'custom-station-pin',
        html: `<div style="background-color: ${color}; width: ${size}px; height: ${size}px; border-radius: 50%; border: 2px solid white; box-shadow: 0 1px 4px rgba(0,0,0,0.45); cursor: pointer;"></div>`,
        iconSize: [size, size],
        iconAnchor: [offset, offset]
    });
};

// Custom Icon for Selected/Active Focused Marker
const createSelectedIcon = (color) => {
    const size = 22;
    const offset = size / 2;
    return L.divIcon({
        className: 'selected-marker-icon',
        html: `<div style="background-color: transparent; width: ${size}px; height: ${size}px; border-radius: 50%; border: 3px solid ${color}; box-shadow: 0 0 12px ${color}; animation: pulse 2s infinite;"></div>`,
        iconSize: [size, size],
        iconAnchor: [offset, offset]
    });
};

const MapSection = ({
    allCities = [],
    locations: locationsProp = [],
    selectedCity = null,
    selectedCityData = null,
    onSelectCity,
    onCitySelect,
    activeLayers = { thunderstorm: true, cloudburst: true, flood: true },
    baseLayer = 'map',
}) => {
    // Event-layer toggles filter markers by their primary threat; zones with none (low risk) always show
    const locations = (allCities.length > 0 ? allCities : (locationsProp || [])).filter((loc) => {
        const t = primaryThreat(loc);
        return t == null || activeLayers[t] !== false;
    });
    const hill = useNationalHillshade(baseLayer === 'terrain');
    const date = gibsDate();
    const activeCity = selectedCity || selectedCityData;
    const handleCitySelect = onSelectCity || onCitySelect;

    console.log("Rendering clustered points:", locations.length);

    return (
        <>
        <MapContainer
            key={allCities.length || locationsProp.length}
            center={[22.5, 79.5]}
            zoom={5}
            className="w-full h-full z-0"
            zoomControl={false}
        >
            {baseLayer === 'satellite' ? (
                <TileLayer key={`gibs-${date}`} url={gibsUrl(date)} attribution={gibsAttr(date)} maxNativeZoom={9} maxZoom={18} />
            ) : (
                <TileLayer key="osm" url={OSM_URL} attribution={OSM_ATTR} />
            )}
            {baseLayer === 'terrain' && hill && (
                <ImageOverlay url={hill.url} bounds={hill.bounds} opacity={0.6} className="dashboard-hillshade"
                    attribution={`Terrain: <span title="${hill.notice}">${hill.credit}</span> hillshade`} />
            )}

            <MapController selectedCity={activeCity} />

            {/* Clustered Station Markers */}
            <MarkerClusterGroup
                chunkedLoading={true}
                showCoverageOnHover={false}
                spiderfyOnMaxZoom={true}
                maxClusterRadius={40}
                animate={true}
                removeOutsideVisibleBounds={true}
            >
                {locations.length > 0 && locations.map((loc, idx) => {
                    if (!loc.lat || !loc.lon) return null;
                    const color = getColor(loc.risk);

                    return (
                        <Marker
                            key={loc.city ? `marker-${loc.city}` : `marker-${loc.id ?? idx}`}
                            position={[loc.lat, loc.lon]}
                            icon={createStationIcon(loc.risk)}
                            eventHandlers={{
                                click: () => {
                                    if (handleCitySelect) handleCitySelect(loc);
                                }
                            }}
                        >
                            <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
                                <div className="text-xs font-sans">
                                    <span className="font-bold">{loc.city}</span>: <span className="font-black" style={{ color }}>{loc.risk || "LOW"}</span>
                                </div>
                            </Tooltip>
                            <Popup>
                                <div className="p-1 font-sans">
                                    <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-1 mb-1.5">
                                        <h4 className="text-sm font-black text-slate-900">{loc.city}</h4>
                                        <span
                                            className="text-[10px] font-bold px-1.5 py-0.5 rounded text-white"
                                            style={{ backgroundColor: color }}
                                        >
                                            {loc.risk || "LOW"}
                                        </span>
                                    </div>
                                    <div className="text-[11px] text-slate-600 space-y-0.5 mb-2">
                                        {loc.weather?.temperature != null && (
                                            <div>Temp: <strong>{Math.round(loc.weather.temperature)}°C</strong></div>
                                        )}
                                        {loc.weather?.rainfall != null && (
                                            <div>Rain: <strong>{Number(loc.weather.rainfall).toFixed(1)} mm</strong></div>
                                        )}
                                        {loc.weather?.humidity != null && (
                                            <div>Humidity: <strong>{Math.round(loc.weather.humidity)}%</strong></div>
                                        )}
                                    </div>
                                    {loc.reason && (
                                        <div className="text-[10px] font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 p-1.5 rounded mb-2 leading-tight">
                                            <span className="font-bold text-slate-800 dark:text-slate-100">Reason: </span>
                                            {loc.reason}
                                        </div>
                                    )}
                                    <button
                                        onClick={() => handleCitySelect && handleCitySelect(loc)}
                                        className="w-full text-[11px] font-bold bg-blue-600 hover:bg-blue-700 text-white py-1 rounded transition-colors"
                                    >
                                        Inspect Details
                                    </button>
                                </div>
                            </Popup>
                        </Marker>
                    );
                })}
            </MarkerClusterGroup>

            {/* Selected City Highlight Halo */}
            {activeCity && activeCity.lat != null && activeCity.lon != null && (
                <Marker
                    position={[activeCity.lat, activeCity.lon]}
                    icon={createSelectedIcon(getColor(activeCity.risk))}
                    interactive={false}
                />
            )}
        </MapContainer>
        {/* test hook: markers handed to the cluster layer after the event-layer filter */}
        <span hidden data-testid="dashboard-markers" data-count={locations.length}
            data-low={locations.filter((l) => primaryThreat(l) == null).length} />
        </>
    );
};

export default MapSection;
