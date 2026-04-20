# Supply Chain Intelligence V2 — Complete Flow Architecture

> **Purpose**: Document the full technical flow so the same intelligence can be rebuilt with a new UI and richer insights, targeting Windows + Python backend + React frontend.

---

## 1. Tech Stack

| Layer | Technology | Version | Role |
|---|---|---|---|
| Backend framework | FastAPI | 0.111.0 | REST + SSE API |
| ASGI server | Uvicorn | 0.30.1 | Runs on port 8003 |
| LLM (primary) | OpenAI (`gpt-4.1-mini`) | openai 1.76.0 | Agent reasoning, debates, narratives |
| LLM (fallback) | Ollama (`qwen2.5:7b`) | local | Offline / cost-free fallback |
| Time-series forecast | TimesFM (Google) | external/local API | 7–90 day demand/inventory runway |
| Signal detection | Google News RSS | http fetch | AutoResearch agent scans supply signals |
| Graph DB (optional) | Neo4j | 5.23.1 | Agent interaction topology |
| Frontend | React 19 + Vite 8 | — | SPA on port 5175 |
| Routing | React Router 7 | — | 6-tab results flow |
| Charts | ECharts 6 + echarts-for-react | — | All data visualizations |
| Animation | Framer Motion 12 | — | Page + card transitions |
| Graph viz | @xyflow/react 12 | — | Knowledge graph / swarm canvas |

---

## 2. Environment Variables

### Backend (set before `uvicorn app.main:app`)
```
OPENAI_API_KEY=sk-...           # Required for LLM mode
OPENAI_MODEL=gpt-4.1-mini       # Configurable; any OpenAI-compatible model
OPENAI_BASE_URL=                # Optional: Azure, vLLM, LiteLLM proxy

OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:7b

TIMESFM_API_URL=                # Optional external TimesFM endpoint
TIMESFM_API_KEY=
TIMESFM_PROVIDER=local          # "local" | "external"

AUTORESEARCH_RSS_URL=https://news.google.com/rss/search
AUTORESEARCH_MAX_ITEMS=4

NEO4J_URI=bolt://localhost:7687  # Optional
NEO4J_USER=neo4j
NEO4J_PASSWORD=
```

### Frontend (.env)
```
VITE_API_BASE=http://localhost:8003
```

---

## 3. Data Architecture

### All Data Is In-Memory (No Database Required for Base Mode)
All reference data lives as Python dicts in `backend/app/main.py`:

| Data Store | Contents |
|---|---|
| `EVENTS` | 6 disruption events (Taiwan EQ, US-China Tariff, Hormuz Closure, Trade War, Malaysia Floods, TSMC Fire) |
| `COMPONENTS` | 4 components: LPDDR5 Memory, CPU, GPU Display Chip, Battery Pack |
| `CAUSAL_CHAINS` | Event → multi-stage causal impact (Root → Fab → Supply → Assembly → Cost) |
| `SCENARIOS` (A–E) | Per-event: fulfillment %, cost delta, lead-time, risk, confidence |
| `VENDOR_CATALOG` | 3–4 vendors per component with tier (domestic / nearshore / friend-shore) |
| `ROUTE_CATALOG` | 9 routes linking vendors to destination (air/sea) |
| `CORRIDOR_GRAPH` | Maritime + air corridors with live risk status (Hormuz, Red Sea, Malacca…) |
| `PRODUCT_LIBRARY` | 2 SKUs: XPS 15 i9+RTX4080, Latitude 14 Ultra 7 — BOM, burn rates, inventory |
| `SKU_MARGIN_PROFILES` | Revenue, target margin %, floor margin %, fixed conversion cost |
| `COMPONENT_COST_BASIS` | Unit costs: CPU $318, GPU $412, Memory $88, Battery $92 |
| `PRICE_REGION_MULTIPLIERS` | Regional cost adjustments (US 1.0×, MX 0.96×, KR 0.98×…) |
| `EVENT_DEBATES` | Pre-scripted agent messages per event (scripted mode fallback) |
| `JUDGE_VERDICTS` | Consensus decisions + dissent notes per event |
| `RISK_HEATMAP` | 4-dimension risk severity map per event |
| `KNOWLEDGE_GRAPH` | Agent interaction topology (in-memory fallback when Neo4j absent) |
| `RUNS` | Live dict: run_id → {event, component, debates, status, progress} |
| `ORDER_CONTEXTS` | Live dict: order_id → BOM context, selected scenario, delivery promises |
| `METRIC_EVENTS` | Audit trail: order_ingested, swarm_deployed, feedback_loop, etc. |

---

## 4. AI Agent System

### Six Agent Workers + One Judge

| Agent | Tag | Driver | Role |
|---|---|---|---|
| **AutoResearch** | signal | google-news-rss | Scans RSS for freshest operational signal; surfaces what changed first |
| **CausalGraph** | causal | llm | Explains highest-impact causal path: disruption → supply impact |
| **TimesFM** | forecast | timesfm-local/api | 7–90 day delivery & inventory runway forecast with p10/p50/p90 bands |
| **RiskScorer** | risk | llm | Quantifies severity; identifies risk concentration & exposure |
| **RecEngine** | decision | llm | Recommends best mitigation scenario with tradeoff justification |
| **JudgeAgent** | verdict | llm | Reviews all 5 agents; scores consistency 1–10; flags dissent |

### Agent Mode (auto-detected at runtime)
```
hybrid   → LLM + external services (TIMESFM, RSS) both available
llm      → OpenAI or Ollama only
external → Only TIMESFM / RSS available
scripted → Fully offline; pre-written EVENT_DEBATES used
```

### Orchestration Pattern
```python
# Parallel async execution (no framework — pure asyncio)
tasks = [_generate_live_agent_insight(req) for req in agent_requests]
results = await asyncio.gather(*tasks)
```
- 45-second TTL cache per `card_id`
- SSE stream endpoint for live card delivery: `GET /api/v2/agents/page-insights/stream`

### Swarm Debate Flow (V3)
```
POST /api/v2/runs            → create run_id, assign event + component
POST /api/v2/runs/{id}/deploy → trigger _generate_run_debates() → 5 agents debate
GET  /api/v2/runs/{id}/stream → SSE: one log line per agent per cycle, 1s pacing
GET  /api/v2/runs/{id}/status → {status, progress 0–100, stage}
```

---

## 5. Complete API Surface

### System
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v2/health` | Agent mode, LLM status, model info |
| GET | `/api/v2/agents/providers` | Registry of all agent providers |
| GET | `/api/v2/command-center/state` | Events, components, scenarios, causal chains |
| GET | `/api/v2/metrics/events` | Audit trail events |
| GET | `/api/v2/metrics/summary` | Aggregate: orders processed, agents deployed, feedback loops |

### Agent Intelligence
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v2/agents/{agent_name}/insight` | Single agent card |
| POST | `/api/v2/agents/page-insights` | Batch agent cards for a page (asyncio.gather) |
| GET | `/api/v2/agents/page-insights/stream` | SSE live agent cards |
| GET | `/api/v2/agents/interaction-graph` | Neo4j or fallback agent topology |
| GET | `/api/v2/swarm/knowledge-graph` | Supply chain topology (vendors, routes, ports, risk zones) |

### Vendor & Route
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v2/vendor-intel` | Filter vendors by component/country/status |
| POST | `/api/v2/vendor-intel` | Vendor intel with event + scenario overlays |
| POST | `/api/v2/vendor-scoring` | Score vendors (reliability/cost/speed/geo-risk) |
| POST | `/api/v2/route-optimizer` | Optimize routes by mode, cost, risk, blocked corridors |

### Simulation & Scenario
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v2/scenario-planner` | Scenarios A–E (fulfillment / cost / lead-time) |
| POST | `/api/v2/scenario-planner` | Scenarios with custom assumptions |
| POST | `/api/v2/runs/{id}/simulate` | Monte Carlo (1,000 rollouts per scenario) |
| GET | `/api/v2/runs/{id}/simulate` | Cached simulation results |

### Orders & Disruption
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v2/orders/ingest` | Ingest order; compute BOM disruption per component |
| GET | `/api/v2/orders/{id}` | Order context (BOM, criticality) |
| GET | `/api/v2/orders/open` | Open orders with delivery promises |
| GET | `/api/v2/orders/{id}/disruption-impact` | Tariff / vendor / freight / lead-time cost deltas |
| GET | `/api/v2/orders/{id}/decision-context` | Unified decision: event + BOM + margin + recommendations |
| GET | `/api/v2/orders/{id}/executive-snapshot` | High-level risk summary |
| GET | `/api/v2/orders/{id}/components/{cid}/deep-dive` | Component economics, vendors, routes, cost drivers |
| GET | `/api/v2/orders/{id}/decision-panel` | CFO narrative + tradeoffs |
| GET | `/api/v2/orders/{id}/monitoring` | Post-execution leading indicators |
| GET | `/api/v2/orders/{id}/risk-dashboard` | Risk heatmap (Supply, Cost, Speed, Resilience) |
| GET | `/api/v2/orders/{id}/shock-forecast` | TimesFM inventory runway forecast |
| GET | `/api/v2/orders/{id}/critical-alert` | Components requiring intervention |

### Negotiation & Procurement
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v2/orders/{id}/negotiation-brief` | Vendor negotiation bands, leverage, price anchors |
| POST | `/api/v2/delivery-promise` | Promise delivery date by vendor/route |
| GET | `/api/v2/orders/{id}/profit-recommendation` | Best vendor/route for max profit + rollback triggers |
| POST | `/api/v2/operations-plan` | Action plan from selected scenario |

### Execution & Learning
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v2/execution/actions` | Execute PO, freight booking, customer notification (mock) |
| GET | `/api/v2/orders/{id}/execution-learning` | Predicted vs actual reconciliation + RL feedback |

### Swarm Runs
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v2/runs` | Create run |
| POST | `/api/v2/runs/{id}/deploy` | Deploy + trigger agent debates |
| GET | `/api/v2/runs` | List all runs |
| GET | `/api/v2/runs/{id}/status` | Run progress (0–100) and stage |
| GET | `/api/v2/runs/{id}/stream` | SSE debate log stream |
| POST | `/api/v2/runs/{id}/narrative` | Generate/update run narrative |

---

## 6. Six-Module End-to-End Flow

### Module 1 — BOM + Global Intelligence
**Goal**: Ingest order context and surface disruption signals.

```
User selects: Event + Component
  → POST /api/v2/runs                    create run_id
  → GET  /api/v2/command-center/state    events, components, causal chains
  → POST /api/v2/agents/page-insights    [AutoResearch signal, RiskScorer risk]
  → Display: disruption timeline, BOM bottlenecks, agent signal cards
```

### Module 2 — Event Trigger + Cost Impact
**Goal**: Quantify cost and timeline impact of the disruption.

```
User reviews disruption tags; adjusts tariff rates / intensity
  → POST /api/v2/runs/{id}/deploy         trigger 5-agent debate
  → POST /api/v2/orders/ingest            BOM context, stockout runway
  → GET  /api/v2/orders/{id}/disruption-impact  tariff / vendor / freight deltas
  → Poll /api/v2/runs/{id}/status every 1s
  → Auto-advance to Module 3 when progress >= 100
```

### Module 3 — Price Simulation Engine
**Goal**: Monte Carlo scenario comparison across 5 options (A–E).

```
User configures: SKU, route blocks, tariff overrides, disruption intensity
  → POST /api/v2/scenario-planner         5 scenarios with custom assumptions
  → POST /api/v2/runs/{id}/simulate       1,000 Monte Carlo rollouts per scenario
  → GET  /api/v2/orders/{id}/shock-forecast  TimesFM inventory runway
  → Display: scenario comparison table, radar chart, profit waterfall
    (Revenue − Procurement − Logistics − Tariff = Profit)
```

### Module 4 — Negotiation Intelligence
**Goal**: Surface vendor negotiation bands and leverage points.

```
User selects scenario; views vendor briefs
  → GET /api/v2/orders/{id}/negotiation-brief   bands, anchors, leverage per vendor
  → POST /api/v2/vendor-intel (with scenario)   stress-tested vendor profiles
  → Display: DealZoneChart, NegotiationVendorRadar, AgentNegotiationTimeline
```

### Module 5 — Recommendation Engine
**Goal**: Best vendor/route selection with profit protection.

```
User reviews ranked options; approves or requests alternative
  → GET  /api/v2/orders/{id}/profit-recommendation   best vendor + rollback triggers
  → GET  /api/v2/orders/{id}/decision-context         unified decision narrative
  → POST /api/v2/operations-plan                       action plan
  → Display: RecommendationRankChart, TradeoffChart, CFO rationale
```

### Module 6 — Action + Reinforcement Learning
**Goal**: Execute decision and close the learning loop.

```
User approves execution; provides outcome feedback
  → POST /api/v2/execution/actions              PO + freight + notification (mock)
  → GET  /api/v2/orders/{id}/execution-learning  predicted vs actual reconciliation
  → GET  /api/v2/metrics/summary                 aggregate learning metrics
  → Display: LearningDeltaBarChart, DecisionAccuracyTrendChart, RLCalibrationRadarChart
```

---

## 7. Frontend Architecture

### Routing (`App.jsx`)
```
/                         → InputConfigurationPage (event + component selection)
/deploy                   → SwarmDeploymentPage (live swarm canvas + debate stream)
/results/:section         → ResultsDashboardPage (6 tabs, auto-advance)
```

### State Management
- **FlowContext** (`context/FlowContext.jsx`): global `runInfo` {eventId, componentId, runId} + `orderContext` {sku, qty, region, etc.}
- **Local useState**: UI toggles, filters, sort orders, selected rows

### Key Components
| Component | Purpose |
|---|---|
| `LegacyDashboard.jsx` | Full 6-module dashboard (~4000 lines); all views |
| `SwarmDeployCanvas.jsx` | Interactive @xyflow graph of agent swarm |
| `Charts.jsx` | All ECharts components (20+ chart types) |
| `AIDebateStage.jsx` | Agent debate card visualizer |
| `BoardroomMode.jsx` | Fullscreen executive presentation mode |
| `NarrativeCopilot.jsx` | LLM narrative display |
| `SimulationPanel.jsx` | Monte Carlo controls + output |

### Chart Inventory
```
KnowledgeGraph2             Agent + supply chain topology graph
RiskHeatmapChart            4-dimension risk severity grid
ForecastChart               TimesFM p10/p50/p90 inventory bands
OutlookChart                Scenario outlook comparison
ScenarioComparisonTable     A–E side-by-side metrics
ScenarioRadarChart          Multi-axis scenario radar
MonteCarloBandChart         Distribution bands per scenario
ProfitWaterfallChart        Revenue → Cost → Profit waterfall
DealZoneChart               Negotiation band visualization
NegotiationImpactChart      Vendor price impact analysis
AgentNegotiationTimeline    Round-by-round negotiation simulation
NegotiationVendorRadar      Multi-vendor comparison radar
RecommendationRankChart     Score bar chart per scenario
RecommendationTradeoffChart Cost-fulfillment-risk bubble chart
RecommendationModeMixChart  Transport mode donut chart
LearningDeltaBarChart       Predicted vs actual deltas
DecisionAccuracyTrendChart  Accuracy over time line chart
RLCalibrationRadarChart     RL model update surface radar
```

---

## 8. New Flow Design Principles (for Rebuild)

### What to Keep
- FastAPI + Uvicorn on Windows (just `uvicorn app.main:app --reload --port 8003`)
- 6-module tab flow with auto-advance polling
- SSE streaming for live agent cards
- Agent mode detection (hybrid → llm → scripted fallback)
- ECharts for charts (excellent Windows compatibility, no canvas issues)
- Framer Motion for transitions
- FlowContext pattern for cross-module state

### What to Improve in New Flow
1. **Persistent storage**: Replace in-memory dicts with SQLite or DuckDB for runs/orders so state survives server restarts
2. **Real vendor data**: Connect live APIs (e.g. Flexport, supplier portals) instead of fixture catalogs
3. **Richer agent prompts**: Give each agent access to real documents (PDF BOM, contracts) via RAG (FAISS + sentence-transformers)
4. **Websockets instead of SSE**: For bidirectional agent communication
5. **User authentication**: Simple JWT so each user has their own order/run history
6. **Parallel module loading**: Prefetch Module N+1 data while user reviews Module N
7. **More insight panels**: Component-level deep-dive charts, corridor live status, multi-SKU comparison
8. **Export**: PDF/Excel export of recommendation + negotiation brief

### Windows Startup (New Flow)
```bat
REM backend
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8003

REM frontend (separate terminal)
cd frontend
npm install
npm run dev
```

---

## 9. Agent Prompt Structure (for Reference)

Each LLM agent receives a system prompt defining its role, then a user prompt with:
```
Event: {event_name} | Component: {component_name}
Context: {causal_chain summary}
Your role: {agent_tag specific instruction}
Output format: JSON with keys: headline, insight, confidence, evidence[]
```

**JudgeAgent** receives all 5 prior responses and outputs:
```json
{
  "consensus": "...",
  "score": 8,
  "dissent": "TimesFM forecast diverges from CausalGraph on lead-time by 12 days",
  "recommended_action": "..."
}
```

---

## 10. Key File Map

```
backend/app/main.py              All API routes + agent logic (~5500 lines)
backend/app/vendor_planner_data.py  Supplementary vendor/route data
backend/requirements.txt         Python dependencies

frontend/src/App.jsx             Router + top-level layout
frontend/src/LegacyDashboard.jsx All 6 module views (~4000 lines)
frontend/src/context/FlowContext.jsx  Global run + order state
frontend/src/components/Charts.jsx    All ECharts visualizations
frontend/src/components/SwarmDeployCanvas.jsx  Agent graph canvas
frontend/src/pages/ResultsDashboardPage.jsx    6-tab results shell
frontend/src/pages/InputConfigurationPage.jsx  Event + component input
frontend/src/pages/SwarmDeploymentPage.jsx     Swarm deploy + stream
frontend/.env                    VITE_API_BASE
```
