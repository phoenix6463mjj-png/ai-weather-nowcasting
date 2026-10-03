// Dashboard ("/") helpers: the page's rule-based risk indicator (NOT the ML model; see /nowcast for that).
// The backend gives each zone a risk level (LOW / MODERATE / HIGH) from fixed weather rules, plus
// per-hazard rule scores. The page shows levels only, never a percentage.

export const RISK_COLOURS = { HIGH: '#ef4444', MODERATE: '#f59e0b', LOW: '#10b981', NONE: '#6b7280' };
export const RISK_ORDER = { LOW: 0, MODERATE: 1, HIGH: 2 };
export const LEVEL_NAMES = ['Low', 'Moderate', 'High'];
export const RULE_LABEL = 'rule-based, not the ML model';
export const NO_EXPLANATION = 'No explanation available';

export const HAZARDS = [
    { key: 'thunderstorm', name: 'Thunderstorm', layer: 'thunderstorm' },
    { key: 'cloudburst', name: 'Cloudburst', layer: 'cloudburst' },
    { key: 'flood', name: 'Flash Flood', layer: 'flood' },
];

export const riskColour = (risk) => (risk && risk !== 'NONE' && RISK_COLOURS[risk]) || RISK_COLOURS.NONE;

export function riskText(loc) {
    const r = String(loc?.risk || loc?.prediction?.risk_text || loc?.prediction?.risk_level || 'LOW').toUpperCase();
    return r in RISK_ORDER ? r : 'LOW';
}

// A hazard is named only when the rule that fired points to it. Of the team's rules (backend
// rules_fired / predict_nowcast) only the rain rules do: rain above 20 mm in the last hour (HIGH) and above
// 5 mm (MODERATE) -> flash flood. The humidity and wind rules name no hazard ("Rule-based HIGH: <rule>"),
// and no rule points to thunderstorm or cloudburst (not rated). The backend's flat per-hazard scores are
// not used for naming (they made every rated zone's top hazard "Flash Flood").
export const RAIN_RULE_HIGH = 'Rain above 20 mm in the last hour';
export const RAIN_RULE_MODERATE = 'Rain above 5 mm in the last hour';
const RAIN_HIGH_MM = 20;          // the team's thresholds (backend predict_nowcast / rules_fired)
const RAIN_MODERATE_MM = 5;

export function firedRules(loc) {
    return Array.isArray(loc?.rules_fired) ? loc.rules_fired.filter(Boolean) : null;
}

// 2 = the HIGH rain rule fired, 1 = the MODERATE rain rule, 0 = neither. Without a rules list (older
// data), the same team thresholds on the zone's own rain.
function rainRuleLevel(loc) {
    const r = firedRules(loc);
    if (r) return r.includes(RAIN_RULE_HIGH) ? 2 : r.includes(RAIN_RULE_MODERATE) ? 1 : 0;
    const rain = Number(loc?.weather?.rainfall ?? loc?.rainfall);
    return rain > RAIN_HIGH_MM ? 2 : rain > RAIN_MODERATE_MM ? 1 : 0;
}

// Per-hazard level: flash flood from the rain rules (never above the zone's level); thunderstorm and
// cloudburst null = no rule points to them (not rated).
export function hazardLevels(loc) {
    const cap = RISK_ORDER[riskText(loc)];
    return { thunderstorm: null, cloudburst: null, flood: Math.min(rainRuleLevel(loc), cap) };
}

// The named hazard: 'flood' for a HIGH zone whose HIGH rain rule fired, or a MODERATE zone whose rain
// rule fired; else null (no hazard named).
export function primaryThreat(loc) {
    const risk = riskText(loc);
    if (risk === 'HIGH') return rainRuleLevel(loc) === 2 ? 'flood' : null;
    if (risk === 'MODERATE') return rainRuleLevel(loc) >= 1 ? 'flood' : null;
    return null;
}

// "Rule-based HIGH: <fired rule(s)>" (no hazard named)
export function ruleLevelText(loc) {
    const r = firedRules(loc);
    return `Rule-based ${riskText(loc)}: ${r && r.length ? r.join('; ') : 'the rule that fired was not reported'}`;
}

// Explanation text: never a "stable" sentence on a MODERATE / HIGH zone; none -> NO_EXPLANATION.
export function explanationText(loc) {
    const e = loc?.prediction?.explanation || loc?.explanation;
    if (!e) return NO_EXPLANATION;
    if (riskText(loc) !== 'LOW' && /stable|normal atmospheric/i.test(e)) return NO_EXPLANATION;
    return e;
}

const hhmmUtc = (iso) => `${iso.slice(11, 16)} UTC`;

// A timezone-aware ISO time ("...Z" or "...+05:30") as a Date; null when missing, unparseable or naive
// (a naive time would be read in the browser's zone).
export function parseUtcIso(iso) {
    if (typeof iso !== 'string' || !/(Z|[+-]\d\d:?\d\d)$/.test(iso.trim())) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
}

// "Fetched HH:MM UTC" from a Date or a timezone-aware ISO time (the team backend emits UTC "...Z").
export function fetchedLabel(fetchedAt) {
    const d = fetchedAt instanceof Date ? fetchedAt : parseUtcIso(fetchedAt);
    return !d || Number.isNaN(d.getTime()) ? 'Fetched —' : `Fetched ${hhmmUtc(d.toISOString())}`;
}

// Neutral wording of the zone-list weather source, for the info strip
export function sourceShort(source) {
    if (source === 'open-meteo') return 'Open-Meteo model data';
    if (source === 'openweather') return 'OpenWeather current weather';
    if (source === 'mixed') return 'mixed: some zones use sample data';
    return 'sample data';
}

// "sample" = deterministic sample values, no weather feed at all: the team pages then show no rule-based
// risk level, count, banner, pill, primary threat or alert card (SampleSafetyNotice instead).
export const isSampleSource = (source) => source === 'sample';
export const SAMPLE_SAFETY_TEXT = 'Sample data — no live weather feed. Risk indicators are not shown on sample data.';

// Live weather sources: OpenWeather (observations, needs a key) and Open-Meteo (model data, no key).
export const LIVE_SOURCES = ['openweather', 'open-meteo'];
export const isLiveSource = (source) => LIVE_SOURCES.includes(source);

// Per-zone weather source (backend `zone_source`: openweather | openweather_stale | open_meteo |
// open_meteo_stale | sample).
// A zone is "unrated" when any of its source fields says sample: it then shows no risk level, hazard
// level, primary threat or alert card, and is left out of every risk count and chart.
export const SAMPLE_ZONE_TEXT = 'Sample data — risk not shown';
export function zoneSource(loc) {
    if (!loc) return null;
    if ([loc.zone_source, loc.source, loc.weather?.source].includes('sample')) return 'sample';
    if (loc.zone_source) return loc.zone_source;
    const s = loc.weather?.source || loc.source;
    if (s === 'open-meteo') return loc.weather?.stale ? 'open_meteo_stale' : 'open_meteo';
    if (s === 'openweather') return loc.weather?.stale ? 'openweather_stale' : 'openweather';
    return null;
}
export const isUnratedZone = (loc) => zoneSource(loc) === 'sample';

// Real counts of a mixed zone list: from the backend summary (zone_sources), else counted from the zones.
export function mixedCounts(summary, zones = []) {
    const zs = summary?.zone_sources;
    const c = zs ? { ...zs } : zones.reduce((acc, z) => {
        const k = zoneSource(z) || 'sample';
        acc[k] = (acc[k] || 0) + 1;
        return acc;
    }, {});
    const openMeteo = (c.open_meteo || 0) + (c.open_meteo_stale || 0);
    const openWeather = (c.openweather || 0) + (c.openweather_stale || 0);
    const sample = c.sample || 0;
    const total = summary?.total ?? (openMeteo + openWeather + sample);
    return { openMeteo, openWeather, sample, total };
}

const timeRange = (lo, hi) => (lo && hi && hhmmUtc(lo) !== hhmmUtc(hi) ? `${hhmmUtc(lo).slice(0, 5)}–${hhmmUtc(hi)}` : hhmmUtc(hi || lo));

// "OpenWeather (current weather) for N of T zones, updated HH:MM UTC" and/or "Open-Meteo (model data) for
// M of T zones, updated HH:MM UTC" (a range when the zones' times differ), from the real counts and
// each source's own times (summary.source_times; with one live source, the list's data_time range).
export function mixedBadge(summary, zones = []) {
    const m = mixedCounts(summary, zones);
    const st = summary?.source_times || {};
    const one = (m.openWeather > 0) !== (m.openMeteo > 0);
    const listTimes = one ? { min: summary?.data_time_min, max: summary?.data_time || summary?.latest_observed_at } : null;
    const upd = (t) => (t && (t.min || t.max) ? `, updated ${timeRange(t.min, t.max)}` : '');
    const parts = [];
    if (m.openWeather > 0) parts.push(`OpenWeather (current weather) for ${m.openWeather} of ${m.total} zones${upd(st.openweather || listTimes)}`);
    if (m.openMeteo > 0) parts.push(`Open-Meteo (model data) for ${m.openMeteo} of ${m.total} zones${upd(st['open-meteo'] || listTimes)}`);
    if (parts.length && summary?.openweather_filling && m.openWeather < m.total) parts.push('the rest switch to OpenWeather as they are fetched');
    return parts.length ? parts.join('; ') : 'Sample data — no live weather feed';
}

// Weather source badge text ("sample" = deterministic sample values; Open-Meteo = model data, never "observed").
// For "mixed", pass the zone-list summary (and zones) to state the real counts.
export function sourceBadge(source, observedAt, dataTime, summary = null, zones = []) {
    // OpenWeather current weather: its own data time ("dt"); never called "observed"
    if (source === 'openweather') return (dataTime || observedAt) ? `OpenWeather (current weather), updated ${hhmmUtc(dataTime || observedAt)}` : 'OpenWeather (current weather)';
    if (source === 'open-meteo') return dataTime ? `Open-Meteo (model data), updated ${hhmmUtc(dataTime)}` : 'Open-Meteo (model data)';
    if (source === 'mixed') return (summary || zones.length) ? mixedBadge(summary, zones) : 'Mixed: some zones use sample data (no live weather feed)';
    return 'Sample data — no live weather feed';
}

// One compact line for the Dashboard map: "OpenWeather 150/380 · Open-Meteo 230/380 · updated 19:30 UTC"
// (real counts of the zone list, the newest update time of its live sources). The full wording
// (sourceBadge / mixedBadge) sits in the line's (i) popover.
export function compactSourceLine(summary, zones = []) {
    const { counts, updated } = compactSourceParts(summary, zones);
    return [counts, updated].filter(Boolean).join(' · ');
}

// The same line in two parts, so a narrow map can shorten the counts and keep the update time
export function compactSourceParts(summary, zones = []) {
    const src = summary?.source;
    if (!src) return { counts: 'Loading weather source…', updated: '' };
    if (isSampleSource(src)) return { counts: 'Sample data · no live weather feed', updated: '' };
    const m = mixedCounts(summary, zones);
    const parts = [];
    if (m.openWeather > 0) parts.push(`OpenWeather ${m.openWeather}/${m.total}`);
    if (m.openMeteo > 0) parts.push(`Open-Meteo ${m.openMeteo}/${m.total}`);
    if (m.sample > 0) parts.push(`sample data ${m.sample}/${m.total}`);
    const st = summary.source_times || {};
    const latest = [st.openweather?.max, st['open-meteo']?.max, summary.data_time, summary.latest_observed_at]
        .filter((t) => parseUtcIso(t)).sort((a, b) => parseUtcIso(a) - parseUtcIso(b)).at(-1);
    return { counts: parts.join(' · '), updated: latest ? `updated ${hhmmUtc(parseUtcIso(latest).toISOString())}` : '' };
}

// Map attribution credits for the weather sources in use (HTML for Leaflet's attribution control), with
// the links the stored terms ask for (backend/assets/openweather_terms.json, open_meteo_terms.json).
export function weatherAttribution({ openWeather = false, openMeteo = false } = {}) {
    const a = (href, text) => `<a href="${href}" target="_blank" rel="noreferrer">${text}</a>`;
    const parts = [];
    if (openWeather) parts.push(`<span data-testid="openweather-credit">${a('https://openweathermap.org/', 'Weather data © OpenWeather')}`
        + ` (${a('https://opendatacommons.org/licenses/odbl/', 'ODbL')})</span>`);
    if (openMeteo) parts.push(`<span data-testid="open-meteo-credit">${parts.length ? '' : 'Weather data: '}${a('https://open-meteo.com/', 'Open-Meteo.com')}`
        + ` (${a('https://creativecommons.org/licenses/by/4.0/', 'CC BY 4.0')})</span>`);
    return parts.join(' · ');
}

// Summary of a plain zone array (/batch_predict has no summary): total, times of the zones with weather data
export function zonesSummary(zones = []) {
    const live = zones.filter((z) => !isUnratedZone(z));
    const times = live.map((z) => z.weather?.data_time).filter(Boolean).sort();
    const obs = live.map((z) => z.weather?.observed_at).filter(Boolean).sort();
    const source_times = {};
    for (const src of ['openweather', 'open-meteo']) {
        const ts = live.filter((z) => (z.weather?.source || z.source) === src).map((z) => z.weather?.data_time).filter(Boolean).sort();
        if (ts.length) source_times[src] = { min: ts[0], max: ts.at(-1) };
    }
    return { total: zones.length, data_time: times.at(-1) || null, data_time_min: times[0] || null,
        latest_observed_at: obs.at(-1) || null, source_times };
}

// A zone list is mixed when it has both sample-data zones and zones with weather data
export function isMixedList(zones = []) {
    const m = mixedCounts(null, zones);
    return m.sample > 0 && m.openMeteo + m.openWeather > 0;
}

// "S sample-data zones: risk not shown" line for mixed lists
export const unratedNote = (n) => `${n} zone${n === 1 ? '' : 's'} with sample data: risk not shown`;
