import math
from typing import Callable, Dict, List

VENDOR_INTEL_BY_COMPONENT = {
    "gpu-display-chip": {
        "unit_cost": 187.0,
        "lead_time": "18d",
        "safety_stock": "12d",
        "inventory": "30d",
        "qty_per_laptop": 1,
        "vendors": [
            {"name": "TSMC", "origin": "TW", "status": "AT-RISK", "capacity": 30610, "cost": 187.0, "lead": "18d", "risk": 62, "quality": 99, "otd": "4,10 12,4 20,4 28,11 36,15 44,15 52,9 60,6 68,11"},
            {"name": "Samsung Foundry", "origin": "KR", "status": "ACTIVE", "capacity": 16572, "cost": 220.66, "lead": "14d", "risk": 33, "quality": 94, "otd": "4,12 12,7 20,6 28,9 36,15 44,16 52,14 60,4 68,4"},
            {"name": "GlobalFoundries", "origin": "US", "status": "ACTIVE", "capacity": 39350, "cost": 252.45, "lead": "16d", "risk": 24, "quality": 90, "otd": "4,13 12,7 20,3 28,13 36,15 44,16 52,15 60,8 68,3"},
            {"name": "UMC", "origin": "TW", "status": "AT-RISK", "capacity": 38524, "cost": 239.36, "lead": "20d", "risk": 66, "quality": 86, "otd": "4,16 12,5 20,3 28,4 36,16 44,16 52,14 60,14 68,7"},
        ],
    },
    "processor-cpu": {
        "unit_cost": 264.0,
        "lead_time": "16d",
        "safety_stock": "10d",
        "inventory": "24d",
        "qty_per_laptop": 1,
        "vendors": [
            {"name": "Intel", "origin": "US", "status": "AT-RISK", "capacity": 28720, "cost": 264.0, "lead": "16d", "risk": 58, "quality": 97, "otd": "4,10 12,8 20,5 28,7 36,12 44,14 52,10 60,7 68,10"},
            {"name": "AMD", "origin": "US", "status": "ACTIVE", "capacity": 19840, "cost": 289.2, "lead": "13d", "risk": 35, "quality": 95, "otd": "4,14 12,9 20,6 28,4 36,6 44,12 52,10 60,5 68,6"},
            {"name": "MediaTek", "origin": "TW", "status": "ACTIVE", "capacity": 32100, "cost": 243.9, "lead": "17d", "risk": 28, "quality": 89, "otd": "4,15 12,10 20,7 28,8 36,13 44,14 52,11 60,7 68,5"},
        ],
    },
    "memory-lpdddr5": {
        "unit_cost": 74.0,
        "lead_time": "15d",
        "safety_stock": "14d",
        "inventory": "34d",
        "qty_per_laptop": 2,
        "vendors": [
            {"name": "SK Hynix", "origin": "KR", "status": "ACTIVE", "capacity": 51200, "cost": 74.0, "lead": "15d", "risk": 32, "quality": 98, "otd": "4,9 12,6 20,4 28,6 36,10 44,9 52,8 60,6 68,4"},
            {"name": "Micron", "origin": "US", "status": "ACTIVE", "capacity": 33100, "cost": 77.6, "lead": "17d", "risk": 39, "quality": 94, "otd": "4,12 12,8 20,6 28,7 36,11 44,12 52,10 60,8 68,6"},
            {"name": "Samsung Memory", "origin": "KR", "status": "AT-RISK", "capacity": 40800, "cost": 80.25, "lead": "18d", "risk": 57, "quality": 93, "otd": "4,14 12,9 20,8 28,12 36,15 44,12 52,9 60,8 68,11"},
        ],
    },
    "battery-pack": {
        "unit_cost": 53.0,
        "lead_time": "12d",
        "safety_stock": "18d",
        "inventory": "28d",
        "qty_per_laptop": 1,
        "vendors": [
            {"name": "ATL", "origin": "CN", "status": "ACTIVE", "capacity": 62200, "cost": 53.0, "lead": "12d", "risk": 27, "quality": 96, "otd": "4,10 12,7 20,5 28,7 36,8 44,9 52,8 60,6 68,5"},
            {"name": "LG Energy", "origin": "KR", "status": "ACTIVE", "capacity": 28700, "cost": 58.7, "lead": "14d", "risk": 33, "quality": 94, "otd": "4,13 12,9 20,8 28,10 36,11 44,10 52,8 60,6 68,7"},
            {"name": "BYD", "origin": "CN", "status": "AT-RISK", "capacity": 45900, "cost": 49.85, "lead": "16d", "risk": 61, "quality": 88, "otd": "4,16 12,10 20,7 28,9 36,14 44,16 52,13 60,11 68,10"},
        ],
    },
}


def build_inventory_timeline(fulfillment: int, risk: int, horizon_days: int, priority: str) -> List[int]:
    points: List[int] = []
    steps = max(8, min(14, round(horizon_days / 3)))
    base = 72 + round(fulfillment * 0.22) - round(risk * 0.18)
    slope_boost = 6 if priority == "Speed" else -2 if priority == "Cost" else 3 if priority == "Risk" else 0
    start = max(32, min(92, base + slope_boost))

    for i in range(steps):
        progress = i / max(1, steps - 1)
        noise = math.sin(i * 1.2) * 3 + math.cos(i * 0.6) * 2
        drawdown = progress * (risk * 0.45)
        value = max(18, min(98, start - drawdown + noise))
        points.append(round(value))

    return points


def component_vendor_view(component_id: str) -> Dict:
    default_view = VENDOR_INTEL_BY_COMPONENT.get("gpu-display-chip", {})
    return VENDOR_INTEL_BY_COMPONENT.get(component_id, default_view)


def flatten_vendor_universe(component_name_resolver: Callable[[str], str]) -> List[Dict]:
    rows: List[Dict] = []
    for component_id, data in VENDOR_INTEL_BY_COMPONENT.items():
        component_name = component_name_resolver(component_id)
        for idx, vendor in enumerate(data.get("vendors", [])):
            rows.append({
                **vendor,
                "component_id": component_id,
                "component_name": component_name,
                "key": f"{component_id}-{vendor['name']}-{idx}",
            })
    return rows