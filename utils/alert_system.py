"""
Alert generation based on ML risk_label from final_rainfall_model.pkl.

Inputs the full prediction dict from rainfall_predictor.predict_rainfall_risk().
Returns human-readable alert strings and metadata for the frontend.
"""
from typing import Dict, Any, Optional


def generate_alerts(prediction: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convert ML prediction output into structured alert data.

    Accepts either:
      - New format: {"risk_label": 0|1|2, "rainfall_level": str, "confidence": f, ...}
      - Legacy format: {"flood": f, "thunderstorm": f, "cloudburst": f}  (probabilities)

    Always returns a consistent dict the frontend can render.
    """
    if prediction is None:
        return _safe_default()

    # ── New model output (risk_label based) ──────────────────────────────────
    if "risk_label" in prediction:
        label    = int(prediction["risk_label"])
        level    = prediction.get("rainfall_level", _label_name(label))
        conf     = prediction.get("confidence", 0.0)
        probs    = prediction.get("probabilities", {})

        if label == 2:        # HIGH
            severity = "HIGH"
            status   = "WARNING"
            message  = "High rainfall risk. Potential flooding or waterlogging likely."
            color    = "#ff4444"
            icon     = "warning"
        elif label == 1:      # MODERATE
            severity = "MODERATE"
            status   = "CAUTION"
            message  = "Moderate rainfall expected. Stay alert for changing conditions."
            color    = "#ffaa00"
            icon     = "caution"
        else:                 # LOW
            severity = "LOW"
            status   = "SAFE"
            message  = "Low rainfall risk. Conditions appear stable."
            color    = "#22cc44"
            icon     = "safe"

        return {
            "severity":       severity,
            "status":         status,
            "message":        message,
            "color":          color,
            "icon":           icon,
            "rainfall_level": level,
            "confidence":     round(float(conf), 3),
            "probabilities":  probs,
            # Legacy-compatible fields so frontend does not break
            "flood":          _prob_str(probs.get("HIGH", 0.0)),
            "thunderstorm":   _prob_str(probs.get("MODERATE", 0.0)),
            "cloudburst":     _prob_str(probs.get("HIGH", 0.0)),
        }

    # ── Legacy probability-based format (old weather_model.pkl) ──────────────
    alerts = {}
    for event, probability in prediction.items():
        try:
            prob = float(probability)
        except (TypeError, ValueError):
            prob = 0.0

        if prob >= 0.7:
            alerts[event] = "HIGH RISK"
        elif prob >= 0.4:
            alerts[event] = "MODERATE RISK"
        else:
            alerts[event] = "LOW RISK"

    # Infer overall severity from legacy probs
    max_prob = max((float(v) for v in prediction.values()
                    if isinstance(v, (int, float))), default=0.0)
    if max_prob >= 0.7:
        severity, status, color = "HIGH", "WARNING", "#ff4444"
        message = "High weather event risk."
        icon = "warning"
    elif max_prob >= 0.4:
        severity, status, color = "MODERATE", "CAUTION", "#ffaa00"
        message = "Moderate weather event risk."
        icon = "caution"
    else:
        severity, status, color = "LOW", "SAFE", "#22cc44"
        message = "Low weather event risk."
        icon = "safe"

    return {
        **alerts,
        "severity":       severity,
        "status":         status,
        "message":        message,
        "color":          color,
        "icon":           icon,
        "rainfall_level": severity,
        "confidence":     round(max_prob, 3),
    }


# ── Helpers ───────────────────────────────────────────────────────────────────
def _label_name(label: int) -> str:
    return {0: "LOW", 1: "MODERATE", 2: "HIGH"}.get(label, "LOW")


def _prob_str(p: float) -> str:
    if p >= 0.7:
        return "HIGH RISK"
    elif p >= 0.4:
        return "MODERATE RISK"
    return "LOW RISK"


def _safe_default() -> Dict[str, Any]:
    return {
        "severity": "LOW", "status": "SAFE",
        "message":  "No prediction data available.",
        "color":    "#22cc44", "icon": "safe",
        "rainfall_level": "LOW", "confidence": 0.0,
    }
