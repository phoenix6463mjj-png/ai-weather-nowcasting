"""
Real-Time Weather AI System — FastAPI Backend v7.0
============================================================
Pipeline:
  1. Live Weather API: OpenWeatherMap (temperature, humidity, rainfall, wind_speed)
  2. Leak-Free ML Model: rainfall_model_v2.pkl (month, day, state_enc, district_enc)
  3. Hybrid Risk Logic:
       IF rainfall >= 20 mm  -> HIGH (2)
       ELIF rainfall >= 5 mm -> MODERATE (1)
       ELSE                  -> ML prediction
  4. Response: structured weather metrics + hybrid risk prediction
============================================================
"""
from dotenv import load_dotenv
import os
import sys

load_dotenv()

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import asyncio, time, hashlib
from typing import Optional, List, Dict, Any, Tuple
import httpx
from datetime import datetime, timezone

project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(project_root)

# Ensure project root .env and backend/.env are loaded regardless of execution CWD
load_dotenv(os.path.join(project_root, "backend", ".env"))
load_dotenv(os.path.join(project_root, ".env"))
load_dotenv()

from utils.api_fetcher import (
    get_coordinates, get_weather_by_coords, get_fallback_mock,
    fetch_weather, async_fetch_weather, _GEO_CACHE, API_KEY, is_valid_api_key,
    async_fetch_open_meteo, fetch_open_meteo_point, OPEN_METEO_STATS,
)
from utils.locations_manager import (
    get_india_locations, get_sampled_locations, find_location_by_name,
)
from utils.v2_predictor import (
    predict_v2, batch_predict_v2, compute_hybrid_risk, get_alert,
)
from backend.ml_proxy import router as ml_router

app = FastAPI(title="Real-Time Weather AI System API", version="7.0.0")
app.include_router(ml_router)
# Browser origins allowed to call this backend (comma-separated). The local default is the Vite dev
# server; on the host set CORS_ORIGINS to the deployed frontend's URL. No cookies or auth headers are
# used by the frontend, so credentials are off.
CORS_ORIGINS = [o.strip() for o in os.environ.get(
    "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# Startup warm-up
print("Loading rainfall_model_v2.pkl & LabelEncoders...")
try:
    _test = predict_v2(state="MAHARASHTRA", district="MUMBAI")
    print(f"  ML Ready: {_test['risk_level']} (conf={_test['confidence']})")
except Exception as e:
    print(f"  WARNING during model warm-up: {e}")

_CACHE: Dict[str, Tuple[Any, float]] = {}
CACHE_TTL = 300.0  # 300 seconds cache for sub-50ms repeat responses


class PredictionRequest(BaseModel):
    city: Optional[str] = None
    location: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "version": "7.0.0",
        "system": "Real-Time Weather AI System",
        "model": "rainfall_model_v2.pkl",
        "logic": "Hybrid (Live Weather Rule Override + ML Inference)",
        "features": ["month", "day", "state_enc", "district_enc"],
        "total_india_locations": len(get_india_locations()),
        "cached_geo_points": len(_GEO_CACHE),
    }


@app.get("/weather_source")
def weather_source():
    """Which weather source the backend uses and Open-Meteo request counters (no secrets)."""
    return {"order": ["openweather (OPENWEATHER_API_KEY set)", "open-meteo", "sample"],
            "openweather_key_set": is_valid_api_key(API_KEY), "open_meteo": dict(OPEN_METEO_STATS)}


@app.get("/locations")
def get_locations():
    return get_india_locations()


def calculate_rule_risk(rainfall: float, humidity: float, wind_speed: float) -> Tuple[str, int]:
    """
    Core Intelligence Risk Evaluation:
    HIGH if: rainfall > 20 OR humidity > 90 OR wind_speed > 10
    MODERATE if: rainfall > 5 OR humidity > 70
    LOW otherwise
    """
    rain = float(rainfall if rainfall is not None else 0.0)
    hum = float(humidity if humidity is not None else 0.0)
    wind = float(wind_speed if wind_speed is not None else 0.0)

    if rain > 20.0 or hum > 90.0 or wind > 10.0:
        return "HIGH", 2
    elif rain > 5.0 or hum > 70.0:
        return "MODERATE", 1
    else:
        return "LOW", 0


def generate_explainable_reason(rainfall: float, humidity: float, wind_speed: float, risk_level: str = "LOW") -> str:
    """
    Explainable AI (XAI) Rule Engine:
    - rainfall > 20 -> "Heavy rainfall indicates flood risk"
    - humidity > 90 -> "High humidity supports storm formation"
    - wind_speed > 10 -> "Strong wind indicates thunderstorm"
    - Combine reasons if multiple
    """
    reasons = []
    rain = float(rainfall if rainfall is not None else 0.0)
    hum = float(humidity if humidity is not None else 0.0)
    wind = float(wind_speed if wind_speed is not None else 0.0)

    if rain > 20.0:
        reasons.append("Heavy rainfall indicates flood risk")
    if hum > 90.0:
        reasons.append("High humidity supports storm formation")
    if wind > 10.0:
        reasons.append("Strong wind indicates thunderstorm")

    if reasons:
        return " | ".join(reasons)

    if str(risk_level).upper() == "HIGH":
        return "Severe atmospheric instability detected"
    elif str(risk_level).upper() == "MODERATE":
        return "Moderate convective indicators observed"
    else:
        return "Normal atmospheric conditions"


# Team rule change (2026-09-30, "calm-down fix"; INTEGRATION.md): with no rain in the last hour
# (rainfall shown as 0.0 mm), the flash-flood indicator cannot be above Low. Its score is held at the
# score a LOW zone gets (0.08, below the page's Moderate cut of 0.40), and the explanation says why.
# The zone's overall risk level (including the humidity rule) is unchanged.
NO_RAIN_NOTE = "no rain in the last hour"
FLOOD_SCORE_LOW = 0.08


def flash_flood_gate(rainfall: float, p_flood: float, reason: str) -> Tuple[float, str, Optional[str]]:
    """Returns (flash-flood score, reason, note); note is NO_RAIN_NOTE when the gate applied."""
    if round(float(rainfall or 0.0), 1) > 0.0:
        return p_flood, reason, None
    return min(p_flood, FLOOD_SCORE_LOW), f"{reason}; flash flood Low ({NO_RAIN_NOTE})", NO_RAIN_NOTE


def engineer_features(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Feature Engineering for Real-Time Nowcasting:
    - moisture_index = humidity * rainfall
    - instability_index = temperature * humidity
    - rain_intensity = rainfall * wind_speed
    """
    humidity = float(data.get("humidity", 0.0) or 0.0)
    rainfall = float(data.get("rainfall", 0.0) or 0.0)
    temperature = float(data.get("temperature", 0.0) or 0.0)
    wind_speed = float(data.get("wind_speed", data.get("wind", 0.0)) or 0.0)

    moisture_index = round(humidity * rainfall, 2)
    instability_index = round(temperature * humidity, 2)
    rain_intensity = round(rainfall * wind_speed, 2)

    features = dict(data)
    features.update({
        "temperature": temperature,
        "humidity": humidity,
        "rainfall": rainfall,
        "wind_speed": wind_speed,
        "moisture_index": moisture_index,
        "instability_index": instability_index,
        "rain_intensity": rain_intensity,
    })
    return features


def utc_now_iso() -> str:
    """Current time as a timezone-aware UTC ISO string ending in "Z" (independent of the server's TZ)."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


# The predict_nowcast rules that put a zone at its level, as short labels for the Alerts cards.
def rules_fired(features: Dict[str, Any], risk_level: str) -> List[str]:
    rainfall = float(features.get("rainfall", 0.0) or 0.0)
    humidity = float(features.get("humidity", 0.0) or 0.0)
    wind_speed = float(features.get("wind_speed", 0.0) or 0.0)
    risk = str(risk_level).upper()
    if risk == "HIGH":
        return (["Rain above 20 mm in the last hour"] if rainfall > 20.0 else []) + (
            ["Humidity above 90 % with wind above 8 m/s"] if humidity > 90.0 and wind_speed > 8.0 else [])
    if risk == "MODERATE":
        return (["Rain above 5 mm in the last hour"] if rainfall > 5.0 else []) + (
            ["Humidity above 70 %"] if humidity > 70.0 else []) + (
            ["Wind above 6 m/s"] if wind_speed > 6.0 else [])
    return []


def predict_nowcast(features: Dict[str, Any]) -> Dict[str, Any]:
    """
    Pluggable Nowcast Prediction Pipeline:
    - rainfall > 20 OR humidity > 90 OR wind_speed > 10 -> HIGH
    - rainfall > 5 OR humidity > 70 OR wind_speed > 6 -> MODERATE
    - else -> LOW
    """
    rainfall = float(features.get("rainfall", 0.0) or 0.0)
    humidity = float(features.get("humidity", 0.0) or 0.0)
    wind_speed = float(features.get("wind_speed", 0.0) or 0.0)

    if rainfall > 20.0 or (humidity > 90.0 and wind_speed > 8.0) or rainfall > 25.0:
        risk = "HIGH"
        prob = 0.88
    elif rainfall > 5.0 or humidity > 70.0 or wind_speed > 6.0:
        risk = "MODERATE"
        prob = 0.75
    else:
        risk = "LOW"
        prob = 0.95

    return {
        "risk_level": risk,
        "probability": prob,
    }


def generate_actionable_alert(risk_level, rainfall, humidity, wind_speed):
    rain = float(rainfall if rainfall is not None else 0.0)
    hum = float(humidity if humidity is not None else 0.0)
    wind = float(wind_speed if wind_speed is not None else 0.0)
    risk = str(risk_level).upper()

    if risk == "HIGH":
        if rain > 20.0:
            return {
                "type": "Flash Flood",
                "severity": "HIGH",
                "action": "Immediate evacuation of low-lying areas. Activate emergency drainage systems."
            }
        elif hum > 90.0 and wind > 8.0:
            return {
                "type": "Thunderstorm",
                "severity": "HIGH",
                "action": "Seek structural indoor shelter immediately. Avoid outdoor activities."
            }
        else:
            return {
                "type": "High Risk",
                "severity": "HIGH",
                "action": "Avoid non-essential travel and monitor emergency civil defense bulletins."
            }
    elif risk == "MODERATE":
        if rain > 5.0:
            return {
                "type": "Heavy Rain",
                "severity": "MODERATE",
                "action": "Monitor local water drainage and exercise caution on roadways."
            }
        elif wind > 6.0:
            return {
                "type": "Thunderstorm Watch",
                "severity": "MODERATE",
                "action": "Secure outdoor objects and monitor convective cloud formations."
            }
        else:
            return {
                "type": "Moderate Risk",
                "severity": "MODERATE",
                "action": "Moderate atmospheric indicators observed. Stay updated with local advisories."
            }
    else:
        return {
            "type": "Normal",
            "severity": "LOW",
            "action": "No immediate defensive action required."
        }


def generate_alerts(cities_data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Generate alerts based on live weather data:
    - HIGH -> "High Risk Alert in {city}"
    - rainfall > 15 -> "Flash Flood Risk"
    - wind_speed > 8 -> "Thunderstorm Alert"
    """
    alerts = []
    for item in cities_data:
        city = item.get("city", "Unknown")
        risk_level = str(item.get("risk_level") or item.get("risk") or "LOW").upper()

        # Weather can be top-level or nested in weather dict
        weather = item.get("weather") or {}
        rain = float(item.get("rainfall") if item.get("rainfall") is not None else weather.get("rainfall", 0.0))
        wind = float(item.get("wind_speed") if item.get("wind_speed") is not None else weather.get("wind_speed", 0.0))

        now_iso = utc_now_iso()
        if risk_level == "HIGH":
            alerts.append({
                "city": city,
                "type": "High Risk",
                "severity": "HIGH",
                "risk_level": "HIGH RISK",
                "action": "Immediate evacuation of vulnerable lowlands, activate civil defense response teams, and suspend non-essential travel.",
                "timestamp": now_iso,
                "message": f"High Risk Alert in {city}"
            })
        if rain > 15.0:
            sev = "HIGH" if rain > 25.0 else "MODERATE"
            alerts.append({
                "city": city,
                "type": "Flash Flood",
                "severity": sev,
                "risk_level": "HIGH RISK" if sev == "HIGH" else "MODERATE RISK",
                "action": "Move to higher ground immediately. Secure flood defenses and strictly avoid inundated roads and riverbanks.",
                "timestamp": now_iso,
                "message": f"Flash Flood Risk in {city} (Rainfall: {rain:.1f} mm)"
            })
        if wind > 8.0:
            sev = "HIGH" if wind > 12.0 else "MODERATE"
            alerts.append({
                "city": city,
                "type": "Thunderstorm",
                "severity": sev,
                "risk_level": "HIGH RISK" if sev == "HIGH" else "MODERATE RISK",
                "action": "Seek structural indoor shelter immediately. Keep clear of tall trees, power lines, and unplug high-draw appliances.",
                "timestamp": now_iso,
                "message": f"Thunderstorm Alert in {city} (Wind Speed: {wind:.1f} m/s)"
            })

    return alerts


@app.post("/predict")
def predict_risk(request: PredictionRequest):
    """
    Real-Time Prediction Pipeline with dynamic rule fallback and hybrid ML logic.
    """
    raw_city = request.location or request.city
    if not raw_city or not raw_city.strip():
        raise HTTPException(status_code=400, detail="Location name cannot be empty.")
    city = raw_city.strip()

    # 1. Location metadata lookup
    matched = find_location_by_name(city)
    state = matched.get("state") if matched else "Unknown"

    # Resolve coordinates
    lat = request.lat
    lon = request.lon
    if lat is None or lon is None:
        if matched:
            lat, lon = matched.get("lat"), matched.get("lon")
        if lat is None or lon is None:
            lat, lon = get_coordinates(city)

    if lat is None or lon is None:
        lat, lon = 22.0, 79.0

    # 2. Live Weather API call
    weather_data = fetch_weather(lat, lon)
    temp = float(weather_data.get("temperature", 30.0))
    hum = float(weather_data.get("humidity", 70.0))
    rainfall = float(weather_data.get("rainfall", 0.0))
    wind = float(weather_data.get("wind_speed", 2.0))
    pressure = float(weather_data.get("pressure", 1010.0))
    w_source = weather_data.get("source", "sample")
    w_observed = weather_data.get("observed_at")
    w_time = weather_data.get("data_time") or w_observed

    # 3. ML Inference with Rule-Based Fallback (No hardcoded fake LOW)
    now = datetime.now()
    try:
        ml_pred = predict_v2(
            state=state,
            district=city,
            month=now.month,
            day=now.day,
        )
    except Exception as e:
        rule_risk, rule_lbl = calculate_rule_risk(rainfall, hum, wind)
        ml_pred = {
            "risk_label": rule_lbl,
            "risk_level": rule_risk,
            "confidence": 0.85 if rule_risk == "HIGH" else (0.75 if rule_risk == "MODERATE" else 0.65),
            "probabilities": {
                "LOW": 0.15 if rule_risk == "HIGH" else (0.25 if rule_risk == "MODERATE" else 0.70),
                "MODERATE": 0.25 if rule_risk == "HIGH" else (0.55 if rule_risk == "MODERATE" else 0.20),
                "HIGH": 0.60 if rule_risk == "HIGH" else (0.20 if rule_risk == "MODERATE" else 0.10)
            },
        }

    city_label = matched["city"] if matched else city

    # 4. Hybrid Risk Logic
    hybrid_pred = compute_hybrid_risk(
        rainfall=rainfall,
        ml_prediction=ml_pred,
        wind_speed=wind,
        temperature=temp,
        humidity=hum,
        state=state,
        city=city_label,
    )

    # Re-evaluate with explicit rules
    rule_level, rule_label = calculate_rule_risk(rainfall, hum, wind)
    final_risk = hybrid_pred.get("risk_level", "LOW")
    final_label = hybrid_pred.get("risk_label", 0)
    if rule_label > final_label:
        final_risk = rule_level
        final_label = rule_label
        # the rules raised the level above the hybrid one: its explanation (e.g. "stable ...") no longer applies
        hybrid_pred["explanation"] = None
        hybrid_pred["risk_level"] = final_risk
        hybrid_pred["risk_label"] = final_label
        hybrid_pred["risk_text"] = final_risk

    p_thunder = float(hybrid_pred.get("thunderstorm", hybrid_pred.get("probabilities", {}).get("MODERATE", 0.1)))
    p_cloud = float(hybrid_pred.get("cloudburst", hybrid_pred.get("probabilities", {}).get("HIGH", 0.05)))
    p_flood = float(hybrid_pred.get("flood", hybrid_pred.get("probabilities", {}).get("HIGH", 0.05)))

    reason = generate_explainable_reason(rainfall, hum, wind, final_risk)
    p_flood, reason, flood_note = flash_flood_gate(rainfall, p_flood, reason)
    hybrid_pred["flood"] = hybrid_pred["prob_flood"] = round(p_flood, 2)
    alerts = get_alert(hybrid_pred)
    actionable_alert = generate_actionable_alert(
        final_risk,
        rainfall,
        hum,
        wind
    )

    return {
        "city": city_label,
        "state": state,
        "lat": lat,
        "lon": lon,
        "risk_level": final_risk,
        "risk": final_risk,
        "temperature": temp,
        "humidity": hum,
        "rainfall": rainfall,
        "wind_speed": wind,
        "timestamp": utc_now_iso(),
        "reason": reason,
        "alert": actionable_alert,
        "explanation": hybrid_pred.get("explanation"),
        "weather": {
            "temperature": temp,
            "humidity": hum,
            "rainfall": rainfall,
            "wind_speed": wind,
            "wind": wind,
            "pressure": pressure,
            "source": w_source,
            "observed_at": w_observed,
            "data_time": w_time,
            "conditions": weather_data.get("conditions"),
        },
        "source": w_source,
        "probabilities": {
            "thunderstorm": round(p_thunder, 2),
            "cloudburst": round(p_cloud, 2),
            "flash_flood": round(p_flood, 2),
        },
        "prediction": {
            "prob_thunderstorm": round(p_thunder, 2),
            "prob_cloudburst": round(p_cloud, 2),
            "prob_flood": round(p_flood, 2),
            "thunderstorm": round(p_thunder, 2),
            "cloudburst": round(p_cloud, 2),
            "flood": round(p_flood, 2),
            **hybrid_pred,
            "risk_level": final_risk,
            "risk_label": final_label,
            "reason": reason,
            "flood_note": flood_note,
        },
        "alerts": alerts,
    }


# ============================================================
# UNIFIED ALERTS ENGINE — SINGLE SOURCE OF TRUTH (5-MIN CACHE)
# ============================================================

_UNIFIED_ALERTS_CACHE: Dict[int, Tuple[Dict[str, Any], float]] = {}
# >= 30 min with a real OpenWeather key (free-tier call limits: 380 zones per refresh), else 5 min
UNIFIED_CACHE_TTL = 1800.0 if is_valid_api_key(API_KEY) else 300.0
_UNIFIED_LOCK = asyncio.Lock()


async def get_unified_alerts_dataset(limit: int = 380) -> Dict[str, Any]:
    """
    SINGLE SOURCE OF TRUTH Alert Engine:
    - Pipeline: get_weather -> engineer_features -> predict_nowcast -> generate_actionable_alert
    - 100% deterministic (no random values, consistent fallback mock)
    - Deduplicates locations strictly by city name
    - Caches for 5 minutes (300 seconds) so counts never flicker or diverge on refresh
    - Strict safety clamp: limit = max(50, min(limit, 380)) (HARD CAP at 380)
    - Overload protection with reduced concurrency and batch delay
    - Precomputes summary: { total, high, moderate, low }
    """
    global _UNIFIED_ALERTS_CACHE
    # Strict safety clamp: HARD CAP at 380
    safe_limit = max(50, min(limit, 380))
    now_ts = time.time()

    if safe_limit in _UNIFIED_ALERTS_CACHE:
        cached_data, cache_time = _UNIFIED_ALERTS_CACHE[safe_limit]
        if (now_ts - cache_time) < UNIFIED_CACHE_TTL:
            return cached_data

    async with _UNIFIED_LOCK:
        now_ts = time.time()
        if safe_limit in _UNIFIED_ALERTS_CACHE:
            cached_data, cache_time = _UNIFIED_ALERTS_CACHE[safe_limit]
            if (now_ts - cache_time) < UNIFIED_CACHE_TTL:
                return cached_data

        # Sample with buffer to ensure exactly safe_limit unique cities
        raw_locations = get_sampled_locations(limit=safe_limit + 25)
        seen_cities = set()
        locations = []
        for loc in raw_locations:
            c_name = loc["city"].strip()
            ck = c_name.lower()
            if ck not in seen_cities:
                seen_cities.add(ck)
                locations.append(loc)
            if len(locations) >= safe_limit:
                break

        # Overload protection: reduce concurrency when zone count > 300
        if safe_limit > 300:
            semaphore_limit = 20  # reduced concurrency to prevent API burst overload
        else:
            semaphore_limit = 25

        sem = asyncio.Semaphore(semaphore_limit)

        async def fetch_one(client: httpx.AsyncClient, loc: Dict[str, Any]) -> Dict[str, Any]:
            async with sem:
                return await async_fetch_weather(city=loc["city"], lat=loc["lat"], lon=loc["lon"], client=client)

        weather_list = []
        chunk_size = 50
        if not is_valid_api_key(API_KEY):
            om = await async_fetch_open_meteo([(l["lat"], l["lon"]) for l in locations])
            weather_list = [w if w else get_fallback_mock(l["city"], l["lat"], l["lon"])
                            for w, l in zip(om, locations)]
        async with httpx.AsyncClient(timeout=3.5) as client:
            for chunk_start in (range(0, len(locations), chunk_size) if is_valid_api_key(API_KEY) else ()):
                chunk = locations[chunk_start:chunk_start + chunk_size]
                chunk_results = await asyncio.gather(*[fetch_one(client, loc) for loc in chunk])
                weather_list.extend(chunk_results)
                if chunk_start + chunk_size < len(locations):
                    await asyncio.sleep(0.05)  # slight delay batching between chunks to avoid thread starvation

        current_time_iso = utc_now_iso()
        alerts_list = []
        high_count = 0
        moderate_count = 0
        low_count = 0

        for i, loc in enumerate(locations):
            w = weather_list[i] if i < len(weather_list) else {}
            city = loc["city"]
            state = loc.get("state", "India")
            lat = loc["lat"]
            lon = loc["lon"]

            temp = float(w.get("temperature", 30.0))
            hum = float(w.get("humidity", 70.0))
            rain = float(w.get("rainfall", 0.0))
            wind = float(w.get("wind_speed", w.get("wind", 2.0)))
            pressure = float(w.get("pressure", 1010.0))
            w_source = w.get("source", "sample")
            w_observed = w.get("observed_at")
            w_time = w.get("data_time") or w_observed

            weather_obj = {
                "city": city,
                "lat": lat,
                "lon": lon,
                "temperature": round(temp, 1),
                "humidity": round(hum, 1),
                "rainfall": round(rain, 1),
                "wind_speed": round(wind, 1),
                "pressure": round(pressure, 1),
                "timestamp": current_time_iso,
            }

            # Pipeline step 1: Engineer features
            features = engineer_features(weather_obj)

            # Pipeline step 2: Predict nowcast
            pred = predict_nowcast(features)
            risk = pred["risk_level"]

            # Pipeline step 3: Generate actionable alert
            actionable = generate_actionable_alert(risk, rain, hum, wind)
            sev = actionable["severity"]

            if sev == "HIGH":
                high_count += 1
            elif sev == "MODERATE":
                moderate_count += 1
            else:
                low_count += 1

            p_flood = round(0.85 if risk == "HIGH" else (0.45 if risk == "MODERATE" else 0.08), 2)
            p_thunder = round(0.80 if risk == "HIGH" else (0.40 if risk == "MODERATE" else 0.12), 2)
            p_cloud = round(0.75 if risk == "HIGH" else (0.35 if risk == "MODERATE" else 0.05), 2)

            reason = generate_explainable_reason(rain, hum, wind, risk)
            p_flood, reason, flood_note = flash_flood_gate(rain, p_flood, reason)
            fired = rules_fired(features, risk)

            alert_item = {
                "id": i,
                "city": city,
                "fullName": city,
                "state": state,
                "lat": lat,
                "lon": lon,
                "risk_level": risk,
                "risk": risk,
                "severity": sev,
                "type": actionable["type"],
                "hazard": actionable["type"],
                "message": f"{actionable['type']} in {city} (Rain: {rain:.1f} mm, Wind: {wind:.1f} m/s)",
                "action": actionable["action"],
                "reason": reason,
                "rules_fired": fired,
                "temperature": round(temp, 1),
                "humidity": round(hum, 1),
                "rainfall": round(rain, 1),
                "wind_speed": round(wind, 1),
                "timestamp": current_time_iso,
                "weather": {
                    "temperature": round(temp, 1),
                    "humidity": round(hum, 1),
                    "rainfall": round(rain, 1),
                    "wind_speed": round(wind, 1),
                    "wind": round(wind, 1),
                    "pressure": round(pressure, 1),
                    "source": w_source,
                    "observed_at": w_observed,
                    "data_time": w_time,
                    "conditions": w.get("conditions"),
                },
                "source": w_source,
                "prediction": {
                    "risk_level": risk,
                    "risk_label": 2 if risk == "HIGH" else (1 if risk == "MODERATE" else 0),
                    "risk_text": risk,
                    "probability": pred.get("probability", 0.85),
                    "prob_flood": p_flood,
                    "prob_thunderstorm": p_thunder,
                    "prob_cloudburst": p_cloud,
                    "reason": reason,
                    "flood_note": flood_note,
                },
                "probabilities": {
                    "flash_flood": p_flood,
                    "thunderstorm": p_thunder,
                    "cloudburst": p_cloud,
                },
                "alert": actionable,
            }
            alerts_list.append(alert_item)

        # Sort results: HIGH risk first, then MODERATE, then LOW
        alerts_list.sort(key=lambda x: (
            2 if x["severity"] == "HIGH" else (1 if x["severity"] == "MODERATE" else 0),
            x["rainfall"]
        ), reverse=True)

        summary = {
            "total": len(alerts_list),
            "high": high_count,
            "moderate": moderate_count,
            "low": low_count,
        }
        sources = {a["source"] for a in alerts_list}
        observed = [a["weather"]["observed_at"] for a in alerts_list if a["weather"].get("observed_at")]
        summary["source"] = sources.pop() if len(sources) == 1 else ("mixed" if sources else "sample")
        summary["n_sample"] = sum(a["source"] == "sample" for a in alerts_list)
        summary["latest_observed_at"] = max(observed) if observed else None
        times = [a["weather"]["data_time"] for a in alerts_list if a["weather"].get("data_time")]
        summary["data_time"] = max(times) if times else None

        dataset = {
            "summary": summary,
            "alerts": alerts_list,
            "last_updated": current_time_iso,
        }

        _UNIFIED_ALERTS_CACHE[safe_limit] = (dataset, time.time())
        return dataset


@app.get("/alerts")
async def get_alerts(limit: int = 380):
    """
    Unified Alerts API (Single Source of Truth):
    Returns precomputed summary, deduplicated alerts, and cached timestamp.
    """
    return await get_unified_alerts_dataset(limit=limit)


@app.get("/zones")
async def get_zones(limit: int = 380):
    """
    Configurable Zones API:
    Returns cached zones dataset with summary and location alerts.
    """
    return await get_unified_alerts_dataset(limit=limit)


@app.get("/dashboard")
async def get_dashboard(limit: int = 380):
    """
    Unified Dashboard Feed API:
    Shares the exact same alerts and summary dataset as /alerts.
    """
    return await get_unified_alerts_dataset(limit=limit)


@app.get("/analytics")
async def get_analytics(limit: int = 380):
    """
    Unified Analytics Feed API:
    Shares the exact same alerts and summary dataset as /alerts.
    """
    return await get_unified_alerts_dataset(limit=limit)


@app.get("/batch_predict")
async def batch_predict(limit: int = 380, state: Optional[str] = None):
    """
    Batch Monitoring API:
    Backed by the unified alert dataset to maintain 100% consistency across pages.
    """
    dataset = await get_unified_alerts_dataset(limit=limit)
    alerts = dataset["alerts"]
    if state:
        st_lower = state.strip().lower()
        filtered = [a for a in alerts if a.get("state", "").lower() == st_lower]
        return filtered[:limit]
    return alerts[:limit]



@app.get("/nowcast")
def get_nowcast(city: str):
    """
    Real-Time Nowcasting API for ANY city.
    Pipeline:
      1. Geocode city via OpenWeather Geo API (with locations registry backup)
      2. Fetch live atmospheric observations
      3. Standardize weather object
      4. Compute engineered features
      5. Generate nowcast risk prediction
      6. Produce actionable alerts
      7. Return unified response
    """
    if not city or not city.strip():
        return {"error": "Location not found"}

    cleaned_city = city.strip()

    try:
        # STEP 2: Fetch coordinates
        lat, lon = get_coordinates(cleaned_city)

        if lat is None or lon is None:
            # Fallback to local locations registry
            loc = find_location_by_name(cleaned_city)
            if loc:
                lat, lon = loc["lat"], loc["lon"]
            else:
                return {"error": "Location not found"}

        # Fetch real weather data by coordinates
        weather = get_weather_by_coords(lat, lon, city_name=cleaned_city)
        source = "realtime_api"
        data_time = None
        if not weather and not is_valid_api_key(API_KEY):
            weather = fetch_open_meteo_point(lat, lon)
            if weather:
                source = "open-meteo"
                data_time = weather.get("data_time")

        if not weather:
            # Fallback if API fails, rate limited, or key missing
            fb = get_fallback_mock(cleaned_city, lat, lon)
            temp = fb["temperature"]
            humidity = fb["humidity"]
            rainfall = fb["rainfall"]
            wind = fb["wind_speed"]
            source = "fallback_mock"
        else:
            temp = float(weather.get("temperature", 30.0))
            humidity = float(weather.get("humidity", 70.0))
            rainfall = float(weather.get("rainfall", 0.0))
            wind = float(weather.get("wind_speed", 2.0))

        # STEP 3: Standard weather object
        current_time = utc_now_iso()
        weather_obj = {
            "city": cleaned_city,
            "lat": lat,
            "lon": lon,
            "temperature": round(temp, 1),
            "humidity": round(humidity, 1),
            "rainfall": round(rainfall, 1),
            "wind_speed": round(wind, 1),
            "timestamp": current_time,
        }

        # STEP 4: Feature engineering
        features = engineer_features(weather_obj)

        # STEP 5: Prediction
        prediction = predict_nowcast(features)
        risk = prediction["risk_level"]

        # STEP 6: Actionable alert (reusing generate_actionable_alert)
        alert = generate_actionable_alert(risk, rainfall, humidity, wind)

        # STEP 7: Final response format
        return {
            "city": cleaned_city,
            "lat": lat,
            "lon": lon,
            "temperature": round(temp, 1),
            "humidity": round(humidity, 1),
            "rainfall": round(rainfall, 1),
            "wind_speed": round(wind, 1),
            "risk_level": risk,
            "prediction": prediction,
            "alert": alert,
            "source": source,
            "data_time": data_time,
        }

    except Exception as e:
        print(f"[NOWCAST ERROR] Exception during nowcast for '{cleaned_city}': {e}")
        # STEP 8: Safe fallback if unexpected exception occurs
        fb = get_fallback_mock(cleaned_city, 22.0, 79.0)
        temp = fb["temperature"]
        humidity = fb["humidity"]
        rainfall = fb["rainfall"]
        wind = fb["wind_speed"]

        risk = "HIGH" if rainfall > 25 else ("MODERATE" if rainfall > 10 else "LOW")
        prediction = {"risk_level": risk, "probability": 0.85}
        alert = generate_actionable_alert(risk, rainfall, humidity, wind)

        return {
            "city": cleaned_city,
            "lat": 22.0,
            "lon": 79.0,
            "temperature": round(temp, 1),
            "humidity": round(humidity, 1),
            "rainfall": round(rainfall, 1),
            "wind_speed": round(wind, 1),
            "risk_level": risk,
            "prediction": prediction,
            "alert": alert,
            "source": "fallback_mock",
        }

