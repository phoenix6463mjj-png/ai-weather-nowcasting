"""
Inference module for rainfall_model_v2.pkl.

Features: month, day, state_enc, district_enc
Encoders: rainfall_model_v2_meta.pkl (LabelEncoder for State and District)

At inference time:
  - month  = current calendar month
  - day    = current day of month
  - state  = from city lookup or "unknown"  
  - district = from city lookup or "unknown"

If state/district not in encoder training vocabulary:
  - Falls back to median encoded value (safe default)
"""

import os
import joblib
import hashlib
import numpy as np
from datetime import datetime
from typing import Dict, Any, Optional, List

_MODEL_DIR   = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models")
_MODEL_PATH  = os.path.join(_MODEL_DIR, "rainfall_model_v2.pkl")
_META_PATH   = os.path.join(_MODEL_DIR, "rainfall_model_v2_meta.pkl")

_clf      = None
_meta     = None
_fallback_state    = 0   # fallback encoded value for unknown state
_fallback_district = 0   # fallback encoded value for unknown district

LABEL_MAP = {0: "LOW", 1: "MODERATE", 2: "HIGH"}
ALERT_MAP = {
    0: {"severity": "LOW",      "status": "SAFE",    "message": "Low rainfall risk. Conditions appear stable.",                    "color": "#22cc44", "icon": "safe"},
    1: {"severity": "MODERATE", "status": "CAUTION", "message": "Moderate rainfall expected. Stay alert for changing conditions.", "color": "#ffaa00", "icon": "caution"},
    2: {"severity": "HIGH",     "status": "WARNING", "message": "High rainfall risk. Potential flooding or waterlogging likely.",  "color": "#ff4444", "icon": "warning"},
}

NORTHEAST_STATES = {
    "Assam", "Arunachal Pradesh", "Manipur", "Meghalaya", 
    "Mizoram", "Nagaland", "Tripura", "Sikkim"
}
COASTAL_STATES = {
    "Maharashtra", "Goa", "Karnataka", "Kerala", "Tamil Nadu", 
    "Andhra Pradesh", "Odisha", "West Bengal", "Gujarat", 
    "Puducherry", "Lakshadweep", "Andaman and Nicobar Islands",
    "Dadra and Nagar Haveli and Daman and Diu"
}
COASTAL_CITIES = {
    "mumbai", "chennai", "kochi", "goa", "puri", "kolkata", "surat", 
    "mangalore", "visakhapatnam", "alappuzha", "ratnagiri", "panaji", 
    "thane", "balasore", "cuddalore", "kakinada", "machilipatnam", 
    "bhavnagar", "jamnagar", "porbandar", "paradeep", "daman", "diu",
    "port blair", "kavaratti", "karwar", "udupi", "kozhikode", "kollam",
    "kannur", "thiruvananthapuram", "tuticorin", "thoothukudi", "nagapattinam",
    "bapatla", "ongole", "nellore", "srikakulam", "gopalpur", "haldia", "digha",
    "veraval", "dwarka", "kandla", "mandvi", "bharuch", "navsari", "valsad"
}
CENTRAL_STATES = {
    "Madhya Pradesh", "Chhattisgarh", "Uttar Pradesh", "Rajasthan", 
    "Bihar", "Jharkhand", "Telangana", "Haryana", "Delhi", "Punjab"
}


def _load():
    global _clf, _meta, _fallback_state, _fallback_district
    if _clf is None:
        _clf  = joblib.load(_MODEL_PATH)
        _meta = joblib.load(_META_PATH)
        # Median class index as safe fallback for unknown labels
        n_states    = len(_meta["le_state"].classes_)
        n_districts = len(_meta["le_district"].classes_)
        _fallback_state    = n_states    // 2
        _fallback_district = n_districts // 2
    return _clf, _meta


def _encode_state(meta: dict, state: Optional[str]) -> int:
    if not state:
        return _fallback_state
    state_up = str(state).upper().strip()
    le = meta["le_state"]
    # Exact match first
    if state_up in le.classes_:
        return int(le.transform([state_up])[0])
    # Partial match
    for cls in le.classes_:
        if state_up in cls or cls in state_up:
            return int(le.transform([cls])[0])
    return _fallback_state


def _encode_district(meta: dict, district: Optional[str]) -> int:
    if not district:
        return _fallback_district
    dist_up = str(district).upper().strip()
    le = meta["le_district"]
    if dist_up in le.classes_:
        return int(le.transform([dist_up])[0])
    for cls in le.classes_:
        if dist_up in cls or cls in dist_up:
            return int(le.transform([cls])[0])
    return _fallback_district


def predict_v2(
    state:    Optional[str] = None,
    district: Optional[str] = None,
    month:    Optional[int] = None,
    day:      Optional[int] = None,
) -> Dict[str, Any]:
    """
    Run rainfall risk prediction for a single location.

    Args:
        state:    Indian state name (used for encoding)
        district: District name (used for encoding)
        month:    Calendar month 1-12 (defaults to today)
        day:      Day of month 1-31 (defaults to today)

    Returns:
        {
          "risk_label":     0 | 1 | 2,
          "risk_level":     "LOW" | "MODERATE" | "HIGH",
          "confidence":     float,
          "probabilities":  {"LOW": f, "MODERATE": f, "HIGH": f}
        }
    """
    clf, meta = _load()

    now = datetime.now()
    m   = month if month is not None else now.month
    d   = day   if day   is not None else now.day

    s_enc  = _encode_state(meta, state)
    di_enc = _encode_district(meta, district)

    X = np.array([[float(m), float(d), float(s_enc), float(di_enc)]], dtype="float32")

    proba      = clf.predict_proba(X)[0]
    risk_label = int(np.argmax(proba))
    confidence = float(np.max(proba))

    raw_pred = {
        "risk_label":    risk_label,
        "risk_level":    LABEL_MAP[risk_label],
        "confidence":    round(confidence, 3),
        "probabilities": {
            "LOW":      round(float(proba[0]), 3),
            "MODERATE": round(float(proba[1]), 3),
            "HIGH":     round(float(proba[2]), 3),
        },
    }

    # Enrich with regional probabilities and hybrid assessment
    hybrid = compute_hybrid_risk(
        rainfall=0.0,
        ml_prediction=raw_pred,
        state=state,
        city=district,
    )
    raw_pred["thunderstorm"] = hybrid["thunderstorm"]
    raw_pred["cloudburst"]   = hybrid["cloudburst"]
    raw_pred["flood"]        = hybrid["flood"]
    raw_pred["prob_thunderstorm"] = hybrid["thunderstorm"]
    raw_pred["prob_cloudburst"]   = hybrid["cloudburst"]
    raw_pred["prob_flood"]        = hybrid["flood"]
    raw_pred["risk_label"]   = hybrid["risk_label"]
    raw_pred["risk_level"]   = hybrid["risk_level"]
    raw_pred["risk_text"]    = hybrid["risk_text"]
    raw_pred["explanation"]  = hybrid["explanation"]

    return raw_pred


def batch_predict_v2(
    locations: List[Dict[str, Any]],
    month: Optional[int] = None,
    day:   Optional[int] = None,
) -> List[Dict[str, Any]]:
    """
    Vectorized batch prediction for /predict-all.

    Args:
        locations: list of dicts with keys: city, state (optional), district (optional)
        month, day: current date (defaults to today)

    Returns: list of prediction dicts (same order)
    """
    clf, meta = _load()

    now = datetime.now()
    m   = float(month if month is not None else now.month)
    d   = float(day   if day   is not None else now.day)

    n = len(locations)
    if n == 0:
        return []

    s_encs  = np.array([float(_encode_state(meta,    loc.get("state")))    for loc in locations], dtype="float32")
    di_encs = np.array([float(_encode_district(meta, loc.get("district") or loc.get("city"))) for loc in locations], dtype="float32")

    months = np.full(n, m, dtype="float32")
    days   = np.full(n, d, dtype="float32")

    # Shape: (n, 4) — order must match training: month, day, state_enc, district_enc
    X = np.column_stack([months, days, s_encs, di_encs])

    proba_matrix = clf.predict_proba(X)       # (n, 3)
    labels       = np.argmax(proba_matrix, axis=1)

    results = []
    for i in range(n):
        p   = proba_matrix[i]
        lbl = int(labels[i])
        loc = locations[i]
        item = {
            "risk_label":    lbl,
            "risk_level":    LABEL_MAP[lbl],
            "confidence":    round(float(np.max(p)), 3),
            "probabilities": {
                "LOW":      round(float(p[0]), 3),
                "MODERATE": round(float(p[1]), 3),
                "HIGH":     round(float(p[2]), 3),
            },
        }
        hybrid = compute_hybrid_risk(
            rainfall=0.0,
            ml_prediction=item,
            state=loc.get("state"),
            city=loc.get("district") or loc.get("city"),
        )
        item["thunderstorm"] = hybrid["thunderstorm"]
        item["cloudburst"]   = hybrid["cloudburst"]
        item["flood"]        = hybrid["flood"]
        item["prob_thunderstorm"] = hybrid["thunderstorm"]
        item["prob_cloudburst"]   = hybrid["cloudburst"]
        item["prob_flood"]        = hybrid["flood"]
        item["risk_label"]   = hybrid["risk_label"]
        item["risk_level"]   = hybrid["risk_level"]
        item["risk_text"]    = hybrid["risk_text"]
        item["explanation"]  = hybrid["explanation"]
        results.append(item)
    return results


def get_alert(prediction: Dict[str, Any]) -> Dict[str, Any]:
    """Convert prediction dict into structured alert for the frontend."""
    lbl   = int(prediction.get("risk_label", 0))
    alert = dict(ALERT_MAP.get(lbl, ALERT_MAP[0]))
    alert["risk_level"]    = LABEL_MAP.get(lbl, "LOW")
    alert["confidence"]    = prediction.get("confidence", 0.0)
    alert["probabilities"] = prediction.get("probabilities", {})
    # Legacy-compatible fields reading actual event probabilities so frontend renders work
    alert["flood"]        = _risk_str(prediction.get("flood", prediction.get("probabilities", {}).get("HIGH", 0.0)))
    alert["thunderstorm"] = _risk_str(prediction.get("thunderstorm", prediction.get("probabilities", {}).get("MODERATE", 0.0)))
    alert["cloudburst"]   = _risk_str(prediction.get("cloudburst", prediction.get("probabilities", {}).get("HIGH", 0.0)))
    return alert


def compute_hybrid_risk(
    rainfall: float,
    ml_prediction: Dict[str, Any],
    wind_speed: float = 2.0,
    temperature: float = 30.0,
    humidity: float = 70.0,
    state: Optional[str] = None,
    city: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Hybrid Risk Logic with Strict Physical Constraints and 40/40/20 weights.
    """
    rain = float(rainfall if rainfall is not None else 0.0)
    wind_s = float(wind_speed if wind_speed is not None else 2.0)
    hum_s = float(humidity if humidity is not None else 70.0)
    temp_s = float(temperature if temperature is not None else 30.0)

    city_str = (city or ml_prediction.get("city") or ml_prediction.get("district") or "").strip()
    state_str = (state or ml_prediction.get("state") or "").strip()
    city_l = city_str.lower()

    # 1. No name-based randomness: the place name no longer scales or jitters the values
    #    (the former name-hash "controlled randomness" -- a +/-25% multiplier and +/-0.10 jitter -- is removed).
    rand_factor = 1.0
    jitter1 = 0.0
    jitter2 = 0.0

    # 2. Regional Classification
    is_ne = state_str in NORTHEAST_STATES or any(c in city_l for c in [
        "guwahati", "shillong", "imphal", "gangtok", "aizawl", "agartala", 
        "itanagar", "kohima", "dibrugarh", "silchar", "cherrapunji", "tezpur", "jorhat"
    ])
    
    is_coast = (
        any(c in city_l for c in COASTAL_CITIES)
        or state_str in {"Goa", "Puducherry", "Lakshadweep", "Andaman and Nicobar Islands", "Dadra and Nagar Haveli and Daman and Diu"}
        or state_str in {"Kerala", "Odisha"}      # was: 2 in 3 places, picked by a hash of the name
        # (other COASTAL_STATES places were coastal for half of the names, by the same hash: now only
        #  the listed coastal cities count, so inland places of a coastal state are not coastal)
    )
    is_central = state_str in CENTRAL_STATES

    # 3. Base Regional Probability Calibration
    if is_ne:
        cloud = min(0.88, max(0.20, (0.58 + jitter1) * rand_factor))
        flood = min(0.86, max(0.18, (0.54 + jitter2) * rand_factor))
        thunder = min(0.75, max(0.10, (0.35 - jitter1) * rand_factor))
        reg_tag = "Northeast topography"
    elif is_coast:
        flood = min(0.88, max(0.18, (0.55 + jitter1) * rand_factor))
        thunder = min(0.80, max(0.14, (0.42 + jitter2) * rand_factor))
        cloud = min(0.75, max(0.10, (0.34 - jitter1) * rand_factor))
        reg_tag = "Coastal maritime zone"
    elif is_central:
        thunder = min(0.82, max(0.16, (0.48 + jitter1) * rand_factor))
        cloud = min(0.48, max(0.06, (0.20 - jitter2) * rand_factor))
        flood = min(0.45, max(0.05, (0.18 + jitter2) * rand_factor))
        reg_tag = "Central convective plains"
    else:
        thunder = min(0.58, max(0.06, (0.24 + jitter1) * rand_factor))
        cloud = min(0.42, max(0.05, (0.15 + jitter2) * rand_factor))
        flood = min(0.38, max(0.05, (0.14 - jitter1) * rand_factor))
        reg_tag = "Inland regional zone"

    ml_conf = float(ml_prediction.get("confidence", 0.0))

    # 4. Live Weather Boosters
    if rain > 0:
        flood = min(0.92, flood + (rain / 20.0) * 0.30)
        cloud = min(0.92, cloud + (rain / 20.0) * 0.25)
    if wind_s > 5.0:
        thunder = min(0.92, thunder + min(0.25, (wind_s - 5.0) * 0.04))
    if hum_s > 80.0:
        cloud = min(0.92, cloud + 0.06)
        flood = min(0.92, flood + 0.05)

    # ML Override Logic: Gradually increase probabilities instead of forcing HIGH
    flood = min(0.95, flood + (ml_conf * 0.15))
    cloud = min(0.95, cloud + (ml_conf * 0.15))
    thunder = min(0.95, thunder + (ml_conf * 0.15))

    # 5. Strict Dependency Rules (50% reduction if not met)
    if not (hum_s > 60.0 and temp_s > 30.0):
        thunder *= 0.50
        
    if not (rain > 8.0 and hum_s > 75.0):
        cloud *= 0.50
        
    if not (rain > 10.0 or is_coast):
        flood *= 0.50

    # Strict physical constraints for < 1 mm
    if rain < 1.0:
        thunder = min(thunder, 0.30)
        cloud = min(cloud, 0.20)
        flood = min(flood, 0.20)

    thunderstorm = round(float(thunder), 2)
    cloudburst = round(float(cloud), 2)
    flood = round(float(flood), 2)
    
    # Risk Calculation Rule (40% rain, 40% ML prob, 20% environment)
    env_factor = max(thunderstorm, cloudburst, flood)
    rain_score = min(1.0, rain / 20.0)
    
    risk_score = (0.40 * rain_score) + (0.40 * ml_conf) + (0.20 * env_factor)

    # 6. Risk Level Categorization 
    if risk_score > 0.65 or rain > 15.0:
        risk_label = 2
        risk_text = "HIGH"
    elif risk_score > 0.35 or rain > 5.0:
        risk_label = 1
        risk_text = "MODERATE"
    else:
        risk_label = 0
        risk_text = "LOW"

    # Enforce strict rainfall caps (Overrides)
    if rain < 1.0:
        risk_label = 0
        risk_text = "LOW"
    elif rain <= 5.0:
        # HIGH risk only if ML confidence > 0.85 AND humidity > 80%
        if risk_label == 2:
            if not (ml_conf > 0.85 and hum_s > 80.0):
                risk_label = 1
                risk_text = "MODERATE"

    # 7. Final probability balancing & Explanation
    comp = max(env_factor, risk_score)
    if risk_label == 2:
        confidence = round(max(comp, 0.75), 3)
        p_high = round(min(0.88, max(0.60, comp)), 2)
        p_mod = round((1.0 - p_high) * 0.70, 2)
        p_low = round(1.0 - p_high - p_mod, 2)
        if rain >= 20.0:
            explanation = f"Severe precipitation warning: heavy downpour ({rain:.1f}mm)"
        elif is_ne and cloudburst >= 0.55:
            explanation = f"{reg_tag}: elevated cloudburst & flash flood indicators"
        elif is_coast and flood >= 0.55:
            explanation = f"{reg_tag}: elevated coastal flood indicator & surge vulnerability"
        elif thunderstorm >= 0.60:
            explanation = f"{reg_tag}: severe thunderstorm indicator"
        else:
            explanation = f"{reg_tag}: high rule-based threat score"

    elif risk_label == 1:
        confidence = round(max(comp, 0.60), 3)
        p_mod = round(min(0.72, max(0.50, comp)), 2)
        p_low = round((1.0 - p_mod) * 0.65, 2)
        p_high = round(1.0 - p_mod - p_low, 2)
        if rain >= 5.0:
            explanation = f"Moderate rainfall detected ({rain:.1f}mm): localized runoff advisory"
        elif thunderstorm >= 0.40:
            explanation = f"{reg_tag}: moderate convective thunderstorm indicator"
        elif cloudburst >= 0.35:
            explanation = f"{reg_tag}: moderate cloudburst indicator"
        elif flood >= 0.35:
            explanation = f"{reg_tag}: localized waterlogging / flood indicator"
        else:
            explanation = f"{reg_tag}: moderate rule-based threat score"

    else:
        confidence = round(max(0.70, 1.0 - comp), 3)
        p_low = round(confidence, 2)
        p_mod = round((1.0 - p_low) * 0.70, 2)
        p_high = round(1.0 - p_low - p_mod, 2)
        explanation = f"{reg_tag}: stable atmospheric conditions (minimal hazard)"

    probs = {
        "LOW": round(p_low, 3),
        "MODERATE": round(p_mod, 3),
        "HIGH": round(p_high, 3),
    }

    return {
        "risk_label": risk_label,
        "risk_text": risk_text,
        "risk_level": risk_text,
        "explanation": explanation,
        "confidence": confidence,
        "probabilities": probs,
        "flood": flood,
        "cloudburst": cloudburst,
        "thunderstorm": thunderstorm,
        "prob_flood": flood,
        "prob_cloudburst": cloudburst,
        "prob_thunderstorm": thunderstorm,
    }


def _risk_str(p: float) -> str:
    if p >= 0.6:   return "HIGH RISK"
    if p >= 0.35:  return "MODERATE RISK"
    return "LOW RISK"


