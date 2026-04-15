import asyncio
import json
import os
from datetime import datetime
from typing import Dict, List, Optional
from uuid import uuid4

from fastapi import FastAPI, HTTPException
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


OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL")
LLM_BACKEND_MODE = "llm" if OPENAI_API_KEY and AsyncOpenAI is not None else "scripted"


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
    return {"status": "ok", "ts": datetime.utcnow().isoformat(), "agent_mode": LLM_BACKEND_MODE, "model": OPENAI_MODEL if OPENAI_API_KEY else None}


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
            {"name": "AutoResearch", "status": "LIVE", "mode": LLM_BACKEND_MODE},
            {"name": "CausalGraph",  "status": "LIVE", "mode": LLM_BACKEND_MODE},
            {"name": "TimesFM",      "status": "LIVE", "mode": LLM_BACKEND_MODE},
            {"name": "RecEngine",    "status": "LIVE", "mode": LLM_BACKEND_MODE},
            {"name": "RiskScorer",   "status": "LIVE", "mode": LLM_BACKEND_MODE},
            {"name": "VendorIntel",  "status": "LIVE", "mode": LLM_BACKEND_MODE},
            {"name": "JudgeAgent",   "status": "LIVE", "mode": LLM_BACKEND_MODE},
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
    return {"run_id": run_id, "status": "created"}


@app.post("/api/v2/runs/{run_id}/deploy")
async def deploy_run(run_id: str) -> dict:
    run = RUNS.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    run["debates"] = await _generate_run_debates(run)
    run["deployed_at"] = datetime.utcnow()
    run["agent_mode"] = "llm" if OPENAI_API_KEY and AsyncOpenAI is not None else "scripted"
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
