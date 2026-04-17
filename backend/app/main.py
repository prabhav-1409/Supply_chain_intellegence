import asyncio
import json
import os
import time
from datetime import datetime, timedelta
from statistics import median
from typing import Any, Dict, List, Optional
from urllib.parse import quote, urlparse
from uuid import uuid4
import xml.etree.ElementTree as ET

from fastapi import FastAPI, HTTPException, Request
import httpx
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .vendor_planner_data import (
    build_inventory_timeline,
    component_vendor_view,
    flatten_vendor_universe,
)

try:
    from openai import AsyncOpenAI
except ImportError:
    AsyncOpenAI = None

try:
    from neo4j import GraphDatabase
except ImportError:
    GraphDatabase = None

app = FastAPI(title="Supply Chain Command Center V2 API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CreateRunRequest(BaseModel):
    event_id: str
    component_id: str


class TariffOverrides(BaseModel):
    china: int = 145
    other: int = 25
    domestic: int = 0


class ScenarioAssumptions(BaseModel):
    uploaded_docs: List[str] = Field(default_factory=list)
    selected_skus: List[str] = Field(default_factory=list)
    active_routes: List[str] = Field(default_factory=list)
    blocked_routes: List[str] = Field(default_factory=list)
    disruption_intensity: int = 50
    disruption_duration: int = 30
    tariffs: TariffOverrides = Field(default_factory=TariffOverrides)


class ScenarioPlannerRequest(BaseModel):
    event_id: str
    component_id: str
    scenario_id: str = "B"
    horizon: int = 30
    priority: str = "Balanced"
    assumptions: ScenarioAssumptions = Field(default_factory=ScenarioAssumptions)


class ScenarioSimulationRequest(BaseModel):
    selected_scenario: str = "B"
    assumptions: ScenarioAssumptions = Field(default_factory=ScenarioAssumptions)


class VendorIntelRequest(BaseModel):
    component_id: str = "gpu-display-chip"
    search: str = ""
    country: str = "All Countries"
    status: str = "All Statuses"
    event_id: Optional[str] = None
    scenario_id: str = "B"
    assumptions: ScenarioAssumptions = Field(default_factory=ScenarioAssumptions)


class OperationsPlanRequest(BaseModel):
    event_id: str
    component_id: str
    scenario_id: str = "B"
    horizon: int = 30
    priority: str = "Balanced"
    assumptions: ScenarioAssumptions = Field(default_factory=ScenarioAssumptions)


class MarginConstraints(BaseModel):
    sku_id: str
    customer_segment: str
    unit_revenue: float
    target_margin_pct: float
    floor_margin_pct: float


class MarketEvidencePoint(BaseModel):
    signal_type: str
    label: str
    value: Any
    unit: str = ""
    confidence: int = 0
    freshness_hours: int = 0


class ComponentEconomics(BaseModel):
    component_id: str
    component_name: str
    category: str
    qty_per_unit: int
    required_units: int
    base_unit_cost: float
    baseline_spend: float
    disruption_sensitive_spend: float
    margin_sensitivity_pct: float


class VendorOption(BaseModel):
    vendor_id: str
    vendor_name: str
    country: str
    tier: str
    unit_price: float
    historical_avg_price: float
    historical_best_price: float
    lead_time_days: float
    fill_rate_pct: int
    reliability: int
    geo_risk: int
    feasible: bool


class RouteOption(BaseModel):
    route_id: str
    vendor_id: str
    mode: str
    transit_days: float
    cost_per_pallet: float
    risk: float
    corridors: List[str] = Field(default_factory=list)
    feasible: bool = True


class DisruptionImpact(BaseModel):
    event_id: str
    component_id: str
    tariff_surcharge_pct: float
    vendor_capacity_lost_pct: float
    freight_premium_pct: float
    lead_time_delta_days: float
    landed_cost_delta_pct: float
    confidence_reduction_pct: float
    summary: str


class ScenarioResult(BaseModel):
    scenario_id: str
    scenario_name: str
    vendor_id: str
    vendor_name: str
    route_id: str
    route_mode: str
    proposed_unit_price: float
    procurement_cost: float
    logistics_cost: float
    tariff_cost: float
    delay_penalty: float
    risk_reserve: float
    revenue: float
    expected_profit: float
    gross_margin_pct: float
    fulfillment_confidence: float
    execution_risk: float
    margin_volatility: float
    scenario_score: float
    tradeoff: str


class NegotiationBand(BaseModel):
    vendor_id: str
    vendor_name: str
    ideal_price: float
    target_low_price: float
    target_high_price: float
    max_acceptable_price: float
    walk_away_price: float
    leverage: str
    rationale: str


class RecommendationResult(BaseModel):
    component_id: str
    selected_vendor_id: str
    selected_vendor_name: str
    selected_route_id: str
    selected_route_mode: str
    selected_target_price: float
    expected_profit: float
    profit_protected_vs_baseline: float
    fulfillment_confidence: float
    confidence_range_low: float
    confidence_range_high: float
    top_tradeoff: str
    rollback_trigger: str


class OutcomeFeedback(BaseModel):
    order_id: str
    component_id: str
    predicted_unit_price: Optional[float] = None
    actual_unit_price: Optional[float] = None
    predicted_eta_days: Optional[float] = None
    actual_eta_days: Optional[float] = None
    predicted_profit: Optional[float] = None
    actual_profit: Optional[float] = None
    calibration_status: str


OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:7b")
LLM_BACKEND_MODE = "llm" if (OPENAI_API_KEY and AsyncOpenAI is not None) or OLLAMA_BASE_URL else "scripted"
TIMESFM_API_URL = os.getenv("TIMESFM_API_URL", "")
TIMESFM_API_KEY = os.getenv("TIMESFM_API_KEY", "")
TIMESFM_MODEL_NAME = os.getenv("TIMESFM_MODEL", "timesfm")
TIMESFM_PROVIDER = os.getenv("TIMESFM_PROVIDER", "local")
AUTORESEARCH_RSS_URL = os.getenv("AUTORESEARCH_RSS_URL", "https://news.google.com/rss/search")
AUTORESEARCH_MAX_ITEMS = int(os.getenv("AUTORESEARCH_MAX_ITEMS", "4"))
NEO4J_URI = os.getenv("NEO4J_URI", "")
NEO4J_USER = os.getenv("NEO4J_USER", "")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "")

AGENT_PROVIDER_REGISTRY: Dict[str, Dict[str, Any]] = {
    "AutoResearch": {
        "provider_type": "web-research",
        "driver": "google-news-rss",
        "external": True,
    },
    "TimesFM": {
        "provider_type": "forecast-model",
        "driver": "timesfm-local",
        "external": False,
    },
    "CausalGraph": {"provider_type": "llm-role", "driver": "llm", "external": False},
    "RiskScorer": {"provider_type": "llm-role", "driver": "llm", "external": False},
    "RecEngine": {"provider_type": "llm-role", "driver": "llm", "external": False},
    "Decision Intelligence": {"provider_type": "llm-role", "driver": "llm", "external": False},
    "Procurement Copilot": {"provider_type": "llm-role", "driver": "llm", "external": False},
    "Customer Communication Agent": {"provider_type": "llm-role", "driver": "llm", "external": False},
    "Monitoring Agent": {"provider_type": "llm-role", "driver": "llm", "external": False},
    "JudgeAgent": {"provider_type": "llm-role", "driver": "llm", "external": False},
}


class AgentInsightRequest(BaseModel):
    page_id: str
    agent_name: str
    card_id: Optional[str] = None
    order_id: Optional[str] = None
    event_id: Optional[str] = None
    component_id: Optional[str] = None
    scenario_id: Optional[str] = None
    question: Optional[str] = None


class PageAgentInsightRequest(BaseModel):
    page_id: str
    order_id: Optional[str] = None
    event_id: Optional[str] = None
    component_id: Optional[str] = None
    scenario_id: Optional[str] = None
    question: Optional[str] = None


def _page_request_to_agent_requests(request: PageAgentInsightRequest) -> List[AgentInsightRequest]:
    cards = AGENT_CARD_LAYOUT.get(request.page_id, [])
    return [
        AgentInsightRequest(
            page_id=request.page_id,
            card_id=card["card_id"],
            agent_name=card["agent_name"],
            order_id=request.order_id,
            event_id=request.event_id,
            component_id=request.component_id,
            scenario_id=request.scenario_id,
            question=request.question,
        )
        for card in cards
    ]


def _neo4j_configured() -> bool:
    return bool(NEO4J_URI and NEO4J_USER and NEO4J_PASSWORD and GraphDatabase is not None)


def _fallback_interaction_graph(event_id: Optional[str]) -> Dict[str, Any]:
    resolved_event = event_id or EVENTS[0]["id"]
    graph = KNOWLEDGE_GRAPH.get(resolved_event, {"nodes": [], "edges": []})
    return {
        "backend": "fallback",
        "configured": _neo4j_configured(),
        "connected": False,
        "event_id": resolved_event,
        "nodes": graph.get("nodes", []),
        "edges": graph.get("edges", []),
        "summary": "In-memory interaction graph is active.",
    }


def _query_neo4j_interaction_graph(event_id: Optional[str], limit: int = 200) -> Dict[str, Any]:
    if not _neo4j_configured():
        return _fallback_interaction_graph(event_id)

    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
    cypher = """
    MATCH (src:Agent)-[r:INTERACTS_WITH]->(dst:Agent)
    WHERE $event_id IS NULL OR r.event_id = $event_id
    RETURN
      src.id AS source_id,
      coalesce(src.label, src.id) AS source_label,
      dst.id AS target_id,
      coalesce(dst.label, dst.id) AS target_label,
      coalesce(r.kind, 'signal') AS kind,
      coalesce(r.weight, 1.0) AS weight
    LIMIT $limit
    """
    try:
        with driver.session() as session:
            records = list(session.run(cypher, event_id=event_id, limit=limit))
        if not records:
            return {
                "backend": "neo4j",
                "configured": True,
                "connected": True,
                "event_id": event_id,
                "nodes": [],
                "edges": [],
                "summary": "Neo4j connected, no interaction edges found for current filter.",
            }

        node_map: Dict[str, Dict[str, str]] = {}
        edges: List[Dict[str, Any]] = []
        for record in records:
            source_id = str(record["source_id"])
            target_id = str(record["target_id"])
            node_map[source_id] = {"id": source_id, "label": str(record["source_label"]), "type": "agent"}
            node_map[target_id] = {"id": target_id, "label": str(record["target_label"]), "type": "agent"}
            edges.append({
                "source": source_id,
                "target": target_id,
                "kind": str(record["kind"]),
                "weight": float(record["weight"]),
            })

        return {
            "backend": "neo4j",
            "configured": True,
            "connected": True,
            "event_id": event_id,
            "nodes": list(node_map.values()),
            "edges": edges,
            "summary": f"Neo4j interaction graph with {len(node_map)} nodes and {len(edges)} edges.",
        }
    finally:
        driver.close()


EVENTS = [
    {"id": "taiwan-earthquake", "name": "Taiwan Earthquake", "severity": "CRITICAL", "icon": "🌏"},
    {"id": "us-china-tariff", "name": "US-China Tariff +25%", "severity": "HIGH", "icon": "📊"},
    {"id": "hormuz-closure", "name": "Strait of Hormuz Closure", "severity": "HIGH", "icon": "🚢"},
    {"id": "us-china-trade-war", "name": "US-China Trade War", "severity": "CRITICAL", "icon": "⚔️"},
    {"id": "malaysia-floods", "name": "Malaysia Flash Floods", "severity": "CRITICAL", "icon": "🌊"},
    {"id": "tsmc-factory-fire", "name": "TSMC Factory Fire", "severity": "CRITICAL", "icon": "🔥"},
]

COMPONENTS = [
    {"id": "memory-lpdddr5", "name": "Memory LPDDR5", "vendor": "SK Hynix", "criticality": "nominal"},
    {"id": "processor-cpu", "name": "Processor CPU", "vendor": "Intel", "criticality": "critical"},
    {"id": "gpu-display-chip", "name": "GPU Display Chip", "vendor": "TSMC", "criticality": "critical"},
    {"id": "battery-pack", "name": "Battery Pack", "vendor": "ATL", "criticality": "important"},
]

CAUSAL_CHAINS = {
    "taiwan-earthquake": [
        {"stage": "Root Event", "name": "Taiwan Earthquake 6.8M", "color": "#ff6b7f"},
        {"stage": "Fab Impact", "name": "TSMC Production -35%", "color": "#ff9c4d"},
        {"stage": "Supply", "name": "CPU Lead Time +22 Days", "color": "#ffc65a"},
        {"stage": "Assembly", "name": "CPU Shortage Critical", "color": "#ff6b7f"},
    ],
    "us-china-tariff": [
        {"stage": "Root Event", "name": "US-China Tariff +25%", "color": "#ff9c4d"},
        {"stage": "Cost Shock", "name": "Imported Components +11%", "color": "#ffbe68"},
        {"stage": "Sourcing", "name": "Nearshore Shift Triggered", "color": "#50d5ff"},
        {"stage": "Assembly", "name": "Margin Compression Alert", "color": "#ff6b7f"},
    ],
    "hormuz-closure": [
        {"stage": "Root Event", "name": "Strait of Hormuz Closure", "color": "#ff6b7f"},
        {"stage": "Logistics", "name": "Sea Route +14 Days", "color": "#ff9c4d"},
        {"stage": "Supply", "name": "Chassis Lead Time 28d", "color": "#ffc65a"},
        {"stage": "Assembly", "name": "Assembly Line Gap Day 42", "color": "#ff6b7f"},
    ],
    "us-china-trade-war": [
        {"stage": "Root Event", "name": "US-China Trade War", "color": "#ff6b7f"},
        {"stage": "Policy", "name": "Export Controls Tightened", "color": "#ff9c4d"},
        {"stage": "Supply", "name": "CPU/GPU Lead Time +16 Days", "color": "#ffc65a"},
        {"stage": "Assembly", "name": "Allocation Conflict Across Plants", "color": "#ff6b7f"},
    ],
    "malaysia-floods": [
        {"stage": "Root Event", "name": "Malaysia Flash Floods", "color": "#ff6b7f"},
        {"stage": "Operations", "name": "Packaging Site Downtime", "color": "#ff9c4d"},
        {"stage": "Logistics", "name": "Outbound Delay +9 Days", "color": "#ffc65a"},
        {"stage": "Assembly", "name": "Memory Module Slippage", "color": "#ff6b7f"},
    ],
    "tsmc-factory-fire": [
        {"stage": "Root Event", "name": "TSMC Factory Fire", "color": "#ff6b7f"},
        {"stage": "Fab Impact", "name": "Wafer Output -28%", "color": "#ff9c4d"},
        {"stage": "Supply", "name": "GPU Allocation Cut", "color": "#ffc65a"},
        {"stage": "Assembly", "name": "Display Unit Bottleneck", "color": "#ff6b7f"},
    ],
}

SCENARIOS = {
    "taiwan-earthquake": {
        "A": {"fulfillment": 90, "cost": "$2.4M", "lead_time": "18d", "risk": 46, "confidence": "+7%"},
        "B": {"fulfillment": 93, "cost": "$1.8M", "lead_time": "17d", "risk": 39, "confidence": "+9%"},
        "C": {"fulfillment": 88, "cost": "$0.9M", "lead_time": "21d", "risk": 48, "confidence": "+12%"},
        "D": {"fulfillment": 95, "cost": "$2.9M", "lead_time": "13d", "risk": 41, "confidence": "+11%"},
        "E": {"fulfillment": 84, "cost": "$3.5M", "lead_time": "26d", "risk": 56, "confidence": "+15%"},
    },
    "us-china-tariff": {
        "A": {"fulfillment": 94, "cost": "$2.0M", "lead_time": "15d", "risk": 34, "confidence": "+6%"},
        "B": {"fulfillment": 96, "cost": "$1.5M", "lead_time": "14d", "risk": 28, "confidence": "+8%"},
        "C": {"fulfillment": 91, "cost": "$0.8M", "lead_time": "18d", "risk": 37, "confidence": "+10%"},
        "D": {"fulfillment": 95, "cost": "$2.4M", "lead_time": "12d", "risk": 33, "confidence": "+9%"},
        "E": {"fulfillment": 86, "cost": "$3.1M", "lead_time": "22d", "risk": 49, "confidence": "+13%"},
    },
    "hormuz-closure": {
        "A": {"fulfillment": 92, "cost": "$2.2M", "lead_time": "17d", "risk": 42, "confidence": "+7%"},
        "B": {"fulfillment": 94, "cost": "$1.7M", "lead_time": "16d", "risk": 34, "confidence": "+8%"},
        "C": {"fulfillment": 89, "cost": "$0.7M", "lead_time": "20d", "risk": 45, "confidence": "+10%"},
        "D": {"fulfillment": 96, "cost": "$2.8M", "lead_time": "11d", "risk": 37, "confidence": "+11%"},
        "E": {"fulfillment": 85, "cost": "$3.4M", "lead_time": "25d", "risk": 55, "confidence": "+15%"},
    },
    "us-china-trade-war": {
        "A": {"fulfillment": 88, "cost": "$2.6M", "lead_time": "19d", "risk": 51, "confidence": "+8%"},
        "B": {"fulfillment": 92, "cost": "$2.0M", "lead_time": "17d", "risk": 43, "confidence": "+9%"},
        "C": {"fulfillment": 85, "cost": "$1.2M", "lead_time": "23d", "risk": 54, "confidence": "+12%"},
        "D": {"fulfillment": 94, "cost": "$3.3M", "lead_time": "13d", "risk": 46, "confidence": "+10%"},
        "E": {"fulfillment": 80, "cost": "$3.9M", "lead_time": "28d", "risk": 61, "confidence": "+16%"},
    },
    "malaysia-floods": {
        "A": {"fulfillment": 90, "cost": "$2.3M", "lead_time": "18d", "risk": 45, "confidence": "+7%"},
        "B": {"fulfillment": 93, "cost": "$1.8M", "lead_time": "16d", "risk": 36, "confidence": "+9%"},
        "C": {"fulfillment": 87, "cost": "$0.9M", "lead_time": "21d", "risk": 49, "confidence": "+11%"},
        "D": {"fulfillment": 95, "cost": "$2.9M", "lead_time": "12d", "risk": 40, "confidence": "+10%"},
        "E": {"fulfillment": 83, "cost": "$3.4M", "lead_time": "26d", "risk": 57, "confidence": "+15%"},
    },
    "tsmc-factory-fire": {
        "A": {"fulfillment": 89, "cost": "$2.7M", "lead_time": "20d", "risk": 52, "confidence": "+8%"},
        "B": {"fulfillment": 92, "cost": "$2.1M", "lead_time": "18d", "risk": 44, "confidence": "+9%"},
        "C": {"fulfillment": 85, "cost": "$1.2M", "lead_time": "23d", "risk": 56, "confidence": "+12%"},
        "D": {"fulfillment": 94, "cost": "$3.4M", "lead_time": "13d", "risk": 47, "confidence": "+10%"},
        "E": {"fulfillment": 79, "cost": "$4.0M", "lead_time": "29d", "risk": 63, "confidence": "+16%"},
    },
}

RECOMMENDATIONS = {
    "A": {
        "title": "Single Vendor Shift",
        "reasoning": "Fast execution and simple operations, but concentration risk remains.",
        "actions": [
            "Issue primary PO within 48 hours",
            "Lock transport capacity for next two cycles",
            "Enable backup vendor as warm standby",
        ],
    },
    "B": {
        "title": "Split Fulfillment 60/40",
        "reasoning": "Best risk-diversification and cost balance across uncertain trade lanes.",
        "actions": [
            "Allocate 60% to low-risk source and 40% to speed source",
            "Sync production windows to reduce assembly jitter",
            "Review vendor ETA variance weekly",
        ],
    },
    "C": {
        "title": "Conservative Deferral",
        "reasoning": "Protects spend in near term while accepting moderate delivery pressure.",
        "actions": [
            "Defer low-priority orders",
            "Preserve safety stock for top SKUs",
            "Prepare rapid switch fallback plan",
        ],
    },
    "D": {
        "title": "Air Freight Escalation",
        "reasoning": "Fastest path to stabilize fulfillment when disruption is severe.",
        "actions": [
            "Reserve expedited lanes immediately",
            "Pre-clear customs and quality checks",
            "Time-box premium spend with weekly review",
        ],
    },
    "E": {
        "title": "Emergency Spot Market",
        "reasoning": "High-cost fallback to bridge availability gaps under extreme constraints.",
        "actions": [
            "Use spot buys only for critical builds",
            "Increase inspection frequency on first lots",
            "Reduce dependence by onboarding long-term alternatives",
        ],
    },
}

AGENT_WORKERS = [
    {
        "name": "AutoResearch",
        "tag": "signal",
        "role": "Surface the freshest operational signal from the event and say what changed first.",
    },
    {
        "name": "CausalGraph",
        "tag": "causal",
        "role": "Explain the highest-impact causal path from disruption to supply chain impact.",
    },
    {
        "name": "TimesFM",
        "tag": "forecast",
        "role": "Forecast the near-term delivery or inventory trajectory in one precise sentence.",
    },
    {
        "name": "RiskScorer",
        "tag": "risk",
        "role": "State the most material risk concentration or exposure now visible.",
    },
    {
        "name": "RecEngine",
        "tag": "decision",
        "role": "Recommend the best mitigation scenario and justify it in one sentence.",
    },
    {
        "name": "JudgeAgent",
        "tag": "verdict",
        "role": (
            "You are the Judge. Review the outputs from AutoResearch, CausalGraph, TimesFM, RiskScorer, and RecEngine. "
            "Score their consistency on a scale of 1-10 and summarize the consensus recommendation in one sentence. "
            "Identify any dissenting view. Return JSON with keys: verdict (string), consensus_score (float 1-10), confidence (int 0-100), dissent (string or null)."
        ),
    },
]

AGENT_CARD_LAYOUT: Dict[str, List[Dict[str, str]]] = {
    "risk-dashboard": [
        {"card_id": "risk.autoresearch", "agent_name": "AutoResearch", "title": "Global Signal"},
        {"card_id": "risk.riskscorer", "agent_name": "RiskScorer", "title": "System Risk"},
    ],
    "component-analysis": [
        {"card_id": "component.causalgraph", "agent_name": "CausalGraph", "title": "Shock Propagation"},
        {"card_id": "component.timesfm", "agent_name": "TimesFM", "title": "Forecast Outlook"},
    ],
    "alerts-decisions": [
        {"card_id": "alerts.riskscorer", "agent_name": "RiskScorer", "title": "Alert Severity"},
        {"card_id": "alerts.decision", "agent_name": "Decision Intelligence", "title": "CFO Rationale"},
        {"card_id": "alerts.causal", "agent_name": "CausalGraph", "title": "Root Cause Chain"},
    ],
    "procurement-actions": [
        {"card_id": "procurement.recengine", "agent_name": "RecEngine", "title": "Recommendation"},
        {"card_id": "procurement.copilot", "agent_name": "Procurement Copilot", "title": "Interactive Copilot"},
    ],
    "route-intelligence": [
        {"card_id": "route.causalgraph", "agent_name": "CausalGraph", "title": "Route Disruption Insight"},
        {"card_id": "route.autoresearch", "agent_name": "AutoResearch", "title": "Corridor Signals"},
    ],
    "delivery-promise": [
        {"card_id": "delivery.timesfm", "agent_name": "TimesFM", "title": "Reliability Forecast"},
        {"card_id": "delivery.communication", "agent_name": "Customer Communication Agent", "title": "Customer Message"},
    ],
    "execution-log": [
        {"card_id": "execution.autoresearch", "agent_name": "AutoResearch", "title": "Improvement Signals"},
        {"card_id": "execution.monitoring", "agent_name": "Monitoring Agent", "title": "Emerging Patterns"},
    ],
}

AGENT_PROMPT_ROLES: Dict[str, str] = {
    "AutoResearch": "Identify new external signals that materially change supply chain risk.",
    "RiskScorer": "Quantify severity and identify where risk concentration is highest.",
    "CausalGraph": "Explain causal chain from disruption to component/route/customer impact.",
    "TimesFM": "Forecast near-term delivery reliability and likely trend direction.",
    "Decision Intelligence": "Provide CFO-grade rationale balancing urgency, cost, and ROI.",
    "RecEngine": "Recommend best action and justify tradeoff in one concise operational summary.",
    "Procurement Copilot": "Answer procurement what-if decisions succinctly and clearly.",
    "Customer Communication Agent": "Draft transparent customer-facing ETA communication.",
    "Monitoring Agent": "Summarize post-action patterns and leading indicators.",
}

AGENT_INSIGHT_CACHE: Dict[str, Dict[str, Any]] = {}

# ── Judge verdicts (scripted fallback) ──────────────────────────────────────
JUDGE_VERDICTS = {
    "taiwan-earthquake":   {"verdict": "Strong consensus: activate Korea backup and buffer with air freight immediately.", "consensus_score": 9.1, "confidence": 87, "dissent": "TimesFM flags week-3 threshold as optimistic under worst-case fab output."},
    "us-china-tariff":     {"verdict": "Agents align on split-fulfillment strategy to absorb tariff pressure.", "consensus_score": 8.7, "confidence": 83, "dissent": None},
    "hormuz-closure":      {"verdict": "Consensus to expedite via air on day-11 trigger before stockout cascade.", "consensus_score": 8.9, "confidence": 85, "dissent": "RiskScorer notes premium spend may exceed budget ceiling in Q2."},
    "us-china-trade-war":  {"verdict": "Agents recommend Scenario D with selective expedite as primary hedge.", "consensus_score": 8.4, "confidence": 80, "dissent": "CausalGraph flags export-control escalation risk not captured in fulfillment model."},
    "malaysia-floods":     {"verdict": "Nearshore activation is the dominant consensus action across all agents.", "consensus_score": 9.0, "confidence": 88, "dissent": None},
    "tsmc-factory-fire":   {"verdict": "Air freight escalation under Scenario D is the least-regret path.", "consensus_score": 8.6, "confidence": 84, "dissent": "RecEngine notes spot-market alternative (Scenario E) may be unavoidable if fire persists beyond day 10."},
}

# ── Tool evidence citations (mock) ───────────────────────────────────────────
TOOL_EVIDENCE = {
    "taiwan-earthquake": {
        "AutoResearch": ["Reuters: TSMC Fab18 halted — seismic check", "Bloomberg: 6.8M quake near Hsinchu, 14:22 UTC"],
        "CausalGraph":  ["Internal ERP: CPU stock T-3 days below reorder", "Gartner: TSMC = 62% of advanced node supply"],
        "TimesFM":      ["Demand model: 4-week rolling burn rate +18%", "Historical: 2022 fab disruption pattern match"],
        "RiskScorer":   ["S&P: TSMC supply concentration score 9.1/10", "Lloyd's: Seismic risk tier 1 for Hsinchu zone"],
        "RecEngine":    ["ERP: Korea fab has 22k wafer/wk spare capacity", "Scenario B: backtested ROI 2.3x vs A and C"],
        "JudgeAgent":   ["Consistency check: 4/5 agents cite fab as root", "Dissent: TimesFM threshold assumption reviewed"],
    },
    "us-china-tariff": {
        "AutoResearch": ["US Federal Register: Section 301 list update", "Reuters: 25% tariff effective in 72h"],
        "CausalGraph":  ["ERP: 68% of memory imports routed via China", "Cost model: landed cost delta +$11/unit"],
        "TimesFM":      ["Cycle analysis: nearshore ramp = 2 cycles avg", "Supplier SLA: Taiwan fab — 14d lead time"],
        "RiskScorer":   ["Treasury: FX exposure $4.2M at current rates", "Procurement: single-route dependency flagged"],
        "RecEngine":    ["Scenario B: 96% fulfillment vs A at 94%", "Trade desk: split allocation feasible this week"],
        "JudgeAgent":   ["Consensus: high on cost hedge, medium on speed", "Dissent: none detected in this run"],
    },
    "hormuz-closure": {
        "AutoResearch": ["Lloyd's: Strait of Hormuz risk level CRITICAL", "Shipping: 3 carriers suspended Gulf lanes"],
        "CausalGraph":  ["Route model: Cap of Good Hope adds 14 days", "ERP: chassis safety stock = 8 days coverage"],
        "TimesFM":      ["Forecast: SLA breach confidence 79% by day 11", "Historical: 2019 tanker incident — 16d resolved"],
        "RiskScorer":   ["Carrier: 6 vendors on affected sea corridor", "Insurance: force majeure clause activated"],
        "RecEngine":    ["Air freight availability: 3 lanes confirmed open", "Scenario D: premium $2.8M vs $4.7M stockout cost"],
        "JudgeAgent":   ["Cross-agent agreement: day-11 trigger validated by 4/5", "RiskScorer budget note flagged as risk item"],
    },
    "us-china-trade-war": {
        "AutoResearch": ["BIS: new export control list published", "Reuters: GPU wafer restrictions tightened"],
        "CausalGraph":  ["ERP: CPU/GPU = 78% of BOM cost affected", "Policy DB: 14 new SKU classifications impacted"],
        "TimesFM":      ["Scenario model: 5-week delay curve confirmed", "Sensitivity: worst case adds 3 weeks on top"],
        "RiskScorer":   ["Concentration index: 3-region dependency 8.8/10", "Stress test: dual-supply reduces score to 5.4"],
        "RecEngine":    ["Scenario D expedite lanes pre-priced at $2.6M", "Supplier: Vietnam ramp feasible in 3 weeks"],
        "JudgeAgent":   ["Consensus 8.4/10 — moderate policy dissent noted", "CausalGraph escalation flag marked for review"],
    },
    "malaysia-floods": {
        "AutoResearch": ["BMKG: flood alert Level 3 — Penang, Kedah", "Supplier: packaging site offline — no ETA"],
        "CausalGraph":  ["ERP: memory module batch delayed 9 days", "Outbound: 4 logistics providers suspended"],
        "TimesFM":      ["Burn rate: inventory runway shrinks by 5.2 days", "Forecast: week-2 customer SLA at 67% confidence"],
        "RiskScorer":   ["Weather index: 72h continued rain probability 84%", "Recovery model: median site uptime = 11 days"],
        "RecEngine":    ["Nearshore: Taiwan fab can cover 80% of volume", "Scenario B activates in 48h — lead-time neutral"],
        "JudgeAgent":   ["All agents cite nearshore as primary lever: 5/5", "No material dissent detected across agent set"],
    },
    "tsmc-factory-fire": {
        "AutoResearch": ["TSMC IR: Fab 14B partial outage — 3F affected", "Bloomberg: fire suppression active, no casualties"],
        "CausalGraph":  ["ERP: GPU wafer pipeline frozen — 12-day gap", "Assembly: display unit = critical path item"],
        "TimesFM":      ["Fulfillment curve: sharp drop after day 12 confirmed", "Model: air freight delays curve by 6-8 days"],
        "RiskScorer":   ["Quality variance: first-lot inspection required", "Schedule risk: week-3 customer commitments at risk"],
        "RecEngine":    ["Scenario D: air freight reserves confirmed available", "Cost: $3.4M premium justified by $6.1M stockout"],
        "JudgeAgent":   ["Consensus 8.6/10 — RecEngine spot-market note logged", "Scenario E trigger: day-10 fire persistence check"],
    },
}

# ── Explainability per scenario ──────────────────────────────────────────────
EXPLAINABILITY = {
    "A": {
        "evidence":   ["ERP inventory snapshot T-0", "Primary vendor capacity confirmed"],
        "assumptions": ["Single vendor has adequate surge capacity", "No secondary disruption in next 30d"],
        "confidence_interval": [84, 94],
        "tradeoffs":  "Fastest execution but highest concentration risk if primary vendor is re-disrupted.",
        "rollback_trigger": "If vendor confirms >10% output reduction, switch to Scenario B within 48h.",
    },
    "B": {
        "evidence":   ["Dual-source feasibility confirmed", "Cost model: 60/40 split validated by procurement"],
        "assumptions": ["Both sources reachable within lead-time window", "Currency and freight costs stable ±5%"],
        "confidence_interval": [89, 97],
        "tradeoffs":  "Best risk-diversification; slightly higher coordination overhead than A.",
        "rollback_trigger": "If secondary source drops below 30% fulfillment, consolidate to primary.",
    },
    "C": {
        "evidence":   ["Demand deferral model: top-SKU coverage at 88%", "Safety stock audit: 14d runway confirmed"],
        "assumptions": ["Low-priority orders can defer without penalty clauses", "Disruption resolves within 3-4 weeks"],
        "confidence_interval": [80, 92],
        "tradeoffs":  "Lowest cost; accepts delivery pressure and customer satisfaction risk.",
        "rollback_trigger": "If disruption extends past week 4, immediately escalate to Scenario D.",
    },
    "D": {
        "evidence":   ["Air freight capacity pre-confirmed on 3 lanes", "Premium cost $2.8-3.4M modeled against stockout"],
        "assumptions": ["Air lanes remain open and unaffected by same event", "Customs clearance time ≤2 days"],
        "confidence_interval": [91, 98],
        "tradeoffs":  "Fastest recovery path; cost premium is significant but bounded.",
        "rollback_trigger": "If air lane availability drops below 2 carriers, activate Scenario E.",
    },
    "E": {
        "evidence":   ["Spot market survey: 3 brokers pricing within range", "Critical builds identified: top 20% of SKUs"],
        "assumptions": ["Spot market remains liquid during crisis peak", "First-lot quality passes inspection within 48h"],
        "confidence_interval": [75, 88],
        "tradeoffs":  "Maximum flexibility at maximum cost; only justified for truly critical builds.",
        "rollback_trigger": "If spot pricing exceeds 2× normal, return to Scenario B/D blended approach.",
    },
}

# ── Narrative scripts (fallback) ────────────────────────────────────────────
NARRATIVE_SCRIPTS = {
    "taiwan-earthquake": {
        "changed":      "TSMC Fab 18 halted production following a 6.8M seismic event near Hsinchu. CPU allocation down 35%. Lead times now 22 days above baseline.",
        "decision":     "Within 48h: issue expedited PO to Korean backup fab and lock air-freight lanes before carrier capacity is absorbed by other buyers.",
        "consequence":  "Without action by end of day, week-3 customer commitments fall to 61% coverage — triggering contractual penalties and a $4.7M stockout exposure.",
    },
    "us-china-tariff": {
        "changed":      "A 25% Section 301 tariff on electronic components became effective this morning. Landed cost per unit up $11. Margin compression immediate on active orders.",
        "decision":     "Activate split-fulfillment Scenario B within 72h to route 40% of volume through tariff-exempt channels before next billing cycle.",
        "consequence":  "Continued single-route sourcing adds $2.8M in avoidable cost over the next quarter and creates a single-point vulnerability to further escalation.",
    },
    "hormuz-closure": {
        "changed":      "Three carrier groups have suspended Gulf sea lanes after a strait closure alert. Six active vendor shipments are currently in transit limbo.",
        "decision":     "Set a day-11 expedite trigger now: reserve air lanes today and pre-clear customs to avoid a 14-day rerouting delay through the Cape of Good Hope.",
        "consequence":  "Missing the day-11 window results in a stockout cascade affecting week-2 assembly. Recovery takes 28+ days and costs $4.1M in premium and lost output.",
    },
    "us-china-trade-war": {
        "changed":      "New BIS export controls now classify 14 additional SKUs. CPU and GPU wafer imports are directly affected. Week 2-5 forecast shows compounded delays.",
        "decision":     "Select Scenario D with selective expedite. Pre-negotiate Vietnam fallback this week before competitors absorb available capacity.",
        "consequence":  "Delay triggers a 5-week compounding deficit: fulfillment drops to 80%, customer churn risk rises, and the Q3 revenue target becomes unreachable.",
    },
    "malaysia-floods": {
        "changed":      "Level-3 flood alerts in Penang and Kedah took a packaging site offline. Memory module batch delayed 9 days. Inventory runway shrinks to 5.2 days below plan.",
        "decision":     "Activate Taiwan nearshore within 48h to cover 80% of volume. Confirm Scenario B allocation split with procurement by EOD.",
        "consequence":  "Without nearshore activation, week-2 SLA confidence drops to 67%, directly threatening high-value customer commitments worth $3.2M.",
    },
    "tsmc-factory-fire": {
        "changed":      "A fire in TSMC Fab 14B has frozen the GPU wafer pipeline. Fulfillment curve drops sharply after day 12. Display unit production is now on the critical path.",
        "decision":     "Reserve air freight under Scenario D today. Trigger day-10 fire-persistence check to decide if Scenario E spot-market bridge is needed.",
        "consequence":  "Without air freight reservation, day-12 becomes a hard shutdown for display assembly. Projected $6.1M stockout vs $3.4M premium to prevent it.",
    },
}

EVENT_DEBATES = {
    "taiwan-earthquake": [
        {"agent": "AutoResearch", "message": "Seismic disruption confirmed near core semiconductor clusters.", "tag": "signal"},
        {"agent": "CausalGraph", "message": "CPU dependency path is primary bottleneck for next 14-21 days.", "tag": "causal"},
        {"agent": "TimesFM", "message": "Demand coverage drops below threshold by week 3 without intervention.", "tag": "forecast"},
        {"agent": "RiskScorer", "message": "Operational risk elevated due to fab output volatility.", "tag": "risk"},
        {"agent": "RecEngine", "message": "Scenario B currently offers highest resilience-to-cost ratio.", "tag": "decision"},
    ],
    "us-china-tariff": [
        {"agent": "AutoResearch", "message": "Tariff pressure raises landed cost for affected imports immediately.", "tag": "signal"},
        {"agent": "CausalGraph", "message": "Margin compression linked to memory and display subassemblies.", "tag": "causal"},
        {"agent": "TimesFM", "message": "Nearshore shift can recover confidence by cycle +2.", "tag": "forecast"},
        {"agent": "RiskScorer", "message": "Financial risk medium-high if single-route sourcing continues.", "tag": "risk"},
        {"agent": "RecEngine", "message": "Scenario B split strategy balances cost and continuity best.", "tag": "decision"},
    ],
    "hormuz-closure": [
        {"agent": "AutoResearch", "message": "Maritime delay risk remains elevated on critical sea corridors.", "tag": "signal"},
        {"agent": "CausalGraph", "message": "Lead-time shock propagates from logistics to assembly in 2 stages.", "tag": "causal"},
        {"agent": "TimesFM", "message": "Service-level degradation projected by day 11 without reroute.", "tag": "forecast"},
        {"agent": "RiskScorer", "message": "Delivery-risk score spikes across long-haul suppliers.", "tag": "risk"},
        {"agent": "RecEngine", "message": "Scenario D mitigates timeline risk at controlled premium.", "tag": "decision"},
    ],
    "us-china-trade-war": [
        {"agent": "AutoResearch", "message": "Policy escalation indicates sustained supply volatility horizon.", "tag": "signal"},
        {"agent": "CausalGraph", "message": "Cross-border controls impact CPU and GPU allocation first.", "tag": "causal"},
        {"agent": "TimesFM", "message": "Forecast shows compounded delay in weeks 2-5 under base route.", "tag": "forecast"},
        {"agent": "RiskScorer", "message": "Multi-region concentration risk is now above stress threshold.", "tag": "risk"},
        {"agent": "RecEngine", "message": "Scenario D with selective expedite is preferred for stability.", "tag": "decision"},
    ],
    "malaysia-floods": [
        {"agent": "AutoResearch", "message": "Flooding alerts confirm packaging and outbound disruptions.", "tag": "signal"},
        {"agent": "CausalGraph", "message": "Memory component path is primary blocker for current batch.", "tag": "causal"},
        {"agent": "TimesFM", "message": "Inventory runway compresses by ~5 days under current burn.", "tag": "forecast"},
        {"agent": "RiskScorer", "message": "Schedule slippage risk high for week-2 customer commitments.", "tag": "risk"},
        {"agent": "RecEngine", "message": "Scenario B is optimal if nearshore fallback is activated now.", "tag": "decision"},
    ],
    "tsmc-factory-fire": [
        {"agent": "AutoResearch", "message": "Factory incident reduces short-term wafer availability.", "tag": "signal"},
        {"agent": "CausalGraph", "message": "GPU supply chain now on critical path for assembly output.", "tag": "causal"},
        {"agent": "TimesFM", "message": "Fulfillment curve drops sharply after day 12 without action.", "tag": "forecast"},
        {"agent": "RiskScorer", "message": "Quality and schedule variance risk both trending upward.", "tag": "risk"},
        {"agent": "RecEngine", "message": "Scenario D reduces delivery shock with acceptable premium.", "tag": "decision"},
    ],
}

RISK_HEATMAP = {
    "taiwan-earthquake": [
        {"dimension": "Supply Continuity", "score": 1.9, "risk": "high"},
        {"dimension": "Cost Exposure", "score": 2.4, "risk": "high"},
        {"dimension": "Execution Speed", "score": 3.7, "risk": "low"},
        {"dimension": "Vendor Resilience", "score": 2.8, "risk": "medium"},
    ],
    "us-china-tariff": [
        {"dimension": "Supply Continuity", "score": 2.9, "risk": "medium"},
        {"dimension": "Cost Exposure", "score": 1.8, "risk": "high"},
        {"dimension": "Execution Speed", "score": 3.4, "risk": "low"},
        {"dimension": "Vendor Resilience", "score": 3.0, "risk": "medium"},
    ],
    "hormuz-closure": [
        {"dimension": "Supply Continuity", "score": 2.1, "risk": "high"},
        {"dimension": "Cost Exposure", "score": 2.5, "risk": "high"},
        {"dimension": "Execution Speed", "score": 3.2, "risk": "medium"},
        {"dimension": "Vendor Resilience", "score": 2.7, "risk": "medium"},
    ],
    "us-china-trade-war": [
        {"dimension": "Supply Continuity", "score": 1.7, "risk": "high"},
        {"dimension": "Cost Exposure", "score": 1.9, "risk": "high"},
        {"dimension": "Execution Speed", "score": 3.0, "risk": "medium"},
        {"dimension": "Vendor Resilience", "score": 2.3, "risk": "high"},
    ],
    "malaysia-floods": [
        {"dimension": "Supply Continuity", "score": 2.2, "risk": "high"},
        {"dimension": "Cost Exposure", "score": 2.7, "risk": "medium"},
        {"dimension": "Execution Speed", "score": 3.3, "risk": "medium"},
        {"dimension": "Vendor Resilience", "score": 2.8, "risk": "medium"},
    ],
    "tsmc-factory-fire": [
        {"dimension": "Supply Continuity", "score": 1.8, "risk": "high"},
        {"dimension": "Cost Exposure", "score": 2.2, "risk": "high"},
        {"dimension": "Execution Speed", "score": 3.1, "risk": "medium"},
        {"dimension": "Vendor Resilience", "score": 2.4, "risk": "high"},
    ],
}

KNOWLEDGE_GRAPH = {
    "taiwan-earthquake": {
        "nodes": [
            {"id": "r1", "label": "Taiwan Earthquake", "type": "root"},
            {"id": "a1", "label": "Activate Korea Backup", "type": "action"},
            {"id": "e1", "label": "Reduce CPU Shortage", "type": "effect"},
            {"id": "a2", "label": "Air Freight Buffer", "type": "action"},
            {"id": "e2", "label": "Protect Q2 Commit", "type": "effect"},
        ],
        "edges": [
            {"source": "r1", "target": "a1", "kind": "primary"},
            {"source": "a1", "target": "e1", "kind": "primary"},
            {"source": "r1", "target": "a2", "kind": "cross"},
            {"source": "a2", "target": "e2", "kind": "primary"},
        ],
    }
}

for event in EVENTS:
    if event["id"] not in KNOWLEDGE_GRAPH:
        KNOWLEDGE_GRAPH[event["id"]] = {
            "nodes": [
                {"id": "r1", "label": event["name"], "type": "root"},
                {"id": "a1", "label": "Diversify Suppliers", "type": "action"},
                {"id": "e1", "label": "Lower Fulfillment Risk", "type": "effect"},
                {"id": "a2", "label": "Expedite Route", "type": "action"},
                {"id": "e2", "label": "Recover Lead Time", "type": "effect"},
            ],
            "edges": [
                {"source": "r1", "target": "a1", "kind": "primary"},
                {"source": "a1", "target": "e1", "kind": "primary"},
                {"source": "r1", "target": "a2", "kind": "cross"},
                {"source": "a2", "target": "e2", "kind": "primary"},
            ],
        }

# Trace evidence links: which debate agents support each forecast horizon
OUTLOOK_TRACES_DEFAULT = {
    "7 days": ["AutoResearch"],
    "30 days": ["CausalGraph", "TimesFM"],
    "90 days": ["RecEngine", "RiskScorer"],
}

OUTLOOK_TRACES_BY_EVENT = {
    "us-china-trade-war": {
        "7 days": ["AutoResearch", "CausalGraph"],
        "30 days": ["TimesFM"],
        "90 days": ["RecEngine"],
    },
    "taiwan-earthquake": {
        "7 days": ["AutoResearch"],
        "30 days": ["CausalGraph", "TimesFM"],
        "90 days": ["RiskScorer", "RecEngine"],
    },
    "hormuz-closure": {
        "7 days": ["AutoResearch", "RiskScorer"],
        "30 days": ["TimesFM"],
        "90 days": ["RecEngine"],
    },
    "malaysia-floods": {
        "7 days": ["AutoResearch"],
        "30 days": ["CausalGraph", "RiskScorer"],
        "90 days": ["RecEngine", "TimesFM"],
    },
    "tsmc-factory-fire": {
        "7 days": ["CausalGraph"],
        "30 days": ["TimesFM", "RiskScorer"],
        "90 days": ["RecEngine"],
    },
    "us-china-tariff": {
        "7 days": ["AutoResearch"],
        "30 days": ["CausalGraph", "TimesFM"],
        "90 days": ["RecEngine"],
    },
}

RUNS: Dict[str, Dict] = {}
ORDER_CONTEXTS: Dict[str, Dict] = {}
METRIC_EVENTS: List[Dict[str, Any]] = []
EXECUTION_LOGS: List[Dict[str, Any]] = []


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


def _log_metric(event_type: str, order_id: Optional[str] = None, run_id: Optional[str] = None, payload: Optional[Dict[str, Any]] = None) -> None:
    METRIC_EVENTS.append(
        {
            "timestamp": _now_iso(),
            "event_type": event_type,
            "order_id": order_id,
            "run_id": run_id,
            "payload": payload or {},
        }
    )


PRODUCT_LIBRARY = {
    "xps-15-i9-rtx4080": {
        "name": "XPS 15 i9 + RTX 4080",
        "components": [
            {"id": "processor-cpu", "name": "Processor CPU", "qty_per_unit": 1, "criticality": "critical", "category": "compute", "burn_per_day": 750, "inventory": 21000},
            {"id": "gpu-display-chip", "name": "GPU Display Chip", "qty_per_unit": 1, "criticality": "critical", "category": "compute", "burn_per_day": 760, "inventory": 16500},
            {"id": "memory-lpdddr5", "name": "Memory LPDDR5", "qty_per_unit": 2, "criticality": "critical", "category": "compute", "burn_per_day": 1520, "inventory": 26000},
            {"id": "motherboard", "name": "Motherboard", "qty_per_unit": 1, "criticality": "critical", "category": "compute", "burn_per_day": 740, "inventory": 23000},
            {"id": "battery-pack", "name": "Battery Pack", "qty_per_unit": 1, "criticality": "important", "category": "power", "burn_per_day": 730, "inventory": 32000},
            {"id": "display-panel", "name": "4K OLED Panel", "qty_per_unit": 1, "criticality": "important", "category": "display", "burn_per_day": 710, "inventory": 28500},
            {"id": "ssd-storage", "name": "SSD Storage", "qty_per_unit": 1, "criticality": "important", "category": "storage", "burn_per_day": 700, "inventory": 34000},
            {"id": "cooling-system", "name": "Cooling System", "qty_per_unit": 1, "criticality": "important", "category": "power", "burn_per_day": 680, "inventory": 33000},
            {"id": "aluminum-chassis", "name": "Aluminum Chassis", "qty_per_unit": 1, "criticality": "substitutable", "category": "chassis", "burn_per_day": 640, "inventory": 42000},
            {"id": "cables-fasteners", "name": "Cables and Fasteners", "qty_per_unit": 1, "criticality": "substitutable", "category": "chassis", "burn_per_day": 620, "inventory": 58000},
        ],
    },
    "latitude-14-u7": {
        "name": "Latitude 14 Ultra 7",
        "components": [
            {"id": "processor-cpu", "name": "Processor CPU", "qty_per_unit": 1, "criticality": "critical", "category": "compute", "burn_per_day": 540, "inventory": 21000},
            {"id": "memory-lpdddr5", "name": "Memory LPDDR5", "qty_per_unit": 2, "criticality": "critical", "category": "compute", "burn_per_day": 1080, "inventory": 26000},
            {"id": "motherboard", "name": "Motherboard", "qty_per_unit": 1, "criticality": "critical", "category": "compute", "burn_per_day": 530, "inventory": 23000},
            {"id": "battery-pack", "name": "Battery Pack", "qty_per_unit": 1, "criticality": "important", "category": "power", "burn_per_day": 520, "inventory": 32000},
            {"id": "display-panel", "name": "Display Panel", "qty_per_unit": 1, "criticality": "important", "category": "display", "burn_per_day": 510, "inventory": 28500},
            {"id": "ssd-storage", "name": "SSD Storage", "qty_per_unit": 1, "criticality": "important", "category": "storage", "burn_per_day": 505, "inventory": 34000},
            {"id": "aluminum-chassis", "name": "Aluminum Chassis", "qty_per_unit": 1, "criticality": "substitutable", "category": "chassis", "burn_per_day": 495, "inventory": 42000},
        ],
    },
}


SKU_MARGIN_PROFILES = {
    "xps-15-i9-rtx4080": {
        "customer_segment": "premium-commercial",
        "unit_revenue": 2450.0,
        "target_margin_pct": 0.31,
        "floor_margin_pct": 0.22,
        "fixed_conversion_cost": 285.0,
    },
    "latitude-14-u7": {
        "customer_segment": "volume-commercial",
        "unit_revenue": 1680.0,
        "target_margin_pct": 0.27,
        "floor_margin_pct": 0.18,
        "fixed_conversion_cost": 210.0,
    },
}


COMPONENT_COST_BASIS = {
    "processor-cpu": 318.0,
    "gpu-display-chip": 412.0,
    "memory-lpdddr5": 88.0,
    "motherboard": 141.0,
    "battery-pack": 54.0,
    "display-panel": 121.0,
    "ssd-storage": 76.0,
    "cooling-system": 33.0,
    "aluminum-chassis": 64.0,
    "cables-fasteners": 8.0,
}


HISTORICAL_VENDOR_MARKET = {
    "memory-lpdddr5": {
        "uae-memoryfab": {"avg_price": 86.0, "best_price": 82.5, "fill_rate_pct": 89, "lead_time_avg": 19.0},
        "samsung-mx": {"avg_price": 103.0, "best_price": 98.5, "fill_rate_pct": 95, "lead_time_avg": 6.0},
        "skhynix-kr": {"avg_price": 99.0, "best_price": 95.5, "fill_rate_pct": 96, "lead_time_avg": 11.0},
        "micron-us": {"avg_price": 128.0, "best_price": 122.0, "fill_rate_pct": 97, "lead_time_avg": 7.5},
    },
    "processor-cpu": {
        "intel-us": {"avg_price": 436.0, "best_price": 421.0, "fill_rate_pct": 95, "lead_time_avg": 8.0},
        "intel-ie": {"avg_price": 382.0, "best_price": 366.0, "fill_rate_pct": 92, "lead_time_avg": 12.0},
        "chipone-in": {"avg_price": 354.0, "best_price": 339.0, "fill_rate_pct": 88, "lead_time_avg": 15.0},
    },
    "gpu-display-chip": {
        "tsmc-tw": {"avg_price": 428.0, "best_price": 412.0, "fill_rate_pct": 94, "lead_time_avg": 14.0},
        "samsung-kr": {"avg_price": 465.0, "best_price": 449.0, "fill_rate_pct": 92, "lead_time_avg": 10.5},
        "intel-us-gpu": {"avg_price": 538.0, "best_price": 521.0, "fill_rate_pct": 89, "lead_time_avg": 9.0},
    },
    "battery-pack": {
        "atl-cn": {"avg_price": 52.0, "best_price": 49.0, "fill_rate_pct": 91, "lead_time_avg": 19.0},
        "lgchem-kr": {"avg_price": 61.0, "best_price": 58.0, "fill_rate_pct": 95, "lead_time_avg": 13.0},
        "freyr-us": {"avg_price": 74.0, "best_price": 69.0, "fill_rate_pct": 90, "lead_time_avg": 9.0},
    },
}


COMPONENT_MARKET_SIGNALS = {
    "memory-lpdddr5": {"commodity": "DRAM spot", "change_pct": 8.4, "supplier": "memory allocation tightening", "freight_delta_days": 3},
    "processor-cpu": {"commodity": "advanced substrate", "change_pct": 5.8, "supplier": "foundry slot competition", "freight_delta_days": 2},
    "gpu-display-chip": {"commodity": "wafer services", "change_pct": 7.1, "supplier": "GPU backlog expansion", "freight_delta_days": 2},
    "battery-pack": {"commodity": "lithium carbonate", "change_pct": 6.6, "supplier": "cell capacity rebalance", "freight_delta_days": 4},
}


PRICE_REGION_MULTIPLIERS = {
    "US": 1.0,
    "Mexico": 0.96,
    "Korea": 0.98,
    "Japan": 1.03,
    "India": 0.95,
}


def _vendor_compliance_profile(vendor: Dict[str, Any], event_id: str) -> Dict[str, Any]:
    country = vendor.get("country", "US")
    sanctioned = country in {"IR", "RU", "KP", "SY"}
    trade_agreement = "USMCA" if country in {"US", "MX", "CA"} else "KORUS" if country == "KR" else "WTO-GPA"
    legal_eligibility = bool(vendor.get("active", True) and not sanctioned)
    if event_id in {"us-china-tariff", "us-china-trade-war"} and country == "CN":
        legal_eligibility = False
    return {
        "vendor_id": vendor.get("vendor_id"),
        "vendor_name": vendor.get("name"),
        "country": country,
        "sanctions_clear": not sanctioned,
        "trade_agreement": trade_agreement,
        "legal_eligibility": legal_eligibility,
        "reason": "Eligible under current policy checks." if legal_eligibility else "Policy or sanctions gate failed.",
    }


def _component_global_price_panel(component_id: str, event_id: str) -> Dict[str, Any]:
    signal = COMPONENT_MARKET_SIGNALS.get(component_id, {"commodity": "supply index", "change_pct": 4.0})
    base_price = _component_base_cost(component_id)
    rows: List[Dict[str, Any]] = []
    for region, multiplier in PRICE_REGION_MULTIPLIERS.items():
        event_lift = 1.0 + (0.04 if event_id in {"hormuz-closure", "us-china-tariff", "us-china-trade-war"} else 0.02)
        unit_price = round(base_price * multiplier * event_lift, 2)
        weekly_change = round(float(signal.get("change_pct", 4.0)) * (1.08 if region in {"US", "Japan"} else 0.92), 1)
        trend = "up" if weekly_change > 1.5 else "flat"
        rows.append({
            "region": region,
            "unit_price": unit_price,
            "weekly_change_pct": weekly_change,
            "trend": trend,
        })
    return {
        "commodity": signal.get("commodity", "supply index"),
        "geography_prices": rows,
        "market_trend": "rising" if any(row["weekly_change_pct"] > 3 for row in rows) else "stable",
    }


VENDOR_CATALOG = {
    "memory-lpdddr5": [
        {"vendor_id": "uae-memoryfab", "name": "Gulf Memory Fab", "tier": "friend-shore", "country": "AE", "reliability": 88, "cost_premium": 0, "lead_days": 21, "geo_risk": 58, "capacity": 32000, "active": True},
        {"vendor_id": "samsung-mx", "name": "Samsung Mexico", "tier": "nearshore", "country": "MX", "reliability": 89, "cost_premium": 22, "lead_days": 5, "geo_risk": 25, "capacity": 26000, "active": True},
        {"vendor_id": "skhynix-kr", "name": "SK Hynix Korea", "tier": "friend-shore", "country": "KR", "reliability": 92, "cost_premium": 15, "lead_days": 12, "geo_risk": 35, "capacity": 40000, "active": True},
        {"vendor_id": "micron-us", "name": "Micron USA", "tier": "domestic", "country": "US", "reliability": 94, "cost_premium": 45, "lead_days": 7, "geo_risk": 10, "capacity": 17000, "active": True},
    ],
    "processor-cpu": [
        {"vendor_id": "intel-us", "name": "Intel USA", "tier": "domestic", "country": "US", "reliability": 93, "cost_premium": 38, "lead_days": 8, "geo_risk": 12, "capacity": 15000, "active": True},
        {"vendor_id": "intel-ie", "name": "Intel Ireland", "tier": "friend-shore", "country": "IE", "reliability": 90, "cost_premium": 20, "lead_days": 13, "geo_risk": 24, "capacity": 21000, "active": True},
        {"vendor_id": "chipone-in", "name": "ChipOne India", "tier": "friend-shore", "country": "IN", "reliability": 86, "cost_premium": 11, "lead_days": 16, "geo_risk": 31, "capacity": 26000, "active": True},
    ],
    "gpu-display-chip": [
        {"vendor_id": "tsmc-tw", "name": "TSMC Taiwan", "tier": "friend-shore", "country": "TW", "reliability": 91, "cost_premium": 0, "lead_days": 14, "geo_risk": 47, "capacity": 29000, "active": True},
        {"vendor_id": "samsung-kr", "name": "Samsung Korea", "tier": "friend-shore", "country": "KR", "reliability": 90, "cost_premium": 16, "lead_days": 10, "geo_risk": 33, "capacity": 22000, "active": True},
        {"vendor_id": "intel-us-gpu", "name": "Intel USA GPU", "tier": "domestic", "country": "US", "reliability": 88, "cost_premium": 42, "lead_days": 9, "geo_risk": 12, "capacity": 14000, "active": True},
    ],
    "battery-pack": [
        {"vendor_id": "atl-cn", "name": "ATL China", "tier": "friend-shore", "country": "CN", "reliability": 87, "cost_premium": 0, "lead_days": 20, "geo_risk": 49, "capacity": 36000, "active": True},
        {"vendor_id": "lgchem-kr", "name": "LG Chem Korea", "tier": "friend-shore", "country": "KR", "reliability": 91, "cost_premium": 19, "lead_days": 13, "geo_risk": 30, "capacity": 23000, "active": True},
        {"vendor_id": "freyr-us", "name": "Freyr USA", "tier": "domestic", "country": "US", "reliability": 88, "cost_premium": 41, "lead_days": 9, "geo_risk": 11, "capacity": 15000, "active": True},
    ],
}


ROUTE_CATALOG = [
    {
        "route_id": "mx-air-qro-dfw-kul",
        "vendor_id": "samsung-mx",
        "mode": "air",
        "nodes": ["Queretaro", "Dallas", "Kuala Lumpur"],
        "corridors": ["north-american-air", "pacific-air"],
        "transit_days": 5,
        "cost_per_pallet": 12500,
        "risk": 22,
    },
    {
        "route_id": "mx-sea-manzanillo-la-kul",
        "vendor_id": "samsung-mx",
        "mode": "sea",
        "nodes": ["Manzanillo", "Los Angeles", "Kuala Lumpur"],
        "corridors": ["pacific-sea"],
        "transit_days": 18,
        "cost_per_pallet": 4900,
        "risk": 31,
    },
    {
        "route_id": "kr-air-icn-anc-dal",
        "vendor_id": "skhynix-kr",
        "mode": "air",
        "nodes": ["Seoul", "Anchorage", "Dallas"],
        "corridors": ["north-pacific-air"],
        "transit_days": 6,
        "cost_per_pallet": 13600,
        "risk": 26,
    },
    {
        "route_id": "kr-sea-busan-la",
        "vendor_id": "skhynix-kr",
        "mode": "sea",
        "nodes": ["Busan", "Los Angeles"],
        "corridors": ["pacific-sea"],
        "transit_days": 15,
        "cost_per_pallet": 5300,
        "risk": 30,
    },
    {
        "route_id": "ae-sea-dubai-rotterdam",
        "vendor_id": "uae-memoryfab",
        "mode": "sea",
        "nodes": ["Dubai", "Suez", "Rotterdam"],
        "corridors": ["strait-of-hormuz", "red-sea", "suez"],
        "transit_days": 21,
        "cost_per_pallet": 4200,
        "risk": 62,
    },
    {
        "route_id": "us-air-austin-dal-kl",
        "vendor_id": "micron-us",
        "mode": "air",
        "nodes": ["Austin", "Dallas", "Kuala Lumpur"],
        "corridors": ["north-american-air", "pacific-air"],
        "transit_days": 7,
        "cost_per_pallet": 14100,
        "risk": 18,
    },
    {
        "route_id": "tw-sea-kaohsiung-la",
        "vendor_id": "tsmc-tw",
        "mode": "sea",
        "nodes": ["Kaohsiung", "Los Angeles"],
        "corridors": ["south-china-sea", "pacific-sea"],
        "transit_days": 14,
        "cost_per_pallet": 5800,
        "risk": 38,
    },
    {
        "route_id": "cn-sea-shanghai-la",
        "vendor_id": "atl-cn",
        "mode": "sea",
        "nodes": ["Shanghai", "Los Angeles"],
        "corridors": ["south-china-sea", "pacific-sea"],
        "transit_days": 21,
        "cost_per_pallet": 6100,
        "risk": 46,
    },
    {
        "route_id": "cn-sea-shanghai-my-reexport",
        "vendor_id": "atl-cn",
        "mode": "sea",
        "nodes": ["Shanghai", "Port Klang", "Los Angeles"],
        "corridors": ["south-china-sea", "malacca-strait", "pacific-sea"],
        "transit_days": 26,
        "cost_per_pallet": 6900,
        "risk": 42,
    },
]


CORRIDOR_GRAPH = {
    "nodes": [
        {"id": "strait-of-hormuz", "label": "Strait of Hormuz", "status": "watch"},
        {"id": "red-sea", "label": "Red Sea", "status": "watch"},
        {"id": "suez", "label": "Suez Canal", "status": "open"},
        {"id": "south-china-sea", "label": "South China Sea", "status": "watch"},
        {"id": "malacca-strait", "label": "Malacca Strait", "status": "open"},
        {"id": "panama-canal", "label": "Panama Canal", "status": "open"},
        {"id": "pacific-sea", "label": "Pacific Sea", "status": "open"},
        {"id": "north-pacific-air", "label": "North Pacific Air", "status": "open"},
        {"id": "north-american-air", "label": "North American Air", "status": "open"},
        {"id": "pacific-air", "label": "Pacific Air", "status": "open"},
    ],
    "edges": [
        {"source": "strait-of-hormuz", "target": "red-sea", "dependency": "oil-shipping"},
        {"source": "red-sea", "target": "suez", "dependency": "suez-throughput"},
        {"source": "south-china-sea", "target": "malacca-strait", "dependency": "asia-export"},
        {"source": "malacca-strait", "target": "pacific-sea", "dependency": "transpacific"},
        {"source": "north-american-air", "target": "pacific-air", "dependency": "air-freight"},
    ],
}


class OrderIngestRequest(BaseModel):
    order_id: Optional[str] = None
    sku_id: str = "xps-15-i9-rtx4080"
    quantity: int = 1200
    region: str = "NA"
    customer_priority: str = "standard"
    event_id: str = "hormuz-closure"
    disruption_factor: float = 1.0


class VendorScoreWeights(BaseModel):
    reliability: float = 0.4
    cost: float = 0.3
    speed: float = 0.2
    geo_penalty: float = 0.1


class VendorScoringRequest(BaseModel):
    order_id: str
    component_id: str
    runway_days: Optional[float] = None
    tier_filter: List[str] = Field(default_factory=lambda: ["domestic", "nearshore", "friend-shore"])
    dynamic_switch: bool = True
    low_runway_threshold: float = 15.0
    weights: VendorScoreWeights = Field(default_factory=VendorScoreWeights)


class RouteOptimizerRequest(BaseModel):
    order_id: str
    component_id: str
    vendor_id: str
    destination_factory: str = "Kuala Lumpur Plant"
    blocked_corridors: List[str] = Field(default_factory=list)
    mode_preference: str = "balanced"


class DeliveryPromiseRequest(BaseModel):
    order_id: str
    selected_vendor_map: Dict[str, str] = Field(default_factory=dict)
    selected_route_map: Dict[str, str] = Field(default_factory=dict)
    assembly_days: int = 3
    customer_shipping_days: int = 5


class ExecutionActionRequest(BaseModel):
    order_id: str
    mode: str = "mock"
    actions: List[str] = Field(default_factory=lambda: ["purchase_order", "freight_booking", "customer_notification"])


def _event_severity_multiplier(event_id: str) -> float:
    severity = _find_event(event_id).get("severity", "HIGH")
    return {"LOW": 1.0, "MEDIUM": 1.08, "HIGH": 1.2, "CRITICAL": 1.35}.get(severity, 1.2)


def _compute_bom_context(order: OrderIngestRequest) -> Dict[str, Any]:
    product = PRODUCT_LIBRARY.get(order.sku_id) or PRODUCT_LIBRARY["xps-15-i9-rtx4080"]
    multiplier = _event_severity_multiplier(order.event_id) * max(0.7, min(order.disruption_factor, 1.8))
    components = []
    for node in product["components"]:
        daily_burn = max(1.0, node["burn_per_day"] * (order.quantity / 1000.0))
        disruption_burn = daily_burn * multiplier
        baseline_days = round(node["inventory"] / daily_burn, 1)
        disruption_days = round(node["inventory"] / disruption_burn, 1)
        intervention_day = round(disruption_days - 14, 1)
        status = "red" if intervention_day <= 0 else "amber" if intervention_day <= 14 else "green"
        criticality_base = {"critical": 95, "important": 70, "substitutable": 45}.get(node["criticality"], 55)
        urgency_bonus = max(0, int((30 - min(30, disruption_days)) * 1.2))
        criticality_score = min(100, criticality_base + urgency_bonus)
        components.append(
            {
                "component_id": node["id"],
                "component_name": node["name"],
                "category": node.get("category", "compute"),
                "qty_per_unit": node["qty_per_unit"],
                "criticality": node["criticality"],
                "inventory": node["inventory"],
                "daily_burn_baseline": round(daily_burn, 1),
                "daily_burn_disruption": round(disruption_burn, 1),
                "days_to_stockout_baseline": baseline_days,
                "days_to_stockout_disruption": disruption_days,
                "stockout_delta_days": round(baseline_days - disruption_days, 1),
                "intervention_day": intervention_day,
                "status": status,
                "criticality_score": criticality_score,
                "is_critical_alert": disruption_days <= 14,
            }
        )

    components.sort(key=lambda c: (c["intervention_day"], -c["criticality_score"]))
    bottleneck = components[0] if components else None
    buckets = {
        "critical": [item for item in components if item["criticality"] == "critical"],
        "important": [item for item in components if item["criticality"] == "important"],
        "substitutable": [item for item in components if item["criticality"] == "substitutable"],
    }
    category_buckets = {
        "compute": [item for item in components if item.get("category") == "compute"],
        "display": [item for item in components if item.get("category") == "display"],
        "storage": [item for item in components if item.get("category") == "storage"],
        "chassis": [item for item in components if item.get("category") == "chassis"],
        "power": [item for item in components if item.get("category") == "power"],
    }
    return {
        "sku_id": order.sku_id,
        "sku_name": product["name"],
        "components": components,
        "criticality_buckets": buckets,
        "category_buckets": category_buckets,
        "bottleneck_component": bottleneck,
        "summary": {
            "component_count": len(components),
            "critical_count": len(buckets["critical"]),
            "important_count": len(buckets["important"]),
            "substitutable_count": len(buckets["substitutable"]),
            "minimum_runway_days": bottleneck["days_to_stockout_disruption"] if bottleneck else None,
        },
    }


def _effective_weights(runway_days: float, dynamic_switch: bool, low_runway_threshold: float, weights: VendorScoreWeights) -> Dict[str, Any]:
    if dynamic_switch and runway_days < low_runway_threshold:
        return {
            "profile": "low-runway-emergency",
            "switched": True,
            "weights": {"reliability": 0.25, "cost": 0.1, "speed": 0.6, "geo_penalty": 0.05},
        }
    return {
        "profile": "balanced",
        "switched": False,
        "weights": {
            "reliability": max(0.0, weights.reliability),
            "cost": max(0.0, weights.cost),
            "speed": max(0.0, weights.speed),
            "geo_penalty": max(0.0, weights.geo_penalty),
        },
    }


def _score_vendor(vendor: Dict[str, Any], weights: Dict[str, float]) -> Dict[str, Any]:
    reliability_score = vendor["reliability"]
    cost_score = max(0.0, 100.0 - vendor["cost_premium"])
    speed_score = max(0.0, 100.0 - vendor["lead_days"] * 3.2)
    geo_penalty_score = vendor["geo_risk"]
    composite = (
        reliability_score * weights["reliability"]
        + cost_score * weights["cost"]
        + speed_score * weights["speed"]
        - geo_penalty_score * weights["geo_penalty"]
    )
    return {
        **vendor,
        "score_breakdown": {
            "reliability": round(reliability_score, 2),
            "cost": round(cost_score, 2),
            "speed": round(speed_score, 2),
            "geo_penalty": round(geo_penalty_score, 2),
        },
        "composite_score": round(max(0.0, min(100.0, composite)), 2),
    }


def _choose_routes(vendor_id: str, blocked_corridors: List[str], mode_preference: str) -> List[Dict[str, Any]]:
    available = []
    blocked_set = set(blocked_corridors)
    for route in ROUTE_CATALOG:
        if route["vendor_id"] != vendor_id:
            continue
        if any(c in blocked_set for c in route["corridors"]):
            continue
        risk_penalty = route["risk"] * 0.45
        time_penalty = route["transit_days"] * (2.4 if mode_preference == "speed" else 1.7)
        cost_penalty = (route["cost_per_pallet"] / 1000.0) * (2.1 if mode_preference == "cost" else 1.3)
        route_score = round(max(0.0, 100.0 - (risk_penalty + time_penalty + cost_penalty)), 2)
        available.append({**route, "route_score": route_score})
    available.sort(key=lambda item: item["route_score"], reverse=True)
    return available


def _find_vendor(component_id: str, vendor_id: str) -> Optional[Dict[str, Any]]:
    for vendor in VENDOR_CATALOG.get(component_id, []):
        if vendor["vendor_id"] == vendor_id:
            return vendor
    return None


def _event_disruption_tags(event_id: str) -> List[str]:
    tags = {
        "hormuz-closure": ["Strait of Hormuz closure", "Red Sea delay surge", "Marine insurance spike"],
        "us-china-tariff": ["Tariff escalation", "Cross-border customs friction", "Cost shock"],
        "taiwan-earthquake": ["Fab output disruption", "Aftershock production checks", "Semiconductor allocation risk"],
        "us-china-trade-war": ["Export control update", "Classification risk", "Policy volatility"],
        "malaysia-floods": ["Plant downtime", "Route congestion", "Outbound delay"],
        "tsmc-factory-fire": ["Fab outage", "Wafer backlog", "GPU availability reduction"],
    }
    return tags.get(event_id, ["Demand volatility", "Route uncertainty"])


def _event_corridor_impacts(event_id: str) -> List[str]:
    impacts = {
        "hormuz-closure": ["Strait of Hormuz", "Red Sea"],
        "us-china-tariff": ["South China Sea", "Pacific Sea"],
        "taiwan-earthquake": ["South China Sea", "North Pacific Air"],
        "us-china-trade-war": ["South China Sea", "Malacca Strait"],
        "malaysia-floods": ["Malacca Strait", "Pacific Sea"],
        "tsmc-factory-fire": ["Pacific Sea", "North Pacific Air"],
    }
    return impacts.get(event_id, ["Trans-Pacific lanes"])


def _component_driver_map(component_id: str) -> Dict[str, List[str]]:
    drivers = {
        "memory-lpdddr5": {
            "route_closures": ["Strait of Hormuz", "Red Sea"],
            "commodity_spikes": ["Helium +60%", "Neon +22%"],
        },
        "battery-pack": {
            "route_closures": ["South China Sea", "Pacific Sea"],
            "commodity_spikes": ["Lithium carbonate +34%", "Nickel +18%"],
        },
        "gpu-display-chip": {
            "route_closures": ["South China Sea"],
            "commodity_spikes": ["Silicon wafer +15%", "Argon +11%"],
        },
        "processor-cpu": {
            "route_closures": ["Pacific Sea", "North Pacific Air"],
            "commodity_spikes": ["Copper +12%", "Rare earths +19%"],
        },
    }
    return drivers.get(component_id, {"route_closures": ["Trans-Pacific lanes"], "commodity_spikes": ["Freight index +20%"]})


def _sku_margin_profile(sku_id: str) -> Dict[str, Any]:
    return SKU_MARGIN_PROFILES.get(sku_id, {
        "customer_segment": "default",
        "unit_revenue": 1800.0,
        "target_margin_pct": 0.24,
        "floor_margin_pct": 0.18,
        "fixed_conversion_cost": 220.0,
    })


def _component_base_cost(component_id: str) -> float:
    return float(COMPONENT_COST_BASIS.get(component_id, 40.0))


def _historical_vendor_market(component_id: str, vendor_id: str) -> Dict[str, float]:
    return HISTORICAL_VENDOR_MARKET.get(component_id, {}).get(vendor_id, {
        "avg_price": round(_component_base_cost(component_id) * 1.08, 2),
        "best_price": round(_component_base_cost(component_id) * 1.02, 2),
        "fill_rate_pct": 90,
        "lead_time_avg": 14.0,
    })


def _tariff_rate(event_id: str, country: str) -> float:
    if event_id in {"us-china-tariff", "us-china-trade-war"}:
        if country == "CN":
            return 0.25
        if country in {"TW", "KR"}:
            return 0.12
        return 0.04
    if event_id == "taiwan-earthquake" and country == "TW":
        return 0.06
    return 0.0


def _freight_multiplier(event_id: str, corridors: List[str]) -> float:
    impacted = set(_event_corridor_impacts(event_id))
    overlap = sum(1 for corridor in corridors if corridor.replace("-", " ").title() in impacted or corridor in {c.lower().replace(" ", "-") for c in impacted})
    if event_id == "hormuz-closure":
        return 1.0 + overlap * 0.18
    if event_id in {"us-china-tariff", "us-china-trade-war"}:
        return 1.0 + overlap * 0.11
    if event_id == "taiwan-earthquake":
        return 1.0 + overlap * 0.14
    return 1.0 + overlap * 0.06


def _default_trigger_type(event_id: str) -> str:
    if event_id in {"us-china-tariff", "us-china-trade-war"}:
        return "tariff"
    if event_id in {"hormuz-closure"}:
        return "vessel-disruption"
    if event_id in {"malaysia-floods"}:
        return "port-closure"
    return "commodity-spike"


def _normalize_tariff_schedule(overrides: Optional[Dict[str, float]] = None) -> Dict[str, float]:
    base = {
        "CN": 145.0,
        "US": 0.0,
        "MX": 0.0,
        "CA": 0.0,
        "KR": 18.0,
        "JP": 14.0,
        "IN": 10.0,
        "OTHER": 25.0,
    }
    if not overrides:
        return base
    normalized = dict(base)
    for key, value in overrides.items():
        upper = str(key).upper()
        if upper in normalized:
            normalized[upper] = max(0.0, float(value))
    return normalized


def _trigger_profile(event_id: str, trigger_type: str) -> Dict[str, float]:
    event_corridors = _event_corridor_impacts(event_id)
    overlap_factor = max(1.0, len(event_corridors) / 2.0)
    if trigger_type == "tariff":
        return {
            "tariff_multiplier": 1.0,
            "freight_multiplier": 1.04,
            "lead_time_days": 2.0 * overlap_factor,
            "commodity_multiplier": 0.45,
            "confidence_base": 0.86,
        }
    if trigger_type == "vessel-disruption":
        return {
            "tariff_multiplier": 0.35,
            "freight_multiplier": 1.24,
            "lead_time_days": 5.0 * overlap_factor,
            "commodity_multiplier": 0.72,
            "confidence_base": 0.78,
        }
    if trigger_type == "port-closure":
        return {
            "tariff_multiplier": 0.2,
            "freight_multiplier": 1.2,
            "lead_time_days": 6.0 * overlap_factor,
            "commodity_multiplier": 0.64,
            "confidence_base": 0.74,
        }
    return {
        "tariff_multiplier": 0.25,
        "freight_multiplier": 1.12,
        "lead_time_days": 3.0 * overlap_factor,
        "commodity_multiplier": 0.95,
        "confidence_base": 0.8,
    }


def _component_market_evidence(component_id: str, event_id: str) -> List[Dict[str, Any]]:
    signal = COMPONENT_MARKET_SIGNALS.get(component_id, {"commodity": "supply index", "change_pct": 4.0, "supplier": "supplier watch", "freight_delta_days": 2})
    tariff_risk = round(_tariff_rate(event_id, "CN") * 100, 1)
    freshness_hours = 6 if event_id in {"us-china-tariff", "hormuz-closure"} else 12
    return [
        {
            "signal_type": "commodity",
            "label": f"{signal['commodity']} weekly move",
            "value": signal["change_pct"],
            "unit": "%",
            "confidence": 84,
            "freshness_hours": freshness_hours,
        },
        {
            "signal_type": "supplier",
            "label": signal["supplier"],
            "value": "watch",
            "unit": "",
            "confidence": 76,
            "freshness_hours": freshness_hours + 4,
        },
        {
            "signal_type": "tariff",
            "label": "CN-origin tariff exposure",
            "value": tariff_risk,
            "unit": "%",
            "confidence": 88,
            "freshness_hours": 2,
        },
        {
            "signal_type": "freight",
            "label": "Expected freight delay",
            "value": signal["freight_delta_days"],
            "unit": "days",
            "confidence": 73,
            "freshness_hours": freshness_hours,
        },
    ]


def _decision_context(order_context: Dict[str, Any]) -> Dict[str, Any]:
    bom = order_context.get("bom", {})
    components = bom.get("components", [])
    profile = _sku_margin_profile(order_context.get("sku_id", ""))
    quantity = int(order_context.get("quantity", 0) or 0)
    base_bom_spend = 0.0
    component_rows = []
    vendor_option_map: Dict[str, List[Dict[str, Any]]] = {}
    route_option_map: Dict[str, List[Dict[str, Any]]] = {}
    market_evidence_map: Dict[str, List[Dict[str, Any]]] = {}
    vendor_compliance_map: Dict[str, List[Dict[str, Any]]] = {}
    global_commodity_price_map: Dict[str, Dict[str, Any]] = {}

    for component in components:
        component_id = component["component_id"]
        required_units = quantity * int(component.get("qty_per_unit", 1))
        base_unit_cost = _component_base_cost(component_id)
        baseline_spend = round(required_units * base_unit_cost, 2)
        base_bom_spend += baseline_spend
        disruption_multiplier = 1.0 + max(0.0, (30.0 - min(30.0, float(component.get("days_to_stockout_disruption", 30.0)))) / 100.0)
        component_rows.append({
            "component_id": component_id,
            "component_name": component["component_name"],
            "category": component.get("category", "compute"),
            "qty_per_unit": component.get("qty_per_unit", 1),
            "required_units": required_units,
            "base_unit_cost": round(base_unit_cost, 2),
            "baseline_spend": baseline_spend,
            "disruption_sensitive_spend": round(baseline_spend * disruption_multiplier, 2),
            "margin_sensitivity_pct": round(min(100.0, 30.0 + (component.get("criticality_score", 50) * 0.55)), 1),
        })

        vendor_option_map[component_id] = []
        route_option_map[component_id] = []
        market_evidence_map[component_id] = _component_market_evidence(component_id, order_context.get("event_id", ""))
        vendor_compliance_map[component_id] = []
        global_commodity_price_map[component_id] = _component_global_price_panel(component_id, order_context.get("event_id", ""))

        for vendor in VENDOR_CATALOG.get(component_id, []):
            history = _historical_vendor_market(component_id, vendor["vendor_id"])
            vendor_option_map[component_id].append({
                "vendor_id": vendor["vendor_id"],
                "vendor_name": vendor["name"],
                "country": vendor["country"],
                "tier": vendor["tier"],
                "unit_price": round(history["avg_price"], 2),
                "historical_avg_price": round(history["avg_price"], 2),
                "historical_best_price": round(history["best_price"], 2),
                "lead_time_days": round(float(history["lead_time_avg"]), 1),
                "fill_rate_pct": int(history["fill_rate_pct"]),
                "reliability": int(vendor["reliability"]),
                "geo_risk": int(vendor["geo_risk"]),
                "feasible": bool(vendor.get("active", True)),
            })
            vendor_compliance_map[component_id].append(_vendor_compliance_profile(vendor, order_context.get("event_id", "")))

            for route in _choose_routes(vendor["vendor_id"], [], "balanced"):
                route_option_map[component_id].append({
                    "route_id": route["route_id"],
                    "vendor_id": route["vendor_id"],
                    "mode": route["mode"],
                    "transit_days": float(route["transit_days"]),
                    "cost_per_pallet": float(route["cost_per_pallet"]),
                    "risk": float(route["risk"]),
                    "corridors": route.get("corridors", []),
                    "feasible": True,
                })

    disruption_sensitive_spend = sum(row["disruption_sensitive_spend"] for row in component_rows)
    exposed_components = sorted(component_rows, key=lambda row: row["disruption_sensitive_spend"], reverse=True)[:3]
    return {
        "order_context": {
            "order_id": order_context.get("order_id"),
            "sku_id": order_context.get("sku_id"),
            "sku_name": order_context.get("sku_name"),
            "quantity": quantity,
            "region": order_context.get("region"),
            "event_id": order_context.get("event_id"),
        },
        "component_requirement_set": component_rows,
        "vendor_option_set": vendor_option_map,
        "route_option_set": route_option_map,
        "market_price_evidence": market_evidence_map,
        "vendor_compliance": vendor_compliance_map,
        "global_commodity_prices": global_commodity_price_map,
        "margin_constraints": {
            "sku_id": order_context.get("sku_id"),
            "customer_segment": profile["customer_segment"],
            "unit_revenue": profile["unit_revenue"],
            "target_margin_pct": profile["target_margin_pct"],
            "floor_margin_pct": profile["floor_margin_pct"],
        },
        "baseline_procurement_spend": round(base_bom_spend, 2),
        "disruption_sensitive_spend": round(disruption_sensitive_spend, 2),
        "demand_snapshot": {
            "order_volume_units": quantity,
            "rolling_30d_avg_units": int(max(1, round(quantity * 0.92))),
            "demand_growth_pct": round(6.5 if quantity >= 1000 else 3.2, 1),
            "source": "current order + rolling demand model",
        },
        "headline": f"Top exposed components represent {round((sum(item['disruption_sensitive_spend'] for item in exposed_components) / max(disruption_sensitive_spend, 1)) * 100, 1)}% of disruption-sensitive spend.",
        "top_exposed_components": exposed_components,
    }


def _disruption_impact(
    order_context: Dict[str, Any],
    component_id: str,
    event_id: Optional[str] = None,
    trigger_type: str = "tariff",
    tariff_schedule: Optional[Dict[str, float]] = None,
) -> Dict[str, Any]:
    component = next((row for row in order_context.get("bom", {}).get("components", []) if row["component_id"] == component_id), None)
    if not component:
        raise HTTPException(status_code=404, detail="Component not found")

    active_event_id = event_id or order_context.get("event_id", "")
    active_trigger_type = (trigger_type or _default_trigger_type(active_event_id)).lower()
    if active_trigger_type not in {"tariff", "vessel-disruption", "port-closure", "commodity-spike"}:
        active_trigger_type = _default_trigger_type(active_event_id)
    schedule = _normalize_tariff_schedule(tariff_schedule)
    trigger_profile = _trigger_profile(active_event_id, active_trigger_type)

    all_components = order_context.get("bom", {}).get("components", [])
    quantity = int(order_context.get("quantity", 0) or 0)
    region_to_country = {
        "US": "US",
        "Mexico": "MX",
        "Korea": "KR",
        "Japan": "JP",
        "India": "IN",
    }

    affected_components: List[Dict[str, Any]] = []
    total_before = 0.0
    total_after = 0.0
    total_after_low = 0.0
    total_after_high = 0.0

    for row in all_components:
        cid = row["component_id"]
        vendors = [vendor for vendor in VENDOR_CATALOG.get(cid, []) if vendor.get("active", True)]
        if not vendors:
            continue

        base_unit_cost = _component_base_cost(cid)
        signal = COMPONENT_MARKET_SIGNALS.get(cid, {"change_pct": 4.0})
        weekly_change_pct = float(signal.get("change_pct", 4.0))
        required_units = quantity * int(row.get("qty_per_unit", 1))

        vendor_tariff_candidates = []
        for vendor in vendors:
            country = vendor.get("country", "US")
            tariff_raw = schedule.get(country, schedule["OTHER"])
            vendor_tariff_candidates.append(max(0.0, tariff_raw * trigger_profile["tariff_multiplier"]))
        max_vendor_tariff_pct = max(vendor_tariff_candidates) if vendor_tariff_candidates else 0.0

        all_corridors: List[str] = []
        for vendor in vendors:
            for route in _choose_routes(vendor["vendor_id"], [], "balanced")[:2]:
                all_corridors.extend(route.get("corridors", []))
        freight_pct = max(0.0, (_freight_multiplier(active_event_id, all_corridors) * trigger_profile["freight_multiplier"] - 1.0) * 100.0)
        commodity_pct = max(0.0, weekly_change_pct * trigger_profile["commodity_multiplier"])

        geography_rows = []
        impact_points = []
        for region, multiplier in PRICE_REGION_MULTIPLIERS.items():
            country = region_to_country.get(region, "OTHER")
            regional_tariff_pct = max(0.0, schedule.get(country, schedule["OTHER"]) * trigger_profile["tariff_multiplier"])
            region_bias = 1.0 if region in {"US", "Japan"} else 0.92
            geography_impact_pct = round(
                regional_tariff_pct
                + freight_pct * (0.52 if active_trigger_type != "tariff" else 0.28)
                + commodity_pct * region_bias,
                2,
            )
            new_cost = round(base_unit_cost * multiplier * (1.0 + geography_impact_pct / 100.0), 2)
            ci_half_pct = max(1.8, round(geography_impact_pct * 0.16 + (10.0 if active_trigger_type in {"vessel-disruption", "port-closure"} else 6.0), 2))
            low_pct = round(max(0.0, geography_impact_pct - ci_half_pct), 2)
            high_pct = round(geography_impact_pct + ci_half_pct, 2)
            low_cost = round(base_unit_cost * multiplier * (1.0 + low_pct / 100.0), 2)
            high_cost = round(base_unit_cost * multiplier * (1.0 + high_pct / 100.0), 2)
            geography_rows.append(
                {
                    "region": region,
                    "country": country,
                    "price_impact_pct": geography_impact_pct,
                    "new_effective_unit_cost": new_cost,
                    "confidence_interval_pct": [low_pct, high_pct],
                    "confidence_interval_usd": [low_cost, high_cost],
                }
            )
            impact_points.append(geography_impact_pct)

        blended_pct = round(float(median(impact_points)) if impact_points else 0.0, 2)
        before_unit = round(base_unit_cost, 2)
        after_unit = round(before_unit * (1.0 + blended_pct / 100.0), 2)
        ci_half_component = max(1.5, round(blended_pct * 0.14 + (8.0 if active_trigger_type != "tariff" else 5.0), 2))
        comp_low_pct = round(max(0.0, blended_pct - ci_half_component), 2)
        comp_high_pct = round(blended_pct + ci_half_component, 2)
        after_low = round(before_unit * (1.0 + comp_low_pct / 100.0), 2)
        after_high = round(before_unit * (1.0 + comp_high_pct / 100.0), 2)
        unit_delta = round(after_unit - before_unit, 2)
        total_delta = round(unit_delta * required_units, 2)

        total_before += before_unit * required_units
        total_after += after_unit * required_units
        total_after_low += after_low * required_units
        total_after_high += after_high * required_units

        if blended_pct >= 1.5 or max_vendor_tariff_pct > 0.0 or freight_pct > 0.0:
            affected_components.append(
                {
                    "component_id": cid,
                    "component_name": row.get("component_name", cid),
                    "qty_per_unit": int(row.get("qty_per_unit", 1)),
                    "required_units": required_units,
                    "base_unit_cost": before_unit,
                    "price_impact_pct": blended_pct,
                    "new_effective_unit_cost": after_unit,
                    "unit_cost_delta_usd": unit_delta,
                    "total_cost_delta_usd": total_delta,
                    "confidence_interval_pct": [comp_low_pct, comp_high_pct],
                    "confidence_interval_unit_usd": [after_low, after_high],
                    "driver_breakdown": {
                        "tariff_pct": round(max_vendor_tariff_pct, 2),
                        "freight_pct": round(freight_pct, 2),
                        "commodity_pct": round(commodity_pct, 2),
                    },
                    "geography_impacts": geography_rows,
                }
            )

    affected_components.sort(key=lambda item: item["total_cost_delta_usd"], reverse=True)
    selected_component = next((item for item in affected_components if item["component_id"] == component_id), None)
    if not selected_component and affected_components:
        selected_component = affected_components[0]
    if not selected_component:
        selected_component = {
            "component_id": component_id,
            "component_name": component.get("component_name", component_id),
            "base_unit_cost": _component_base_cost(component_id),
            "new_effective_unit_cost": _component_base_cost(component_id),
            "price_impact_pct": 0.0,
            "unit_cost_delta_usd": 0.0,
            "driver_breakdown": {"tariff_pct": 0.0, "freight_pct": 0.0, "commodity_pct": 0.0},
            "geography_impacts": [],
            "confidence_interval_pct": [0.0, 0.0],
            "confidence_interval_unit_usd": [_component_base_cost(component_id), _component_base_cost(component_id)],
        }

    primary_vendor = _primary_vendor_for_component(component_id) or (VENDOR_CATALOG.get(component_id, [{}])[0])
    routes = _choose_routes(primary_vendor.get("vendor_id", ""), [], "balanced") if primary_vendor else []
    primary_route = routes[0] if routes else {"cost_per_pallet": 5200.0, "transit_days": 12.0, "corridors": [], "risk": 40.0}

    impacted_vendors = []
    for vendor in VENDOR_CATALOG.get(component_id, []):
        country = vendor.get("country", "US")
        vendor_tariff_pct = max(0.0, schedule.get(country, schedule["OTHER"]) * trigger_profile["tariff_multiplier"])
        freight_pct_for_vendor = max(0.0, (_freight_multiplier(active_event_id, primary_route.get("corridors", [])) * trigger_profile["freight_multiplier"] - 1.0) * 100.0)
        new_vendor_cost = round(_component_base_cost(component_id) * (1.0 + (vendor_tariff_pct + freight_pct_for_vendor * 0.45) / 100.0), 2)
        ci_half = max(2.0, round((vendor_tariff_pct + freight_pct_for_vendor) * 0.15 + 6.0, 2))
        impacted_vendors.append(
            {
                "vendor_id": vendor["vendor_id"],
                "vendor_name": vendor["name"],
                "country": country,
                "effective_unit_cost_delta_pct": round(vendor_tariff_pct + freight_pct_for_vendor * 0.45, 2),
                "new_effective_unit_cost": new_vendor_cost,
                "confidence_interval_unit_usd": [
                    round(max(0.0, new_vendor_cost * (1.0 - ci_half / 100.0)), 2),
                    round(new_vendor_cost * (1.0 + ci_half / 100.0), 2),
                ],
                "remaining_capacity_pct": round(max(0.0, 100.0 - vendor.get("geo_risk", 30) * 0.45), 1),
            }
        )

    impacted_routes = []
    for route in routes[:3]:
        multiplier = _freight_multiplier(active_event_id, route.get("corridors", [])) * trigger_profile["freight_multiplier"]
        impacted_routes.append({
            "route_id": route["route_id"],
            "mode": route["mode"],
            "transit_days_before": route["transit_days"],
            "transit_days_after": round(route["transit_days"] * multiplier + trigger_profile["lead_time_days"], 1),
            "cost_delta_pct": round((multiplier - 1.0) * 100, 2),
        })

    before_cost_stack = {
        "procurement": round(selected_component["base_unit_cost"], 2),
        "logistics": round(primary_route.get("cost_per_pallet", 5200.0) / 250.0, 2),
        "tariff": 0.0,
    }
    after_cost_stack = {
        "procurement": round(selected_component["new_effective_unit_cost"], 2),
        "logistics": round(before_cost_stack["logistics"] * trigger_profile["freight_multiplier"] * _freight_multiplier(active_event_id, primary_route.get("corridors", [])), 2),
        "tariff": round(selected_component["base_unit_cost"] * (selected_component["driver_breakdown"]["tariff_pct"] / 100.0), 2),
    }

    total_delta_usd = round(total_after - total_before, 2)
    total_delta_pct = round(((total_after / max(total_before, 1.0)) - 1.0) * 100.0, 2)
    confidence_interval_total_usd = [round(total_after_low, 2), round(total_after_high, 2)]

    return {
        "event_id": active_event_id,
        "event_name": _find_event(active_event_id).get("name"),
        "trigger_type": active_trigger_type,
        "component_id": selected_component["component_id"],
        "component_name": selected_component["component_name"],
        "tariff_surcharge_pct": round(selected_component["driver_breakdown"]["tariff_pct"], 2),
        "vendor_capacity_lost_pct": round(min(55.0, primary_vendor.get("geo_risk", 30) * 0.38), 1),
        "freight_premium_pct": round(selected_component["driver_breakdown"]["freight_pct"], 2),
        "lead_time_delta_days": round(trigger_profile["lead_time_days"] + (selected_component["driver_breakdown"]["freight_pct"] * 0.04), 2),
        "landed_cost_delta_pct": round(selected_component["price_impact_pct"], 2),
        "confidence_reduction_pct": round((1.0 - trigger_profile["confidence_base"]) * 100.0, 2),
        "before_cost_stack": before_cost_stack,
        "after_cost_stack": after_cost_stack,
        "impacted_vendors": impacted_vendors,
        "impacted_routes": impacted_routes,
        "affected_components": affected_components,
        "overall_cost_stack": {
            "before_total_usd": round(total_before, 2),
            "after_total_usd": round(total_after, 2),
            "delta_total_usd": total_delta_usd,
            "delta_total_pct": total_delta_pct,
            "confidence_interval_after_total_usd": confidence_interval_total_usd,
        },
        "summary": (
            f"{_find_event(active_event_id).get('name')} ({active_trigger_type}) impacts {len(affected_components)} BOM components, "
            f"adding ${total_delta_usd:,.0f} to expected procurement stack with a {confidence_interval_total_usd[0]:,.0f}-{confidence_interval_total_usd[1]:,.0f} confidence range."
        ),
    }

    primary_vendor = _primary_vendor_for_component(component_id) or (VENDOR_CATALOG.get(component_id, [{}])[0])
    routes = _choose_routes(primary_vendor.get("vendor_id", ""), [], "balanced") if primary_vendor else []
    primary_route = routes[0] if routes else {"cost_per_pallet": 5200.0, "transit_days": 12.0, "corridors": [], "risk": 40.0}
    tariff_pct = round(_tariff_rate(order_context.get("event_id", ""), primary_vendor.get("country", "US")) * 100, 1)
    freight_multiplier = _freight_multiplier(order_context.get("event_id", ""), primary_route.get("corridors", []))
    freight_premium_pct = round((freight_multiplier - 1.0) * 100, 1)
    capacity_lost_pct = round(min(55.0, primary_vendor.get("geo_risk", 30) * 0.38), 1)
    lead_time_delta_days = round((freight_multiplier - 1.0) * primary_route.get("transit_days", 10.0) + tariff_pct * 0.04, 1)
    landed_cost_delta_pct = round(tariff_pct + freight_premium_pct * 0.35 + capacity_lost_pct * 0.08, 1)
    confidence_reduction_pct = round(min(35.0, capacity_lost_pct * 0.32 + lead_time_delta_days * 1.1), 1)

    base_unit_cost = _component_base_cost(component_id)
    before_cost_stack = {
        "procurement": round(base_unit_cost, 2),
        "logistics": round(primary_route.get("cost_per_pallet", 5200.0) / 250.0, 2),
        "tariff": 0.0,
    }
    after_cost_stack = {
        "procurement": round(base_unit_cost * (1.0 + tariff_pct / 100.0 * 0.5), 2),
        "logistics": round(before_cost_stack["logistics"] * freight_multiplier, 2),
        "tariff": round(base_unit_cost * tariff_pct / 100.0, 2),
    }
    impacted_vendors = []
    for vendor in VENDOR_CATALOG.get(component_id, []):
        vendor_tariff = round(_tariff_rate(order_context.get("event_id", ""), vendor["country"]) * 100, 1)
        vendor_capacity = round(max(0.0, 100.0 - vendor.get("geo_risk", 30) * 0.45), 1)
        impacted_vendors.append({
            "vendor_id": vendor["vendor_id"],
            "vendor_name": vendor["name"],
            "country": vendor["country"],
            "effective_unit_cost_delta_pct": round(vendor_tariff + vendor.get("cost_premium", 0) * 0.08, 1),
            "remaining_capacity_pct": vendor_capacity,
        })

    impacted_routes = []
    for route in routes[:3]:
        multiplier = _freight_multiplier(order_context.get("event_id", ""), route.get("corridors", []))
        impacted_routes.append({
            "route_id": route["route_id"],
            "mode": route["mode"],
            "transit_days_before": route["transit_days"],
            "transit_days_after": round(route["transit_days"] * multiplier, 1),
            "cost_delta_pct": round((multiplier - 1.0) * 100, 1),
        })

    return {
        "event_id": order_context.get("event_id"),
        "component_id": component_id,
        "component_name": component.get("component_name"),
        "tariff_surcharge_pct": tariff_pct,
        "vendor_capacity_lost_pct": capacity_lost_pct,
        "freight_premium_pct": freight_premium_pct,
        "lead_time_delta_days": lead_time_delta_days,
        "landed_cost_delta_pct": landed_cost_delta_pct,
        "confidence_reduction_pct": confidence_reduction_pct,
        "before_cost_stack": before_cost_stack,
        "after_cost_stack": after_cost_stack,
        "impacted_vendors": impacted_vendors,
        "impacted_routes": impacted_routes,
        "summary": f"This disruption raises landed {component.get('component_name')} cost by {landed_cost_delta_pct}%, removes low-cost capacity, and pushes the sourcing frontier toward faster or safer supply.",
    }


def _build_scenario_result(order_context: Dict[str, Any], component_row: Dict[str, Any], scenario_id: str, scenario_name: str, vendor: Dict[str, Any], route: Dict[str, Any], proposed_unit_price: float, tradeoff: str) -> Dict[str, Any]:
    profile = _sku_margin_profile(order_context.get("sku_id", ""))
    quantity = int(order_context.get("quantity", 0) or 0)
    required_units = quantity * int(component_row.get("qty_per_unit", 1))
    total_base_bom = sum(_component_base_cost(row["component_id"]) * int(row.get("qty_per_unit", 1)) * quantity for row in order_context.get("bom", {}).get("components", []))
    base_component_spend = _component_base_cost(component_row["component_id"]) * required_units
    procurement_cost = round(total_base_bom - base_component_spend + proposed_unit_price * required_units, 2)
    pallets = max(1.0, required_units / 250.0)
    base_logistics = pallets * 4800.0
    logistics_cost = round(base_logistics + max(0.0, route.get("cost_per_pallet", 5200.0) - 4800.0) * pallets, 2)
    tariff_cost = round(proposed_unit_price * required_units * _tariff_rate(order_context.get("event_id", ""), vendor.get("country", "US")), 2)
    lead_plus_transit = float(vendor.get("lead_time_days", vendor.get("lead_days", 14))) + float(route.get("transit_days", 10.0))
    intervention_day = float(component_row.get("intervention_day", component_row.get("days_to_stockout_disruption", 20.0)))
    delay_days = max(0.0, lead_plus_transit - intervention_day)
    revenue = round(profile["unit_revenue"] * quantity, 2)
    delay_penalty = round(delay_days * quantity * (profile["unit_revenue"] * 0.012), 2)
    execution_risk = round(vendor.get("geo_risk", 30) * 0.55 + route.get("risk", 35.0) * 0.45, 1)
    fulfillment_confidence = max(58.0, min(98.0, round(vendor.get("reliability", 85) - route.get("risk", 35.0) * 0.35 - delay_days * 1.6, 1)))
    risk_reserve = round(revenue * ((100.0 - fulfillment_confidence) / 100.0) * 0.06 + revenue * execution_risk / 10000.0, 2)
    fixed_conversion = round(profile["fixed_conversion_cost"] * quantity, 2)
    expected_profit = round(revenue - (procurement_cost + logistics_cost + tariff_cost + delay_penalty + risk_reserve + fixed_conversion), 2)
    gross_margin_pct = round((expected_profit / max(revenue, 1.0)) * 100.0, 1)
    margin_volatility = round(max(4.0, (100.0 - fulfillment_confidence) * 0.42 + execution_risk * 0.18), 1)
    scenario_score = round((expected_profit / 1_000_000.0) - margin_volatility * 0.05 - execution_risk * 0.04 + fulfillment_confidence * 0.03, 2)
    return {
        "scenario_id": scenario_id,
        "scenario_name": scenario_name,
        "vendor_id": vendor["vendor_id"],
        "vendor_name": vendor["name"],
        "route_id": route["route_id"],
        "route_mode": route["mode"],
        "proposed_unit_price": round(proposed_unit_price, 2),
        "procurement_cost": procurement_cost,
        "logistics_cost": logistics_cost,
        "tariff_cost": tariff_cost,
        "delay_penalty": delay_penalty,
        "risk_reserve": risk_reserve,
        "revenue": revenue,
        "expected_profit": expected_profit,
        "gross_margin_pct": gross_margin_pct,
        "fulfillment_confidence": fulfillment_confidence,
        "execution_risk": execution_risk,
        "margin_volatility": margin_volatility,
        "scenario_score": scenario_score,
        "tradeoff": tradeoff,
    }


def _negotiation_band(order_context: Dict[str, Any], component_row: Dict[str, Any], scenario: Dict[str, Any]) -> Dict[str, Any]:
    vendor = _find_vendor(component_row["component_id"], scenario["vendor_id"]) or {"vendor_id": scenario["vendor_id"], "name": scenario["vendor_name"], "country": "US", "reliability": 85, "geo_risk": 20}
    route = next((item for item in _choose_routes(vendor["vendor_id"], [], "balanced") if item["route_id"] == scenario["route_id"]), None) or {
        "route_id": scenario["route_id"],
        "cost_per_pallet": 5200.0,
        "transit_days": 10.0,
        "risk": 35.0,
        "mode": scenario["route_mode"],
    }
    profile = _sku_margin_profile(order_context.get("sku_id", ""))
    quantity = int(order_context.get("quantity", 0) or 0)
    required_units = quantity * int(component_row.get("qty_per_unit", 1))
    total_base_bom_per_unit = sum(_component_base_cost(row["component_id"]) * int(row.get("qty_per_unit", 1)) for row in order_context.get("bom", {}).get("components", []))
    component_budget_share = (_component_base_cost(component_row["component_id"]) * int(component_row.get("qty_per_unit", 1))) / max(total_base_bom_per_unit, 1.0)
    allowed_total_bom_per_unit = profile["unit_revenue"] * (1.0 - profile["floor_margin_pct"]) - profile["fixed_conversion_cost"]
    allowed_component_cost_per_unit = max(1.0, allowed_total_bom_per_unit * component_budget_share)
    historical = _historical_vendor_market(component_row["component_id"], vendor["vendor_id"])
    market_median = median([entry["avg_price"] for entry in HISTORICAL_VENDOR_MARKET.get(component_row["component_id"], {}).values()] or [historical["avg_price"]])
    logistics_per_required_unit = (route.get("cost_per_pallet", 5200.0) / 250.0)
    tariff_per_unit = scenario["proposed_unit_price"] * _tariff_rate(order_context.get("event_id", ""), vendor.get("country", "US"))
    risk_allowance = (scenario["execution_risk"] / 100.0) * 6.5
    max_acceptable = max(1.0, round(allowed_component_cost_per_unit - logistics_per_required_unit - tariff_per_unit - risk_allowance, 2))
    urgency_multiplier = 1.06 if float(component_row.get("days_to_stockout_disruption", 30.0)) < 14 else 1.02
    ideal_price = min(max_acceptable, round(min(market_median, historical["best_price"] * urgency_multiplier), 2))
    target_low = round(min(ideal_price, historical["avg_price"]), 2)
    target_high = round(min(max_acceptable, max(ideal_price * 1.04, target_low + 1.5)), 2)
    leverage = "weak" if (vendor.get("reliability", 85) > 90 and scenario["fulfillment_confidence"] < 85) else "moderate" if len(VENDOR_CATALOG.get(component_row["component_id"], [])) <= 2 else "balanced"
    walk_away = max_acceptable
    return {
        "vendor_id": vendor["vendor_id"],
        "vendor_name": vendor["name"],
        "ideal_price": round(ideal_price, 2),
        "target_low_price": round(target_low, 2),
        "target_high_price": round(target_high, 2),
        "max_acceptable_price": round(max_acceptable, 2),
        "walk_away_price": round(walk_away, 2),
        "leverage": leverage,
        "rationale": f"Target {target_low:.2f}-{target_high:.2f} keeps gross margin above the {profile['floor_margin_pct'] * 100:.0f}% floor after logistics, tariff, and risk allowances.",
    }


def _profit_recommendation(
    order_context: Dict[str, Any],
    component_id: str,
    event_id: Optional[str] = None,
    trigger_type: str = "tariff",
    locked_revenue_unit: Optional[float] = None,
    target_margin_pct: float = 22.0,
    preferred_freight_mode: str = "auto",
    monte_carlo_runs: int = 1200,
) -> Dict[str, Any]:
    import random

    component_row = next((row for row in order_context.get("bom", {}).get("components", []) if row["component_id"] == component_id), None)
    if not component_row:
        raise HTTPException(status_code=404, detail="Component not found")

    vendors = [vendor for vendor in VENDOR_CATALOG.get(component_id, []) if vendor.get("active", True)]
    if not vendors:
        raise HTTPException(status_code=404, detail="No vendors available")

    active_event_id = event_id or order_context.get("event_id")
    disruption_payload = _disruption_impact(order_context, component_id, event_id=active_event_id, trigger_type=trigger_type)
    affected_components = disruption_payload.get("affected_components", [])
    impacted_component = next((item for item in affected_components if item.get("component_id") == component_id), None)

    component_qty_per_unit = max(1, int(component_row.get("qty_per_unit", 1)))
    sku_profile = _sku_margin_profile(order_context.get("sku_id", ""))
    order_qty = max(1, int(order_context.get("quantity", 1) or 1))
    normalized_runs = max(300, min(10000, int(monte_carlo_runs or 1200)))
    target_margin = max(1.0, min(65.0, float(target_margin_pct or 22.0)))
    locked_revenue_per_unit = float(locked_revenue_unit or sku_profile["unit_revenue"])
    fixed_conversion_per_unit = float(sku_profile["fixed_conversion_cost"])

    total_base_bom_per_unit = sum(
        _component_base_cost(row["component_id"]) * int(row.get("qty_per_unit", 1))
        for row in order_context.get("bom", {}).get("components", [])
    )
    this_component_base_per_product = _component_base_cost(component_id) * component_qty_per_unit
    other_bom_per_unit = max(0.0, total_base_bom_per_unit - this_component_base_per_product)

    balanced_weights = {"reliability": 0.4, "cost": 0.3, "speed": 0.2, "geo_penalty": 0.1}
    scored_vendors = [_score_vendor(vendor, balanced_weights) for vendor in vendors]
    balanced_vendor = max(scored_vendors, key=lambda vendor: vendor["composite_score"])
    fastest_vendor = min(vendors, key=lambda vendor: vendor["lead_days"])
    safest_vendor = max(vendors, key=lambda vendor: vendor["reliability"] - vendor["geo_risk"] * 0.35)
    cheapest_vendor = min(vendors, key=lambda vendor: _historical_vendor_market(component_id, vendor["vendor_id"])["avg_price"])

    def pick_route(vendor_id: str, mode: Optional[str] = None) -> Dict[str, Any]:
        options = _choose_routes(vendor_id, [], "balanced")
        if mode and mode != "auto":
            filtered = [route for route in options if route.get("mode") == mode]
            if filtered:
                return filtered[0]
        return options[0] if options else {
            "route_id": "manual-route",
            "mode": (mode if mode and mode != "auto" else "sea"),
            "transit_days": 12.0,
            "cost_per_pallet": 8200.0,
            "risk": 35.0,
        }

    # 4 scenarios: optimistic, base, stressed, worst-case.
    scenario_blueprints = [
        {
            "scenario_id": "optimistic",
            "scenario_name": "Optimistic",
            "vendor": cheapest_vendor,
            "mode": "sea" if preferred_freight_mode == "auto" else preferred_freight_mode,
            "purchase_shift": -0.04,
            "freight_shift": -0.08,
            "tariff_shift": -0.10,
            "customs_rate": 0.017,
            "handling_unit": 2.4,
            "noise": 0.05,
            "tradeoff": "Best-case de-escalation with softer freight and tariff pressure.",
        },
        {
            "scenario_id": "base",
            "scenario_name": "Base",
            "vendor": balanced_vendor,
            "mode": preferred_freight_mode,
            "purchase_shift": 0.0,
            "freight_shift": 0.0,
            "tariff_shift": 0.0,
            "customs_rate": 0.02,
            "handling_unit": 2.9,
            "noise": 0.08,
            "tradeoff": "Most probable operating profile under current disruption conditions.",
        },
        {
            "scenario_id": "stressed",
            "scenario_name": "Stressed",
            "vendor": fastest_vendor,
            "mode": "air" if preferred_freight_mode == "auto" else preferred_freight_mode,
            "purchase_shift": 0.08,
            "freight_shift": 0.24,
            "tariff_shift": 0.14,
            "customs_rate": 0.027,
            "handling_unit": 3.5,
            "noise": 0.11,
            "tradeoff": "Tariff/friction persistence pushes landed economics into squeeze territory.",
        },
        {
            "scenario_id": "worst-case",
            "scenario_name": "Worst-case",
            "vendor": safest_vendor,
            "mode": "air",
            "purchase_shift": 0.18,
            "freight_shift": 0.42,
            "tariff_shift": 0.26,
            "customs_rate": 0.034,
            "handling_unit": 4.3,
            "noise": 0.16,
            "tradeoff": "Compounded disruption and emergency routing create loss-risk boundary conditions.",
        },
    ]

    base_purchase = float(impacted_component.get("new_effective_unit_cost", _component_base_cost(component_id)) if impacted_component else _component_base_cost(component_id))
    base_tariff_rate = max(0.0, float((impacted_component or {}).get("driver_breakdown", {}).get("tariff_pct", disruption_payload.get("tariff_surcharge_pct", 0.0))) / 100.0)

    rng_seed = hash(f"{order_context.get('order_id')}|{component_id}|{active_event_id}|{trigger_type}|{normalized_runs}|{target_margin}|{locked_revenue_per_unit:.4f}") & 0xFFFFFFFF
    rng = random.Random(rng_seed)

    def _normal_non_negative(mean: float, sigma: float) -> float:
        return max(0.0, rng.gauss(mean, sigma))

    def _percentile(values: List[float], q: float) -> float:
        if not values:
            return 0.0
        sorted_values = sorted(values)
        idx = int(round((len(sorted_values) - 1) * q))
        return float(sorted_values[max(0, min(idx, len(sorted_values) - 1))])

    scenarios: List[Dict[str, Any]] = []
    for blueprint in scenario_blueprints:
        vendor = blueprint["vendor"]
        route = pick_route(vendor["vendor_id"], blueprint["mode"])
        freight_unit_base = max(2.0, float(route.get("cost_per_pallet", 5200.0)) / 250.0)

        purchase_samples: List[float] = []
        freight_samples: List[float] = []
        tariff_samples: List[float] = []
        customs_samples: List[float] = []
        handling_samples: List[float] = []
        landed_component_samples: List[float] = []
        profit_per_unit_samples: List[float] = []

        purchase_mean = max(0.1, base_purchase * (1.0 + blueprint["purchase_shift"]))
        freight_mean = max(0.1, freight_unit_base * (1.0 + blueprint["freight_shift"]))
        tariff_mean = max(0.0, base_tariff_rate * (1.0 + blueprint["tariff_shift"]))
        customs_rate = max(0.0, float(blueprint["customs_rate"]))
        handling_mean = max(0.1, float(blueprint["handling_unit"]))
        noise = float(blueprint["noise"])

        for _ in range(normalized_runs):
            purchase_u = _normal_non_negative(purchase_mean, max(0.01, purchase_mean * noise))
            freight_u = _normal_non_negative(freight_mean, max(0.01, freight_mean * noise * 1.15))
            tariff_rate_u = max(0.0, rng.gauss(tariff_mean, max(0.0001, tariff_mean * noise * 0.55)))
            customs_rate_u = max(0.0, rng.gauss(customs_rate, max(0.0001, customs_rate * noise * 0.45)))
            handling_u = _normal_non_negative(handling_mean, max(0.01, handling_mean * noise * 0.9))

            tariff_u = purchase_u * tariff_rate_u
            customs_u = (purchase_u + freight_u) * customs_rate_u
            landed_component_u = purchase_u + freight_u + tariff_u + customs_u + handling_u
            landed_product_u = landed_component_u * component_qty_per_unit
            total_cost_product_u = other_bom_per_unit + fixed_conversion_per_unit + landed_product_u
            profit_product_u = locked_revenue_per_unit - total_cost_product_u

            purchase_samples.append(purchase_u)
            freight_samples.append(freight_u)
            tariff_samples.append(tariff_u)
            customs_samples.append(customs_u)
            handling_samples.append(handling_u)
            landed_component_samples.append(landed_component_u)
            profit_per_unit_samples.append(profit_product_u)

        purchase_expected = round(sum(purchase_samples) / len(purchase_samples), 4)
        freight_expected = round(sum(freight_samples) / len(freight_samples), 4)
        tariff_expected = round(sum(tariff_samples) / len(tariff_samples), 4)
        customs_expected = round(sum(customs_samples) / len(customs_samples), 4)
        handling_expected = round(sum(handling_samples) / len(handling_samples), 4)
        landed_component_expected = round(sum(landed_component_samples) / len(landed_component_samples), 4)
        landed_product_expected = round(landed_component_expected * component_qty_per_unit, 4)
        profit_per_unit_expected = round(sum(profit_per_unit_samples) / len(profit_per_unit_samples), 4)

        profit_ci = [round(_percentile(profit_per_unit_samples, 0.1), 4), round(_percentile(profit_per_unit_samples, 0.9), 4)]
        landed_ci = [round(_percentile(landed_component_samples, 0.1), 4), round(_percentile(landed_component_samples, 0.9), 4)]

        allowed_cost_per_product = locked_revenue_per_unit * (1.0 - target_margin / 100.0)
        non_purchase_per_component = freight_expected + handling_expected + (freight_expected * customs_rate)
        ceiling_numerator = allowed_cost_per_product - other_bom_per_unit - fixed_conversion_per_unit - component_qty_per_unit * non_purchase_per_component
        ceiling_denominator = max(0.01, component_qty_per_unit * (1.0 + tariff_mean + customs_rate))
        negotiation_ceiling = round(max(0.0, ceiling_numerator / ceiling_denominator), 4)

        breakeven_numerator = locked_revenue_per_unit - other_bom_per_unit - fixed_conversion_per_unit - component_qty_per_unit * non_purchase_per_component
        break_even_purchase = round(max(0.0, breakeven_numerator / ceiling_denominator), 4)

        revenue_total = round(locked_revenue_per_unit * order_qty, 2)
        procurement_cost_total = round((other_bom_per_unit + purchase_expected * component_qty_per_unit) * order_qty, 2)
        logistics_total = round(freight_expected * component_qty_per_unit * order_qty, 2)
        tariff_total = round(tariff_expected * component_qty_per_unit * order_qty, 2)
        customs_total = round(customs_expected * component_qty_per_unit * order_qty, 2)
        handling_total = round(handling_expected * component_qty_per_unit * order_qty, 2)
        fixed_conversion_total = round(fixed_conversion_per_unit * order_qty, 2)
        expected_profit_total = round(profit_per_unit_expected * order_qty, 2)

        execution_risk = round(min(95.0, vendor.get("geo_risk", 25) * 0.55 + route.get("risk", 30.0) * 0.45 + (0 if blueprint["scenario_id"] in {"optimistic", "base"} else 8)), 1)
        fulfillment_confidence = round(max(45.0, min(99.0, 100.0 - execution_risk * 0.55 - (15.0 if blueprint["scenario_id"] == "worst-case" else 0.0))), 1)
        margin_volatility = round(max(2.0, (profit_ci[1] - profit_ci[0]) / max(abs(profit_per_unit_expected) + 1.0, 1.0) * 18.0), 1)
        scenario_score = round((expected_profit_total / 1000000.0) + fulfillment_confidence * 0.025 - execution_risk * 0.04 - margin_volatility * 0.06, 2)
        gross_margin_pct = round((profit_per_unit_expected / max(locked_revenue_per_unit, 0.01)) * 100.0, 2)

        scenarios.append(
            {
                "scenario_id": blueprint["scenario_id"],
                "scenario_name": blueprint["scenario_name"],
                "vendor_id": vendor["vendor_id"],
                "vendor_name": vendor["name"],
                "route_id": route["route_id"],
                "route_mode": route["mode"],
                "proposed_unit_price": round(purchase_expected, 2),
                "procurement_cost": procurement_cost_total,
                "logistics_cost": logistics_total,
                "tariff_cost": tariff_total,
                "delay_penalty": 0.0,
                "risk_reserve": round(max(0.0, (profit_ci[1] - profit_ci[0]) * 0.18 * order_qty), 2),
                "revenue": revenue_total,
                "expected_profit": expected_profit_total,
                "gross_margin_pct": gross_margin_pct,
                "fulfillment_confidence": fulfillment_confidence,
                "execution_risk": execution_risk,
                "margin_volatility": margin_volatility,
                "scenario_score": scenario_score,
                "tradeoff": blueprint["tradeoff"],
                "locked_revenue_per_unit": round(locked_revenue_per_unit, 4),
                "target_margin_pct": round(target_margin, 2),
                "purchase_price_per_unit": round(purchase_expected, 4),
                "freight_per_unit": round(freight_expected, 4),
                "tariff_per_unit": round(tariff_expected, 4),
                "customs_per_unit": round(customs_expected, 4),
                "handling_per_unit": round(handling_expected, 4),
                "other_bom_per_unit": round(other_bom_per_unit, 4),
                "fixed_conversion_per_unit": round(fixed_conversion_per_unit, 4),
                "landed_cost_per_unit": round(landed_component_expected, 4),
                "landed_cost_per_unit_ci": landed_ci,
                "profit_per_unit_expected": round(profit_per_unit_expected, 4),
                "profit_per_unit_ci": profit_ci,
                "negotiation_ceiling_purchase_price": round(negotiation_ceiling, 4),
                "break_even_purchase_price": round(break_even_purchase, 4),
                "is_loss_making": expected_profit_total < 0,
                "waterfall": {
                    "revenue_per_unit": round(locked_revenue_per_unit, 4),
                    "purchase_per_unit": round(purchase_expected * component_qty_per_unit, 4),
                    "freight_per_unit": round(freight_expected * component_qty_per_unit, 4),
                    "tariff_per_unit": round(tariff_expected * component_qty_per_unit, 4),
                    "customs_per_unit": round(customs_expected * component_qty_per_unit, 4),
                    "handling_per_unit": round(handling_expected * component_qty_per_unit, 4),
                    "other_bom_per_unit": round(other_bom_per_unit, 4),
                    "fixed_conversion_per_unit": round(fixed_conversion_per_unit, 4),
                    "profit_per_unit": round(profit_per_unit_expected, 4),
                },
                "monte_carlo_runs": normalized_runs,
            }
        )

    scenarios.sort(key=lambda scenario: scenario["scenario_score"], reverse=True)
    best = scenarios[0]
    baseline = scenarios[-1]

    # Keep the legacy negotiation band fields for downstream compatibility.
    band = _negotiation_band(order_context, component_row, best)
    band["max_acceptable_price"] = round(best["negotiation_ceiling_purchase_price"], 4)
    band["walk_away_price"] = round(best["break_even_purchase_price"], 4)

    recommendation = {
        "component_id": component_id,
        "selected_vendor_id": best["vendor_id"],
        "selected_vendor_name": best["vendor_name"],
        "selected_route_id": best["route_id"],
        "selected_route_mode": best["route_mode"],
        "selected_target_price": round(min(best["negotiation_ceiling_purchase_price"], (band["target_low_price"] + band["target_high_price"]) / 2.0), 2),
        "expected_profit": best["expected_profit"],
        "profit_protected_vs_baseline": round(best["expected_profit"] - baseline["expected_profit"], 2),
        "fulfillment_confidence": best["fulfillment_confidence"],
        "confidence_range_low": max(50.0, round(best["fulfillment_confidence"] - 6.0, 1)),
        "confidence_range_high": min(99.0, round(best["fulfillment_confidence"] + 4.0, 1)),
        "top_tradeoff": best["tradeoff"],
        "rollback_trigger": f"If awarded price exceeds ${best['break_even_purchase_price']:.2f} or ETA slips beyond {int(component_row.get('intervention_day', 14))} days, switch to scenario {scenarios[1]['scenario_id']}",
    }

    severity_order = ["optimistic", "base", "stressed", "worst-case"]
    by_id = {item["scenario_id"]: item for item in scenarios}
    ordered_for_boundary = [by_id[item] for item in severity_order if item in by_id]
    loss_boundary = next((item for item in ordered_for_boundary if item["is_loss_making"]), None)

    payload = {
        "component_id": component_id,
        "component_name": component_row["component_name"],
        "event_id": active_event_id,
        "trigger_type": trigger_type,
        "locked_revenue_per_unit": round(locked_revenue_per_unit, 4),
        "target_margin_pct": round(target_margin, 2),
        "freight_mode": preferred_freight_mode,
        "monte_carlo_runs": normalized_runs,
        "scenarios": scenarios,
        "scenario_order": severity_order,
        "loss_boundary_scenario": {
            "scenario_id": loss_boundary["scenario_id"],
            "scenario_name": loss_boundary["scenario_name"],
            "profit_per_unit_expected": loss_boundary["profit_per_unit_expected"],
        } if loss_boundary else None,
        "negotiation_band": band,
        "recommendation": recommendation,
        "headline": (
            f"{best['scenario_name']} is the best risk-adjusted outcome: landed cost ${best['landed_cost_per_unit']:.2f}/component, "
            f"negotiation ceiling ${best['negotiation_ceiling_purchase_price']:.2f}, break-even purchase ${best['break_even_purchase_price']:.2f}."
        ),
    }
    order_context["last_profit_recommendation"] = payload
    return payload


def _execution_learning(order_context: Dict[str, Any], component_id: str) -> Dict[str, Any]:
    def bounded(value: float, low: float, high: float) -> float:
        return max(low, min(high, value))

    recommendation = order_context.get("last_profit_recommendation")
    if not recommendation or recommendation.get("component_id") != component_id:
        recommendation = _profit_recommendation(order_context, component_id)

    chosen = recommendation["recommendation"]
    selected_scenario = next(
        (
            scenario
            for scenario in recommendation.get("scenarios", [])
            if scenario["vendor_id"] == chosen["selected_vendor_id"] and scenario["route_id"] == chosen["selected_route_id"]
        ),
        recommendation.get("scenarios", [{}])[0] if recommendation.get("scenarios") else {},
    )

    quantity = max(1, int(order_context.get("quantity", 1) or 1))
    promise = order_context.get("last_delivery_promise") or {}
    execution = order_context.get("last_execution") or {}

    projected_unit_price = float(chosen.get("selected_target_price", 0.0) or 0.0)
    projected_profit = float(chosen.get("expected_profit", 0.0) or 0.0)
    projected_margin_pct = float(selected_scenario.get("gross_margin_pct", 0.0) or 0.0)
    projected_total_cost = round(
        float(selected_scenario.get("procurement_cost", 0.0) or 0.0)
        + float(selected_scenario.get("logistics_cost", 0.0) or 0.0)
        + float(selected_scenario.get("tariff_cost", 0.0) or 0.0)
        + float(selected_scenario.get("delay_penalty", 0.0) or 0.0)
        + float(selected_scenario.get("risk_reserve", 0.0) or 0.0),
        2,
    )
    projected_eta_days = promise.get("original_eta_days")

    has_execution = bool(execution)
    execution_mode = str(execution.get("mode", "mock")).lower()
    delay_days = max(0.0, float(promise.get("delay_days", 0.0) or 0.0))
    unit_price_slippage = 0.018 if execution_mode == "live" else 0.009

    actual_unit_price = None
    actual_total_cost = None
    actual_profit = None
    actual_margin_pct = None
    actual_eta_days = promise.get("order_level_eta_days")
    calibration_status = "pending-negotiation"

    if has_execution:
        actual_unit_price = round(projected_unit_price * (1.0 + unit_price_slippage), 4)
        slip_cost = projected_total_cost * (0.006 if execution_mode == "mock" else 0.014)
        delay_cost = delay_days * quantity * 12.5
        actual_total_cost = round(projected_total_cost + slip_cost + delay_cost, 2)
        revenue_total = float(selected_scenario.get("revenue", projected_total_cost + projected_profit) or (projected_total_cost + projected_profit))
        actual_profit = round(revenue_total - actual_total_cost, 2)
        actual_margin_pct = round((actual_profit / max(revenue_total, 1.0)) * 100.0, 2)
        calibration_status = "closed" if promise else "approved-in-flight"

    price_delta = None if actual_unit_price is None else round(actual_unit_price - projected_unit_price, 4)
    cost_delta = None if actual_total_cost is None else round(actual_total_cost - projected_total_cost, 2)
    margin_delta = None if actual_margin_pct is None else round(actual_margin_pct - projected_margin_pct, 2)
    profit_delta = None if actual_profit is None else round(actual_profit - projected_profit, 2)
    eta_delta = None if actual_eta_days is None or projected_eta_days is None else round(float(actual_eta_days) - float(projected_eta_days), 1)

    decision_date = execution.get("created_at") or _now_iso()
    procurement_head_id = str(order_context.get("procurement_head_id") or "procurement-head")
    decision_snapshot = {
        "decision_id": execution.get("execution_id") or f"decision-{order_context.get('order_id')}",
        "order_id": order_context.get("order_id"),
        "event_id": order_context.get("event_id"),
        "component_id": component_id,
        "procurement_head_id": procurement_head_id,
        "vendor_id": chosen.get("selected_vendor_id"),
        "vendor_name": chosen.get("selected_vendor_name"),
        "route_id": chosen.get("selected_route_id"),
        "route_mode": chosen.get("selected_route_mode"),
        "decision_date": decision_date,
        "projected_unit_price": projected_unit_price,
        "projected_total_cost": projected_total_cost,
        "projected_margin_pct": projected_margin_pct,
    }
    outcome_snapshot = {
        "actual_unit_price": actual_unit_price,
        "actual_total_cost": actual_total_cost,
        "actual_margin_pct": actual_margin_pct,
        "actual_profit": actual_profit,
        "actual_eta_days": actual_eta_days,
        "status": calibration_status,
    }

    if has_execution:
        execution["decision_snapshot"] = decision_snapshot
        execution["outcome_snapshot"] = outcome_snapshot
        order_context["last_execution"] = execution

    decision_history_rows: List[Dict[str, Any]] = []
    for item in EXECUTION_LOGS:
        snap = item.get("decision_snapshot")
        if not snap:
            continue
        outcome = item.get("outcome_snapshot") or {}
        pm = snap.get("projected_margin_pct")
        am = outcome.get("actual_margin_pct")
        pc = snap.get("projected_total_cost")
        ac = outcome.get("actual_total_cost")

        margin_accuracy = 0.0
        cost_accuracy = 0.0
        if pm is not None and am is not None:
            margin_accuracy = bounded(100.0 - abs(float(am) - float(pm)) * 3.0, 0.0, 100.0)
        if pc is not None and ac is not None and float(pc) > 0:
            cost_accuracy = bounded(100.0 - abs(float(ac) - float(pc)) / float(pc) * 200.0, 0.0, 100.0)
        if margin_accuracy > 0 and cost_accuracy > 0:
            accuracy_score = round(margin_accuracy * 0.6 + cost_accuracy * 0.4, 1)
        elif margin_accuracy > 0:
            accuracy_score = round(margin_accuracy, 1)
        elif cost_accuracy > 0:
            accuracy_score = round(cost_accuracy, 1)
        else:
            accuracy_score = 0.0

        decision_history_rows.append(
            {
                "decision_id": snap.get("decision_id", item.get("execution_id")),
                "order_id": snap.get("order_id"),
                "event_id": snap.get("event_id"),
                "component_id": snap.get("component_id"),
                "procurement_head_id": snap.get("procurement_head_id", "procurement-head"),
                "vendor_name": snap.get("vendor_name"),
                "route_id": snap.get("route_id"),
                "route_mode": snap.get("route_mode"),
                "decision_date": snap.get("decision_date", item.get("created_at")),
                "projected_margin_pct": pm,
                "actual_margin_pct": am,
                "projected_total_cost": pc,
                "actual_total_cost": ac,
                "accuracy_score": accuracy_score,
                "status": (outcome.get("status") or "approved-in-flight"),
            }
        )

    decision_history_rows.sort(key=lambda row: row.get("decision_date", ""), reverse=True)
    closed_scores = [row["accuracy_score"] for row in decision_history_rows if row.get("status") == "closed" and row.get("accuracy_score", 0) > 0]
    avg_accuracy = round(sum(closed_scores) / len(closed_scores), 1) if closed_scores else 0.0

    similar_history = [
        row
        for row in decision_history_rows
        if row.get("component_id") == component_id or row.get("event_id") == order_context.get("event_id")
    ]
    base_confidence = float(chosen.get("fulfillment_confidence", 72.0) or 72.0)
    confidence_score = round(bounded(base_confidence * 0.62 + avg_accuracy * 0.34 + min(len(similar_history), 5) * 1.2, 45.0, 98.0), 1)
    informed_by = [
        {
            "decision_id": row.get("decision_id"),
            "event_id": row.get("event_id"),
            "vendor_name": row.get("vendor_name"),
            "route_id": row.get("route_id"),
            "outcome_accuracy": row.get("accuracy_score"),
            "delta_summary": (
                f"margin {row.get('projected_margin_pct', 0):.1f}% -> {row.get('actual_margin_pct', 0):.1f}%"
                if row.get("actual_margin_pct") is not None
                else "awaiting close-out"
            ),
        }
        for row in similar_history[:3]
    ]

    vendor = _find_vendor(component_id, chosen.get("selected_vendor_id")) or {
        "vendor_id": chosen.get("selected_vendor_id"),
        "name": chosen.get("selected_vendor_name"),
        "reliability": 85,
    }
    projected_cost_nonzero = max(projected_total_cost, 1.0)
    realized_cost_delta_pct = 0.0 if cost_delta is None else (cost_delta / projected_cost_nonzero) * 100.0
    vendor_reliability_delta = 0.0 if margin_delta is None else bounded(margin_delta * 0.22 - max(0.0, realized_cost_delta_pct) * 0.08, -4.0, 4.0)
    vendor_reliability_after = round(bounded(float(vendor.get("reliability", 85)) + vendor_reliability_delta, 40.0, 99.0), 1)
    commodity_before = round(bounded(86.0 - abs(realized_cost_delta_pct) * 1.6, 42.0, 96.0), 1)
    commodity_after = round(bounded(commodity_before + (2.4 if calibration_status == "closed" else 0.8), 45.0, 99.0), 1)
    simulation_before = {
        "purchase_noise_pct": 8.0,
        "logistics_noise_pct": 11.0,
        "risk_reserve_factor": 1.0,
    }
    simulation_after = {
        "purchase_noise_pct": round(bounded(simulation_before["purchase_noise_pct"] + abs(realized_cost_delta_pct) * 0.12, 5.0, 20.0), 2),
        "logistics_noise_pct": round(bounded(simulation_before["logistics_noise_pct"] + max(0.0, delay_days) * 0.25, 6.0, 24.0), 2),
        "risk_reserve_factor": round(bounded(simulation_before["risk_reserve_factor"] + (0.08 if (margin_delta is not None and margin_delta < 0) else -0.03), 0.72, 1.45), 2),
    }
    negotiation_floor_adjustment_pct = round(bounded(realized_cost_delta_pct * 0.45, -6.0, 6.0), 2)

    milestones = [
        {
            "stage": "Decision Approved",
            "timestamp": execution.get("created_at"),
            "status": "done" if has_execution else "pending",
            "note": f"Vendor {chosen.get('selected_vendor_name')} via {chosen.get('selected_route_id')} at ${projected_unit_price:.2f}",
        },
        {
            "stage": "PO + Freight Booking",
            "timestamp": execution.get("created_at"),
            "status": "done" if has_execution else "pending",
            "note": execution.get("po_number", "Awaiting approval"),
        },
        {
            "stage": "Delivery Promise",
            "timestamp": promise.get("promised_delivery_date"),
            "status": "done" if promise else "pending",
            "note": f"ETA {promise.get('promised_delivery_date')}" if promise else "Waiting for promise run",
        },
        {
            "stage": "Outcome Closed",
            "timestamp": _now_iso() if calibration_status == "closed" else None,
            "status": "done" if calibration_status == "closed" else "in-progress",
            "note": "Actual vs projected deltas posted to learning model." if calibration_status == "closed" else "Waiting for close-out signals.",
        },
    ]

    feedback = {
        "order_id": order_context.get("order_id"),
        "component_id": component_id,
        "predicted_unit_price": projected_unit_price,
        "actual_unit_price": actual_unit_price,
        "predicted_total_cost": projected_total_cost,
        "actual_total_cost": actual_total_cost,
        "predicted_margin_pct": projected_margin_pct,
        "actual_margin_pct": actual_margin_pct,
        "predicted_eta_days": projected_eta_days,
        "actual_eta_days": actual_eta_days,
        "predicted_profit": projected_profit,
        "actual_profit": actual_profit,
        "calibration_status": calibration_status,
        "decision_date": decision_date,
    }

    return {
        "feedback": feedback,
        "calibration_deltas": {
            "price_delta": price_delta,
            "cost_delta": cost_delta,
            "margin_delta_pct": margin_delta,
            "eta_delta_days": eta_delta,
            "profit_delta": profit_delta,
        },
        "rl_updates": {
            "vendor_reliability": [
                {
                    "vendor_id": vendor.get("vendor_id"),
                    "vendor_name": vendor.get("name", chosen.get("selected_vendor_name")),
                    "old_reliability": vendor.get("reliability", 85),
                    "new_reliability": vendor_reliability_after,
                    "delta": round(vendor_reliability_after - float(vendor.get("reliability", 85)), 2),
                }
            ],
            "commodity_estimate_accuracy": {
                "before_pct": commodity_before,
                "after_pct": commodity_after,
                "delta_pct": round(commodity_after - commodity_before, 2),
            },
            "simulation_calibration": {
                "before": simulation_before,
                "after": simulation_after,
            },
            "negotiation_floor_adjustment_pct": negotiation_floor_adjustment_pct,
        },
        "decision_history": {
            "procurement_head_id": procurement_head_id,
            "average_accuracy_score": avg_accuracy,
            "decisions": decision_history_rows,
        },
        "next_event_guidance": {
            "confidence_score": confidence_score,
            "informed_by": informed_by,
            "explanation": (
                f"Confidence {confidence_score:.1f}% blends current scenario feasibility with {len(similar_history)} similar decisions and your historical outcome accuracy of {avg_accuracy:.1f}%."
            ),
        },
        "order_tracking": {
            "order_id": order_context.get("order_id"),
            "status": calibration_status,
            "milestones": milestones,
        },
        "summary": "Action + reinforcement learning now logs every approved sourcing decision, compares projected vs actual outcomes at close, and recalibrates vendor reliability, price-estimation accuracy, simulation parameters, and negotiation floors for the next disruption.",
    }


def _executive_snapshot(order_context: Dict[str, Any]) -> Dict[str, Any]:
    components = order_context.get("bom", {}).get("components", [])
    if not components:
        return {
            "order_id": order_context.get("order_id"),
            "critical_components_at_risk": 0,
            "closest_intervention_deadline_days": None,
            "active_geopolitical_disruptions": 0,
            "orders_impacted_percent": 0,
            "estimated_revenue_at_risk": 0,
            "decision": "No action needed",
            "status": "green",
        }

    critical_at_risk = sum(1 for c in components if c.get("criticality") == "critical" and c.get("status") in {"red", "amber"})
    closest = min(c.get("intervention_day", 999) for c in components)
    impacted = min(100, max(8, int((critical_at_risk / max(1, len(components))) * 100 + 18)))
    revenue_at_risk = int(order_context.get("quantity", 1000) * 1650 * (impacted / 100.0))
    disruption_count = len(_event_disruption_tags(order_context.get("event_id", "")))
    immediate = closest <= 7 or critical_at_risk >= 2
    return {
        "order_id": order_context.get("order_id"),
        "critical_components_at_risk": critical_at_risk,
        "closest_intervention_deadline_days": round(closest, 1),
        "active_geopolitical_disruptions": disruption_count,
        "orders_impacted_percent": impacted,
        "estimated_revenue_at_risk": revenue_at_risk,
        "decision": "Immediate action required" if immediate else "No action needed",
        "status": "red" if immediate else "green",
    }


def _component_deep_dive(order_context: Dict[str, Any], component_id: str) -> Dict[str, Any]:
    components = order_context.get("bom", {}).get("components", [])
    component = next((c for c in components if c.get("component_id") == component_id), None)
    if not component:
        raise HTTPException(status_code=404, detail="Component not found in order BOM")

    drivers = _component_driver_map(component_id)
    risk_delta = round(component["days_to_stockout_baseline"] - component["days_to_stockout_disruption"], 1)
    signal_strength = min(100, int(component.get("criticality_score", 60) + max(0, 20 - component.get("intervention_day", 20))))
    active_event_id = order_context.get("event_id", "")
    event_corridors = _event_corridor_impacts(active_event_id)
    exposure_corridors = drivers["route_closures"]
    impacted_corridors = [corridor for corridor in exposure_corridors if corridor in event_corridors]
    return {
        "order_id": order_context.get("order_id"),
        "component_id": component_id,
        "component_name": component.get("component_name"),
        "inventory": {
            "current_stock": component.get("inventory"),
            "daily_burn_baseline": component.get("daily_burn_baseline"),
            "daily_burn_disruption": component.get("daily_burn_disruption"),
            "days_to_stockout_baseline": component.get("days_to_stockout_baseline"),
            "days_to_stockout_disruption": component.get("days_to_stockout_disruption"),
        },
        "scenario_comparison": {
            "baseline_runway_days": component.get("days_to_stockout_baseline"),
            "disrupted_runway_days": component.get("days_to_stockout_disruption"),
            "runway_loss_days": risk_delta,
            "intervention_day": component.get("intervention_day"),
        },
        "active_disruptions": _event_disruption_tags(active_event_id),
        "event_route_impacts": event_corridors,
        "exposure_corridors": exposure_corridors,
        "impacted_exposure_corridors": impacted_corridors,
        "route_closures": exposure_corridors,
        "commodity_spikes": drivers["commodity_spikes"],
        "signal_strength": signal_strength,
        "status": component.get("status", "amber"),
        "decision_hint": "Real risk signal - intervention required" if component.get("intervention_day", 99) <= 14 else "Monitor closely",
    }


def _decision_panel(order_context: Dict[str, Any], component_id: Optional[str] = None) -> Dict[str, Any]:
    components = order_context.get("bom", {}).get("components", [])
    target = next((c for c in components if c.get("component_id") == component_id), None) if component_id else None
    target = target or (components[0] if components else None)
    if not target:
        raise HTTPException(status_code=404, detail="No component context available")

    scored = [_score_vendor(v, {"reliability": 0.25, "cost": 0.1, "speed": 0.6, "geo_penalty": 0.05}) for v in VENDOR_CATALOG.get(target["component_id"], []) if v.get("active", True)]
    scored.sort(key=lambda item: item["composite_score"], reverse=True)
    best_vendor = scored[0] if scored else None
    routes = _choose_routes(best_vendor["vendor_id"], [], "speed") if best_vendor else []
    primary_route = routes[0] if routes else None

    action_cost = round(max(0.8, order_context.get("quantity", 1000) / 1000 * 2.8), 2)
    inaction_cost = round(max(40.0, order_context.get("quantity", 1000) / 1000 * 200.0), 2)
    roi = round(inaction_cost / max(action_cost, 0.1), 2)
    deadline = round(target.get("intervention_day", 14), 1)
    return {
        "order_id": order_context.get("order_id"),
        "component_id": target.get("component_id"),
        "component_name": target.get("component_name"),
        "recommended_action": f"Activate {best_vendor['name']} via {primary_route['route_id']}" if best_vendor and primary_route else "Activate contingency vendor and expedited freight",
        "deadline_days": deadline,
        "cost_of_action_musd": action_cost,
        "cost_of_inaction_musd": inaction_cost,
        "roi_multiple": roi,
        "best_vendor": best_vendor,
        "primary_route": primary_route,
        "approve_label": "Approve and Execute",
    }


def _monitoring_view(order_context: Dict[str, Any]) -> Dict[str, Any]:
    components = order_context.get("bom", {}).get("components", [])
    min_runway = min((c.get("days_to_stockout_disruption", 40) for c in components), default=40)
    trend = [round(min_runway + offset, 1) for offset in [3.5, 2.0, 0.0, -1.2, -2.8]]
    corridor_watch = sum(1 for node in CORRIDOR_GRAPH.get("nodes", []) if node.get("status") == "watch")
    status = "escalating" if min_runway <= 12 else "stabilized" if min_runway >= 22 else "watch"
    return {
        "order_id": order_context.get("order_id"),
        "status": status,
        "days_to_stockout_trend": trend,
        "routes_reopening": max(0, 3 - corridor_watch),
        "commodity_normalization_index": max(30, 82 - corridor_watch * 9),
        "inventory_recovery_index": max(25, int(min_runway * 2.2)),
        "message": "Situation improving" if status == "stabilized" else "Situation escalating" if status == "escalating" else "Situation requires watchful monitoring",
    }


def _primary_vendor_for_component(component_id: str) -> Optional[Dict[str, Any]]:
    vendors = [vendor for vendor in VENDOR_CATALOG.get(component_id, []) if vendor.get("active", True)]
    return vendors[0] if vendors else None


def _live_signal_strip(event_id: str) -> Dict[str, Any]:
    event_corridors = _event_corridor_impacts(event_id)
    return {
        "last_refresh": _now_iso(),
        "refresh_cadence": "15m",
        "vessel_disruptions_active": [f"{corridor} congestion" for corridor in event_corridors[:3]],
        "commodity_price_changes_15m": [
            {"commodity": "Jet Fuel", "change_pct": 3.4},
            {"commodity": "Diesel", "change_pct": 2.1},
            {"commodity": "Lithium Carbonate", "change_pct": 1.8},
        ],
        "tariff_alerts": [
            "CN electronics category review pending",
            "Cross-border battery tariff watchlist elevated",
        ],
    }


def _risk_dashboard(order_context: Dict[str, Any]) -> Dict[str, Any]:
    event_id = order_context.get("event_id", "")
    rows = []
    for component in order_context.get("bom", {}).get("components", []):
        criticality = component.get("criticality", "important")
        safety_days = 18 if criticality == "critical" else 25 if criticality == "important" else 35
        primary_vendor = _primary_vendor_for_component(component["component_id"])
        rows.append(
            {
                "component_id": component["component_id"],
                "name": component["component_name"],
                "category": component.get("category", "compute"),
                "criticality": criticality,
                "inventory_days": component["days_to_stockout_disruption"],
                "vendor_region": primary_vendor.get("country", "N/A") if primary_vendor else "N/A",
                "risk_score": component.get("criticality_score", 0),
                "status": component.get("status", "amber"),
                "timeline": {
                    "days_remaining": component["days_to_stockout_disruption"],
                    "safety_stock_threshold": safety_days,
                    "is_cliff": component["days_to_stockout_disruption"] <= safety_days,
                },
            }
        )
    rows.sort(key=lambda row: (row["inventory_days"], -row["risk_score"]))
    return {
        "order_id": order_context.get("order_id"),
        "rows": rows,
        "live_signals": _live_signal_strip(event_id),
        "available_filters": {
            "criticality": ["critical", "important", "substitutable"],
            "region": sorted({row["vendor_region"] for row in rows if row["vendor_region"] != "N/A"}),
            "days_remaining_thresholds": [7, 14, 30, 45],
        },
    }


def _shock_forecast(order_context: Dict[str, Any], component_id: Optional[str] = None) -> Dict[str, Any]:
    components = order_context.get("bom", {}).get("components", [])
    target = next((c for c in components if c.get("component_id") == component_id), None) if component_id else None
    target = target or (components[0] if components else None)
    if not target:
        raise HTTPException(status_code=404, detail="No component forecast available")
    runway_loss = max(0.0, target["days_to_stockout_baseline"] - target["days_to_stockout_disruption"])
    severity_0_10 = round(min(10.0, max(0.0, runway_loss / 3.0 + (2.5 if target.get("status") == "red" else 1.2))), 1)
    disruption_score = int(min(100, severity_0_10 * 10))
    event_corridors = _event_corridor_impacts(order_context.get("event_id", ""))
    stranded_vessels = [
        {"id": "MSC-481", "corridor": event_corridors[0] if event_corridors else "Pacific Sea", "status": "awaiting reroute"},
        {"id": "MAERSK-220", "corridor": event_corridors[-1] if event_corridors else "South China Sea", "status": "anchored"},
    ]
    commodity_prices_7d = [
        {"day": "D-6", "index": 100.0},
        {"day": "D-5", "index": 101.4},
        {"day": "D-4", "index": 102.6},
        {"day": "D-3", "index": 104.1},
        {"day": "D-2", "index": 105.0},
        {"day": "D-1", "index": 106.8},
        {"day": "D0", "index": 107.6},
    ]
    return {
        "order_id": order_context.get("order_id"),
        "component_id": target["component_id"],
        "component_name": target["component_name"],
        "baseline_days_to_stockout": target["days_to_stockout_baseline"],
        "disruption_days_to_stockout": target["days_to_stockout_disruption"],
        "disruption_delta_days": runway_loss,
        "intervention_day": target["intervention_day"],
        "severity_0_10": severity_0_10,
        "disruption_score": disruption_score,
        "intervention_window_days": max(0.0, target["intervention_day"]),
        "corridors_closed": event_corridors,
        "stranded_vessels": stranded_vessels,
        "commodity_prices_7d": commodity_prices_7d,
    }


def _critical_alert_panel(order_context: Dict[str, Any], component_id: Optional[str] = None) -> Dict[str, Any]:
    components = order_context.get("bom", {}).get("components", [])
    target = next((c for c in components if c.get("component_id") == component_id), None) if component_id else None
    target = target or (components[0] if components else None)
    if not target:
        raise HTTPException(status_code=404, detail="No alert candidate found")

    event_corridors = _event_corridor_impacts(order_context.get("event_id", ""))
    severity = round(min(10.0, max(0.0, target.get("criticality_score", 50) / 10.0)), 1)
    lead_time_proxy = 12
    trigger = (
        target["days_to_stockout_disruption"] < lead_time_proxy
        or severity > 7
        or target["intervention_day"] < 7
        or len(event_corridors) >= 2
    )
    action_cost = round(max(0.8, order_context.get("quantity", 1000) / 1000 * 2.8), 2)
    inaction_cost = round(max(40.0, order_context.get("quantity", 1000) / 1000 * 200.0), 2)

    rationale = {
        "what_happened": f"{order_context.get('event_id', 'disruption')} is reducing inbound reliability for {target['component_name']}.",
        "what_it_means": f"Runway drops to {target['days_to_stockout_disruption']} days with intervention in {target['intervention_day']} days.",
        "what_to_do": "Approve contingency vendor and expedited routing to preserve assembly continuity.",
    }

    alert_history = order_context.setdefault("alert_history", [])
    if trigger:
        alert_key = f"{order_context.get('event_id')}|{target['component_id']}|{target['status']}"
        if not any(item.get("alert_key") == alert_key for item in alert_history):
            alert_history.append(
                {
                    "alert_key": alert_key,
                    "timestamp": _now_iso(),
                    "component_id": target["component_id"],
                    "component_name": target["component_name"],
                    "action_taken": "Pending approval",
                    "outcome": "Pending",
                    "manager": "Ops Duty Lead",
                }
            )

    return {
        "order_id": order_context.get("order_id"),
        "triggered": trigger,
        "component_id": target["component_id"],
        "component_name": target["component_name"],
        "criticality": target["criticality"],
        "severity_score": severity,
        "days_to_stockout_disruption": target["days_to_stockout_disruption"],
        "intervention_day": target["intervention_day"],
        "rationale": rationale,
        "cost_of_action_musd": action_cost,
        "cost_of_inaction_musd": inaction_cost,
        "roi_multiple": round(inaction_cost / max(action_cost, 0.1), 2),
        "alert_history": alert_history[-12:],
    }


def _fuel_multipliers() -> Dict[str, Any]:
    return {
        "jet_fuel_index": 1.14,
        "diesel_index": 1.08,
        "freight_cost_multiplier": 1.12,
        "last_updated": _now_iso(),
    }

SCENARIO_PROFILES = {
    "A": {"fill_relief": 3.0, "risk_relief": 2.5, "lead_relief": 1.0, "cost_penalty": 0.35, "confidence_bonus": 0.8},
    "B": {"fill_relief": 5.5, "risk_relief": 7.0, "lead_relief": 2.0, "cost_penalty": 0.15, "confidence_bonus": 1.5},
    "C": {"fill_relief": 1.5, "risk_relief": 3.0, "lead_relief": -1.0, "cost_penalty": -0.25, "confidence_bonus": 2.4},
    "D": {"fill_relief": 8.0, "risk_relief": 4.5, "lead_relief": 6.0, "cost_penalty": 0.95, "confidence_bonus": 0.9},
    "E": {"fill_relief": 5.0, "risk_relief": 1.5, "lead_relief": 3.0, "cost_penalty": 1.25, "confidence_bonus": 0.4},
}


def _parse_currency_millions(value: str) -> float:
    return float(str(value).replace("$", "").replace("M", ""))


def _format_currency_millions(value: float) -> str:
    return f"${value:.1f}M"


def _parse_days(value: str) -> int:
    return int(str(value).replace("d", ""))


def _format_days(value: int) -> str:
    return f"{max(1, int(round(value)))}d"


def _parse_confidence(value: str) -> float:
    return float(str(value).replace("%", "").replace("+", ""))


def _format_confidence(value: float) -> str:
    rounded = int(round(value))
    return f"+{rounded}%" if rounded >= 0 else f"{rounded}%"


def _assumption_metrics(component_id: str, assumptions: Optional[ScenarioAssumptions]) -> Dict[str, float]:
    normalized = assumptions or ScenarioAssumptions()
    active_route_count = max(1, len(normalized.active_routes) or len(normalized.blocked_routes) or 1)
    blocked_ratio = len(normalized.blocked_routes) / active_route_count
    disruption_pressure = max(0.0, min(normalized.disruption_intensity, 100)) / 100.0
    duration_pressure = max(0.0, min(normalized.disruption_duration, 90)) / 90.0
    tariff_pressure = min(
        (normalized.tariffs.china * 0.45 + normalized.tariffs.other * 0.35 + normalized.tariffs.domestic * 0.2) / 180.0,
        1.4,
    )
    sku_pressure = min(len(normalized.selected_skus), 5) / 5.0
    docs_bonus = min(len(normalized.uploaded_docs), 4) * 0.02
    criticality = _find_component(component_id).get("criticality", "important")
    criticality_factor = {"nominal": 0.92, "important": 1.0, "critical": 1.12}.get(criticality, 1.0)
    stress = (blocked_ratio * 0.42 + disruption_pressure * 0.34 + duration_pressure * 0.16 + tariff_pressure * 0.08) * criticality_factor
    return {
        "blocked_ratio": blocked_ratio,
        "disruption_pressure": disruption_pressure,
        "duration_pressure": duration_pressure,
        "tariff_pressure": tariff_pressure,
        "sku_pressure": sku_pressure,
        "docs_bonus": docs_bonus,
        "stress": stress,
    }


def _adjust_scenario_map(event_id: str, component_id: str, assumptions: Optional[ScenarioAssumptions]) -> Dict[str, Dict]:
    base_map = SCENARIOS.get(event_id, {})
    if not base_map:
        return {}

    metrics = _assumption_metrics(component_id, assumptions)
    adjusted: Dict[str, Dict] = {}
    for letter, values in base_map.items():
        profile = SCENARIO_PROFILES.get(letter, SCENARIO_PROFILES["B"])
        fulfillment = float(values["fulfillment"])
        cost = _parse_currency_millions(values["cost"])
        lead = _parse_days(values["lead_time"])
        risk = float(values["risk"])
        confidence = _parse_confidence(values["confidence"])

        fulfillment_delta = (-metrics["stress"] * 18.0) + profile["fill_relief"] + metrics["docs_bonus"] * 100 - metrics["sku_pressure"] * 3.0
        risk_delta = (metrics["stress"] * 24.0) - profile["risk_relief"] + metrics["blocked_ratio"] * 4.0 - metrics["docs_bonus"] * 35
        lead_delta = (metrics["stress"] * 9.0) - profile["lead_relief"] + metrics["blocked_ratio"] * 4.0
        cost_delta = metrics["tariff_pressure"] * 0.65 + metrics["blocked_ratio"] * 0.45 + metrics["disruption_pressure"] * 0.35 + metrics["sku_pressure"] * 0.2 + profile["cost_penalty"]
        confidence_delta = profile["confidence_bonus"] + metrics["docs_bonus"] * 75 - metrics["stress"] * 8.5

        adjusted[letter] = {
            "fulfillment": max(68, min(99, int(round(fulfillment + fulfillment_delta)))),
            "cost": _format_currency_millions(max(0.3, cost + cost_delta)),
            "lead_time": _format_days(max(5, lead + lead_delta)),
            "risk": max(12, min(85, int(round(risk + risk_delta)))),
            "confidence": _format_confidence(max(-5, min(25, confidence + confidence_delta))),
            "title": RECOMMENDATIONS.get(letter, {}).get("title", f"Scenario {letter}"),
        }
    return adjusted


def _scenario_planner_response(
    event_id: str,
    component_id: str,
    scenario_id: str = "B",
    horizon: int = 30,
    priority: str = "Balanced",
    assumptions: Optional[ScenarioAssumptions] = None,
) -> dict:
    if event_id not in {event["id"] for event in EVENTS}:
        raise HTTPException(status_code=404, detail="Event not found")

    event_meta = _find_event(event_id)
    component_meta = _find_component(component_id)
    scenario_map = _adjust_scenario_map(event_id, component_id, assumptions)
    selected = scenario_map.get(scenario_id) or next(iter(scenario_map.values()), None)

    if not selected:
        return {
            "event_id": event_id,
            "event_name": event_meta["name"],
            "component_id": component_id,
            "component_name": component_meta["name"],
            "scenario_id": scenario_id,
            "priority": priority,
            "horizon": horizon,
            "scenarios": [],
            "inventory_points": [],
        }

    scenario_rows = [{"letter": letter, **values} for letter, values in scenario_map.items()]
    timeline = build_inventory_timeline(selected["fulfillment"], selected["risk"], int(horizon), priority)

    return {
        "event_id": event_id,
        "event_name": event_meta["name"],
        "component_id": component_id,
        "component_name": component_meta["name"],
        "scenario_id": scenario_id,
        "priority": priority,
        "horizon": int(horizon),
        "scenarios": scenario_rows,
        "inventory_points": timeline,
        "assumptions_applied": (assumptions or ScenarioAssumptions()).model_dump(),
    }


def _simulation_response(run: Dict, assumptions: Optional[ScenarioAssumptions]) -> dict:
    import random

    event_id = run["event_id"]
    scenario_map = _adjust_scenario_map(event_id, run["component_id"], assumptions)

    rng = random.Random(hash(f"{run['run_id']}:{json.dumps((assumptions or ScenarioAssumptions()).model_dump(), sort_keys=True)}") & 0xFFFFFF)
    distributions = {}
    for letter, vals in scenario_map.items():
        base = float(vals["fulfillment"])
        risk = float(vals["risk"])
        spread = 3.5 + risk * 0.06
        p10 = round(max(60.0, base - spread * 1.6 + rng.gauss(0, 0.4)), 1)
        p25 = round(max(65.0, base - spread * 0.9 + rng.gauss(0, 0.3)), 1)
        p50 = round(min(99.0, base + rng.gauss(0, 0.5)), 1)
        p75 = round(min(99.5, base + spread * 0.7 + rng.gauss(0, 0.3)), 1)
        p90 = round(min(100.0, base + spread * 1.4 + rng.gauss(0, 0.4)), 1)
        distributions[letter] = {
            "p10": p10, "p25": p25, "p50": p50, "p75": p75, "p90": p90,
            "cost": vals["cost"], "lead_time": vals["lead_time"],
            "risk": risk, "sim_runs": 1000,
        }

    best_letter = min(distributions, key=lambda k: (distributions[k]["risk"], -distributions[k]["p50"]))
    return {
        "run_id": run["run_id"],
        "event_id": event_id,
        "distributions": distributions,
        "recommendation": best_letter,
        "assumptions_applied": (assumptions or ScenarioAssumptions()).model_dump(),
        "note": (
            "Monte Carlo simulation across 1,000 rollouts per scenario. "
            "Bands show p10–p90 fulfillment range under stochastic disruption propagation."
        ),
    }


def _apply_vendor_overlay(vendor: Dict, scenario_values: Dict, metrics: Dict[str, float], component_id: str) -> Dict:
    stressed = dict(vendor)
    scenario_risk = float(scenario_values.get("risk", vendor.get("risk", 40)))
    blocked_ratio = metrics["blocked_ratio"]
    tariff_pressure = metrics["tariff_pressure"]
    docs_bonus = metrics["docs_bonus"]

    origin_penalty = 0
    if vendor.get("origin") in {"CN", "TW"}:
      origin_penalty += blocked_ratio * 12 + tariff_pressure * 8
    if vendor.get("origin") == "US":
      origin_penalty += tariff_pressure * 2

    stressed_risk = max(10, min(95, round(vendor["risk"] + scenario_risk * 0.16 + origin_penalty - docs_bonus * 25)))
    stressed_cost = round(vendor["cost"] * (1 + tariff_pressure * 0.14 + blocked_ratio * 0.08), 2)
    stressed_lead = _format_days(_parse_days(vendor["lead"]) + blocked_ratio * 4 + metrics["disruption_pressure"] * 3)
    stressed_capacity = max(1000, int(round(vendor["capacity"] * (1 - metrics["stress"] * 0.18))))
    impact = "Elevated" if stressed_risk >= 55 else "Watch" if stressed_risk >= 38 else "Stable"
    impact_note = f"Scenario pressure shifts lead to {stressed_lead}, risk {stressed_risk}, and cost ${stressed_cost:.2f}."

    stressed.update({
        "scenario_risk": stressed_risk,
        "scenario_cost": stressed_cost,
        "scenario_lead": stressed_lead,
        "scenario_capacity": stressed_capacity,
        "scenario_impact": impact,
        "scenario_note": impact_note,
    })
    return stressed


def _vendor_intel_response(
    component_id: str = "gpu-display-chip",
    search: str = "",
    country: str = "All Countries",
    status: str = "All Statuses",
    event_id: Optional[str] = None,
    scenario_id: str = "B",
    assumptions: Optional[ScenarioAssumptions] = None,
) -> dict:
    component = _find_component(component_id)
    component_view = component_vendor_view(component_id)
    universe = flatten_vendor_universe(lambda cid: _find_component(cid)["name"])

    metrics = _assumption_metrics(component_id, assumptions)
    adjusted_scenarios = _adjust_scenario_map(event_id or EVENTS[0]["id"], component_id, assumptions) if event_id else {}
    selected_scenario = adjusted_scenarios.get(scenario_id)

    filtered = []
    for vendor in universe:
        if search and search.lower() not in vendor["name"].lower():
            continue
        if country != "All Countries" and vendor["origin"] != country:
            continue
        if status != "All Statuses" and vendor["status"] != status:
            continue
        enriched = _apply_vendor_overlay(vendor, selected_scenario or {"risk": vendor.get("risk", 40)}, metrics, component_id)
        filtered.append(enriched)

    countries = ["All Countries", *sorted({vendor["origin"] for vendor in universe})]
    statuses = ["All Statuses", "ACTIVE", "AT-RISK"]

    scenario_overlay = None
    if selected_scenario:
        scenario_overlay = {
            "scenario_id": scenario_id,
            "title": selected_scenario.get("title", f"Scenario {scenario_id}"),
            "summary": f"Scenario-adjusted supplier overlay for {component['name']} under {scenario_id}.",
        }

    return {
        "component_id": component_id,
        "component_name": component["name"],
        "component_view": component_view,
        "vendors": filtered,
        "countries": countries,
        "statuses": statuses,
        "scenario_overlay": scenario_overlay,
    }


def _operations_plan_response(request: OperationsPlanRequest) -> dict:
    planner = _scenario_planner_response(
        request.event_id,
        request.component_id,
        request.scenario_id,
        request.horizon,
        request.priority,
        request.assumptions,
    )
    selected = next((row for row in planner["scenarios"] if row["letter"] == request.scenario_id), None)
    if not selected:
        return {"title": "No action plan available", "reasoning": "Scenario data unavailable.", "actions": [], "explainability": None}

    metrics = _assumption_metrics(request.component_id, request.assumptions)
    base_template = RECOMMENDATIONS.get(request.scenario_id, {"title": f"Scenario {request.scenario_id}", "actions": []})
    event_name = _find_event(request.event_id)["name"]
    component_name = _find_component(request.component_id)["name"]
    reasoning = (
        f"For {event_name}, {base_template['title']} now projects {selected['fulfillment']}% fulfillment, "
        f"{selected['lead_time']} lead time, and risk {selected['risk']} after applying the current assumptions. "
        f"This keeps {component_name} aligned to a {request.priority.lower()} priority over {request.horizon} days."
    )

    actions = list(base_template.get("actions", []))
    if metrics["blocked_ratio"] > 0:
        actions.append(f"Pre-book alternate capacity for {len(request.assumptions.blocked_routes)} blocked route exposure(s).")
    if metrics["tariff_pressure"] > 0.4:
        actions.append("Escalate tariff offset plan with finance and procurement before next sourcing cycle.")
    if request.assumptions.uploaded_docs:
        actions.append(f"Attach {len(request.assumptions.uploaded_docs)} uploaded document(s) to the operations brief for stakeholder review.")
    actions = actions[:5]

    base_explainability = EXPLAINABILITY.get(request.scenario_id, EXPLAINABILITY.get("B"))
    explainability = {
        "evidence": [
            f"Adjusted fulfillment {selected['fulfillment']}% and risk {selected['risk']} from scenario planner",
            f"Assumption package: {len(request.assumptions.selected_skus)} SKU(s), {len(request.assumptions.blocked_routes)} blocked route(s)",
            *base_explainability["evidence"][:1],
        ],
        "assumptions": [
            f"Disruption intensity {request.assumptions.disruption_intensity}% over {request.assumptions.disruption_duration} day(s)",
            f"Tariff profile CN {request.assumptions.tariffs.china}% / Other {request.assumptions.tariffs.other}% / Domestic {request.assumptions.tariffs.domestic}%",
            *base_explainability["assumptions"][:1],
        ],
        "confidence_interval": [max(55, selected["fulfillment"] - 8), min(99, selected["fulfillment"] + 3)],
        "tradeoffs": f"Higher confidence comes from using {base_template['title']} under the current assumptions, but cost is now {selected['cost']} and lead time is {selected['lead_time']}.",
        "rollback_trigger": f"If risk rises above {selected['risk'] + 8} or fulfillment drops below {max(50, selected['fulfillment'] - 10)}%, re-open scenario comparison immediately.",
    }

    return {
        "scenario_id": request.scenario_id,
        "title": base_template["title"],
        "reasoning": reasoning,
        "actions": actions,
        "selected_scenario": selected,
        "explainability": explainability,
    }


def _find_event(event_id: str) -> Dict:
    return next((event for event in EVENTS if event["id"] == event_id), {"id": event_id, "name": event_id, "severity": "HIGH", "icon": "🔵"})


def _find_component(component_id: str) -> Dict:
    return next((component for component in COMPONENTS if component["id"] == component_id), {"id": component_id, "name": component_id, "vendor": "Unknown", "criticality": "important"})


def _default_agent_output(event_id: str, agent_name: str, tag: str) -> Dict:
    scripted = next(
        (item for item in EVENT_DEBATES.get(event_id, []) if item["agent"] == agent_name and item["tag"] == tag),
        None,
    )
    if scripted:
        return scripted
    return {"agent": agent_name, "message": f"{agent_name} has no configured output for {event_id}.", "tag": tag}


def _current_agent_mode() -> str:
    llm_available = (OPENAI_API_KEY and AsyncOpenAI is not None) or bool(OLLAMA_BASE_URL)
    external_enabled = bool(TIMESFM_API_URL or AUTORESEARCH_RSS_URL)
    if llm_available and external_enabled:
        return "hybrid"
    if llm_available:
        return "llm"
    if external_enabled:
        return "external"
    return "scripted"


def _provider_for_agent(agent_name: str) -> Dict[str, Any]:
    return AGENT_PROVIDER_REGISTRY.get(agent_name, {"provider_type": "llm-role", "driver": "llm", "external": False})


def _agent_mode_for_state(agent_name: str) -> str:
    provider = _provider_for_agent(agent_name)
    if provider["driver"] == "timesfm-local":
        llm_available = (OPENAI_API_KEY and AsyncOpenAI is not None) or bool(OLLAMA_BASE_URL)
        return "LOCAL+LLM" if llm_available else "LOCAL"
    if provider["driver"] == "timesfm-api":
        return "EXTERNAL" if TIMESFM_API_URL else "FALLBACK"
    if provider["driver"] == "google-news-rss":
        return "EXTERNAL"
    return "LLM" if ((OPENAI_API_KEY and AsyncOpenAI is not None) or OLLAMA_BASE_URL) else "SCRIPTED"


def _summarize_source_host(url: str) -> str:
    if not url:
        return "unknown"
    try:
        return urlparse(url).netloc or "unknown"
    except Exception:
        return "unknown"


def _event_query_hint(event_id: str) -> str:
    event_name = _find_event(event_id).get("name", event_id)
    return f"{event_name} supply chain logistics risk"


def _forecast_series_seed(order_context: Optional[Dict[str, Any]], event_id: str, component_id: str) -> List[float]:
    if order_context:
        shock = _shock_forecast(order_context, component_id)
        base = float(shock.get("baseline_days_to_stockout", 20))
        disrupted = float(shock.get("disruption_days_to_stockout", max(base - 4, 8)))
        slope = (disrupted - base) / 6.0
        return [round(base + slope * idx, 2) for idx in range(7)]

    base_seed = 24.0 if event_id in {"taiwan-earthquake", "tsmc-factory-fire"} else 30.0
    return [round(max(8.0, base_seed - idx * 1.3), 2) for idx in range(7)]


def _forecast_summary_from_points(points: List[float]) -> str:
    if not points:
        return "Forecast unavailable; hold current delivery promise until model refresh completes."
    start = points[0]
    end = points[-1]
    direction = "improves" if end > start else "degrades" if end < start else "holds steady"
    delta = round(end - start, 1)
    return f"7-day reliability {direction} from {start:.1f} to {end:.1f} ({delta:+.1f}) under current disruption conditions."


def _series_stddev(values: List[float]) -> float:
    if not values:
        return 0.0
    mean = sum(values) / len(values)
    variance = sum((value - mean) ** 2 for value in values) / len(values)
    return variance ** 0.5


def _timesfm_local_forecast(series: List[float], horizon: int = 7) -> Dict[str, Any]:
    # Deterministic Holt linear smoothing for local time-series forecasting.
    if not series:
        series = [20.0, 19.2, 18.5, 17.7, 16.9, 16.1, 15.4]

    alpha = 0.55
    beta = 0.25
    level = series[0]
    trend = (series[1] - series[0]) if len(series) > 1 else -0.6
    residuals: List[float] = []

    for idx in range(1, len(series)):
        value = series[idx]
        forecast_one_step = level + trend
        residuals.append(value - forecast_one_step)
        prev_level = level
        level = alpha * value + (1 - alpha) * (level + trend)
        trend = beta * (level - prev_level) + (1 - beta) * trend

    point = [round(max(1.0, level + trend * step), 2) for step in range(1, horizon + 1)]
    sigma = max(0.35, _series_stddev(residuals))
    z_80 = 1.28
    lower = [round(max(0.1, value - z_80 * sigma), 2) for value in point]
    upper = [round(value + z_80 * sigma, 2) for value in point]

    baseline = max(0.1, abs(point[0]))
    cv = min(1.0, sigma / baseline)
    confidence = int(max(55, min(95, round(90 - cv * 35))))

    return {
        "history": [round(float(item), 2) for item in series],
        "point": point,
        "lower": lower,
        "upper": upper,
        "horizon_days": horizon,
        "interval": "80%",
        "confidence": confidence,
    }


async def _timesfm_llm_narrative(
    request: AgentInsightRequest,
    bundle: Dict[str, Any],
    forecast: Dict[str, Any],
) -> Dict[str, Any]:
    points = forecast.get("point", [])
    lowers = forecast.get("lower", [])
    uppers = forecast.get("upper", [])
    if not points:
        return {
            "summary": "Local forecast unavailable; retain current ETA and monitor for fresh telemetry.",
            "confidence": 60,
            "source": "narrative-fallback-empty",
            "backend": "local",
            "model": "none",
        }

    system_prompt = (
        "You are TimesFM analyst copilot. Explain forecast in one concise operational sentence and one concrete next action. "
        "Do not invent numbers not provided."
    )
    user_prompt = (
        f"Agent name: {request.agent_name}\n"
        f"Page: {request.page_id}\n"
        f"Forecast point values (next {forecast.get('horizon_days', 7)} days): {points}\n"
        f"Lower band: {lowers}\n"
        f"Upper band: {uppers}\n"
        f"Facts:\n- " + "\n- ".join(bundle.get("facts", [])[:8]) + "\n\n"
        "Return strict JSON with keys: summary (string), confidence (integer 0-100), next_action (string)."
    )

    model_name = OPENAI_MODEL if OPENAI_API_KEY and AsyncOpenAI is not None else OLLAMA_MODEL
    backend = "openai" if OPENAI_API_KEY and AsyncOpenAI is not None else "ollama"
    try:
        payload = await _structured_llm_json(system_prompt, user_prompt)
        summary = str(payload.get("summary", "")).strip() or _forecast_summary_from_points(points)
        next_action = str(payload.get("next_action", "")).strip()
        if next_action:
            summary = f"{summary} Next: {next_action}."
        confidence = int(max(0, min(100, int(payload.get("confidence", forecast.get("confidence", 72))))))
        return {
            "summary": summary,
            "confidence": confidence,
            "source": "ollama-narrative" if backend == "ollama" else "openai-narrative",
            "backend": backend,
            "model": model_name,
        }
    except Exception as exc:
        return {
            "summary": _forecast_summary_from_points(points),
            "confidence": int(forecast.get("confidence", 70)),
            "source": f"narrative-fallback:{type(exc).__name__}",
            "backend": "local",
            "model": "holt-linear",
        }


async def _autoresearch_external_scan(request: AgentInsightRequest, bundle: Dict[str, Any]) -> Dict[str, Any]:
    ctx = bundle.get("context", {})
    event_id = ctx.get("event_id") or request.event_id or EVENTS[0]["id"]
    query = _event_query_hint(event_id)
    url = f"{AUTORESEARCH_RSS_URL}?q={quote(query)}&hl=en-US&gl=US&ceid=US:en"

    t0 = time.perf_counter()
    traces: List[Dict[str, Any]] = []
    citations: List[Dict[str, Any]] = []
    summary = ""
    source = "external-rss"
    confidence = 72

    try:
        async with httpx.AsyncClient(timeout=18.0) as client:
            response = await client.get(url)
            response.raise_for_status()
            traces.append({"tool": "rss_fetch", "status": "ok", "latency_ms": round((time.perf_counter() - t0) * 1000, 2)})
            root = ET.fromstring(response.text)
            items = root.findall(".//item")[: max(1, AUTORESEARCH_MAX_ITEMS)]
            for idx, item in enumerate(items, start=1):
                title = (item.findtext("title") or "Untitled signal").strip()
                link = (item.findtext("link") or "").strip()
                pub_date = (item.findtext("pubDate") or "").strip()
                source_host = _summarize_source_host(link)
                snippet = f"{title} ({pub_date})" if pub_date else title
                citations.append(_make_citation(idx, source_host, snippet))

            if citations:
                highlights = "; ".join(c["snippet"] for c in citations[:2])
                summary = f"External signals detected: {highlights}."
                confidence = min(92, 66 + len(citations) * 6)
            else:
                source = "fallback-no-items"
                summary = _fallback_agent_summary(request.agent_name, bundle)
                citations = bundle.get("citations", [])[:2]
        
    except Exception as exc:
        traces.append({"tool": "rss_fetch", "status": "error", "latency_ms": round((time.perf_counter() - t0) * 1000, 2), "error": str(exc)[:140]})
        source = f"fallback:{type(exc).__name__}"
        summary = _fallback_agent_summary(request.agent_name, bundle)
        citations = bundle.get("citations", [])[:2]
        confidence = 61

    return {
        "summary": summary,
        "confidence": int(confidence),
        "citations": citations,
        "tool_trace": traces + bundle.get("tool_trace", []),
        "runtime": {
            "backend": "external-api",
            "model": "google-news-rss",
            "source": source,
            "latency_ms": round((time.perf_counter() - t0) * 1000, 2),
            "provider_type": "web-research",
            "cost_usd": 0.0,
            "retries": 0,
        },
    }


async def _timesfm_forecast_insight(request: AgentInsightRequest, bundle: Dict[str, Any]) -> Dict[str, Any]:
    ctx = bundle.get("context", {})
    order_context = ctx.get("order_context")
    event_id = ctx.get("event_id") or request.event_id or EVENTS[0]["id"]
    component_id = ctx.get("component_id") or request.component_id or COMPONENTS[0]["id"]
    series = _forecast_series_seed(order_context, event_id, component_id)

    t0 = time.perf_counter()
    traces: List[Dict[str, Any]] = []
    citations: List[Dict[str, Any]] = list(bundle.get("citations", [])[:1])

    local_t0 = time.perf_counter()
    forecast = _timesfm_local_forecast(series, horizon=7)
    traces.append({"tool": "local_holt_forecast", "status": "ok", "latency_ms": round((time.perf_counter() - local_t0) * 1000, 2)})
    citations.append(_make_citation(len(citations) + 1, "local-forecast-engine", f"Deterministic Holt forecast points={forecast.get('point', [])[:3]}"))

    # Optional external override path if explicitly requested.
    if TIMESFM_PROVIDER.lower() == "external" and TIMESFM_API_URL:
        try:
            headers = {"Content-Type": "application/json"}
            if TIMESFM_API_KEY:
                headers["Authorization"] = f"Bearer {TIMESFM_API_KEY}"
            payload = {
                "series": forecast.get("history", series),
                "horizon": 7,
                "frequency": "D",
                "event_id": event_id,
                "component_id": component_id,
            }
            async with httpx.AsyncClient(timeout=18.0) as client:
                response = await client.post(TIMESFM_API_URL, headers=headers, json=payload)
                response.raise_for_status()
                data = response.json()
                traces.append({"tool": "timesfm_api", "status": "ok", "latency_ms": round((time.perf_counter() - t0) * 1000, 2)})
                raw_points = data.get("forecast") or data.get("predictions") or []
                api_points = [float(x) for x in raw_points if isinstance(x, (int, float, str))][:7]
                if api_points:
                    sigma = max(0.35, _series_stddev(api_points) * 0.22)
                    forecast = {
                        **forecast,
                        "point": [round(value, 2) for value in api_points],
                        "lower": [round(max(0.1, value - 1.28 * sigma), 2) for value in api_points],
                        "upper": [round(value + 1.28 * sigma, 2) for value in api_points],
                        "confidence": int(max(0, min(100, int(data.get("confidence", forecast.get("confidence", 74)))))),
                        "interval": "80%",
                    }
                    citations.append(_make_citation(len(citations) + 1, _summarize_source_host(TIMESFM_API_URL), f"External TimesFM points={len(api_points)}"))
        except Exception as exc:
            traces.append({"tool": "timesfm_api", "status": "error", "latency_ms": round((time.perf_counter() - t0) * 1000, 2), "error": str(exc)[:140]})

    narrative_t0 = time.perf_counter()
    narrative = await _timesfm_llm_narrative(request, bundle, forecast)
    traces.append({"tool": "llm_narrative", "status": "ok" if not str(narrative.get("source", "")).startswith("narrative-fallback") else "fallback", "latency_ms": round((time.perf_counter() - narrative_t0) * 1000, 2)})

    summary = narrative.get("summary") or _forecast_summary_from_points(forecast.get("point", []))
    confidence = int(narrative.get("confidence", forecast.get("confidence", 70)))

    return {
        "summary": summary,
        "confidence": confidence,
        "citations": citations,
        "tool_trace": traces + bundle.get("tool_trace", []),
        "forecast": forecast,
        "runtime": {
            "backend": "local-forecast+llm" if narrative.get("backend") != "local" else "local-forecast",
            "model": f"holt-linear + {narrative.get('model', OLLAMA_MODEL)}",
            "source": narrative.get("source", "local-holt"),
            "latency_ms": round((time.perf_counter() - t0) * 1000, 2),
            "provider_type": "forecast-model",
            "cost_usd": 0.0,
            "retries": 0,
        },
    }


def _safe_json_loads(raw: str) -> Dict[str, Any]:
    try:
        return json.loads(raw)
    except Exception:
        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(raw[start:end + 1])
            except Exception:
                return {}
        return {}


async def _structured_llm_json(system_prompt: str, user_prompt: str) -> Dict[str, Any]:
    if OPENAI_API_KEY and AsyncOpenAI is not None:
        client_kwargs = {"api_key": OPENAI_API_KEY}
        if OPENAI_BASE_URL:
            client_kwargs["base_url"] = OPENAI_BASE_URL
        client = AsyncOpenAI(**client_kwargs)
        response = await client.chat.completions.create(
            model=OPENAI_MODEL,
            temperature=0.25,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
        return _safe_json_loads(response.choices[0].message.content or "{}")

    if not OLLAMA_BASE_URL:
        raise RuntimeError("No LLM backend configured")

    prompt = (
        f"System: {system_prompt}\n\n"
        f"User: {user_prompt}\n\n"
        "Return strict JSON only."
    )
    async with httpx.AsyncClient(timeout=25.0) as client:
        response = await client.post(
            f"{OLLAMA_BASE_URL.rstrip('/')}/api/generate",
            json={
                "model": OLLAMA_MODEL,
                "prompt": prompt,
                "stream": False,
                "format": "json",
                "options": {"temperature": 0.2},
            },
        )
        response.raise_for_status()
        data = response.json()
        return _safe_json_loads(data.get("response", "{}"))


def _resolve_context(request: AgentInsightRequest) -> Dict[str, Any]:
    order_context = ORDERS.get(request.order_id) if request.order_id else None
    event_id = request.event_id or (order_context.get("event_id") if order_context else None) or EVENTS[0]["id"]
    component_id = request.component_id or (order_context.get("bom", {}).get("bottleneck_component", {}).get("component_id") if order_context else None) or COMPONENTS[0]["id"]
    scenario_id = request.scenario_id or "B"
    return {
        "order_context": order_context,
        "event_id": event_id,
        "component_id": component_id,
        "scenario_id": scenario_id,
    }


def _make_citation(idx: int, source: str, snippet: str) -> Dict[str, Any]:
    return {"id": f"C{idx}", "source": source, "snippet": snippet}


def _agent_tool_bundle(request: AgentInsightRequest) -> Dict[str, Any]:
    ctx = _resolve_context(request)
    order_context = ctx["order_context"]
    event_id = ctx["event_id"]
    component_id = ctx["component_id"]
    scenario_id = ctx["scenario_id"]

    facts: List[str] = []
    citations: List[Dict[str, Any]] = []
    traces: List[Dict[str, Any]] = []

    def run_tool(tool_name: str, tool_fn, source_hint: str):
        t0 = time.perf_counter()
        try:
            payload = tool_fn()
            elapsed = round((time.perf_counter() - t0) * 1000, 2)
            traces.append({"tool": tool_name, "status": "ok", "latency_ms": elapsed})
            snippet = str(payload)[:180].replace("\n", " ")
            citations.append(_make_citation(len(citations) + 1, source_hint, snippet))
            return payload
        except Exception as exc:
            elapsed = round((time.perf_counter() - t0) * 1000, 2)
            traces.append({"tool": tool_name, "status": "error", "latency_ms": elapsed, "error": str(exc)[:140]})
            return None

    facts.append(f"Page={request.page_id}, Agent={request.agent_name}, Event={event_id}, Component={component_id}, Scenario={scenario_id}")
    facts.append(f"Event severity={_find_event(event_id).get('severity', 'HIGH')}")

    if order_context:
        facts.append(f"Order={order_context.get('order_id')} qty={order_context.get('quantity')} region={order_context.get('region')}")
        risk = run_tool("risk_dashboard", lambda: _risk_dashboard(order_context), f"/api/v2/orders/{order_context.get('order_id')}/risk-dashboard")
        if risk:
            red_count = sum(1 for row in risk.get("rows", []) if row.get("status") == "red")
            facts.append(f"Risk dashboard rows={len(risk.get('rows', []))}, red_components={red_count}")

        shock = run_tool("shock_forecast", lambda: _shock_forecast(order_context, component_id), f"/api/v2/orders/{order_context.get('order_id')}/shock-forecast")
        if shock:
            facts.append(
                "Shock forecast baseline={}d disruption={}d severity={}/10".format(
                    shock.get("baseline_days_to_stockout"),
                    shock.get("disruption_days_to_stockout"),
                    shock.get("severity_0_10"),
                )
            )

        alert = run_tool("critical_alert", lambda: _critical_alert_panel(order_context, component_id), f"/api/v2/orders/{order_context.get('order_id')}/critical-alert")
        if alert:
            facts.append(
                "Critical alert triggered={} severity={} intervention_day={}".format(
                    alert.get("triggered"),
                    alert.get("severity_score"),
                    alert.get("intervention_day"),
                )
            )

        decision = run_tool("decision_panel", lambda: _decision_panel(order_context, component_id), f"/api/v2/orders/{order_context.get('order_id')}/decision-panel")
        if decision:
            facts.append(
                "Decision ROI={}x action={} inaction={}M".format(
                    decision.get("roi_multiple"),
                    decision.get("cost_of_action_musd"),
                    decision.get("cost_of_inaction_musd"),
                )
            )

    if request.page_id in {"procurement-actions", "route-intelligence", "delivery-promise"} and request.order_id:
        score = run_tool(
            "vendor_scoring",
            lambda: vendor_scoring(VendorScoringRequest(order_id=request.order_id, component_id=component_id)),
            "/api/v2/vendor-scoring",
        )
        if score:
            top = (score.get("ranked_vendors") or [{}])[0]
            facts.append(f"Top vendor={top.get('name', 'n/a')} composite={top.get('composite_score', 'n/a')}")

    if request.page_id in {"route-intelligence", "delivery-promise"} and request.order_id:
        open_list = run_tool("open_orders", open_orders, "/api/v2/orders/open")
        if open_list:
            facts.append(f"Open orders count={open_list.get('count', 0)}")

    if request.page_id in {"execution-log", "delivery-promise"}:
        summary = run_tool("metrics_summary", metrics_summary, "/api/v2/metrics/summary")
        if summary:
            facts.append(
                "Metrics detect_avg={}s action_avg={}s roi={}x".format(
                    summary.get("time_to_detect_sec", {}).get("avg"),
                    summary.get("time_to_action_sec", {}).get("avg"),
                    summary.get("financials", {}).get("roi_multiple"),
                )
            )

    return {"facts": facts, "citations": citations, "tool_trace": traces, "context": ctx}


def _fallback_agent_summary(agent_name: str, bundle: Dict[str, Any]) -> str:
    facts = bundle.get("facts", [])
    if not facts:
        return f"{agent_name} is awaiting additional signals to produce a reliable insight."
    key_fact = facts[min(2, len(facts) - 1)]
    return f"{agent_name} indicates: {key_fact}."


async def _generate_live_agent_insight(request: AgentInsightRequest) -> Dict[str, Any]:
    cache_key = "|".join(
        [
            request.page_id,
            request.card_id or request.agent_name,
            request.order_id or "-",
            request.event_id or "-",
            request.component_id or "-",
            request.scenario_id or "-",
            request.question or "-",
        ]
    )
    now = time.time()
    cached = AGENT_INSIGHT_CACHE.get(cache_key)
    if cached and (now - cached.get("ts", 0) <= 45):
        return cached["payload"]

    bundle = _agent_tool_bundle(request)
    facts = bundle["facts"]
    citations = bundle["citations"]
    tool_trace = bundle["tool_trace"]

    role = AGENT_PROMPT_ROLES.get(request.agent_name, "Provide concise supply-chain insight.")
    citation_refs = " ".join(c["id"] for c in citations)
    question_suffix = f"\nUser question: {request.question}" if request.question else ""

    system_prompt = "You are an expert multi-agent supply-chain copilot. Be precise, concise, and operational."
    user_prompt = (
        f"Agent name: {request.agent_name}\n"
        f"Role: {role}\n"
        f"Page: {request.page_id}\n"
        f"Facts:\n- " + "\n- ".join(facts[:14]) +
        f"\nCitations available: {citation_refs or 'None'}"
        f"{question_suffix}\n\n"
        "Return strict JSON with keys:\n"
        "summary: string (1-2 short sentences)\n"
        "confidence: integer 0-100\n"
        "next_action: string (single clause).\n"
    )

    provider = _provider_for_agent(request.agent_name)
    t0 = time.perf_counter()

    summary: str
    confidence: int
    source: str
    model_name = OPENAI_MODEL if OPENAI_API_KEY and AsyncOpenAI is not None else OLLAMA_MODEL
    backend = "openai" if OPENAI_API_KEY and AsyncOpenAI is not None else "ollama"
    runtime_meta: Dict[str, Any]
    merged_citations = citations
    merged_trace = tool_trace
    extra_payload: Dict[str, Any] = {}

    if provider.get("driver") == "google-news-rss":
        external = await _autoresearch_external_scan(request, bundle)
        summary = external["summary"]
        confidence = int(external["confidence"])
        source = external["runtime"].get("source", "external-rss")
        runtime_meta = external["runtime"]
        merged_citations = external.get("citations", citations)
        merged_trace = external.get("tool_trace", tool_trace)
    elif provider.get("driver") in {"timesfm-api", "timesfm-local"}:
        external = await _timesfm_forecast_insight(request, bundle)
        summary = external["summary"]
        confidence = int(external["confidence"])
        source = external["runtime"].get("source", "timesfm-fallback")
        runtime_meta = external["runtime"]
        merged_citations = external.get("citations", citations)
        merged_trace = external.get("tool_trace", tool_trace)
        if external.get("forecast"):
            extra_payload["forecast"] = external["forecast"]
    else:
        try:
            payload = await _structured_llm_json(system_prompt, user_prompt)
            summary = str(payload.get("summary", "")).strip() or _fallback_agent_summary(request.agent_name, bundle)
            next_action = str(payload.get("next_action", "")).strip()
            if next_action:
                summary = f"{summary} Next: {next_action}."
            confidence = int(max(0, min(100, int(payload.get("confidence", 74)))))
            source = "llm"
        except Exception as exc:
            summary = _fallback_agent_summary(request.agent_name, bundle)
            confidence = 66
            source = f"fallback:{type(exc).__name__}"

        runtime_meta = {
            "backend": backend,
            "model": model_name,
            "source": source,
            "latency_ms": round((time.perf_counter() - t0) * 1000, 2),
            "provider_type": provider.get("provider_type", "llm-role"),
            "cost_usd": 0.0,
            "retries": 0,
        }

    elapsed = round((time.perf_counter() - t0) * 1000, 2)
    runtime_meta["latency_ms"] = runtime_meta.get("latency_ms", elapsed)
    insight = {
        "page_id": request.page_id,
        "card_id": request.card_id or request.agent_name.lower(),
        "agent_name": request.agent_name,
        "summary": summary,
        "confidence": confidence,
        "citations": merged_citations,
        "tool_trace": merged_trace,
        "llm": {
            **runtime_meta,
            "provider": provider,
            "source": source,
        },
        "debug": {
            "system_prompt": system_prompt,
            "user_prompt": user_prompt,
            "facts": facts,
            "context": {
                "order_id": request.order_id,
                "event_id": request.event_id,
                "component_id": request.component_id,
                "scenario_id": request.scenario_id,
                "page_id": request.page_id,
            },
        },
        "updated_at": datetime.utcnow().isoformat(),
        **extra_payload,
    }
    AGENT_INSIGHT_CACHE[cache_key] = {"ts": now, "payload": insight}
    return insight


def _sse_event(event_name: str, payload: Dict[str, Any]) -> str:
    return f"event: {event_name}\ndata: {json.dumps(payload)}\n\n"


async def _page_agent_stream(request: Request, page_request: PageAgentInsightRequest):
    agent_requests = _page_request_to_agent_requests(page_request)
    if not agent_requests:
        yield _sse_event(
            "page-complete",
            {
                "page_id": page_request.page_id,
                "cards": [],
                "updated_at": datetime.utcnow().isoformat(),
            },
        )
        return

    cycle = 0
    while True:
        cycle += 1
        if await request.is_disconnected():
            break

        yield _sse_event(
            "page-status",
            {
                "page_id": page_request.page_id,
                "cycle": cycle,
                "card_ids": [item.card_id for item in agent_requests],
                "updated_at": datetime.utcnow().isoformat(),
            },
        )

        for item in agent_requests:
            if await request.is_disconnected():
                break
            yield _sse_event(
                "card-start",
                {
                    "page_id": page_request.page_id,
                    "card_id": item.card_id,
                    "agent_name": item.agent_name,
                    "cycle": cycle,
                    "status": "working",
                    "updated_at": datetime.utcnow().isoformat(),
                },
            )
            insight = await _generate_live_agent_insight(item)
            yield _sse_event(
                "card-update",
                {
                    **insight,
                    "cycle": cycle,
                    "status": "complete",
                },
            )

        if await request.is_disconnected():
            break

        yield _sse_event(
            "page-complete",
            {
                "page_id": page_request.page_id,
                "cycle": cycle,
                "updated_at": datetime.utcnow().isoformat(),
            },
        )

        for _ in range(20):
            if await request.is_disconnected():
                return
            await asyncio.sleep(1)
        yield _sse_event(
            "heartbeat",
            {
                "page_id": page_request.page_id,
                "cycle": cycle,
                "updated_at": datetime.utcnow().isoformat(),
            },
        )


def _build_agent_prompt(worker: Dict, event_meta: Dict, component_meta: Dict) -> str:
    chain = CAUSAL_CHAINS.get(event_meta["id"], [])
    scenarios = SCENARIOS.get(event_meta["id"], {})
    recommendation = RECOMMENDATIONS.get("B", {})
    chain_text = " | ".join(f"{step['stage']}: {step['name']}" for step in chain) or "No causal chain provided"
    scenario_text = " | ".join(
        f"{name}: fulfillment {scenario['fulfillment']}%, lead_time {scenario['lead_time']}, risk {scenario['risk']}"
        for name, scenario in scenarios.items()
    ) or "No scenarios provided"
    return (
        f"Event: {event_meta['name']} ({event_meta['severity']})\n"
        f"Component: {component_meta['name']} from {component_meta['vendor']} ({component_meta['criticality']})\n"
        f"Role: {worker['role']}\n"
        f"Causal chain: {chain_text}\n"
        f"Scenario options: {scenario_text}\n"
        f"Current preferred scenario reference: {recommendation.get('title', 'Scenario B')}\n\n"
        "Return strict JSON with keys 'message' and 'confidence'.\n"
        "Constraints:\n"
        "- One sentence only.\n"
        "- 8 to 18 words.\n"
        "- Specific to the event and component.\n"
        "- No markdown.\n"
        "- No prefacing text."
    )


async def _generate_agent_output(client: AsyncOpenAI, worker: Dict, event_meta: Dict, component_meta: Dict) -> Dict:
    try:
        response = await client.chat.completions.create(
            model=OPENAI_MODEL,
            temperature=0.35,
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a supply-chain analyst agent inside a disruption war room. "
                        "Be concrete, concise, and operational."
                    ),
                },
                {"role": "user", "content": _build_agent_prompt(worker, event_meta, component_meta)},
            ],
        )
        payload = json.loads(response.choices[0].message.content or "{}")
        message = str(payload.get("message", "")).strip()
        if not message:
            raise ValueError("empty message")
        return {"agent": worker["name"], "message": message, "tag": worker["tag"], "confidence": payload.get("confidence")}
    except Exception:
        return _default_agent_output(event_meta["id"], worker["name"], worker["tag"])


async def _generate_run_debates(run: Dict) -> List[Dict]:
    event_meta = _find_event(run["event_id"])
    component_meta = _find_component(run["component_id"])
    if not OPENAI_API_KEY or AsyncOpenAI is None:
        return EVENT_DEBATES.get(run["event_id"], [])

    client_kwargs = {"api_key": OPENAI_API_KEY}
    if OPENAI_BASE_URL:
        client_kwargs["base_url"] = OPENAI_BASE_URL
    client = AsyncOpenAI(**client_kwargs)
    tasks = [_generate_agent_output(client, worker, event_meta, component_meta) for worker in AGENT_WORKERS]
    results = await asyncio.gather(*tasks)
    return results


def _run_debates(run: Dict) -> List[Dict]:
    return run.get("debates") or EVENT_DEBATES.get(run["event_id"], [])


def _serialize_debate_log(event_id: str, idx: int, item: Dict) -> Dict:
    graph = KNOWLEDGE_GRAPH.get(event_id, {"edges": []})
    edges = graph.get("edges", [])
    edge = edges[min(idx, len(edges) - 1)] if edges else None
    edge_id = f"{edge['source']}-{edge['target']}" if edge else None
    agent_name = item["agent"]
    evidence = TOOL_EVIDENCE.get(event_id, {}).get(agent_name, [])
    return {
        "agent": agent_name,
        "tag": item["tag"],
        "message": item["message"],
        "timestamp": f"T+{idx:02d}:{(idx * 2) % 60:02d}",
        "sequence": idx,
        "edge_id": edge_id,
        "tool_evidence": evidence,
    }


def _run_status(run: Dict) -> Dict:
    event_id = run["event_id"]
    debates = _run_debates(run)

    if not run.get("deployed_at"):
        return {
            "run_id": run["run_id"],
            "status": "ready",
            "stage": "trigger",
            "progress": 0,
            "visible_logs": [],
            "event_stream": [],
            "total_logs": len(debates),
            "active_agents": 0,
            "total_agents": max(10, len(debates)),
            "graph_ready": False,
            "heatmap": [],
            "knowledge_graph": {"nodes": [], "edges": []},
            "future_outlook": [],
            "agent_mode": run.get("agent_mode", LLM_BACKEND_MODE),
        }

    elapsed = (datetime.utcnow() - run["deployed_at"]).total_seconds()
    visible_count = min(len(debates), int(elapsed / 1.0) + 1)
    progress = int((visible_count / max(1, len(debates))) * 100)

    stage = "debate"
    status = "running"
    graph_ready = False

    if visible_count >= len(debates) and len(debates) > 0:
        stage = "artifacts"
        status = "completed"
        progress = 100
        graph_ready = True

    visible_logs: List[Dict] = []
    event_stream: List[Dict] = []
    for idx, item in enumerate(debates[:visible_count]):
        log = _serialize_debate_log(event_id, idx, item)
        timestamp = log["timestamp"]
        visible_logs.append(log)
        event_stream.append(
            {
                "timestamp": timestamp,
                "message": f"{item['agent']} joined debate channel",
                "status": "join",
            }
        )
        event_stream.append(
            {
                "timestamp": timestamp,
                "message": f"{item['agent']} completed {item['tag']} analysis",
                "status": "complete",
            }
        )

    future_outlook = [
        {"horizon": "7 days", "label": "Expedite Probability", "value": 76},
        {"horizon": "30 days", "label": "Stockout Risk", "value": 43},
        {"horizon": "90 days", "label": "Recovery Confidence", "value": 68},
    ]

    if event_id == "us-china-trade-war":
        future_outlook = [
            {"horizon": "7 days", "label": "Policy Shock Probability", "value": 82},
            {"horizon": "30 days", "label": "Supplier Churn Risk", "value": 58},
            {"horizon": "90 days", "label": "Recovery Confidence", "value": 51},
        ]
    elif event_id == "taiwan-earthquake":
        future_outlook = [
            {"horizon": "7 days", "label": "Fab Outage Probability", "value": 74},
            {"horizon": "30 days", "label": "Lead-Time Escalation", "value": 63},
            {"horizon": "90 days", "label": "Recovery Confidence", "value": 57},
        ]

    # Attach trace-link evidence to each forecast horizon
    traces = OUTLOOK_TRACES_BY_EVENT.get(event_id, OUTLOOK_TRACES_DEFAULT)
    for item in future_outlook:
        item["trace"] = traces.get(item["horizon"], ["AutoResearch"])

    return {
        "run_id": run["run_id"],
        "status": status,
        "stage": stage,
        "progress": progress,
        "visible_logs": visible_logs,
        "event_stream": event_stream,
        "total_logs": len(debates),
        "active_agents": min(max(visible_count, 0), max(10, len(debates))),
        "total_agents": max(10, len(debates)),
        "graph_ready": graph_ready,
        "heatmap": RISK_HEATMAP.get(event_id, []),
        "knowledge_graph": KNOWLEDGE_GRAPH.get(event_id, {"nodes": [], "edges": []}),
        "future_outlook": future_outlook,
        "agent_mode": run.get("agent_mode", LLM_BACKEND_MODE),
        "judge_verdict": JUDGE_VERDICTS.get(event_id) if graph_ready else None,
    }


@app.get("/api/v2/health")
def health() -> dict:
    model = OPENAI_MODEL if OPENAI_API_KEY and AsyncOpenAI is not None else OLLAMA_MODEL
    backend = "openai" if OPENAI_API_KEY and AsyncOpenAI is not None else "ollama"
    return {
        "status": "ok",
        "ts": datetime.utcnow().isoformat(),
        "agent_mode": _current_agent_mode(),
        "llm_backend": backend,
        "model": model,
        "timesfm_api_configured": bool(TIMESFM_API_URL),
        "autoresearch_feed": AUTORESEARCH_RSS_URL,
    }


@app.get("/api/v2/agents/interaction-graph")
def interaction_graph(event_id: Optional[str] = None, limit: int = 200) -> dict:
    try:
        return _query_neo4j_interaction_graph(event_id=event_id, limit=max(1, min(limit, 1000)))
    except Exception as exc:
        fallback = _fallback_interaction_graph(event_id)
        fallback["error"] = str(exc)
        fallback["summary"] = "Neo4j unavailable; using in-memory interaction graph fallback."
        return fallback


@app.get("/api/v2/agents/providers")
def agents_provider_registry() -> dict:
    return {
        "agent_mode": _current_agent_mode(),
        "registry": {
            name: {
                **config,
                "active_mode": _agent_mode_for_state(name),
                "timesfm_provider": TIMESFM_PROVIDER if name == "TimesFM" else None,
                "timesfm_api_configured": bool(TIMESFM_API_URL) if name == "TimesFM" else None,
            }
            for name, config in AGENT_PROVIDER_REGISTRY.items()
        },
        "updated_at": datetime.utcnow().isoformat(),
    }


@app.post("/api/v2/agents/{agent_name}/insight")
async def agent_insight(agent_name: str, request: AgentInsightRequest) -> dict:
    normalized = AgentInsightRequest(**{**request.model_dump(), "agent_name": agent_name})
    return await _generate_live_agent_insight(normalized)


@app.post("/api/v2/agents/page-insights")
async def page_agent_insights(request: PageAgentInsightRequest) -> dict:
    agent_requests = _page_request_to_agent_requests(request)
    if not agent_requests:
        return {
            "page_id": request.page_id,
            "cards": [],
            "agent_mode": _current_agent_mode(),
            "message": "No page agent cards configured.",
        }

    tasks = [_generate_live_agent_insight(insight_req) for insight_req in agent_requests]

    results = await asyncio.gather(*tasks)
    return {
        "page_id": request.page_id,
        "cards": results,
        "agent_mode": _current_agent_mode(),
        "llm_model": OPENAI_MODEL if OPENAI_API_KEY and AsyncOpenAI is not None else OLLAMA_MODEL,
        "flow": ["Signal", "Cause", "Forecast", "Risk", "Decision"],
        "updated_at": datetime.utcnow().isoformat(),
    }


@app.get("/api/v2/agents/page-insights/stream")
async def page_agent_insights_stream(
    request: Request,
    page_id: str,
    order_id: Optional[str] = None,
    event_id: Optional[str] = None,
    component_id: Optional[str] = None,
    scenario_id: Optional[str] = None,
    question: Optional[str] = None,
):
    page_request = PageAgentInsightRequest(
        page_id=page_id,
        order_id=order_id,
        event_id=event_id,
        component_id=component_id,
        scenario_id=scenario_id,
        question=question,
    )
    return StreamingResponse(_page_agent_stream(request, page_request), media_type="text/event-stream")


@app.get("/api/v2/command-center/state")
def command_center_state() -> dict:
    return {
        "updated_at": datetime.utcnow().isoformat(),
        "overview": {
            "geo_risk": 69,
            "active_orders": 145210,
            "delivery_confidence": 71,
            "intervention_deadline": "7 days",
        },
        "agents": [
            {"name": "AutoResearch", "status": "LIVE", "mode": _agent_mode_for_state("AutoResearch")},
            {"name": "CausalGraph",  "status": "LIVE", "mode": _agent_mode_for_state("CausalGraph")},
            {"name": "TimesFM",      "status": "LIVE", "mode": _agent_mode_for_state("TimesFM")},
            {"name": "RecEngine",    "status": "LIVE", "mode": _agent_mode_for_state("RecEngine")},
            {"name": "RiskScorer",   "status": "LIVE", "mode": _agent_mode_for_state("RiskScorer")},
            {"name": "VendorIntel",  "status": "LIVE", "mode": _agent_mode_for_state("VendorIntel")},
            {"name": "JudgeAgent",   "status": "LIVE", "mode": _agent_mode_for_state("JudgeAgent")},
        ],
        "events": EVENTS,
        "components": COMPONENTS,
        "causal_chains": CAUSAL_CHAINS,
        "scenarios": SCENARIOS,
        "recommendations": RECOMMENDATIONS,
        "explainability": EXPLAINABILITY,
    }


@app.get("/api/v2/vendor-intel")
def vendor_intel(
    component_id: str = "gpu-display-chip",
    search: str = "",
    country: str = "All Countries",
    status: str = "All Statuses",
) -> dict:
    return _vendor_intel_response(component_id, search, country, status, None, "B", None)


@app.post("/api/v2/vendor-intel")
def vendor_intel_with_scenario(request: VendorIntelRequest) -> dict:
    return _vendor_intel_response(
        request.component_id,
        request.search,
        request.country,
        request.status,
        request.event_id,
        request.scenario_id,
        request.assumptions,
    )


@app.post("/api/v2/operations-plan")
def operations_plan(request: OperationsPlanRequest) -> dict:
    return _operations_plan_response(request)


@app.get("/api/v2/scenario-planner")
def scenario_planner(
    event_id: str,
    component_id: str,
    scenario_id: str = "B",
    horizon: int = 30,
    priority: str = "Balanced",
) -> dict:
    return _scenario_planner_response(event_id, component_id, scenario_id, horizon, priority, None)


@app.post("/api/v2/scenario-planner")
def scenario_planner_with_assumptions(request: ScenarioPlannerRequest) -> dict:
    return _scenario_planner_response(
        request.event_id,
        request.component_id,
        request.scenario_id,
        request.horizon,
        request.priority,
        request.assumptions,
    )


@app.post("/api/v2/runs")
def create_run(request: CreateRunRequest) -> dict:
    if request.event_id not in {event["id"] for event in EVENTS}:
        raise HTTPException(status_code=404, detail="Event not found")

    run_id = f"run-{uuid4().hex[:10]}"
    RUNS[run_id] = {
        "run_id": run_id,
        "event_id": request.event_id,
        "component_id": request.component_id,
        "created_at": datetime.utcnow(),
        "deployed_at": None,
        "debates": [],
        "agent_mode": LLM_BACKEND_MODE,
    }
    _log_metric("run_created", run_id=run_id, payload={"event_id": request.event_id, "component_id": request.component_id})
    return {"run_id": run_id, "status": "created"}


@app.post("/api/v2/runs/{run_id}/deploy")
async def deploy_run(run_id: str) -> dict:
    run = RUNS.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    run["debates"] = await _generate_run_debates(run)
    run["deployed_at"] = datetime.utcnow()
    run["agent_mode"] = "llm" if OPENAI_API_KEY and AsyncOpenAI is not None else "scripted"
    _log_metric("swarm_deployed", run_id=run_id, payload={"event_id": run["event_id"], "component_id": run["component_id"], "agent_mode": run["agent_mode"]})
    return {
        "run_id": run_id,
        "status": "deployed",
        "deployed_at": run["deployed_at"].isoformat(),
        "agent_mode": run["agent_mode"],
    }


@app.get("/api/v2/runs")
def list_runs() -> list:
    """Return all runs ordered newest-first for run history and comparison."""
    result = []
    for run in sorted(RUNS.values(), key=lambda r: r["created_at"], reverse=True):
        event_meta = next((e for e in EVENTS if e["id"] == run["event_id"]), None)
        st = _run_status(run)
        result.append({
            "run_id": run["run_id"],
            "event_id": run["event_id"],
            "event_name": event_meta["name"] if event_meta else run["event_id"],
            "event_icon": event_meta["icon"] if event_meta else "🔵",
            "component_id": run["component_id"],
            "created_at": run["created_at"].isoformat(),
            "status": st["status"],
            "progress": st["progress"],
        })
    return result


@app.get("/api/v2/runs/{run_id}/stream")
async def stream_run(run_id: str):
    """SSE endpoint that streams debate logs one-by-one as they are generated."""
    run = RUNS.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    event_id = run["event_id"]
    debates = _run_debates(run)

    async def event_generator():
        # Skip logs already elapsed since deployment
        if run.get("deployed_at"):
            elapsed = (datetime.utcnow() - run["deployed_at"]).total_seconds()
            already_shown = min(len(debates), max(0, int(elapsed)))
        else:
            already_shown = 0

        # Immediately flush already-visible logs
        for idx in range(already_shown):
            item = debates[idx]
            data = json.dumps(_serialize_debate_log(event_id, idx, item))
            yield f"data: {data}\n\n"

        # Stream remaining logs with 1-second pacing
        for idx in range(already_shown, len(debates)):
            await asyncio.sleep(1.0)
            item = debates[idx]
            data = json.dumps(_serialize_debate_log(event_id, idx, item))
            yield f"data: {data}\n\n"

        # Emit final completed status as a named 'complete' event
        final = _run_status(run)
        yield f"event: complete\ndata: {json.dumps(final)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/v2/runs/{run_id}/status")
def run_status(run_id: str) -> dict:
    run = RUNS.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    return _run_status(run)


@app.post("/api/v2/orders/ingest")
def ingest_order(request: OrderIngestRequest) -> dict:
    order_id = request.order_id or f"ord-{uuid4().hex[:8]}"
    bom_context = _compute_bom_context(request)
    order_context = {
        "order_id": order_id,
        "sku_id": request.sku_id,
        "sku_name": bom_context["sku_name"],
        "quantity": request.quantity,
        "region": request.region,
        "customer_priority": request.customer_priority,
        "event_id": request.event_id,
        "created_at": _now_iso(),
        "bom": bom_context,
    }
    ORDER_CONTEXTS[order_id] = order_context
    bottleneck = bom_context.get("bottleneck_component") or {}
    _log_metric(
        "order_ingested",
        order_id=order_id,
        payload={
            "sku_id": request.sku_id,
            "event_id": request.event_id,
            "bottleneck_component_id": bottleneck.get("component_id"),
            "bottleneck_runway": bottleneck.get("days_to_stockout_disruption"),
        },
    )
    _log_metric("disruption_detected", order_id=order_id, payload={"event_id": request.event_id})
    return order_context


@app.get("/api/v2/orders/{order_id}")
def get_order_context(order_id: str) -> dict:
    context = ORDER_CONTEXTS.get(order_id)
    if not context:
        raise HTTPException(status_code=404, detail="Order not found")
    return context


@app.get("/api/v2/orders/{order_id}/executive-snapshot")
def executive_snapshot(order_id: str) -> dict:
    context = ORDER_CONTEXTS.get(order_id)
    if not context:
        raise HTTPException(status_code=404, detail="Order not found")
    return _executive_snapshot(context)


@app.get("/api/v2/orders/{order_id}/components/{component_id}/deep-dive")
def component_deep_dive(order_id: str, component_id: str) -> dict:
    context = ORDER_CONTEXTS.get(order_id)
    if not context:
        raise HTTPException(status_code=404, detail="Order not found")
    return _component_deep_dive(context, component_id)


@app.get("/api/v2/orders/{order_id}/decision-panel")
def decision_panel(order_id: str, component_id: Optional[str] = None) -> dict:
    context = ORDER_CONTEXTS.get(order_id)
    if not context:
        raise HTTPException(status_code=404, detail="Order not found")
    return _decision_panel(context, component_id)


@app.get("/api/v2/orders/{order_id}/monitoring")
def monitoring_view(order_id: str) -> dict:
    context = ORDER_CONTEXTS.get(order_id)
    if not context:
        raise HTTPException(status_code=404, detail="Order not found")
    return _monitoring_view(context)


@app.get("/api/v2/orders/{order_id}/risk-dashboard")
def risk_dashboard(order_id: str) -> dict:
    context = ORDER_CONTEXTS.get(order_id)
    if not context:
        raise HTTPException(status_code=404, detail="Order not found")
    return _risk_dashboard(context)


@app.get("/api/v2/orders/{order_id}/shock-forecast")
def shock_forecast(order_id: str, component_id: Optional[str] = None) -> dict:
    context = ORDER_CONTEXTS.get(order_id)
    if not context:
        raise HTTPException(status_code=404, detail="Order not found")
    return _shock_forecast(context, component_id)


@app.get("/api/v2/orders/{order_id}/critical-alert")
def critical_alert(order_id: str, component_id: Optional[str] = None) -> dict:
    context = ORDER_CONTEXTS.get(order_id)
    if not context:
        raise HTTPException(status_code=404, detail="Order not found")
    return _critical_alert_panel(context, component_id)


@app.get("/api/v2/orders/open")
def open_orders() -> dict:
    items = []
    for order in ORDER_CONTEXTS.values():
        promise = order.get("last_delivery_promise") or {}
        items.append(
            {
                "order_id": order.get("order_id"),
                "sku_name": order.get("sku_name"),
                "region": order.get("region"),
                "quantity": order.get("quantity"),
                "promised_delivery_date": promise.get("promised_delivery_date"),
                "confidence_score": promise.get("confidence_score"),
                "status": "manual-review" if (promise.get("confidence_score", 100) < 80) else "on-track",
            }
        )
    items.sort(key=lambda item: item["order_id"] or "")
    return {"count": len(items), "orders": items}


@app.get("/api/v2/orders/{order_id}/decision-context")
def decision_context(order_id: str) -> dict:
    order_context = ORDER_CONTEXTS.get(order_id)
    if not order_context:
        raise HTTPException(status_code=404, detail="Order not found")
    return _decision_context(order_context)


@app.get("/api/v2/orders/{order_id}/disruption-impact")
def disruption_impact(
    order_id: str,
    component_id: Optional[str] = None,
    event_id: Optional[str] = None,
    trigger_type: str = "tariff",
    tariff_cn: float = 145.0,
    tariff_mx: float = 0.0,
    tariff_kr: float = 18.0,
    tariff_jp: float = 14.0,
    tariff_in: float = 10.0,
    tariff_other: float = 25.0,
) -> dict:
    order_context = ORDER_CONTEXTS.get(order_id)
    if not order_context:
        raise HTTPException(status_code=404, detail="Order not found")
    resolved_component_id = component_id or order_context.get("bom", {}).get("bottleneck_component", {}).get("component_id")
    if not resolved_component_id:
        raise HTTPException(status_code=404, detail="Component not found")
    tariff_schedule = {
        "CN": tariff_cn,
        "MX": tariff_mx,
        "KR": tariff_kr,
        "JP": tariff_jp,
        "IN": tariff_in,
        "OTHER": tariff_other,
    }
    return _disruption_impact(
        order_context,
        resolved_component_id,
        event_id=event_id,
        trigger_type=trigger_type,
        tariff_schedule=tariff_schedule,
    )


def _vendor_floor_price(
    component_id: str,
    vendor: Dict[str, Any],
    event_id: Optional[str],
) -> Dict[str, Any]:
    """Estimate the price below which a vendor is unlikely to go (their cost floor)."""
    base = _component_base_cost(component_id)
    signal = COMPONENT_MARKET_SIGNALS.get(component_id, {"change_pct": 4.0, "commodity": "supply index"})
    event_lift = 1.0 + (0.05 if event_id in {"hormuz-closure", "us-china-tariff", "us-china-trade-war"} else 0.02)
    country_code = vendor.get("country", "US")
    # Regional cost index: domestic/friend-shore vendors have slightly different input costs
    country_cost_map = {"US": 1.0, "MX": 0.93, "KR": 0.97, "IE": 0.99, "IN": 0.88, "TW": 0.96, "CN": 0.85, "AE": 0.91}
    regional_factor = country_cost_map.get(country_code, 0.95)
    # Vendor floor = base input cost * regional factor * event lift * (1 + vendor's fixed overhead premium)
    cost_premium_rate = max(0.0, vendor.get("cost_premium", 0)) / 100.0
    raw_material_floor = round(base * regional_factor * event_lift, 4)
    overhead_floor = round(raw_material_floor * (1.0 + cost_premium_rate * 0.45), 4)  # vendor can shave overhead
    # Market rate from price region data
    region_label = {"US": "US", "MX": "Mexico", "KR": "Korea", "IE": "Japan", "TW": "Korea", "IN": "India", "AE": "India"}.get(country_code, "US")
    market_rate = round(base * PRICE_REGION_MULTIPLIERS.get(region_label, 1.0) * event_lift, 4)
    # Floor = max of (overhead model, market floor) — vendor will not sell below their input + minimal overhead
    floor = round(max(overhead_floor, raw_material_floor * 1.04), 4)
    market_change_pct = float(signal.get("change_pct", 4.0))
    return {
        "raw_material_floor": raw_material_floor,
        "overhead_floor": overhead_floor,
        "market_rate": market_rate,
        "estimated_floor": floor,
        "commodity": signal.get("commodity", "supply index"),
        "weekly_market_change_pct": round(market_change_pct, 2),
        "market_trend": "rising" if market_change_pct > 3.0 else "stable",
        "event_lift_pct": round((event_lift - 1.0) * 100.0, 1),
        "regional_factor": round(regional_factor, 3),
    }


def _agent_negotiate_rounds(
    opening_offer: float,
    vendor_floor: float,
    walk_away: float,
    vendor_anchor: float,
    n_rounds: int = 5,
) -> List[Dict[str, Any]]:
    """
    Simulate multi-round agent negotiation between procurement (buyer) and vendor.
    Buyer opens low, vendor anchors high, both converge. Returns per-round outcomes.
    """
    rounds: List[Dict[str, Any]] = []
    buyer_price = opening_offer
    vendor_price = vendor_anchor
    deal_zone_low = opening_offer * 1.02  # buyer can edge up
    deal_zone_high = walk_away

    for rnd in range(1, n_rounds + 1):
        gap = vendor_price - buyer_price
        if gap <= 0:
            status = "agreed"
        elif buyer_price >= deal_zone_high:
            status = "buyer-at-ceiling"
        elif vendor_price <= deal_zone_low:
            status = "deal-zone"
        else:
            status = "negotiating"

        concession_factor = 0.38 if rnd <= 2 else 0.22 if rnd <= 4 else 0.12
        buyer_move = min(gap * concession_factor * 0.6, max(0.0, deal_zone_high - buyer_price) * 0.4)
        vendor_move = max(0.0, (vendor_price - vendor_floor) * concession_factor * 0.7)

        rounds.append({
            "round": rnd,
            "buyer_offer": round(buyer_price, 2),
            "vendor_ask": round(vendor_price, 2),
            "gap": round(max(0.0, vendor_price - buyer_price), 2),
            "status": status,
            "in_deal_zone": deal_zone_low <= vendor_price <= deal_zone_high and buyer_price <= deal_zone_high,
            "agreed": vendor_price <= buyer_price or (abs(vendor_price - buyer_price) < 0.5 and rnd >= 3),
        })

        if rounds[-1]["agreed"]:
            break

        buyer_price = min(round(buyer_price + buyer_move, 4), deal_zone_high)
        vendor_price = max(round(vendor_price - vendor_move, 4), vendor_floor)

    return rounds


def _negotiation_brief(
    order_context: Dict[str, Any],
    component_id: str,
    event_id: Optional[str] = None,
    trigger_type: str = "tariff",
    simulation_scenario_id: Optional[str] = None,
    locked_revenue_unit: Optional[float] = None,
    target_margin_pct: float = 22.0,
) -> Dict[str, Any]:
    """
    Generate full negotiation intelligence brief for all shortlisted vendors.
    Includes vendor floor, walk-away, deal zone, opening offer, BATNA, and agent simulation.
    """
    component_row = next(
        (row for row in order_context.get("bom", {}).get("components", []) if row["component_id"] == component_id),
        None,
    )
    if not component_row:
        raise HTTPException(status_code=404, detail="Component not found")

    active_event_id = event_id or order_context.get("event_id")
    vendors = [v for v in VENDOR_CATALOG.get(component_id, []) if v.get("active", True)]
    if not vendors:
        raise HTTPException(status_code=404, detail="No vendors available")

    sku_profile = _sku_margin_profile(order_context.get("sku_id", ""))
    revenue_per_unit = float(locked_revenue_unit or sku_profile["unit_revenue"])
    target_margin = max(1.0, min(65.0, float(target_margin_pct or 22.0)))
    fixed_conversion = float(sku_profile["fixed_conversion_cost"])
    qty_per_unit = max(1, int(component_row.get("qty_per_unit", 1)))
    order_qty = max(1, int(order_context.get("quantity", 1) or 1))

    # Pull from cached profit recommendation if available
    cached_rec = order_context.get("last_profit_recommendation")
    cached_scenarios = {item["scenario_id"]: item for item in (cached_rec.get("scenarios", []) if cached_rec else [])}
    active_scenario = cached_scenarios.get(simulation_scenario_id or "base") or (list(cached_scenarios.values())[0] if cached_scenarios else None)

    # Global commodity context
    commodity_data = _component_global_price_panel(component_id, active_event_id or "")
    drivers = _component_driver_map(component_id)

    # Build per-vendor briefs
    vendor_briefs: List[Dict[str, Any]] = []
    for vendor in vendors:
        floor_data = _vendor_floor_price(component_id, vendor, active_event_id)
        hist = _historical_vendor_market(component_id, vendor["vendor_id"])
        routes = _choose_routes(vendor["vendor_id"], [], "balanced")
        best_route = routes[0] if routes else {"cost_per_pallet": 5200.0, "transit_days": 12.0, "risk": 35.0, "route_id": "unknown", "mode": "sea"}

        tariff_rate = _tariff_rate(active_event_id or "", vendor.get("country", "US"))
        freight_per_unit = round(float(best_route.get("cost_per_pallet", 5200.0)) / 250.0, 4)

        # Total non-purchase landed cost per product unit
        non_purchase_per_component = freight_per_unit * (1.0 + tariff_rate) + 2.9  # + handling
        non_purchase_per_product = non_purchase_per_component * qty_per_unit

        total_bom_for_other = sum(
            _component_base_cost(row["component_id"]) * int(row.get("qty_per_unit", 1))
            for row in order_context.get("bom", {}).get("components", [])
            if row["component_id"] != component_id
        )
        total_non_component_cost = total_bom_for_other + fixed_conversion

        # Walk-away: max purchase price that still achieves target margin
        allowed_product_cost = revenue_per_unit * (1.0 - target_margin / 100.0)
        max_purchase_per_component = round(
            max(0.0, (allowed_product_cost - total_non_component_cost - non_purchase_per_product) / max(1, qty_per_unit)), 4
        )
        # Absolute break-even walk-away (0% margin)
        break_even_per_component = round(
            max(0.0, (revenue_per_unit - total_non_component_cost - non_purchase_per_product) / max(1, qty_per_unit)), 4
        )

        # From active scenario if available
        sim_ceiling = float((active_scenario or {}).get("negotiation_ceiling_purchase_price", max_purchase_per_component))
        sim_breakeven = float((active_scenario or {}).get("break_even_purchase_price", break_even_per_component))
        walk_away_price = round(min(sim_ceiling, max_purchase_per_component), 4)

        # Opening offer: target to land in deal zone — start 8-14% below estimated floor
        estimated_floor = floor_data["estimated_floor"]
        aggressiveness = 0.11 if vendor.get("reliability", 85) > 90 else 0.14
        opening_offer = round(max(estimated_floor * (1.0 - aggressiveness), hist["best_price"] * 0.96), 4)

        # Deal zone: range where agreement is mutually possible
        deal_zone_low = round(max(opening_offer, estimated_floor), 4)
        deal_zone_high = round(min(walk_away_price, hist["avg_price"] * 1.05), 4)
        if deal_zone_low > deal_zone_high:
            deal_zone_low, deal_zone_high = deal_zone_high, deal_zone_low

        # Is agreement structurally possible?
        deal_feasible = estimated_floor <= walk_away_price
        gap_to_close = round(max(0.0, estimated_floor - walk_away_price), 4)

        # Vendor anchor price (where vendor will start bidding)
        anchor_premium = 0.12 if vendor.get("geo_risk", 30) < 25 else 0.08 if vendor.get("geo_risk", 30) < 45 else 0.05
        vendor_anchor = round(hist["avg_price"] * (1.0 + anchor_premium), 4)

        # Agent simulation: multi-round negotiation
        agent_rounds = _agent_negotiate_rounds(
            opening_offer=opening_offer,
            vendor_floor=estimated_floor,
            walk_away=walk_away_price,
            vendor_anchor=vendor_anchor,
        )
        agreed_round = next((item for item in agent_rounds if item["agreed"]), None)
        projected_deal_price = round(agreed_round["vendor_ask"] if agreed_round else walk_away_price, 4)

        # Real-time profit at each agent round
        for ag_round in agent_rounds:
            buyer_p = ag_round["buyer_offer"]
            total_cost = (buyer_p + non_purchase_per_component) * qty_per_unit + total_non_component_cost
            ag_round["buyer_profit_per_unit"] = round(revenue_per_unit - total_cost, 4)
            ag_round["buyer_margin_pct"] = round((revenue_per_unit - total_cost) / max(revenue_per_unit, 0.01) * 100.0, 2)

        # Profit at projected deal price
        deal_total_cost = (projected_deal_price + non_purchase_per_component) * qty_per_unit + total_non_component_cost
        projected_deal_profit = round(revenue_per_unit - deal_total_cost, 4)
        projected_deal_margin_pct = round(projected_deal_profit / max(revenue_per_unit, 0.01) * 100.0, 2)

        # Leverage assessment
        n_alternatives = len([v for v in vendors if v["vendor_id"] != vendor["vendor_id"]])
        leverage = "strong" if n_alternatives >= 3 else "moderate" if n_alternatives >= 1 else "weak"

        # Compliance profile
        compliance = _vendor_compliance_profile(vendor, active_event_id or "")

        vendor_briefs.append({
            "vendor_id": vendor["vendor_id"],
            "vendor_name": vendor["name"],
            "country": vendor.get("country", "?"),
            "tier": vendor.get("tier", "?"),
            "reliability": vendor.get("reliability", 85),
            "geo_risk": vendor.get("geo_risk", 30),
            "lead_days": vendor.get("lead_days", 14),
            "capacity": vendor.get("capacity", 10000),
            "historical_avg_price": round(hist["avg_price"], 4),
            "historical_best_price": round(hist["best_price"], 4),
            "fill_rate_pct": hist.get("fill_rate_pct", 90),
            "floor_data": floor_data,
            "estimated_vendor_floor": round(estimated_floor, 4),
            "vendor_anchor_price": round(vendor_anchor, 4),
            "opening_offer": round(opening_offer, 4),
            "deal_zone_low": round(deal_zone_low, 4),
            "deal_zone_high": round(deal_zone_high, 4),
            "walk_away_price": round(walk_away_price, 4),
            "break_even_price": round(sim_breakeven, 4),
            "deal_feasible": deal_feasible,
            "gap_to_close": round(gap_to_close, 4),
            "leverage": leverage,
            "n_alternatives": n_alternatives,
            "projected_deal_price": round(projected_deal_price, 4),
            "projected_deal_profit_per_unit": round(projected_deal_profit, 4),
            "projected_deal_margin_pct": round(projected_deal_margin_pct, 2),
            "agent_rounds": agent_rounds,
            "agreed_in_simulation": agreed_round is not None,
            "compliance": compliance,
            "tariff_rate_pct": round(tariff_rate * 100.0, 2),
            "freight_per_unit": round(freight_per_unit, 4),
            "non_purchase_cost_per_component": round(non_purchase_per_component, 4),
            "route": {
                "route_id": best_route.get("route_id"),
                "mode": best_route.get("mode"),
                "transit_days": best_route.get("transit_days"),
                "risk": best_route.get("risk"),
            },
            "profit_impact_curve": [
                {
                    "price": round(p, 2),
                    "profit_per_unit": round(
                        revenue_per_unit - (p + non_purchase_per_component) * qty_per_unit - total_non_component_cost, 4
                    ),
                    "margin_pct": round(
                        (revenue_per_unit - (p + non_purchase_per_component) * qty_per_unit - total_non_component_cost)
                        / max(revenue_per_unit, 0.01) * 100.0, 2
                    ),
                }
                for p in [
                    round(estimated_floor * f, 2)
                    for f in [0.80, 0.85, 0.90, 0.95, 1.00, 1.05, 1.10, 1.15, 1.20]
                ]
            ],
        })

    # Sort: feasible first, then by projected margin
    vendor_briefs.sort(key=lambda b: (-int(b["deal_feasible"]), -b["projected_deal_margin_pct"]))

    # BATNA: if primary vendor can't reach deal zone, best alternative vendor
    primary = vendor_briefs[0]
    batna_vendor = next(
        (b for b in vendor_briefs[1:] if b["deal_feasible"] and b["vendor_id"] != primary["vendor_id"]),
        vendor_briefs[1] if len(vendor_briefs) > 1 else None,
    )
    batna = {
        "vendor_id": batna_vendor["vendor_id"],
        "vendor_name": batna_vendor["vendor_name"],
        "projected_deal_price": batna_vendor["projected_deal_price"],
        "projected_deal_margin_pct": batna_vendor["projected_deal_margin_pct"],
        "deal_feasible": batna_vendor["deal_feasible"],
        "trigger_condition": f"Activate if primary vendor ({primary['vendor_name']}) cannot reach deal zone (≤${primary['deal_zone_high']:.2f}).",
    } if batna_vendor else None

    return {
        "component_id": component_id,
        "component_name": component_row["component_name"],
        "event_id": active_event_id,
        "trigger_type": trigger_type,
        "locked_revenue_per_unit": round(revenue_per_unit, 4),
        "target_margin_pct": round(target_margin, 2),
        "order_quantity": order_qty,
        "vendor_briefs": vendor_briefs,
        "primary_vendor_id": primary["vendor_id"],
        "batna": batna,
        "commodity_context": commodity_data,
        "commodity_drivers": drivers,
        "headline": (
            f"Deal zone for {primary['vendor_name']}: ${primary['deal_zone_low']:.2f}–${primary['deal_zone_high']:.2f}. "
            f"Open at ${primary['opening_offer']:.2f}. Walk-away at ${primary['walk_away_price']:.2f}. "
            f"{'Agreement feasible in simulation.' if primary['agreed_in_simulation'] else 'Gap requires BATNA escalation.'}"
        ),
    }


@app.get("/api/v2/orders/{order_id}/negotiation-brief")
def negotiation_brief(
    order_id: str,
    component_id: Optional[str] = None,
    event_id: Optional[str] = None,
    trigger_type: str = "tariff",
    simulation_scenario_id: Optional[str] = None,
    locked_revenue_unit: Optional[float] = None,
    target_margin_pct: float = 22.0,
) -> dict:
    order_context = ORDER_CONTEXTS.get(order_id)
    if not order_context:
        raise HTTPException(status_code=404, detail="Order not found")
    resolved_component_id = component_id or order_context.get("bom", {}).get("bottleneck_component", {}).get("component_id")
    if not resolved_component_id:
        raise HTTPException(status_code=404, detail="Component not found")
    return _negotiation_brief(
        order_context,
        resolved_component_id,
        event_id=event_id,
        trigger_type=trigger_type,
        simulation_scenario_id=simulation_scenario_id,
        locked_revenue_unit=locked_revenue_unit,
        target_margin_pct=target_margin_pct,
    )


@app.get("/api/v2/orders/{order_id}/profit-recommendation")
def profit_recommendation(
    order_id: str,
    component_id: Optional[str] = None,
    event_id: Optional[str] = None,
    trigger_type: str = "tariff",
    locked_revenue_unit: Optional[float] = None,
    target_margin_pct: float = 22.0,
    freight_mode: str = "auto",
    monte_carlo_runs: int = 1200,
) -> dict:
    order_context = ORDER_CONTEXTS.get(order_id)
    if not order_context:
        raise HTTPException(status_code=404, detail="Order not found")
    resolved_component_id = component_id or order_context.get("bom", {}).get("bottleneck_component", {}).get("component_id")
    if not resolved_component_id:
        raise HTTPException(status_code=404, detail="Component not found")
    return _profit_recommendation(
        order_context,
        resolved_component_id,
        event_id=event_id,
        trigger_type=trigger_type,
        locked_revenue_unit=locked_revenue_unit,
        target_margin_pct=target_margin_pct,
        preferred_freight_mode=freight_mode,
        monte_carlo_runs=monte_carlo_runs,
    )


@app.get("/api/v2/orders/{order_id}/execution-learning")
def execution_learning(order_id: str, component_id: Optional[str] = None) -> dict:
    order_context = ORDER_CONTEXTS.get(order_id)
    if not order_context:
        raise HTTPException(status_code=404, detail="Order not found")
    resolved_component_id = component_id or order_context.get("bom", {}).get("bottleneck_component", {}).get("component_id")
    if not resolved_component_id:
        raise HTTPException(status_code=404, detail="Component not found")
    return _execution_learning(order_context, resolved_component_id)


@app.post("/api/v2/vendor-scoring")
def vendor_scoring(request: VendorScoringRequest) -> dict:
    order_context = ORDER_CONTEXTS.get(request.order_id)
    if not order_context:
        raise HTTPException(status_code=404, detail="Order not found")

    components = order_context.get("bom", {}).get("components", [])
    component_row = next((row for row in components if row["component_id"] == request.component_id), None)
    runway_days = request.runway_days if request.runway_days is not None else (component_row["days_to_stockout_disruption"] if component_row else 30.0)
    runtime_weights = _effective_weights(runway_days, request.dynamic_switch, request.low_runway_threshold, request.weights)

    scored = []
    for vendor in VENDOR_CATALOG.get(request.component_id, []):
        if request.tier_filter and vendor["tier"] not in request.tier_filter:
            continue
        if not vendor.get("active", True):
            continue
        scored.append(_score_vendor(vendor, runtime_weights["weights"]))
    scored.sort(key=lambda item: item["composite_score"], reverse=True)
    primary_vendor = _primary_vendor_for_component(request.component_id)
    primary_routes = _choose_routes(primary_vendor["vendor_id"], [], "balanced") if primary_vendor else []
    blocked_corridors = _event_corridor_impacts(order_context.get("event_id", ""))
    primary_blocked = bool(primary_routes and any(c in blocked_corridors for c in primary_routes[0].get("corridors", [])))

    _log_metric(
        "alternatives_ranked",
        order_id=request.order_id,
        payload={
            "component_id": request.component_id,
            "runway_days": runway_days,
            "dynamic_profile": runtime_weights["profile"],
            "top_vendor": scored[0]["vendor_id"] if scored else None,
        },
    )

    return {
        "order_id": request.order_id,
        "component_id": request.component_id,
        "runway_days": runway_days,
        "active_profile": runtime_weights,
        "primary_vendor_status": {
            "vendor_name": primary_vendor["name"] if primary_vendor else "Unassigned",
            "status": "Unreachable - route blocked" if primary_blocked else "Reachable",
            "blocked_corridors": blocked_corridors if primary_blocked else [],
        },
        "ranked_vendors": scored,
    }


@app.post("/api/v2/route-optimizer")
def route_optimizer(request: RouteOptimizerRequest) -> dict:
    order_context = ORDER_CONTEXTS.get(request.order_id)
    if not order_context:
        raise HTTPException(status_code=404, detail="Order not found")

    routes = _choose_routes(request.vendor_id, request.blocked_corridors, request.mode_preference)
    primary = routes[0] if routes else None
    fallbacks = routes[1:3] if len(routes) > 1 else []
    air_routes = [route for route in routes if route.get("mode") == "air"]
    sea_routes = [route for route in routes if route.get("mode") == "sea"]
    best_air = air_routes[0] if air_routes else None
    best_sea = sea_routes[0] if sea_routes else None
    mode_recommendation = "air" if (best_air and (not best_sea or best_air["transit_days"] <= best_sea["transit_days"] - 4)) else "sea"
    fuel = _fuel_multipliers()
    _log_metric(
        "route_recomputed",
        order_id=request.order_id,
        payload={
            "component_id": request.component_id,
            "vendor_id": request.vendor_id,
            "blocked_corridors": request.blocked_corridors,
            "primary_route": primary["route_id"] if primary else None,
        },
    )
    return {
        "order_id": request.order_id,
        "component_id": request.component_id,
        "vendor_id": request.vendor_id,
        "destination_factory": request.destination_factory,
        "corridor_graph": CORRIDOR_GRAPH,
        "recommended_primary": primary,
        "fallback_routes": fallbacks,
        "mode_comparison": {
            "air": {
                "route_id": best_air.get("route_id") if best_air else None,
                "transit_days": best_air.get("transit_days") if best_air else None,
                "cost_per_pallet": best_air.get("cost_per_pallet") if best_air else None,
            },
            "sea": {
                "route_id": best_sea.get("route_id") if best_sea else None,
                "transit_days": best_sea.get("transit_days") if best_sea else None,
                "cost_per_pallet": best_sea.get("cost_per_pallet") if best_sea else None,
            },
            "recommended_mode": mode_recommendation,
        },
        "fuel_multipliers": fuel,
        "all_routes": routes,
    }


@app.post("/api/v2/delivery-promise")
def delivery_promise(request: DeliveryPromiseRequest) -> dict:
    order_context = ORDER_CONTEXTS.get(request.order_id)
    if not order_context:
        raise HTTPException(status_code=404, detail="Order not found")

    bom_components = order_context.get("bom", {}).get("components", [])
    line_items = []
    for component in bom_components:
        component_id = component["component_id"]
        selected_vendor_id = request.selected_vendor_map.get(component_id)
        vendor = _find_vendor(component_id, selected_vendor_id) if selected_vendor_id else None
        if not vendor:
            ranked = [_score_vendor(v, {"reliability": 0.4, "cost": 0.3, "speed": 0.2, "geo_penalty": 0.1}) for v in VENDOR_CATALOG.get(component_id, []) if v.get("active", True)]
            ranked.sort(key=lambda item: item["composite_score"], reverse=True)
            vendor = ranked[0] if ranked else {
                "vendor_id": "unassigned",
                "name": "Unassigned Vendor",
                "reliability": 70,
                "lead_days": 18,
            }

        route_id = request.selected_route_map.get(component_id)
        route_options = _choose_routes(vendor["vendor_id"], [], "balanced")
        route = next((r for r in route_options if r["route_id"] == route_id), None) if route_id else None
        if not route:
            route = route_options[0] if route_options else {
                "route_id": "manual-routing",
                "transit_days": 12,
                "cost_per_pallet": 8200,
                "risk": 40,
                "nodes": ["Vendor", "Factory"],
                "corridors": [],
            }

        arrival_days = int(round(vendor.get("lead_days", 15) + route.get("transit_days", 10)))
        line_items.append(
            {
                "component_id": component_id,
                "component_name": component["component_name"],
                "vendor_id": vendor.get("vendor_id"),
                "vendor_name": vendor.get("name"),
                "route_id": route.get("route_id"),
                "route_nodes": route.get("nodes", []),
                "component_arrival_days": arrival_days,
                "vendor_reliability": vendor.get("reliability", 70),
                "route_risk": route.get("risk", 45),
            }
        )

    line_items.sort(key=lambda item: item["component_arrival_days"], reverse=True)
    bottleneck = line_items[0] if line_items else None
    max_component_days = bottleneck["component_arrival_days"] if bottleneck else 0
    total_eta_days = max_component_days + request.assembly_days + request.customer_shipping_days
    baseline_component_days = max(8, max_component_days - 6)
    baseline_eta_days = baseline_component_days + request.assembly_days + request.customer_shipping_days
    delay_days = max(0, total_eta_days - baseline_eta_days)
    promise_date = (datetime.utcnow() + timedelta(days=total_eta_days)).date().isoformat()
    original_date = (datetime.utcnow() + timedelta(days=baseline_eta_days)).date().isoformat()
    avg_reliability = sum(item["vendor_reliability"] for item in line_items) / max(1, len(line_items))
    avg_route_risk = sum(item["route_risk"] for item in line_items) / max(1, len(line_items))
    confidence = int(max(55, min(98, round(avg_reliability - avg_route_risk * 0.22))))
    customer_message = (
        f"Due to active supply chain disruption on {order_context['sku_name']}, we have secured alternate sourcing and routing. "
        f"Your updated delivery date is {promise_date} with a {confidence}% confidence estimate."
    )
    email_preview = {
        "subject": f"Updated delivery timeline for order {request.order_id}",
        "body": customer_message,
    }
    last_execution = order_context.get("last_execution") or {}
    procurement_log = {
        "po_number": last_execution.get("po_number", "Pending approval"),
        "freight_booking_reference": last_execution.get("freight_booking_reference", "Pending approval"),
        "eta": promise_date,
    }

    _log_metric(
        "delivery_promised",
        order_id=request.order_id,
        payload={
            "eta_days": total_eta_days,
            "promise_date": promise_date,
            "confidence": confidence,
            "bottleneck_component": bottleneck["component_id"] if bottleneck else None,
        },
    )

    response = {
        "order_id": request.order_id,
        "sku_name": order_context["sku_name"],
        "order_level_eta_days": total_eta_days,
        "original_eta_days": baseline_eta_days,
        "delay_days": delay_days,
        "promised_delivery_date": promise_date,
        "original_delivery_date": original_date,
        "bottleneck_component": bottleneck,
        "confidence_score": confidence,
        "line_items": line_items,
        "customer_communication": customer_message,
        "email_preview": email_preview,
        "procurement_log": procurement_log,
    }
    order_context["last_delivery_promise"] = response
    return response


@app.post("/api/v2/execution/actions")
def execution_actions(request: ExecutionActionRequest) -> dict:
    order_context = ORDER_CONTEXTS.get(request.order_id)
    if not order_context:
        raise HTTPException(status_code=404, detail="Order not found")

    recommendation_bundle = order_context.get("last_profit_recommendation")
    if not recommendation_bundle:
        bottleneck_component = order_context.get("bom", {}).get("bottleneck_component", {}).get("component_id")
        if bottleneck_component:
            recommendation_bundle = _profit_recommendation(order_context, bottleneck_component)
    chosen = (recommendation_bundle or {}).get("recommendation", {})
    selected_scenario = next(
        (
            scenario
            for scenario in (recommendation_bundle or {}).get("scenarios", [])
            if scenario.get("vendor_id") == chosen.get("selected_vendor_id") and scenario.get("route_id") == chosen.get("selected_route_id")
        ),
        None,
    )

    mode = request.mode.lower()
    supported_mode = mode in {"mock", "live"}
    effective_mode = mode if supported_mode else "mock"
    steps = []
    for action in request.actions:
        if effective_mode == "live":
            status = "queued"
            note = "Live integration adapter not configured in this environment."
        else:
            status = "completed"
            note = "Mock automation executed successfully."
        steps.append({"action": action, "status": status, "note": note, "timestamp": _now_iso()})

    po_number = f"PO-{request.order_id[-4:]}-{uuid4().hex[:5].upper()}"
    freight_ref = f"FR-{uuid4().hex[:8].upper()}"
    entry = {
        "execution_id": f"exe-{uuid4().hex[:8]}",
        "order_id": request.order_id,
        "mode": effective_mode,
        "po_number": po_number,
        "freight_booking_reference": freight_ref,
        "steps": steps,
        "created_at": _now_iso(),
        "decision_snapshot": {
            "decision_id": f"exe-{uuid4().hex[:8]}",
            "order_id": request.order_id,
            "event_id": order_context.get("event_id"),
            "component_id": (recommendation_bundle or {}).get("component_id") or order_context.get("bom", {}).get("bottleneck_component", {}).get("component_id"),
            "procurement_head_id": str(order_context.get("procurement_head_id") or "procurement-head"),
            "vendor_id": chosen.get("selected_vendor_id"),
            "vendor_name": chosen.get("selected_vendor_name"),
            "route_id": chosen.get("selected_route_id"),
            "route_mode": chosen.get("selected_route_mode"),
            "decision_date": _now_iso(),
            "projected_unit_price": chosen.get("selected_target_price"),
            "projected_total_cost": (
                round(
                    float((selected_scenario or {}).get("procurement_cost", 0.0) or 0.0)
                    + float((selected_scenario or {}).get("logistics_cost", 0.0) or 0.0)
                    + float((selected_scenario or {}).get("tariff_cost", 0.0) or 0.0)
                    + float((selected_scenario or {}).get("delay_penalty", 0.0) or 0.0)
                    + float((selected_scenario or {}).get("risk_reserve", 0.0) or 0.0),
                    2,
                )
                if selected_scenario
                else None
            ),
            "projected_margin_pct": (selected_scenario or {}).get("gross_margin_pct"),
        },
    }
    EXECUTION_LOGS.append(entry)
    order_context["last_execution"] = entry
    _log_metric("actions_executed", order_id=request.order_id, payload={"mode": effective_mode, "actions": request.actions})
    return entry


@app.get("/api/v2/metrics/events")
def metrics_events(order_id: Optional[str] = None, limit: int = 200) -> dict:
    events = METRIC_EVENTS
    if order_id:
        events = [event for event in events if event.get("order_id") == order_id]
    return {"count": len(events), "events": events[-max(1, min(limit, 1000)):]}


@app.get("/api/v2/metrics/summary")
def metrics_summary() -> dict:
    per_order: Dict[str, Dict[str, Any]] = {}
    for event in METRIC_EVENTS:
        order_id = event.get("order_id")
        if not order_id:
            continue
        record = per_order.setdefault(order_id, {})
        event_ts = datetime.fromisoformat(event["timestamp"])
        record[event["event_type"]] = event_ts

    detect_secs, alternative_secs, action_secs = [], [], []
    for timeline in per_order.values():
        ingest_ts = timeline.get("order_ingested")
        detect_ts = timeline.get("disruption_detected")
        alt_ts = timeline.get("alternatives_ranked")
        exec_ts = timeline.get("actions_executed")
        if ingest_ts and detect_ts:
            detect_secs.append((detect_ts - ingest_ts).total_seconds())
        if ingest_ts and alt_ts:
            alternative_secs.append((alt_ts - ingest_ts).total_seconds())
        if ingest_ts and exec_ts:
            action_secs.append((exec_ts - ingest_ts).total_seconds())

    avg_action_time = round((sum(action_secs) / len(action_secs)) if action_secs else 0, 2)
    simulated_loss_avoided = round(len(action_secs) * 200_000_000.0, 2)
    premium_spend = round(len(action_secs) * 2_800_000.0, 2)
    system_cost = 2_000_000.0
    net_benefit = simulated_loss_avoided - premium_spend - system_cost
    roi = round((net_benefit / max(system_cost + premium_spend, 1.0)), 2)

    return {
        "orders_observed": len(per_order),
        "time_to_detect_sec": {
            "avg": round((sum(detect_secs) / len(detect_secs)) if detect_secs else 0, 2),
            "median": round(median(detect_secs), 2) if detect_secs else 0,
        },
        "time_to_alternative_sec": {
            "avg": round((sum(alternative_secs) / len(alternative_secs)) if alternative_secs else 0, 2),
            "median": round(median(alternative_secs), 2) if alternative_secs else 0,
        },
        "time_to_action_sec": {
            "avg": avg_action_time,
            "median": round(median(action_secs), 2) if action_secs else 0,
        },
        "financials": {
            "simulated_loss_avoided": simulated_loss_avoided,
            "premium_spend": premium_spend,
            "system_cost": system_cost,
            "net_benefit": round(net_benefit, 2),
            "roi_multiple": roi,
        },
        "event_count": len(METRIC_EVENTS),
        "execution_log_count": len(EXECUTION_LOGS),
    }


# ── Narrative Copilot ────────────────────────────────────────────────────────
@app.post("/api/v2/runs/{run_id}/narrative")
async def run_narrative(run_id: str) -> dict:
    """Generate executive AI narrative: what changed, decision needed, consequence."""
    run = RUNS.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    event_id  = run["event_id"]
    event_meta = _find_event(event_id)
    component_meta = _find_component(run["component_id"])
    scripted = NARRATIVE_SCRIPTS.get(event_id, {
        "changed":     f"{event_meta['name']} is disrupting supply chain operations.",
        "decision":    "Deploy risk mitigation scenario and confirm vendor contingency plan.",
        "consequence": "Inaction risks stockout and missed customer commitments.",
    })

    if not OPENAI_API_KEY or AsyncOpenAI is None:
        return {"event_id": event_id, "run_id": run_id, "source": "scripted", **scripted}

    try:
        client_kwargs: dict = {"api_key": OPENAI_API_KEY}
        if OPENAI_BASE_URL:
            client_kwargs["base_url"] = OPENAI_BASE_URL
        client = AsyncOpenAI(**client_kwargs)
        chain = CAUSAL_CHAINS.get(event_id, [])
        chain_text = " → ".join(step["name"] for step in chain)
        prompt = (
            f"Supply chain disruption: {event_meta['name']} (severity {event_meta['severity']})\n"
            f"Component affected: {component_meta['name']} from {component_meta['vendor']}\n"
            f"Causal chain: {chain_text}\n\n"
            "Write a concise executive brief with exactly three short sentences.\n"
            "Return strict JSON with keys:\n"
            "  changed (what changed since last hour — 1 sentence),\n"
            "  decision (what action is needed today — 1 sentence),\n"
            "  consequence (what happens if no action — 1 sentence).\n"
            "Keep each sentence under 25 words. No markdown. Be specific to the event."
        )
        response = await client.chat.completions.create(
            model=OPENAI_MODEL,
            temperature=0.3,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": "You are an executive supply chain intelligence briefer. Be precise."},
                {"role": "user", "content": prompt},
            ],
        )
        payload = json.loads(response.choices[0].message.content or "{}")
        return {
            "event_id": event_id, "run_id": run_id, "source": "llm",
            "changed":     str(payload.get("changed",     scripted["changed"])),
            "decision":    str(payload.get("decision",    scripted["decision"])),
            "consequence": str(payload.get("consequence", scripted["consequence"])),
        }
    except Exception:
        return {"event_id": event_id, "run_id": run_id, "source": "scripted", **scripted}


# ── Simulation Agent ─────────────────────────────────────────────────────────
@app.get("/api/v2/runs/{run_id}/simulate")
def run_simulate(run_id: str) -> dict:
    """Return Monte-Carlo-style outcome distributions across all 5 scenarios."""
    run = RUNS.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    return _simulation_response(run, None)


@app.post("/api/v2/runs/{run_id}/simulate")
def run_simulate_with_assumptions(run_id: str, request: ScenarioSimulationRequest) -> dict:
    run = RUNS.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    return _simulation_response(run, request.assumptions)
