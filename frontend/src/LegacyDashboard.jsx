import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import './App.css'
import AmbientBackground from './components/AmbientBackground'
import LivingSupplyMap from './components/LivingSupplyMap'
import { KnowledgeGraph2, RiskHeatmapChart, ForecastChart, OutlookChart, ScenarioComparisonTable, ScenarioRadarChart, MonteCarloBandChart, ProfitWaterfallChart, DealZoneChart, NegotiationImpactChart, AgentNegotiationTimeline, NegotiationVendorRadar, RecommendationRankChart, RecommendationTradeoffChart, RecommendationModeMixChart, LearningDeltaBarChart, DecisionAccuracyTrendChart, RLCalibrationRadarChart } from './components/Charts'
import ScenarioFilmstrip from './components/ScenarioFilmstrip'
import AIDebateStage, { SwarmInteractionBoard } from './components/AIDebateStage'
import BoardroomMode from './components/BoardroomMode'
import NarrativeCopilot from './components/NarrativeCopilot'
import SimulationPanel from './components/SimulationPanel'
import SimulationControlModule, { DEFAULT_SIMULATION_CONFIG } from './components/flow/SimulationControlModule'
import SwarmDeployCanvas from './components/SwarmDeployCanvas'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8003'

const storySteps = ['Signal', 'Cause', 'Forecast', 'Risk', 'Decision']

const tagVisuals = {
  signal:   { label: 'Signal Confidence', score: 82 },
  causal:   { label: 'Causal Strength',   score: 74 },
  forecast: { label: 'Forecast Confidence', score: 79 },
  risk:     { label: 'Risk Severity',     score: 86 },
  decision: { label: 'Decision Readiness', score: 91 },
}

const vendorStatuses = ['All Statuses', 'ACTIVE', 'AT-RISK']
const plannerPriorities = ['Balanced', 'Speed', 'Cost', 'Risk']
const plannerHorizons  = ['7', '14', '30', '90']
const vendorTierOptions = ['domestic', 'nearshore', 'friend-shore']
const defaultVendorWeights = { reliability: 0.4, cost: 0.3, speed: 0.2, geo_penalty: 0.1 }
const groupedPageIds = new Set([
  'bom-intelligence',
  'disruption-impact',
  'simulation-lab',
  'negotiation-intelligence',
  'recommendation-engine',
  'action-learning',
  // Backward-compatible aliases.
  'negotiation-recommendation',
  'execution-learning',
])
const groupedInsightPageMap = {
  'bom-intelligence': 'risk-dashboard',
  'disruption-impact': 'component-analysis',
  'simulation-lab': 'procurement-actions',
  'negotiation-intelligence': 'alerts-decisions',
  'recommendation-engine': 'procurement-actions',
  'action-learning': 'execution-log',
  'negotiation-recommendation': 'alerts-decisions',
  'execution-learning': 'execution-log',
}

const disruptionTriggerOptions = [
  { value: 'tariff', label: 'Tariff Event' },
  { value: 'vessel-disruption', label: 'Vessel Disruption' },
  { value: 'port-closure', label: 'Port Closure' },
  { value: 'commodity-spike', label: 'Commodity Price Spike' },
]

const defaultTriggerTypeByEvent = {
  'us-china-tariff': 'tariff',
  'us-china-trade-war': 'tariff',
  'hormuz-closure': 'vessel-disruption',
  'malaysia-floods': 'port-closure',
  'taiwan-earthquake': 'commodity-spike',
  'tsmc-factory-fire': 'commodity-spike',
}

function LiveAgentCard({ agentLabel, insight, fallbackTitle, fallbackBody, isWorking, timeline = [], onOpenDebug }) {
  const summary = insight?.summary || fallbackTitle
  const body = fallbackBody || ''
  const confidence = insight?.confidence
  const citations = insight?.citations || []
  const trace = insight?.tool_trace || []
  const runtime = insight?.llm || {}
  const runtimeLabel = runtime?.provider_type || runtime?.backend
  const runtimeLatency = typeof runtime?.latency_ms === 'number' ? `${runtime.latency_ms}ms` : null
  const runtimeCost = typeof runtime?.cost_usd === 'number' ? `$${runtime.cost_usd.toFixed(4)}` : null
  const forecast = insight?.forecast
  const forecastStart = forecast?.point?.[0]
  const forecastEnd = forecast?.point?.[forecast?.point?.length - 1]
  const bandStart = forecast?.lower?.[0] != null && forecast?.upper?.[0] != null
    ? `${forecast.lower[0]}-${forecast.upper[0]}`
    : null
  const bandEnd = forecast?.lower?.[forecast?.lower?.length - 1] != null && forecast?.upper?.[forecast?.upper?.length - 1] != null
    ? `${forecast.lower[forecast.lower.length - 1]}-${forecast.upper[forecast.upper.length - 1]}`
    : null
  return (
    <>
      <div className="agent-card-toolbar">
        <span className="agent-name">{agentLabel}</span>
        <div className="agent-toolbar-actions">
          <span className={`agent-status-pill ${isWorking ? 'working' : 'ready'}`}>{isWorking ? 'WORKING' : 'LIVE'}</span>
          <button className="agent-debug-btn" onClick={onOpenDebug} disabled={!insight?.debug}>Debug</button>
        </div>
      </div>
      <strong>{summary}</strong>
      {body ? <p>{body}</p> : null}
      {typeof confidence === 'number' && <p className="agent-meta">Confidence: {confidence}%</p>}
      {(runtimeLabel || runtimeLatency || runtimeCost) && (
        <p className="agent-meta">
          Runtime: {runtimeLabel || 'unknown'}
          {runtime?.model ? ` · ${runtime.model}` : ''}
          {runtimeLatency ? ` · ${runtimeLatency}` : ''}
          {runtimeCost ? ` · Cost ${runtimeCost}` : ''}
        </p>
      )}
      {forecast && (
        <p className="agent-meta">
          Local forecast: {forecastStart ?? '--'} → {forecastEnd ?? '--'}
          {bandStart ? ` · Band(${forecast.interval || '80%'}) D1 ${bandStart}` : ''}
          {bandEnd ? ` · D${forecast.horizon_days || forecast.point?.length || 7} ${bandEnd}` : ''}
        </p>
      )}
      {timeline.length > 0 && (
        <div className="agent-timeline">
          {timeline.slice(0, 5).map((item, index) => (
            <div key={`${item.label}-${index}`} className={`agent-timeline-item ${item.status || 'ready'}`}>
              <span>{item.label}</span>
              {item.meta ? <strong>{item.meta}</strong> : null}
            </div>
          ))}
        </div>
      )}
      {citations.length > 0 && (
        <div className="agent-citations">
          {citations.slice(0, 2).map((citation) => (
            <span key={citation.id} className="agent-citation-chip">{citation.id}: {citation.source}</span>
          ))}
        </div>
      )}
      {trace.length > 0 && (
        <p className="agent-trace">Tools: {trace.slice(0, 3).map((item) => `${item.tool} (${item.status})`).join(' | ')}</p>
      )}
    </>
  )
}

export default function App({ view = 'bom-intelligence', initialEventId, initialComponentId, initialRunId, initialOrderContext, onRunIdChange, onOrderContextChange, onRequestSectionChange }) {
  const shellRef = useRef(null)
  const hasAutoNavigatedRef = useRef(false)
  const round2 = (v) => Math.round(Number(v) * 100) / 100

  const [state, setState] = useState(null)
  const [bootError, setBootError] = useState('')
  const [selectedEventId, setSelectedEventId] = useState(initialEventId || 'hormuz-closure')
  const [selectedComponentId, setSelectedComponentId] = useState(initialComponentId || 'memory-lpdddr5')
  const [selectedScenario, setSelectedScenario] = useState('B')

  const [runId, setRunId] = useState(null)
  const [runStatus, setRunStatus] = useState(null)
  const [isDeploying, setIsDeploying] = useState(false)
  const [deployError, setDeployError] = useState('')

  const [isLivePaused, setIsLivePaused] = useState(false)
  const [selectedEdgeId, setSelectedEdgeId] = useState('')
  const [replayCursor, setReplayCursor] = useState(null)
  const [isReplayPlaying, setIsReplayPlaying] = useState(false)
  const [isBoardroomMode, setIsBoardroomMode] = useState(false)

  const [highlightedAgents, setHighlightedAgents] = useState([])
  const [runHistory, setRunHistory] = useState([])
  const [showHistory, setShowHistory] = useState(false)
  const [compareRunId, setCompareRunId] = useState(null)
  const [compareStatus, setCompareStatus] = useState(null)

  const [vendorSearch, setVendorSearch] = useState('')
  const [vendorCountryFilter, setVendorCountryFilter] = useState('All Countries')
  const [vendorStatusFilter, setVendorStatusFilter] = useState('All Statuses')
  const [selectedVendorKey, setSelectedVendorKey] = useState('')
  const [plannerHorizon, setPlannerHorizon] = useState('30')
  const [plannerPriority, setPlannerPriority] = useState('Balanced')
  const [scenarioConfig, setScenarioConfig] = useState(DEFAULT_SIMULATION_CONFIG)
  const [vendorData, setVendorData] = useState({ component_view: null, vendors: [], countries: ['All Countries'], statuses: vendorStatuses })
  const [plannerData, setPlannerData] = useState({ scenarios: [], inventory_points: [] })
  const [operationsPlan, setOperationsPlan] = useState(null)
  const [orderDraft, setOrderDraft] = useState({
    skuId: initialOrderContext?.skuId || 'xps-15-i9-rtx4080',
    quantity: initialOrderContext?.quantity || 1200,
    region: initialOrderContext?.region || 'NA',
    customerPriority: initialOrderContext?.customerPriority || 'standard',
  })
  const [orderContext, setOrderContext] = useState(null)
  const [orderLoading, setOrderLoading] = useState(false)
  const [orderError, setOrderError] = useState('')
  const [vendorScore, setVendorScore] = useState(null)
  const [vendorScoringLoading, setVendorScoringLoading] = useState(false)
  const [vendorScoringError, setVendorScoringError] = useState('')
  const [vendorTierFilter, setVendorTierFilter] = useState(vendorTierOptions)
  const [vendorWeights, setVendorWeights] = useState(defaultVendorWeights)
  const [lowRunwayThreshold, setLowRunwayThreshold] = useState(15)
  const [routePlan, setRoutePlan] = useState(null)
  const [routeError, setRouteError] = useState('')
  const [deliveryPromise, setDeliveryPromise] = useState(null)
  const [promiseLoading, setPromiseLoading] = useState(false)
  const [executionResult, setExecutionResult] = useState(null)
  const [executionMode, setExecutionMode] = useState('mock')
  const [executionLoading, setExecutionLoading] = useState(false)
  const [metricsSummary, setMetricsSummary] = useState(null)
  const [executiveSnapshot, setExecutiveSnapshot] = useState(null)
  const [selectedRiskComponentId, setSelectedRiskComponentId] = useState('')
  const [componentDeepDive, setComponentDeepDive] = useState(null)
  const [decisionPanel, setDecisionPanel] = useState(null)
  const [interactionGraph, setInteractionGraph] = useState({ backend: 'fallback', nodes: [], edges: [], configured: false, connected: false })
  const [interactionGraphLoading, setInteractionGraphLoading] = useState(false)
  const [interactionGraphError, setInteractionGraphError] = useState('')
  const [monitoringView, setMonitoringView] = useState(null)
  const [selectedBomCategory, setSelectedBomCategory] = useState('all')
  const [riskDashboard, setRiskDashboard] = useState(null)
  const [riskCriticalityFilter, setRiskCriticalityFilter] = useState('all')
  const [riskRegionFilter, setRiskRegionFilter] = useState('all')
  const [riskDaysFilter, setRiskDaysFilter] = useState(30)
  const [shockForecast, setShockForecast] = useState(null)
  const [criticalAlert, setCriticalAlert] = useState(null)
  const [openOrders, setOpenOrders] = useState([])
  const [decisionContextData, setDecisionContextData] = useState(null)
  const [disruptionImpactData, setDisruptionImpactData] = useState(null)
  const [profitRecommendationData, setProfitRecommendationData] = useState(null)
  const [executionLearningData, setExecutionLearningData] = useState(null)
  const [selectedResearchComponentId, setSelectedResearchComponentId] = useState('')
  const [vendorCounterOffer, setVendorCounterOffer] = useState('')
  const [impactTrigger, setImpactTrigger] = useState(null)
  const [impactTriggerType, setImpactTriggerType] = useState(defaultTriggerTypeByEvent[initialEventId] || 'tariff')
  const [impactTariffProfile, setImpactTariffProfile] = useState({ cn: 145, mx: 0, kr: 18, jp: 14, in: 10, other: 25 })
  const [selectedImpactComponentId, setSelectedImpactComponentId] = useState('')
  const [simulationTargetMarginPct, setSimulationTargetMarginPct] = useState(22)
  const [simulationLockedRevenueUnit, setSimulationLockedRevenueUnit] = useState(0)
  const [simulationFreightMode, setSimulationFreightMode] = useState('auto')
  const [simulationMonteCarloRuns, setSimulationMonteCarloRuns] = useState(1200)
  const [selectedSimulationScenarioId, setSelectedSimulationScenarioId] = useState('')
  const [materialAmplifications, setMaterialAmplifications] = useState({})

  // ── Module 4: Negotiation Intelligence ───────────────────────────────────
  const [negotiationBriefData, setNegotiationBriefData] = useState(null)
  const [activeNegVendorId, setActiveNegVendorId] = useState('')
  const [negoCounterInput, setNegoCounterInput] = useState('')
  const [negoAgentRunning, setNegoAgentRunning] = useState(false)
  const [negoSimScenarioId, setNegoSimScenarioId] = useState('')

  // ── Module 5: Recommendation Engine ─────────────────────────────────────
  const [recommendationSortBy, setRecommendationSortBy] = useState('margin')
  const [activeRecommendationId, setActiveRecommendationId] = useState('')
  const [recommendationNarrativeMode, setRecommendationNarrativeMode] = useState('template')
  const [llmNarrativeDigest, setLlmNarrativeDigest] = useState(null)

  // ── Module 6: Action + RL Learning ──────────────────────────────────────
  const [actionHistorySortBy, setActionHistorySortBy] = useState('recent')
  const [selectedLearningDecisionId, setSelectedLearningDecisionId] = useState('')

  const [liveAgentCards, setLiveAgentCards] = useState({})
  const [liveAgentLoading, setLiveAgentLoading] = useState(false)
  const [liveAgentError, setLiveAgentError] = useState('')
  const [liveAgentWorking, setLiveAgentWorking] = useState({})
  const [liveAgentTimeline, setLiveAgentTimeline] = useState({})
  const [selectedAgentDebug, setSelectedAgentDebug] = useState(null)
  const resolvedInsightPageId = groupedInsightPageMap[view] || view

  // ── New AI features ───────────────────────────────────────────────────────
  const [narrativeOpen,  setNarrativeOpen]  = useState(false)
  const [voiceListening, setVoiceListening] = useState(false)
  const voiceRef = useRef(null)
  const orderIngestKeyRef = useRef('')

  const activeOrderId = orderContext?.order_id || ''
  const activeDecisionComponentId = selectedRiskComponentId || orderContext?.bom?.bottleneck_component?.component_id || selectedComponentId
  const isImpactTriggered = useMemo(() => {
    if (!impactTrigger) return false
    return impactTrigger.eventId === selectedEventId && impactTrigger.componentId === activeDecisionComponentId
  }, [activeDecisionComponentId, impactTrigger, selectedEventId])

  const navigateToSection = useCallback((targetSection) => {
    if (!targetSection) return
    if (!groupedPageIds.has(view)) {
      onRequestSectionChange?.(targetSection)
      return
    }

    const mappedTargets = {
      'bom-intelligence': {
        'risk-dashboard': 'disruption-impact',
      },
      'disruption-impact': {
        'component-analysis': 'simulation-lab',
      },
      'simulation-lab': {
        'route-intelligence': 'negotiation-intelligence',
        'delivery-promise': 'negotiation-intelligence',
      },
      'negotiation-intelligence': {
        'delivery-promise': 'recommendation-engine',
        'execution-log': 'recommendation-engine',
      },
      'recommendation-engine': {
        'delivery-promise': 'action-learning',
        'execution-log': 'action-learning',
      },
      // Backward-compatible aliases.
      'negotiation-recommendation': { 'execution-log': 'action-learning' },
      'execution-learning': { 'execution-log': 'action-learning' },
    }

    onRequestSectionChange?.(mappedTargets[view]?.[targetSection] || targetSection)
  }, [onRequestSectionChange, view])

  const refreshHistory = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v2/runs`)
      if (!res.ok) return
      setRunHistory(await res.json())
    } catch {}
  }, [])

  // ── Voice Command Engine ────────────────────────────────────────────────
  const speak = useCallback((text) => {
    if (!window.speechSynthesis) return
    window.speechSynthesis.cancel()
    const utt = new SpeechSynthesisUtterance(text)
    utt.rate = 0.94; utt.pitch = 1.0
    window.speechSynthesis.speak(utt)
  }, [])

  // Stable action-refs that voice handler can call without dep-cycle issues
  const voiceActionsRef = useRef({})

  const startVoiceCommand = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { speak('Voice commands are not supported in this browser.'); return }
    if (voiceRef.current) { voiceRef.current.stop(); voiceRef.current = null; setVoiceListening(false); return }
    const rec = new SR()
    rec.continuous = false; rec.lang = 'en-US'; rec.interimResults = false
    voiceRef.current = rec
    rec.onstart  = () => setVoiceListening(true)
    rec.onend    = () => { setVoiceListening(false); voiceRef.current = null }
    rec.onerror  = () => { setVoiceListening(false); voiceRef.current = null }
    rec.onresult = (event) => {
      const cmd = event.results[0][0].transcript.toLowerCase()
      const actions = voiceActionsRef.current
      if (cmd.includes('narrative') || cmd.includes('brief') || cmd.includes('what changed')) {
        setNarrativeOpen(true); speak('Opening executive narrative.')
      } else if (cmd.includes('boardroom') || cmd.includes('presentation')) {
        actions.toggleBoardroom?.(); speak('Entering boardroom mode.')
      } else if (cmd.includes('deploy') || cmd.includes('swarm')) {
        actions.deploySwarm?.(); speak('Deploying AI swarm.')
      } else if (cmd.includes('risk') || cmd.includes('geo risk')) {
        speak(`Current geo risk score is ${actions.getGeoRisk?.() ?? 'unknown'} out of 100.`)
      } else if (cmd.includes('best scenario') || cmd.includes('recommend')) {
        setSelectedScenario('B'); speak('The recommended scenario is B: Split Fulfillment 60 40.')
      } else if (cmd.includes('scenario a')) { setSelectedScenario('A'); speak('Switching to Scenario A.')
      } else if (cmd.includes('scenario b')) { setSelectedScenario('B'); speak('Switching to Scenario B.')
      } else if (cmd.includes('scenario c')) { setSelectedScenario('C'); speak('Switching to Scenario C.')
      } else if (cmd.includes('scenario d')) { setSelectedScenario('D'); speak('Switching to Scenario D.')
      } else if (cmd.includes('scenario e')) { setSelectedScenario('E'); speak('Switching to Scenario E.')
      } else if (cmd.includes('confidence') || cmd.includes('delivery')) {
        speak(`Delivery confidence is ${actions.getConfidence?.() ?? 'unknown'} percent.`)
      } else {
        speak(`Command not recognised. Try: brief me, deploy swarm, best scenario, or geo risk.`)
      }
    }
    rec.start()
  }, [speak])

  const loadDashboardState = useCallback(async () => {
    setBootError('')
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 8000)
    try {
      const res = await fetch(`${API_BASE}/api/v2/command-center/state`, { signal: controller.signal })
      if (!res.ok) throw new Error(`state fetch failed (${res.status})`)
      const data = await res.json()
      setState(data)
      if (!initialEventId && data.events?.length) setSelectedEventId(data.events[0].id)
      if (!initialComponentId && data.components?.length) setSelectedComponentId(data.components[0].id)
    } catch (error) {
      console.error('load state failed', error)
      setBootError('Unable to reach intelligence backend. Verify backend is running on port 8003, then retry.')
    } finally {
      window.clearTimeout(timeoutId)
    }
  }, [initialComponentId, initialEventId])

  useEffect(() => {
    loadDashboardState()
    refreshHistory()
  }, [loadDashboardState, refreshHistory])

  useEffect(() => {
    if (!initialRunId) return
    setRunId(initialRunId)
    fetch(`${API_BASE}/api/v2/runs/${initialRunId}/status`)
      .then((r) => r.json())
      .then(setRunStatus)
      .catch(() => {})
  }, [initialRunId])

  useEffect(() => {
    if (!runId || isLivePaused) return
    let isCancelled = false

    const pollStatus = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/v2/runs/${runId}/status`)
        if (!response.ok || isCancelled) return
        const status = await response.json()
        if (isCancelled) return
        setRunStatus((prev) => ({
          ...prev,
          ...status,
          visible_logs: status.visible_logs || prev?.visible_logs || [],
          event_stream: status.event_stream || prev?.event_stream || [],
          knowledge_graph: status.knowledge_graph || prev?.knowledge_graph || { nodes: [], edges: [] },
          future_outlook: status.future_outlook || prev?.future_outlook || [],
          heatmap: status.heatmap || prev?.heatmap || [],
        }))
        if (status.status === 'completed') refreshHistory()
      } catch {}
    }

    pollStatus()
    const intervalId = window.setInterval(pollStatus, 1200)
    return () => {
      isCancelled = true
      window.clearInterval(intervalId)
    }
  }, [runId, isLivePaused, refreshHistory])

  useEffect(() => {
    if (!runId || isLivePaused) return
    const es = new EventSource(`${API_BASE}/api/v2/runs/${runId}/stream`)
    es.onmessage = (ev) => {
      try {
        const log = JSON.parse(ev.data)
        setRunStatus((prev) => {
          const existing = prev?.visible_logs || []
          if (existing.some((l) => l.agent === log.agent && l.timestamp === log.timestamp)) return prev
          const newLogs = [...existing, log]
          const total = prev?.total_logs || 5
          return {
            ...prev,
            run_id: runId,
            status: 'running',
            stage: 'debate',
            progress: Math.round((newLogs.length / total) * 100),
            visible_logs: newLogs,
            total_logs: total,
            active_agents: newLogs.length,
            total_agents: prev?.total_agents || 10,
            graph_ready: false,
            heatmap: prev?.heatmap || [],
            knowledge_graph: prev?.knowledge_graph || { nodes: [], edges: [] },
            future_outlook: prev?.future_outlook || [],
            event_stream: [
              ...(prev?.event_stream || []),
              { timestamp: log.timestamp, message: `${log.agent} joined debate channel`, status: 'join' },
              { timestamp: log.timestamp, message: `${log.agent} completed ${log.tag} analysis`, status: 'complete' },
            ],
          }
        })
      } catch {}
    }
    es.addEventListener('complete', (ev) => {
      try { setRunStatus(JSON.parse(ev.data)); refreshHistory() } catch {}
      es.close()
    })
    es.onerror = () => es.close()
    return () => es.close()
  }, [runId, isLivePaused, refreshHistory])

  useEffect(() => {
    if (!compareRunId) { setCompareStatus(null); return }
    fetch(`${API_BASE}/api/v2/runs/${compareRunId}/status`).then((r) => r.json()).then(setCompareStatus).catch(() => {})
  }, [compareRunId])

  useEffect(() => {
    if (!state) return
    fetch(`${API_BASE}/api/v2/vendor-intel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        component_id: selectedComponentId,
        search: vendorSearch,
        country: vendorCountryFilter,
        status: vendorStatusFilter,
        event_id: selectedEventId,
        scenario_id: selectedScenario,
        assumptions: scenarioConfig,
      }),
    })
      .then((r) => r.json())
      .then((data) => setVendorData({ component_view: data.component_view || null, vendors: data.vendors || [], countries: data.countries || ['All Countries'], statuses: data.statuses || vendorStatuses, scenario_overlay: data.scenario_overlay || null }))
      .catch(() => {})
  }, [state, selectedComponentId, selectedEventId, selectedScenario, vendorSearch, vendorCountryFilter, vendorStatusFilter, scenarioConfig])

  useEffect(() => {
    if (!state) return
    fetch(`${API_BASE}/api/v2/scenario-planner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_id: selectedEventId,
        component_id: selectedComponentId,
        scenario_id: selectedScenario,
        horizon: Number(plannerHorizon),
        priority: plannerPriority,
        assumptions: scenarioConfig,
      }),
    })
      .then((r) => r.json())
      .then((data) => setPlannerData(data || { scenarios: [], inventory_points: [] }))
      .catch(() => {})
  }, [state, selectedEventId, selectedComponentId, selectedScenario, plannerHorizon, plannerPriority, scenarioConfig])

  useEffect(() => {
    if (!state) return
    fetch(`${API_BASE}/api/v2/operations-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_id: selectedEventId,
        component_id: selectedComponentId,
        scenario_id: selectedScenario,
        horizon: Number(plannerHorizon),
        priority: plannerPriority,
        assumptions: scenarioConfig,
      }),
    })
      .then((r) => r.json())
      .then(setOperationsPlan)
      .catch(() => setOperationsPlan(null))
  }, [state, selectedEventId, selectedComponentId, selectedScenario, plannerHorizon, plannerPriority, scenarioConfig])

  useEffect(() => {
    if (!initialOrderContext) return
    setOrderDraft((prev) => ({
      ...prev,
      skuId: initialOrderContext.skuId || prev.skuId,
      quantity: initialOrderContext.quantity || prev.quantity,
      region: initialOrderContext.region || prev.region,
      customerPriority: initialOrderContext.customerPriority || prev.customerPriority,
    }))
  }, [initialOrderContext])

  useEffect(() => {
    const agentPages = new Set([
      'risk-dashboard',
      'component-analysis',
      'alerts-decisions',
      'procurement-actions',
      'route-intelligence',
      'delivery-promise',
      'execution-log',
      'bom-intelligence',
      'disruption-impact',
      'simulation-lab',
      'negotiation-intelligence',
      'recommendation-engine',
      'action-learning',
      'negotiation-recommendation',
      'execution-learning',
    ])
    if (!agentPages.has(view)) {
      setLiveAgentCards({})
      setLiveAgentWorking({})
      setLiveAgentTimeline({})
      setSelectedAgentDebug(null)
      setLiveAgentError('')
      setLiveAgentLoading(false)
      return
    }

    const params = new URLSearchParams({
      page_id: resolvedInsightPageId,
      event_id: selectedEventId,
      component_id: selectedRiskComponentId || selectedComponentId,
      scenario_id: selectedScenario,
    })
    if (activeOrderId) params.set('order_id', activeOrderId)

    setLiveAgentCards({})
    setLiveAgentWorking({})
    setLiveAgentTimeline({})
    setLiveAgentLoading(true)
    setLiveAgentError('')
    const eventSource = new EventSource(`${API_BASE}/api/v2/agents/page-insights/stream?${params.toString()}`)

    eventSource.addEventListener('page-status', () => {
      setLiveAgentLoading(true)
    })

    eventSource.addEventListener('card-start', (event) => {
      const payload = JSON.parse(event.data)
      setLiveAgentWorking((prev) => ({ ...prev, [payload.card_id]: true }))
      setLiveAgentTimeline((prev) => ({
        ...prev,
        [payload.card_id]: [
          ...(prev[payload.card_id] || []).slice(-4),
          { label: 'Agent started', status: 'working', meta: payload.agent_name },
        ],
      }))
    })

    eventSource.addEventListener('card-update', (event) => {
      const payload = JSON.parse(event.data)
      setLiveAgentCards((prev) => ({ ...prev, [payload.card_id]: payload }))
      setLiveAgentWorking((prev) => ({ ...prev, [payload.card_id]: false }))
      setLiveAgentTimeline((prev) => ({
        ...prev,
        [payload.card_id]: [
          { label: 'Context bundle', status: 'ready', meta: `${payload.citations?.length || 0} citations` },
          ...((payload.tool_trace || []).map((item) => ({
            label: item.tool,
            status: item.status,
            meta: `${item.latency_ms ?? 0}ms`,
          }))),
          { label: payload.llm?.provider_type || 'Model/API response', status: 'ready', meta: `${payload.llm?.latency_ms ?? 0}ms` },
        ],
      }))
      setSelectedAgentDebug((prev) => (prev?.card_id === payload.card_id ? payload : prev))
    })

    eventSource.addEventListener('page-complete', () => {
      setLiveAgentLoading(false)
    })

    eventSource.onerror = () => {
      setLiveAgentError('Streaming agent insights disconnected. Reopen the page or wait for reconnect.')
      setLiveAgentLoading(false)
      eventSource.close()
    }

    return () => eventSource.close()
  }, [activeOrderId, resolvedInsightPageId, selectedComponentId, selectedEventId, selectedRiskComponentId, selectedScenario, view])

  useEffect(() => {
    if (!selectedAgentDebug?.card_id) return
    const updated = liveAgentCards[selectedAgentDebug.card_id]
    if (updated) setSelectedAgentDebug(updated)
  }, [liveAgentCards, selectedAgentDebug])

  useEffect(() => {
    const availableComponents = decisionContextData?.component_requirement_set || []
    if (!availableComponents.length) {
      setSelectedResearchComponentId('')
      return
    }
    if (!availableComponents.some((component) => component.component_id === selectedResearchComponentId)) {
      setSelectedResearchComponentId(availableComponents[0].component_id)
    }
  }, [decisionContextData?.component_requirement_set, selectedResearchComponentId])

  useEffect(() => {
    const impacted = disruptionImpactData?.affected_components || []
    if (!impacted.length) {
      setSelectedImpactComponentId('')
      return
    }
    if (!impacted.some((item) => item.component_id === selectedImpactComponentId)) {
      setSelectedImpactComponentId(impacted[0].component_id)
    }
  }, [disruptionImpactData?.affected_components, selectedImpactComponentId])

  useEffect(() => {
    setImpactTriggerType(defaultTriggerTypeByEvent[selectedEventId] || 'tariff')
  }, [selectedEventId])

  useEffect(() => {
    const bottleneckId = orderContext?.bom?.bottleneck_component?.component_id
    if (bottleneckId) setSelectedRiskComponentId(bottleneckId)
  }, [orderContext?.bom?.bottleneck_component?.component_id])

  const ingestOrder = useCallback(async () => {
    setOrderLoading(true)
    setOrderError('')
    try {
      const response = await fetch(`${API_BASE}/api/v2/orders/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku_id: orderDraft.skuId,
          quantity: Number(orderDraft.quantity),
          region: orderDraft.region,
          customer_priority: orderDraft.customerPriority,
          event_id: selectedEventId,
        }),
      })
      if (!response.ok) throw new Error('order ingest failed')
      const data = await response.json()
      setOrderContext(data)
      onOrderContextChange?.({
        orderId: data.order_id,
        skuId: data.sku_id,
        quantity: data.quantity,
        region: data.region,
        customerPriority: data.customer_priority,
      })
      const bottleneckComponentId = data?.bom?.bottleneck_component?.component_id
      if (bottleneckComponentId && state?.components?.some((c) => c.id === bottleneckComponentId)) {
        setSelectedComponentId(bottleneckComponentId)
      }
    } catch {
      setOrderError('Unable to ingest order context. Verify backend and try again.')
      orderIngestKeyRef.current = ''
    } finally {
      setOrderLoading(false)
    }
  }, [onOrderContextChange, orderDraft.customerPriority, orderDraft.quantity, orderDraft.region, orderDraft.skuId, selectedEventId, state?.components])

  useEffect(() => {
    if (!state || !['orders-intake', 'bom-intelligence'].includes(view)) return
    const ingestKey = `${selectedEventId}|${orderDraft.skuId}|${orderDraft.quantity}|${orderDraft.region}|${orderDraft.customerPriority}`
    if (orderIngestKeyRef.current === ingestKey || orderLoading) return
    orderIngestKeyRef.current = ingestKey
    ingestOrder()
  }, [ingestOrder, orderDraft.customerPriority, orderDraft.quantity, orderDraft.region, orderDraft.skuId, orderLoading, selectedEventId, state, view])

  useEffect(() => {
    if (!activeOrderId || !['procurement-actions', 'simulation-lab', 'recommendation-engine', 'action-learning', 'execution-learning'].includes(view)) return
    const targetComponentId = orderContext?.bom?.bottleneck_component?.component_id || selectedComponentId
    if (!targetComponentId) return
    setVendorScoringLoading(true)
    setVendorScoringError('')
    fetch(`${API_BASE}/api/v2/vendor-scoring`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id: activeOrderId,
        component_id: targetComponentId,
        tier_filter: vendorTierFilter,
        dynamic_switch: true,
        low_runway_threshold: Number(lowRunwayThreshold),
        weights: vendorWeights,
      }),
    })
      .then((r) => {
        if (!r.ok) throw new Error('vendor scoring failed')
        return r.json()
      })
      .then((data) => {
        setVendorScore(data)
        const topVendor = data?.ranked_vendors?.[0]
        if (!topVendor) {
          setRoutePlan(null)
          return
        }
        return fetch(`${API_BASE}/api/v2/route-optimizer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            order_id: activeOrderId,
            component_id: targetComponentId,
            vendor_id: topVendor.vendor_id,
            blocked_corridors: [],
            mode_preference: plannerPriority.toLowerCase(),
          }),
        })
          .then((r) => {
            if (!r.ok) throw new Error('route optimizer failed')
            return r.json()
          })
          .then((routeData) => {
            setRoutePlan(routeData)
            setRouteError('')
          })
      })
      .catch(() => {
        setVendorScoringError('Vendor scoring is unavailable for this selection.')
        setRouteError('Route optimizer unavailable until a valid vendor is ranked.')
      })
      .finally(() => setVendorScoringLoading(false))
  }, [activeOrderId, lowRunwayThreshold, orderContext?.bom?.bottleneck_component?.component_id, plannerPriority, selectedComponentId, vendorTierFilter, vendorWeights, view])

  useEffect(() => {
    if (!activeOrderId) {
      setExecutiveSnapshot(null)
      setMonitoringView(null)
      setRiskDashboard(null)
      setShockForecast(null)
      setCriticalAlert(null)
      setDecisionContextData(null)
      setDisruptionImpactData(null)
      setProfitRecommendationData(null)
      setExecutionLearningData(null)
      return
    }
    fetch(`${API_BASE}/api/v2/orders/${activeOrderId}/executive-snapshot`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setExecutiveSnapshot(data)
      })
      .catch(() => {})

    fetch(`${API_BASE}/api/v2/orders/${activeOrderId}/monitoring`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setMonitoringView(data)
      })
      .catch(() => {})

    fetch(`${API_BASE}/api/v2/orders/${activeOrderId}/risk-dashboard`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setRiskDashboard(data)
      })
      .catch(() => {})

    fetch(`${API_BASE}/api/v2/orders/${activeOrderId}/critical-alert`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setCriticalAlert(data)
      })
      .catch(() => {})

    fetch(`${API_BASE}/api/v2/orders/${activeOrderId}/decision-context`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setDecisionContextData(data)
      })
      .catch(() => {})
  }, [activeOrderId, executionResult, view])

  useEffect(() => {
    if (!activeOrderId || !selectedRiskComponentId) {
      setComponentDeepDive(null)
      setShockForecast(null)
      return
    }
    fetch(`${API_BASE}/api/v2/orders/${activeOrderId}/components/${selectedRiskComponentId}/deep-dive`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setComponentDeepDive(data)
      })
      .catch(() => {})

    fetch(`${API_BASE}/api/v2/orders/${activeOrderId}/shock-forecast?component_id=${encodeURIComponent(selectedRiskComponentId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setShockForecast(data)
      })
      .catch(() => {})

    fetch(`${API_BASE}/api/v2/orders/${activeOrderId}/critical-alert?component_id=${encodeURIComponent(selectedRiskComponentId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setCriticalAlert(data)
      })
      .catch(() => {})
  }, [activeOrderId, selectedRiskComponentId, view])

  useEffect(() => {
    if (!activeOrderId || !activeDecisionComponentId) {
      setDisruptionImpactData(null)
      setProfitRecommendationData(null)
      setExecutionLearningData(null)
      return
    }

    if (view === 'disruption-impact' && !isImpactTriggered) {
      setDisruptionImpactData(null)
      return
    }

    const disruptionParams = new URLSearchParams({
      component_id: activeDecisionComponentId,
      event_id: selectedEventId,
      trigger_type: impactTriggerType,
      tariff_cn: String(impactTariffProfile.cn),
      tariff_mx: String(impactTariffProfile.mx),
      tariff_kr: String(impactTariffProfile.kr),
      tariff_jp: String(impactTariffProfile.jp),
      tariff_in: String(impactTariffProfile.in),
      tariff_other: String(impactTariffProfile.other),
    })
    fetch(`${API_BASE}/api/v2/orders/${activeOrderId}/disruption-impact?${disruptionParams.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setDisruptionImpactData(data)
      })
      .catch(() => {})

    const recommendationParams = new URLSearchParams({
      component_id: activeDecisionComponentId,
      event_id: selectedEventId,
      trigger_type: impactTriggerType,
      target_margin_pct: String(simulationTargetMarginPct),
      freight_mode: simulationFreightMode,
      monte_carlo_runs: String(simulationMonteCarloRuns),
    })
    if (simulationLockedRevenueUnit > 0) {
      recommendationParams.set('locked_revenue_unit', String(simulationLockedRevenueUnit))
    }
    fetch(`${API_BASE}/api/v2/orders/${activeOrderId}/profit-recommendation?${recommendationParams.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setProfitRecommendationData(data)
      })
      .catch(() => {})

    // ── Module 4: Negotiation brief fetch ──────────────────────────────────
    if (['negotiation-intelligence', 'negotiation-recommendation'].includes(view)) {
      const negoParams = new URLSearchParams({
        component_id: activeDecisionComponentId,
        event_id: selectedEventId,
        trigger_type: impactTriggerType,
        target_margin_pct: String(simulationTargetMarginPct),
      })
      if (simulationLockedRevenueUnit > 0) negoParams.set('locked_revenue_unit', String(simulationLockedRevenueUnit))
      if (negoSimScenarioId) negoParams.set('simulation_scenario_id', negoSimScenarioId)
      fetch(`${API_BASE}/api/v2/orders/${activeOrderId}/negotiation-brief?${negoParams.toString()}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data) setNegotiationBriefData(data)
        })
        .catch(() => {})
    }
  }, [
    activeDecisionComponentId,
    activeOrderId,
    impactTariffProfile.cn,
    impactTariffProfile.in,
    impactTariffProfile.jp,
    impactTariffProfile.kr,
    impactTariffProfile.mx,
    impactTariffProfile.other,
    impactTriggerType,
    isImpactTriggered,
    simulationFreightMode,
    simulationLockedRevenueUnit,
    simulationMonteCarloRuns,
    simulationTargetMarginPct,
    negoSimScenarioId,
    selectedEventId,
    selectedScenario,
    view,
  ])

  useEffect(() => {
    if (!decisionContextData?.margin_constraints?.unit_revenue) return
    if (simulationLockedRevenueUnit > 0) return
    setSimulationLockedRevenueUnit(Number(decisionContextData.margin_constraints.unit_revenue))
  }, [decisionContextData?.margin_constraints?.unit_revenue, simulationLockedRevenueUnit])

  useEffect(() => {
    const simulationScenarios = profitRecommendationData?.scenarios?.slice(0, 4) || []
    if (!simulationScenarios.length) {
      setSelectedSimulationScenarioId('')
      return
    }
    if (!selectedSimulationScenarioId || !simulationScenarios.some((item) => item.scenario_id === selectedSimulationScenarioId)) {
      setSelectedSimulationScenarioId(simulationScenarios[0].scenario_id)
    }
  }, [profitRecommendationData?.scenarios, selectedSimulationScenarioId])

  useEffect(() => {
    const recommendationOptions = (profitRecommendationData?.scenarios || []).map((scenario) => ({
      id: scenario.scenario_id,
      projectedMarginPct: Number(scenario.gross_margin_pct || 0),
      riskScore: Number(scenario.execution_risk || 0),
      leadTimeDays: Number(scenario.route_mode === 'air' ? 4 : scenario.route_mode === 'sea' ? 12 : 10),
      totalLandedCost: Number(scenario.procurement_cost || 0) + Number(scenario.logistics_cost || 0) + Number(scenario.tariff_cost || 0),
    }))
    const sorted = [...recommendationOptions]
    if (recommendationSortBy === 'risk') sorted.sort((a, b) => a.riskScore - b.riskScore)
    else if (recommendationSortBy === 'lead') sorted.sort((a, b) => a.leadTimeDays - b.leadTimeDays)
    else if (recommendationSortBy === 'cost') sorted.sort((a, b) => a.totalLandedCost - b.totalLandedCost)
    else sorted.sort((a, b) => b.projectedMarginPct - a.projectedMarginPct)

    if (!sorted.length) {
      setActiveRecommendationId('')
      return
    }
    if (!activeRecommendationId || !sorted.some((item) => item.id === activeRecommendationId)) {
      setActiveRecommendationId(sorted[0].id)
    }
  }, [activeRecommendationId, profitRecommendationData?.scenarios, recommendationSortBy])

  useEffect(() => {
    const history = executionLearningData?.decision_history?.decisions || []
    const sorted = [...history]
    if (actionHistorySortBy === 'accuracy') sorted.sort((a, b) => Number(b.accuracy_score || 0) - Number(a.accuracy_score || 0))
    else if (actionHistorySortBy === 'margin-delta') sorted.sort((a, b) => Math.abs(Number(b.actual_margin_pct || 0) - Number(b.projected_margin_pct || 0)) - Math.abs(Number(a.actual_margin_pct || 0) - Number(a.projected_margin_pct || 0)))
    else if (actionHistorySortBy === 'cost-delta') sorted.sort((a, b) => Math.abs(Number(b.actual_total_cost || 0) - Number(b.projected_total_cost || 0)) - Math.abs(Number(a.actual_total_cost || 0) - Number(a.projected_total_cost || 0)))
    else sorted.sort((a, b) => String(b.decision_date || '').localeCompare(String(a.decision_date || '')))

    if (!sorted.length) {
      setSelectedLearningDecisionId('')
      return
    }
    if (!selectedLearningDecisionId || !sorted.some((item) => item.decision_id === selectedLearningDecisionId)) {
      setSelectedLearningDecisionId(sorted[0].decision_id)
    }
  }, [actionHistorySortBy, executionLearningData?.decision_history?.decisions, selectedLearningDecisionId])

  useEffect(() => {
    if (view !== 'recommendation-engine' || recommendationNarrativeMode !== 'ollama') {
      setLlmNarrativeDigest(null)
      return
    }
    if (!runId) {
      setLlmNarrativeDigest(null)
      return
    }

    fetch(`${API_BASE}/api/v2/runs/${runId}/narrative`, { method: 'POST' })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!payload) return
        setLlmNarrativeDigest({
          changed: String(payload.changed || ''),
          decision: String(payload.decision || ''),
          consequence: String(payload.consequence || ''),
          source: payload.source || 'scripted',
        })
      })
      .catch(() => setLlmNarrativeDigest(null))
  }, [recommendationNarrativeMode, runId, view])

  useEffect(() => {
    if (!activeOrderId || !activeDecisionComponentId || !['action-learning', 'execution-learning', 'execution-log', 'delivery-promise'].includes(view)) {
      if (!['action-learning', 'execution-learning', 'execution-log', 'delivery-promise'].includes(view)) setExecutionLearningData(null)
      return
    }

    fetch(`${API_BASE}/api/v2/orders/${activeOrderId}/execution-learning?component_id=${encodeURIComponent(activeDecisionComponentId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setExecutionLearningData(data)
      })
      .catch(() => {})
  }, [activeDecisionComponentId, activeOrderId, deliveryPromise, executionResult, view])

  useEffect(() => {
    if (!activeOrderId || !['alerts-decisions', 'delivery-promise', 'negotiation-intelligence', 'recommendation-engine', 'action-learning', 'negotiation-recommendation', 'execution-learning'].includes(view)) {
      setDecisionPanel(null)
      return
    }
    const componentId = selectedRiskComponentId || orderContext?.bom?.bottleneck_component?.component_id
    const suffix = componentId ? `?component_id=${encodeURIComponent(componentId)}` : ''
    fetch(`${API_BASE}/api/v2/orders/${activeOrderId}/decision-panel${suffix}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setDecisionPanel(data)
      })
      .catch(() => {})
  }, [activeOrderId, orderContext?.bom?.bottleneck_component?.component_id, selectedRiskComponentId, view])

  useEffect(() => {
    if (!selectedEventId) return
    setInteractionGraphLoading(true)
    setInteractionGraphError('')
    fetch(`${API_BASE}/api/v2/agents/interaction-graph?event_id=${encodeURIComponent(selectedEventId)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!payload) {
          setInteractionGraphError('Interaction graph endpoint unavailable.')
          return
        }
        setInteractionGraph(payload)
      })
      .catch(() => setInteractionGraphError('Unable to load interaction graph.'))
      .finally(() => setInteractionGraphLoading(false))
  }, [selectedEventId])

  const generateDeliveryPromise = useCallback(async () => {
    if (!activeOrderId) return
    setPromiseLoading(true)
    try {
      const selectedVendorMap = {}
      const selectedRouteMap = {}
      if (vendorScore?.component_id && vendorScore?.ranked_vendors?.[0]) {
        selectedVendorMap[vendorScore.component_id] = vendorScore.ranked_vendors[0].vendor_id
      }
      if (routePlan?.component_id && routePlan?.recommended_primary) {
        selectedRouteMap[routePlan.component_id] = routePlan.recommended_primary.route_id
      }

      const response = await fetch(`${API_BASE}/api/v2/delivery-promise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: activeOrderId,
          selected_vendor_map: selectedVendorMap,
          selected_route_map: selectedRouteMap,
          assembly_days: 3,
          customer_shipping_days: 5,
        }),
      })
      if (!response.ok) throw new Error('promise failed')
      setDeliveryPromise(await response.json())
    } catch {
      setDeliveryPromise(null)
    } finally {
      setPromiseLoading(false)
    }
  }, [activeOrderId, routePlan?.component_id, routePlan?.recommended_primary, vendorScore?.component_id, vendorScore?.ranked_vendors])

  const executeActions = useCallback(async () => {
    if (!activeOrderId) return
    setExecutionLoading(true)
    try {
      const response = await fetch(`${API_BASE}/api/v2/execution/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: activeOrderId,
          mode: executionMode,
          actions: ['purchase_order', 'freight_booking', 'customer_notification'],
        }),
      })
      if (!response.ok) throw new Error('execution failed')
      setExecutionResult(await response.json())
      const metricsRes = await fetch(`${API_BASE}/api/v2/metrics/summary`)
      if (metricsRes.ok) setMetricsSummary(await metricsRes.json())
    } catch {
      setExecutionResult(null)
    } finally {
      setExecutionLoading(false)
    }
  }, [activeOrderId, executionMode])

  useEffect(() => {
    if (!['delivery-promise', 'execution-log', 'action-learning', 'execution-learning'].includes(view)) return
    fetch(`${API_BASE}/api/v2/metrics/summary`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setMetricsSummary(data)
      })
      .catch(() => {})

    fetch(`${API_BASE}/api/v2/orders/open`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.orders) setOpenOrders(data.orders)
      })
      .catch(() => {})
  }, [view])

  useEffect(() => {
    if (['delivery-promise', 'action-learning', 'execution-learning'].includes(view) && activeOrderId && !deliveryPromise && !promiseLoading) {
      generateDeliveryPromise()
    }
  }, [activeOrderId, deliveryPromise, generateDeliveryPromise, promiseLoading, view])

  const debateLogs = runStatus?.visible_logs || []
  const replayIndex = replayCursor ?? Math.max(debateLogs.length - 1, 0)
  const displayedLogs = useMemo(
    () => (replayCursor === null ? debateLogs : debateLogs.slice(0, replayCursor + 1)),
    [debateLogs, replayCursor],
  )
  const replayActiveLog = useMemo(
    () => (replayCursor === null ? debateLogs[debateLogs.length - 1] || null : debateLogs[replayCursor] || null),
    [debateLogs, replayCursor],
  )

  useEffect(() => {
    const v = runStatus?.visible_logs || []
    if (v.length === 0) { setReplayCursor(null); setSelectedEdgeId(''); setIsReplayPlaying(false); return }
    if (replayCursor !== null && replayCursor > v.length - 1) setReplayCursor(v.length - 1)
  }, [replayCursor, runStatus])

  // Auto-start replay when the AI room becomes visible and logs are ready
  const autoPlayHandler = useCallback(() => {
    if (debateLogs.length >= 2) {
      setReplayCursor(0)
      setIsReplayPlaying(true)
    }
  }, [debateLogs.length])

  useEffect(() => {
    setSelectedEdgeId(debateLogs[replayCursor ?? debateLogs.length - 1]?.edge_id || '')
  }, [replayCursor, debateLogs])

  useEffect(() => {
    if (!isReplayPlaying || replayCursor === null || debateLogs.length < 2) return
    if (replayCursor >= debateLogs.length - 1) { setIsReplayPlaying(false); return }
    const timer = setInterval(() => {
      setReplayCursor((prev) => {
        if (prev === null || prev >= debateLogs.length - 1) { clearInterval(timer); return prev }
        return prev + 1
      })
    }, 900)
    return () => clearInterval(timer)
  }, [isReplayPlaying, replayCursor, debateLogs])

  const selectedEvent     = useMemo(() => state?.events?.find((e) => e.id === selectedEventId), [state, selectedEventId])
  const selectedComponent = useMemo(() => state?.components?.find((c) => c.id === selectedComponentId), [state, selectedComponentId])
  const knownComponentIds = useMemo(() => new Set((state?.components || []).map((component) => component.id)), [state?.components])
  const missionAnalyticalComponents = useMemo(() => {
    const bomComponents = orderContext?.bom?.components || []
    if (!bomComponents.length) return state?.components || []
    const filtered = bomComponents
      .filter((component) => knownComponentIds.has(component.component_id))
      .map((component) => ({
        id: component.component_id,
        name: component.component_name,
        criticality: component.criticality,
        runway: component.days_to_stockout_disruption,
      }))
    return filtered.length ? filtered : state?.components || []
  }, [knownComponentIds, orderContext?.bom?.components, state?.components])
  const bomCategoryOptions = useMemo(() => {
    const categories = Object.keys(orderContext?.bom?.category_buckets || {})
    return categories.length ? categories : ['compute', 'display', 'storage', 'chassis', 'power']
  }, [orderContext?.bom?.category_buckets])
  const visibleBomComponents = useMemo(() => {
    const components = orderContext?.bom?.components || []
    if (selectedBomCategory === 'all') return components
    return components.filter((component) => component.category === selectedBomCategory)
  }, [orderContext?.bom?.components, selectedBomCategory])
  const riskRows = useMemo(() => {
    const rows = riskDashboard?.rows || []
    return rows.filter((row) => {
      const criticalityMatch = riskCriticalityFilter === 'all' || row.criticality === riskCriticalityFilter
      const regionMatch = riskRegionFilter === 'all' || row.vendor_region === riskRegionFilter
      const daysMatch = Number(row.inventory_days) <= Number(riskDaysFilter)
      return criticalityMatch && regionMatch && daysMatch
    })
  }, [riskCriticalityFilter, riskDashboard?.rows, riskDaysFilter, riskRegionFilter])
  const riskRegions = useMemo(() => riskDashboard?.available_filters?.region || [], [riskDashboard?.available_filters?.region])
  const riskHeatmapItems = useMemo(
    () => riskRows.slice(0, 6).map((row) => ({
      dimension: row.name,
      score: Math.max(1, Math.min(5, Math.round((Number(row.risk_score || 0) / 20) || 1))),
      risk: row.status === 'red' ? 'high' : row.status === 'amber' ? 'medium' : 'low',
    })),
    [riskRows],
  )
  const riskTrajectorySeries = useMemo(
    () => riskRows.slice(0, 10).map((row) => Math.max(5, Math.min(100, 100 - Number(row.inventory_days || 0) * 2.6))),
    [riskRows],
  )
  const componentOutlookItems = useMemo(() => {
    if (!shockForecast) return []
    const baseline = Number(shockForecast.baseline_days_to_stockout || 0)
    const disruption = Number(shockForecast.disruption_days_to_stockout || 0)
    const severity = Number(shockForecast.severity_0_10 || 0)
    return [
      { horizon: '7d', value: Math.max(0, Math.min(100, 100 - severity * 7)) },
      { horizon: '30d', value: Math.max(0, Math.min(100, 100 - (baseline - disruption) * 5)) },
      { horizon: '90d', value: Math.max(0, Math.min(100, 78 - severity * 3)) },
    ]
  }, [shockForecast])
  const alertOutlookItems = useMemo(() => {
    if (!criticalAlert) return []
    const severity = Number(criticalAlert.severity_score || 0)
    const roi = Number(criticalAlert.roi_multiple || 0)
    return [
      { horizon: 'Now', value: Math.max(0, Math.min(100, severity * 10)) },
      { horizon: 'Action', value: Math.max(0, Math.min(100, 100 - severity * 6)) },
      { horizon: 'ROI', value: Math.max(0, Math.min(100, roi * 16)) },
    ]
  }, [criticalAlert])
  const deliveryOutlookItems = useMemo(() => {
    if (!deliveryPromise) return []
    const confidence = Number(deliveryPromise.confidence_score || 0)
    const delay = Number(deliveryPromise.delay_days || 0)
    return [
      { horizon: 'ETA', value: confidence },
      { horizon: 'Delay Risk', value: Math.max(0, Math.min(100, 100 - delay * 12)) },
      { horizon: '90d', value: Math.max(0, Math.min(100, confidence - 6)) },
    ]
  }, [deliveryPromise])
  const executionSeries = useMemo(() => {
    if (!metricsSummary) return []
    const detect = Number(metricsSummary?.time_to_detect_sec?.avg || 0)
    const alt = Number(metricsSummary?.time_to_alternative_sec?.avg || 0)
    const action = Number(metricsSummary?.time_to_action_sec?.avg || 0)
    return [100, Math.max(5, 100 - detect / 2), Math.max(5, 100 - alt / 2), Math.max(5, 100 - action / 2)]
  }, [metricsSummary])
  const insightFor = useCallback((cardId) => liveAgentCards[cardId], [liveAgentCards])
  const topMarketEvidence = decisionContextData?.market_price_evidence?.[activeDecisionComponentId] || []
  const researchComponents = decisionContextData?.component_requirement_set || []
  const activeResearchComponentId = selectedResearchComponentId || researchComponents[0]?.component_id || ''
  const activeResearchComponent = researchComponents.find((component) => component.component_id === activeResearchComponentId) || null
  const activeResearchCommodity = decisionContextData?.global_commodity_prices?.[activeResearchComponentId] || null
  const activeResearchCompliance = decisionContextData?.vendor_compliance?.[activeResearchComponentId] || []
  const activeResearchEvidence = decisionContextData?.market_price_evidence?.[activeResearchComponentId] || []
  const affectedComponents = disruptionImpactData?.affected_components || []
  const activeImpactComponentId = selectedImpactComponentId || activeDecisionComponentId
  const activeImpactComponent = affectedComponents.find((item) => item.component_id === activeImpactComponentId) || affectedComponents[0] || null
  const activeImpactGeography = activeImpactComponent?.geography_impacts || []
  const topSimulationScenarios = profitRecommendationData?.scenarios?.slice(0, 4) || []
  const activeSimulationScenario = topSimulationScenarios.find((item) => item.scenario_id === selectedSimulationScenarioId) || topSimulationScenarios[0] || null
  const negotiationBand = profitRecommendationData?.negotiation_band || null
  const recommendationMemo = profitRecommendationData?.recommendation || null
  const allRecommendationScenarios = profitRecommendationData?.scenarios || []

  // ── Module 4 derived values ───────────────────────────────────────────────
  const negoBriefs = negotiationBriefData?.vendor_briefs || []
  const activeNegVendor = negoBriefs.find((b) => b.vendor_id === activeNegVendorId) || negoBriefs[0] || null
  const negoBatna = negotiationBriefData?.batna || null
  const negoCounterPrice = Number(negoCounterInput) || 0
  const negoLiveProfit = useMemo(() => {
    if (!activeNegVendor || negoCounterPrice <= 0) return null
    const qty = Math.max(1, parseInt(orderContext?.quantity || 1))
    const nonPurchase = Number(activeNegVendor.non_purchase_cost_per_component || 0)
    const qtyPerUnit = parseInt(orderContext?.bom?.components?.find((c) => c.component_id === negotiationBriefData?.component_id)?.qty_per_unit || 1)
    const revenue = Number(simulationLockedRevenueUnit || decisionContextData?.margin_constraints?.unit_revenue || 0)
    const otherCosts = revenue * (1 - simulationTargetMarginPct / 100) - (negoCounterPrice + nonPurchase) * qtyPerUnit
    const profit = revenue - (negoCounterPrice + nonPurchase) * qtyPerUnit - otherCosts
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0
    return { profit: round2(profit), margin: round2(margin), total_cost_per_unit: round2((negoCounterPrice + nonPurchase) * qtyPerUnit), profit_total: round2(profit * qty) }
  }, [activeNegVendor, negoCounterPrice, orderContext, negotiationBriefData, simulationLockedRevenueUnit, decisionContextData, simulationTargetMarginPct])

  // ── Module 5 derived values ───────────────────────────────────────────────
  const vendorCountryById = useMemo(() => {
    const map = {}
    ;(activeImpactComponent?.impacted_vendors || []).forEach((vendor) => {
      map[vendor.vendor_id] = vendor.country
    })
    ;(negoBriefs || []).forEach((vendor) => {
      if (!map[vendor.vendor_id] && vendor.country) map[vendor.vendor_id] = vendor.country
    })
    return map
  }, [activeImpactComponent?.impacted_vendors, negoBriefs])

  const recommendationOptions = useMemo(() => {
    return (allRecommendationScenarios || []).map((scenario) => {
      const routeMode = String(scenario.route_mode || 'sea').toLowerCase()
      const routeTransit = routeMode === 'air' ? 4 : routeMode === 'sea' ? 12 : routeMode === 'rail' ? 9 : 10
      const vendorLead = Number(negoBriefs.find((item) => item.vendor_id === scenario.vendor_id)?.lead_days || 12)
      const leadTimeDays = round2(vendorLead + routeTransit)
      const totalLandedCost = round2(
        Number(scenario.procurement_cost || 0)
        + Number(scenario.logistics_cost || 0)
        + Number(scenario.tariff_cost || 0)
        + Number(scenario.delay_penalty || 0)
        + Number(scenario.risk_reserve || 0)
      )
      const targetPrice = round2(
        recommendationMemo?.selected_vendor_id === scenario.vendor_id
          ? recommendationMemo?.selected_target_price
          : scenario.negotiation_ceiling_purchase_price || scenario.purchase_price_per_unit || scenario.proposed_unit_price
      )
      const projectedMarginPct = Number(scenario.gross_margin_pct || 0)
      const riskScore = Number(scenario.execution_risk || 0)
      const marginAnswer = `If I buy from ${scenario.vendor_name} at $${Number(targetPrice || 0).toFixed(2)} and ship via ${scenario.route_id} (${String(scenario.route_mode || '').toUpperCase()}), projected gross margin is ${projectedMarginPct.toFixed(2)}%.`

      return {
        id: scenario.scenario_id,
        label: `${scenario.scenario_name}`,
        scenarioName: scenario.scenario_name,
        vendorId: scenario.vendor_id,
        vendorName: scenario.vendor_name,
        vendorCountry: vendorCountryById[scenario.vendor_id] || '--',
        negotiatedOrTargetPrice: targetPrice,
        routeId: scenario.route_id,
        routeMode,
        routeLabel: `${scenario.route_id} (${String(routeMode).toUpperCase()})`,
        totalLandedCost,
        projectedMarginPct,
        expectedProfit: Number(scenario.expected_profit || 0),
        riskScore,
        leadTimeDays,
        tradeoff: scenario.tradeoff,
        marginAnswer,
      }
    })
  }, [allRecommendationScenarios, negoBriefs, recommendationMemo, vendorCountryById])

  const sortedRecommendationOptions = useMemo(() => {
    const items = [...recommendationOptions]
    if (recommendationSortBy === 'risk') return items.sort((a, b) => a.riskScore - b.riskScore)
    if (recommendationSortBy === 'lead') return items.sort((a, b) => a.leadTimeDays - b.leadTimeDays)
    if (recommendationSortBy === 'cost') return items.sort((a, b) => a.totalLandedCost - b.totalLandedCost)
    return items.sort((a, b) => b.projectedMarginPct - a.projectedMarginPct)
  }, [recommendationOptions, recommendationSortBy])

  const activeRecommendation = sortedRecommendationOptions.find((item) => item.id === activeRecommendationId) || sortedRecommendationOptions[0] || null

  const activeRecommendationRationale = useMemo(() => {
    if (!activeRecommendation) return ''
    const llmSuffix = recommendationNarrativeMode === 'ollama' && llmNarrativeDigest
      ? ` ${llmNarrativeDigest.changed} ${llmNarrativeDigest.decision} ${llmNarrativeDigest.consequence}`
      : ''
    return `${activeRecommendation.vendorName} (${activeRecommendation.vendorCountry}) is ranked for ${activeRecommendation.scenarioName} because it balances margin protection (${activeRecommendation.projectedMarginPct.toFixed(2)}%), manageable risk (${activeRecommendation.riskScore.toFixed(1)}), and lead-time feasibility (${activeRecommendation.leadTimeDays.toFixed(1)} days) through ${activeRecommendation.routeLabel}. The target buy price of $${activeRecommendation.negotiatedOrTargetPrice.toFixed(2)} keeps the expected landed spend near $${Math.round(activeRecommendation.totalLandedCost).toLocaleString()} while preserving approximately $${Math.round(activeRecommendation.expectedProfit).toLocaleString()} in projected profit. ${activeRecommendation.tradeoff || ''}${llmSuffix}`
  }, [activeRecommendation, llmNarrativeDigest, recommendationNarrativeMode])

  const recommendationGraphNodes = useMemo(() => {
    if (!activeRecommendation) return []
    return [
      { id: 'vendor-node', label: `${activeRecommendation.vendorName} (${activeRecommendation.vendorCountry})`, type: 'root' },
      { id: 'price-node', label: `Target $${activeRecommendation.negotiatedOrTargetPrice.toFixed(2)}`, type: 'action' },
      { id: 'route-node', label: activeRecommendation.routeLabel, type: 'action' },
      { id: 'cost-node', label: `Landed $${Math.round(activeRecommendation.totalLandedCost).toLocaleString()}`, type: 'effect' },
      { id: 'margin-node', label: `Margin ${activeRecommendation.projectedMarginPct.toFixed(1)}%`, type: 'effect' },
      { id: 'risk-node', label: `Risk ${activeRecommendation.riskScore.toFixed(1)}`, type: 'effect' },
    ]
  }, [activeRecommendation])

  const recommendationGraphEdges = useMemo(() => {
    if (!activeRecommendation) return []
    return [
      { source: 'vendor-node', target: 'price-node' },
      { source: 'vendor-node', target: 'route-node' },
      { source: 'price-node', target: 'cost-node' },
      { source: 'route-node', target: 'cost-node' },
      { source: 'cost-node', target: 'margin-node' },
      { source: 'route-node', target: 'risk-node' },
    ]
  }, [activeRecommendation])

  const learningHistory = executionLearningData?.decision_history?.decisions || []
  const sortedLearningHistory = useMemo(() => {
    const rows = [...learningHistory]
    if (actionHistorySortBy === 'accuracy') return rows.sort((a, b) => Number(b.accuracy_score || 0) - Number(a.accuracy_score || 0))
    if (actionHistorySortBy === 'margin-delta') return rows.sort((a, b) => Math.abs(Number(b.actual_margin_pct || 0) - Number(b.projected_margin_pct || 0)) - Math.abs(Number(a.actual_margin_pct || 0) - Number(a.projected_margin_pct || 0)))
    if (actionHistorySortBy === 'cost-delta') return rows.sort((a, b) => Math.abs(Number(b.actual_total_cost || 0) - Number(b.projected_total_cost || 0)) - Math.abs(Number(a.actual_total_cost || 0) - Number(a.projected_total_cost || 0)))
    return rows.sort((a, b) => String(b.decision_date || '').localeCompare(String(a.decision_date || '')))
  }, [actionHistorySortBy, learningHistory])

  const selectedLearningDecision = sortedLearningHistory.find((item) => item.decision_id === selectedLearningDecisionId) || sortedLearningHistory[0] || null

  const module6GraphNodes = useMemo(() => {
    if (!executionLearningData?.next_event_guidance) return []
    const informed = executionLearningData.next_event_guidance.informed_by || []
    const nodes = [
      { id: 'confidence-root', label: `Confidence ${Number(executionLearningData.next_event_guidance.confidence_score || 0).toFixed(1)}%`, type: 'root' },
      { id: 'current-decision', label: selectedLearningDecision ? `${selectedLearningDecision.vendor_name} / ${selectedLearningDecision.route_id}` : 'Current Decision', type: 'action' },
    ]
    informed.forEach((item, index) => {
      nodes.push({ id: `history-${index}`, label: `${item.vendor_name || 'Decision'} (${Number(item.outcome_accuracy || 0).toFixed(0)})`, type: 'effect' })
    })
    return nodes
  }, [executionLearningData, selectedLearningDecision])

  const module6GraphEdges = useMemo(() => {
    if (!executionLearningData?.next_event_guidance) return []
    const informed = executionLearningData.next_event_guidance.informed_by || []
    const edges = [
      { source: 'current-decision', target: 'confidence-root' },
    ]
    informed.forEach((_, index) => {
      edges.push({ source: `history-${index}`, target: 'confidence-root' })
    })
    return edges
  }, [executionLearningData])
  const selectedScenarioForEquation = activeSimulationScenario
  const orderQuantity = Number(orderContext?.quantity || 0)
  const lockedRevenue = Number(simulationLockedRevenueUnit || decisionContextData?.margin_constraints?.unit_revenue || 0) * orderQuantity
  const purchaseCostBase = Number(selectedScenarioForEquation?.procurement_cost || 0)
  const logisticsCostBase = Number(selectedScenarioForEquation?.logistics_cost || 0) + Number(selectedScenarioForEquation?.tariff_cost || 0)
  const counterOfferValue = Number(vendorCounterOffer)
  const counterOfferAdjustedPurchaseCost = Number.isFinite(counterOfferValue) && counterOfferValue > 0 && orderQuantity > 0
    ? counterOfferValue * orderQuantity
    : purchaseCostBase
  const liveProfit = lockedRevenue - counterOfferAdjustedPurchaseCost - logisticsCostBase
  const liveMarginPct = lockedRevenue > 0 ? (liveProfit / lockedRevenue) * 100 : 0
  const causalSteps       = useMemo(() => state?.causal_chains?.[selectedEventId] || [], [state, selectedEventId])
  const scenario          = useMemo(() => state?.scenarios?.[selectedEventId]?.[selectedScenario] || null, [state, selectedEventId, selectedScenario])
  const recommendation    = useMemo(() => state?.recommendations?.[selectedScenario] || null, [state, selectedScenario])
  const heatmapItems      = runStatus?.heatmap || []
  const futureOutlook     = runStatus?.future_outlook || []
  const graphNodes        = interactionGraph?.nodes?.length ? interactionGraph.nodes : (runStatus?.knowledge_graph?.nodes || [])
  const graphEdges        = interactionGraph?.edges?.length ? interactionGraph.edges : (runStatus?.knowledge_graph?.edges || [])
  const activeAgents      = runStatus?.active_agents || 0
  const totalAgents       = runStatus?.total_agents || 10
  const agentMode         = (runStatus?.agent_mode || state?.agents?.[0]?.mode || 'scripted').toUpperCase()
  const swarmState        = runStatus ? (runStatus.status === 'completed' ? 'READY' : 'DEBATING') : 'IDLE'
  const missionOrderReady = Boolean(orderContext?.order_id)
  const missionReadyToAdvance = missionOrderReady && Boolean(runId) && ((runStatus?.progress || 0) >= 100 || runStatus?.status === 'completed' || runStatus?.stage === 'artifacts')

  const activeStep = useMemo(() => {
    if (view === 'disruption-impact') return 2
    if (view === 'simulation-lab') return 3
    if (['negotiation-intelligence', 'negotiation-recommendation'].includes(view)) return 4
    if (view === 'recommendation-engine') return 5
    if (['action-learning', 'execution-learning'].includes(view)) return 6
    if (view === 'component-analysis') return 2
    if (view === 'alerts-decisions') return 3
    if (['procurement-actions', 'route-intelligence', 'delivery-promise', 'execution-log'].includes(view)) return 5
    return 0
  }, [view])

  const showSections = useMemo(() => ({
    ordersIntake: ['orders-intake', 'bom-intelligence'].includes(view),
    riskDashboard: ['risk-dashboard'].includes(view),
    componentAnalysis: ['component-analysis'].includes(view),
    alertsDecisions: ['alerts-decisions'].includes(view),
    negotiationWorkspace: ['negotiation-intelligence', 'negotiation-recommendation'].includes(view),
    procurementActions: ['procurement-actions'].includes(view),
    // Embedded calculations only; no standalone route page in the module flow.
    routeIntelligence: ['route-intelligence'].includes(view),
    deliveryPromise: ['delivery-promise'].includes(view),
    executionLog: ['execution-log'].includes(view),
  }), [view])

  const graphNodeLabels = useMemo(() => Object.fromEntries(graphNodes.map((n) => [n.id, n.label])), [graphNodes])
  const activatedNodeIds = useMemo(() => {
    if (!selectedEdgeId) return new Set()
    const parts = selectedEdgeId.split('-')
    return new Set([parts[0], parts.slice(1).join('-')])
  }, [selectedEdgeId])

  const agentTelemetry = useMemo(() => {
    const knownAgents = state?.agents || []
    return knownAgents.map((agent, idx) => {
      const log = debateLogs.find((entry) => entry.agent === agent.name)
      const tag = log?.tag || 'signal'
      const visual = tagVisuals[tag] || tagVisuals.signal
      return {
        name: agent.name,
        status: !log ? 'standby' : replayActiveLog?.agent === agent.name ? 'speaking' : runStatus?.status === 'completed' ? 'locked' : 'online',
        score: !log ? 10 : Math.min(100, visual.score + idx),
        tag,
        sequence: log?.sequence,
        edgeId: log?.edge_id || '',
        edgeLabel: log?.edge_id
          ? `${graphNodeLabels[log.edge_id.split('-')[0]] || 'Root'} → ${graphNodeLabels[log.edge_id.split('-')[1]] || 'Effect'}`
          : 'Awaiting',
      }
    })
  }, [debateLogs, graphNodeLabels, replayActiveLog, runStatus?.status, state])

  const selectedVendorView = useMemo(() => ({
    unitCost: vendorData?.component_view?.unit_cost ?? 0,
    leadTime: vendorData?.component_view?.lead_time ?? '--',
    safetyStock: vendorData?.component_view?.safety_stock ?? '--',
    inventory: vendorData?.component_view?.inventory ?? '--',
    qtyPerLaptop: vendorData?.component_view?.qty_per_laptop ?? '-',
    vendors: vendorData?.component_view?.vendors || [],
  }), [vendorData])

  const vendorUniverse      = useMemo(() => vendorData?.vendors || [], [vendorData])
  const vendorCountries     = useMemo(() => vendorData?.countries || ['All Countries'], [vendorData])
  const vendorStatusOptions = useMemo(() => vendorData?.statuses || vendorStatuses, [vendorData])
  const selectedVendorDetail = useMemo(
    () => vendorUniverse.find((v) => v.key === selectedVendorKey) || vendorUniverse[0] || null,
    [vendorUniverse, selectedVendorKey],
  )
  const scenarioComparisonRows = useMemo(() => plannerData?.scenarios || [], [plannerData])
  const plannerInventorySeries = useMemo(() => plannerData?.inventory_points || [], [plannerData])
  const compareEntry           = useMemo(() => runHistory.find((r) => r.run_id === compareRunId), [runHistory, compareRunId])
  const scenarioAssumptionSummary = useMemo(() => {
    const summary = []
    summary.push(`${scenarioConfig.selectedSkus.length} SKU${scenarioConfig.selectedSkus.length === 1 ? '' : 's'} in scope`)
    summary.push(`${scenarioConfig.blockedRoutes.length}/${Math.max(scenarioConfig.activeRoutes.length, 1)} routes blocked`)
    summary.push(`Intensity ${scenarioConfig.disruptionIntensity}% for ${scenarioConfig.disruptionDuration}d`)
    summary.push(`Tariffs CN ${scenarioConfig.tariffs.china}% / Other ${scenarioConfig.tariffs.other}% / Domestic ${scenarioConfig.tariffs.domestic}%`)
    if (scenarioConfig.uploadedDocs.length) summary.push(`${scenarioConfig.uploadedDocs.length} supporting document${scenarioConfig.uploadedDocs.length === 1 ? '' : 's'}`)
    return summary
  }, [scenarioConfig])
  const vendorOverlay = vendorData?.scenario_overlay || null

  useEffect(() => {
    if (!vendorUniverse.length) { setSelectedVendorKey(''); return }
    if (!vendorUniverse.some((v) => v.key === selectedVendorKey)) setSelectedVendorKey(vendorUniverse[0].key)
  }, [vendorUniverse, selectedVendorKey])

  const deploySwarm = async () => {
    if (!state || isDeploying) return
    if (!orderContext?.order_id) {
      setDeployError('Order context is not ready yet. Wait for automatic BOM ingestion to finish.')
      return
    }
    hasAutoNavigatedRef.current = false
    setIsDeploying(true); setDeployError(''); setRunStatus(null)
    setIsLivePaused(false); setSelectedEdgeId(''); setHighlightedAgents([])
    setReplayCursor(null); setIsReplayPlaying(false)
    try {
      const createRes = await fetch(`${API_BASE}/api/v2/runs`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: selectedEventId, component_id: selectedComponentId }),
      })
      if (!createRes.ok) throw new Error('create failed')
      const created = await createRes.json()
      if (!created.run_id) throw new Error('missing run_id')
      const deployRes = await fetch(`${API_BASE}/api/v2/runs/${created.run_id}/deploy`, { method: 'POST' })
      if (!deployRes.ok) throw new Error('deploy failed')
      setRunId(created.run_id)
    } catch {
      setDeployError('Unable to deploy swarm. Check backend on port 8003 and retry.')
    } finally {
      setIsDeploying(false)
    }
  }

  useEffect(() => {
    if (onRunIdChange && runId && runId !== initialRunId) onRunIdChange(runId)
  }, [onRunIdChange, runId])

  const advanceToDebate = useCallback(() => {
    navigateToSection('component-analysis')
  }, [navigateToSection])

  useEffect(() => {
    const hasReachedTerminalProgress = (runStatus?.progress || 0) >= 100
    const hasCompletedState = runStatus?.status === 'completed' || runStatus?.stage === 'artifacts'
    if (view === 'risk-dashboard' && runId && orderContext?.order_id && (hasCompletedState || hasReachedTerminalProgress) && !hasAutoNavigatedRef.current) {
      hasAutoNavigatedRef.current = true
      advanceToDebate()
    }
  }, [advanceToDebate, orderContext?.order_id, runStatus?.progress, runStatus?.stage, runStatus?.status, runId, view])

  const resetEvent = (id) => {
    hasAutoNavigatedRef.current = false
    setImpactTrigger(null)
    setSelectedImpactComponentId('')
    setImpactTriggerType(defaultTriggerTypeByEvent[id] || 'tariff')
    setSelectedEventId(id); setRunId(null); setRunStatus(null)
    setSelectedEdgeId(''); setHighlightedAgents([])
    setReplayCursor(null); setIsReplayPlaying(false)
  }

  const triggerDisruptionImpact = useCallback(async () => {
    if (!activeDecisionComponentId) return
    setImpactTrigger({ eventId: selectedEventId, componentId: activeDecisionComponentId, triggeredAt: new Date().toISOString() })
    await deploySwarm()
  }, [activeDecisionComponentId, deploySwarm, selectedEventId])

  const handleDebateClick = (entry) => {
    setReplayCursor(entry.sequence)
    setSelectedEdgeId(entry.edge_id || '')
    setIsReplayPlaying(false)
  }

  const handleAgentFilter = (agent) => {
    if (!agent.name) { setHighlightedAgents([]); return }
    setHighlightedAgents((prev) => {
      const same = prev.length === 1 && prev[0] === agent.name
      return same ? [] : [agent.name]
    })
    if (agent.sequence !== undefined) {
      setReplayCursor(agent.sequence)
      setSelectedEdgeId(agent.edgeId || '')
      setIsReplayPlaying(false)
    }
  }

  const handleReplayToggle = () => {
    if (replayCursor === null || replayCursor >= debateLogs.length - 1) setReplayCursor(0)
    setIsReplayPlaying((v) => !v)
  }

  const toggleBoardroomMode = useCallback(async () => {
    if (isBoardroomMode) { setIsBoardroomMode(false); return }
    setIsBoardroomMode(true)
    if (!document.fullscreenElement && shellRef.current?.requestFullscreen) {
      try { await shellRef.current.requestFullscreen() } catch {}
    }
  }, [isBoardroomMode])

  // Wire voice action refs after all handlers are defined
  useEffect(() => {
    voiceActionsRef.current = {
      deploySwarm,
      toggleBoardroom: toggleBoardroomMode,
      getGeoRisk:     () => state?.overview?.geo_risk,
      getConfidence:  () => state?.overview?.delivery_confidence,
    }
  })

  useEffect(() => {
    const handler = () => { if (!document.fullscreenElement) setIsBoardroomMode(false) }
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  if (!state) {
    return (
      <div className="boot-screen">
        <AmbientBackground />
        <motion.div className="boot-content" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.8 }}>
          <div className="boot-logo">SENTINEL</div>
          <div className="boot-version">V2</div>
          <div className="boot-status">Connecting to intelligence layer...</div>
          <div className="boot-bar">
            <motion.div className="boot-bar-fill" animate={{ width: ['0%', '100%'] }} transition={{ duration: 2, repeat: Infinity }} />
          </div>
          {bootError && (
            <>
              <div className="boot-error">{bootError}</div>
              <button className="ghost-btn" onClick={loadDashboardState}>Retry Connection</button>
            </>
          )}
        </motion.div>
      </div>
    )
  }

  return (
    <div ref={shellRef} className="shell">
      <AmbientBackground />

      <BoardroomMode
        isActive={isBoardroomMode}
        event={selectedEvent}
        causalSteps={causalSteps}
        debateLogs={debateLogs}
        scenario={scenario}
        recommendation={recommendation}
        heatmapItems={heatmapItems}
        onExit={() => {
          setIsBoardroomMode(false)
          if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {})
        }}
      />

      <NarrativeCopilot
        runId={runId}
        eventName={selectedEvent?.name}
        apiBase={API_BASE}
        isVisible={narrativeOpen}
        onClose={() => setNarrativeOpen(false)}
      />

      {/* ── Topbar ── */}
      <motion.header className="topbar" initial={{ y: -60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.5 }}>
        <div className="topbar-brand">
          <div className="brand-mark">S</div>
          <div>
            <h1>SENTINEL V2</h1>
            <p>AI Supply Chain Decision Intelligence</p>
          </div>
        </div>
        <div className="topbar-center">
          {storySteps.map((step, idx) => (
            <div key={step} className={`story-node ${idx <= activeStep ? 'active' : ''}`}>
              <div className="story-node-dot" />
              <span>{step}</span>
            </div>
          ))}
        </div>
        <div className="topbar-right">
          <span className={`mode-pill ${agentMode === 'LLM' ? 'live' : 'scripted'}`}>{agentMode}</span>
          {liveAgentLoading && <span className="mode-pill live">AGENTS SYNCING</span>}
          <div className="kpi-trio">
            <div className="kpi-cell"><span>GEO RISK</span><strong className={state.overview.geo_risk > 60 ? 'kpi-danger' : 'kpi-ok'}>{state.overview.geo_risk}</strong></div>
            <div className="kpi-cell"><span>CONFIDENCE</span><strong className={state.overview.delivery_confidence < 75 ? 'kpi-warn' : 'kpi-ok'}>{state.overview.delivery_confidence}%</strong></div>
            <div className="kpi-cell"><span>DEADLINE</span><strong>{state.overview.intervention_deadline}</strong></div>
          </div>
          <motion.button className={`boardroom-btn ${isBoardroomMode ? 'active' : ''}`} onClick={toggleBoardroomMode} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}>
            {isBoardroomMode ? '✕ Exit' : '⬛ Boardroom'}
          </motion.button>
          <motion.button
            className={`voice-btn ${voiceListening ? 'listening' : ''}`}
            onClick={startVoiceCommand}
            title="Voice command (try: brief me, deploy swarm, best scenario)"
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.93 }}
          >
            {voiceListening ? '🔴' : '🎤'}
          </motion.button>
          {runId && (
            <motion.button
              className="narrative-btn"
              onClick={() => setNarrativeOpen(true)}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
            >
              ✦ Brief
            </motion.button>
          )}
        </div>
      </motion.header>

      <section className="panel" style={{ marginTop: 6, marginBottom: 0 }}>
        <div className="panel-head" style={{ marginBottom: 8 }}>
          <h2>Profit Equation</h2>
          <p>Revenue − Purchase Cost − Logistics Cost = Profit</p>
        </div>
        <div className="decision-grid">
          <div><span>Revenue</span><strong>${Math.round(lockedRevenue).toLocaleString()}</strong></div>
          <div><span>Purchase Cost</span><strong>${Math.round(counterOfferAdjustedPurchaseCost).toLocaleString()}</strong></div>
          <div><span>Logistics + Tariff</span><strong>${Math.round(logisticsCostBase).toLocaleString()}</strong></div>
          <div><span>Profit</span><strong>${Math.round(liveProfit).toLocaleString()} ({liveMarginPct.toFixed(1)}%)</strong></div>
        </div>
      </section>

      <AnimatePresence>
        {selectedAgentDebug && (
          <motion.section className="panel agent-debug-panel" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
            <div className="panel-head">
              <h2>Agent Debug Panel</h2>
              <div className="panel-head-right">
                <p>{selectedAgentDebug.agent_name} · {selectedAgentDebug.card_id}</p>
                <button className="ghost-btn" onClick={() => setSelectedAgentDebug(null)}>Close</button>
              </div>
            </div>
            <div className="agent-debug-grid">
              <div className="agent-debug-block">
                <span>System Prompt</span>
                <pre>{selectedAgentDebug.debug?.system_prompt || 'No prompt available'}</pre>
              </div>
              <div className="agent-debug-block">
                <span>User Prompt</span>
                <pre>{selectedAgentDebug.debug?.user_prompt || 'No prompt available'}</pre>
              </div>
              <div className="agent-debug-block">
                <span>Facts</span>
                <pre>{(selectedAgentDebug.debug?.facts || []).join('\n')}</pre>
              </div>
              <div className="agent-debug-block">
                <span>Citations</span>
                <pre>{JSON.stringify(selectedAgentDebug.citations || [], null, 2)}</pre>
              </div>
              <div className="agent-debug-block">
                <span>Tool Trace</span>
                <pre>{JSON.stringify(selectedAgentDebug.tool_trace || [], null, 2)}</pre>
              </div>
              <div className="agent-debug-block">
                <span>LLM</span>
                <pre>{JSON.stringify(selectedAgentDebug.llm || {}, null, 2)}</pre>
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {view === 'bom-intelligence' && (
        <motion.section className="panel" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <div className="panel-head">
            <h2>Page 1: BOM + Global Intelligence</h2>
            <p>What are we buying, and what is the global cost environment for those components?</p>
          </div>
          {!decisionContextData ? (
            <div className="section-placeholder">
              <h3>Building Economic Truth Layer</h3>
              <p>Ingest an order to populate component economics, vendor options, routes, and market evidence.</p>
            </div>
          ) : (
            <>
              <div className="metrics-strip">
                <div><span>Baseline Procurement Spend</span><strong>${Number(decisionContextData.baseline_procurement_spend || 0).toLocaleString()}</strong></div>
                <div><span>Disruption-Sensitive Spend</span><strong>${Number(decisionContextData.disruption_sensitive_spend || 0).toLocaleString()}</strong></div>
                <div><span>Unit Revenue</span><strong>${Number(decisionContextData.margin_constraints?.unit_revenue || 0).toLocaleString()}</strong></div>
                <div><span>Floor Margin</span><strong>{Math.round(Number(decisionContextData.margin_constraints?.floor_margin_pct || 0) * 100)}%</strong></div>
              </div>
              <p className="ops-context-note">{decisionContextData.headline}</p>
              <div className="agent-chart-grid">
                <div className="intel-card">
                  <h3>Top Exposed Components</h3>
                  <ul>
                    {(decisionContextData.top_exposed_components || []).map((item) => (
                      <li key={item.component_id}>
                        <strong>{item.component_name}</strong> · ${Number(item.disruption_sensitive_spend || 0).toLocaleString()} sensitive spend · {item.margin_sensitivity_pct}% margin sensitivity
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="intel-card">
                  <h3>Market Evidence</h3>
                  <ul>
                    {topMarketEvidence.map((item, index) => (
                      <li key={`${item.label}-${index}`}>
                        <strong>{item.label}</strong> · {item.value}{item.unit ? ` ${item.unit}` : ''} · confidence {item.confidence}% · fresh {item.freshness_hours}h
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="panel-head" style={{ marginTop: 12, paddingBottom: 0 }}>
                <h3>Component Research Panel</h3>
                <p>Click a component to review global pricing, compliance eligibility, and demand-backed market signals.</p>
              </div>
              <div className="bom-category-row" style={{ marginTop: 8 }}>
                {researchComponents.map((component) => (
                  <button
                    key={component.component_id}
                    className={`ghost-btn ${activeResearchComponentId === component.component_id ? 'active' : ''}`}
                    onClick={() => setSelectedResearchComponentId(component.component_id)}
                  >
                    {component.component_name}
                  </button>
                ))}
              </div>
              {activeResearchComponent && (
                <>
                  <div className="decision-grid" style={{ marginTop: 8 }}>
                    <div><span>Commodity</span><strong>{activeResearchCommodity?.commodity || activeResearchComponent.component_name}</strong></div>
                    <div><span>Market Trend</span><strong>{activeResearchCommodity?.market_trend || 'stable'}</strong></div>
                    <div><span>Required Units</span><strong>{Number(activeResearchComponent.required_units || 0).toLocaleString()}</strong></div>
                    <div>
                      <span>Demand Snapshot</span>
                      <strong>
                        {Number(decisionContextData?.demand_snapshot?.order_volume_units || 0).toLocaleString()} units
                        {' '}
                        ({Number(decisionContextData?.demand_snapshot?.demand_growth_pct || 0)}% growth)
                      </strong>
                    </div>
                  </div>
                  <div className="scenario-compare-wrap" style={{ marginTop: 10 }}>
                    <table className="scenario-compare-table">
                      <thead>
                        <tr>
                          <th>Geography</th>
                          <th>Unit Price</th>
                          <th>Weekly Change</th>
                          <th>Trend</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(activeResearchCommodity?.geography_prices || []).map((row) => (
                          <tr key={`${activeResearchComponentId}-${row.region}`}>
                            <td>{row.region}</td>
                            <td>${Number(row.unit_price || 0).toLocaleString()}</td>
                            <td>{Number(row.weekly_change_pct || 0) > 0 ? '+' : ''}{Number(row.weekly_change_pct || 0)}%</td>
                            <td>{row.trend || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="scenario-compare-wrap" style={{ marginTop: 10 }}>
                    <table className="scenario-compare-table">
                      <thead>
                        <tr>
                          <th>Vendor</th>
                          <th>Country</th>
                          <th>Sanctions</th>
                          <th>Trade Agreement</th>
                          <th>Legal Eligibility</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeResearchCompliance.map((vendor) => (
                          <tr key={`${activeResearchComponentId}-${vendor.vendor_id}`}>
                            <td>{vendor.vendor_name}</td>
                            <td>{vendor.country}</td>
                            <td>{vendor.sanctions_clear ? 'Clear' : 'Blocked'}</td>
                            <td>{vendor.trade_agreement}</td>
                            <td>{vendor.legal_eligibility ? 'Eligible' : 'Not Eligible'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="intel-card" style={{ marginTop: 10 }}>
                    <h3>Market Trend Evidence</h3>
                    <ul>
                      {activeResearchEvidence.map((item, index) => (
                        <li key={`${activeResearchComponentId}-evidence-${index}`}>
                          <strong>{item.label}</strong> · {item.value}{item.unit ? ` ${item.unit}` : ''} · confidence {item.confidence}%
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </>
          )}
        </motion.section>
      )}

      {showSections.ordersIntake && (
        <motion.section className="panel order-intake-panel" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.1 }}>
          <div className="panel-head">
            <h2>Layer 1: Customer Order Intake + BOM Explosion</h2>
            <p>What just came in, and what does it need? Intake, BOM explosion, category expansion, criticality, and inventory countdown.</p>
          </div>
          <div className="order-auto-status order-auto-controls">
            <label>Product SKU
              <select className="ghost-select" value={orderDraft.skuId} onChange={(e) => setOrderDraft((prev) => ({ ...prev, skuId: e.target.value }))}>
                <option value="xps-15-i9-rtx4080">XPS 15 i9 RTX 4080</option>
                <option value="latitude-14-u7">Latitude 14 Ultra 7</option>
              </select>
            </label>
            <label>Quantity
              <input className="ghost-input" type="number" min="1" value={orderDraft.quantity} onChange={(e) => setOrderDraft((prev) => ({ ...prev, quantity: Number(e.target.value) }))} />
            </label>
            <label>Region
              <input className="ghost-input" value={orderDraft.region} onChange={(e) => setOrderDraft((prev) => ({ ...prev, region: e.target.value }))} />
            </label>
            <label>Priority
              <select className="ghost-select" value={orderDraft.customerPriority} onChange={(e) => setOrderDraft((prev) => ({ ...prev, customerPriority: e.target.value }))}>
                <option value="standard">Standard</option>
                <option value="high">High</option>
                <option value="expedite">Expedite</option>
              </select>
            </label>
            <div><span>Scope Source</span><strong>Automatic Intake</strong></div>
            <button className="flow-btn" onClick={() => { orderIngestKeyRef.current = ''; ingestOrder() }} disabled={orderLoading}>{orderLoading ? 'Refreshing...' : 'Refresh BOM'}</button>
          </div>
          {orderError && <p className="flow-error">{orderError}</p>}

          {executiveSnapshot && (
            <div className={`executive-strip ${executiveSnapshot.status === 'red' ? 'critical' : 'stable'}`}>
              <div><span>Decision</span><strong>{executiveSnapshot.decision}</strong></div>
              <div><span>Critical at Risk</span><strong>{executiveSnapshot.critical_components_at_risk}</strong></div>
              <div><span>Intervention Deadline</span><strong>{executiveSnapshot.closest_intervention_deadline_days}d</strong></div>
              <div><span>Orders Impacted</span><strong>{executiveSnapshot.orders_impacted_percent}%</strong></div>
              <div><span>Revenue at Risk</span><strong>${Number(executiveSnapshot.estimated_revenue_at_risk || 0).toLocaleString()}</strong></div>
            </div>
          )}

          {orderContext?.bom ? (
            <>
              <div className="order-summary-strip">
                <div><span>Order</span><strong>{orderContext.order_id}</strong></div>
                <div><span>SKU</span><strong>{orderContext.sku_name}</strong></div>
                <div><span>Region</span><strong>{orderContext.region}</strong></div>
                <div><span>Components</span><strong>{orderContext.bom.summary.component_count}</strong></div>
                <div><span>Critical</span><strong>{orderContext.bom.summary.critical_count}</strong></div>
                <div><span>Order Timestamp</span><strong>{new Date(orderContext.created_at).toLocaleString()}</strong></div>
              </div>

              <div className="bom-category-row">
                <button className={`ghost-btn ${selectedBomCategory === 'all' ? 'active' : ''}`} onClick={() => setSelectedBomCategory('all')}>All Categories</button>
                {bomCategoryOptions.map((category) => (
                  <button key={category} className={`ghost-btn ${selectedBomCategory === category ? 'active' : ''}`} onClick={() => setSelectedBomCategory(category)}>
                    {category}
                  </button>
                ))}
              </div>

              <div className="bom-buckets">
                {['critical', 'important', 'substitutable'].map((bucket) => (
                  <div key={bucket} className="bom-bucket-card">
                    <h4>{bucket.toUpperCase()}</h4>
                    <ul>
                      {(orderContext.bom.criticality_buckets[bucket] || []).slice(0, 5).map((component) => (
                        <li key={`${bucket}-${component.component_id}`}>{component.component_name} · {component.days_to_stockout_disruption}d</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              <div className="bom-tree-wrap">
                <table className="bom-tree-table">
                  <thead>
                    <tr>
                      <th>Component</th>
                      <th>Criticality</th>
                      <th>Status</th>
                      <th>Risk Score</th>
                      <th>Qty/Unit</th>
                      <th>Baseline Runway</th>
                      <th>Disruption Runway</th>
                      <th>Delta</th>
                      <th>Intervention Day</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleBomComponents.map((component) => (
                      <tr
                        key={component.component_id}
                        className={`${component.is_critical_alert ? 'row-alert' : ''} ${selectedRiskComponentId === component.component_id ? 'row-selected' : ''}`}
                        onClick={() => setSelectedRiskComponentId(component.component_id)}
                      >
                        <td>{component.component_name}</td>
                        <td>{component.criticality}</td>
                        <td><span className={`status-pill ${component.status}`}>{component.status}</span></td>
                        <td>{component.criticality_score}</td>
                        <td>{component.qty_per_unit}</td>
                        <td>{component.days_to_stockout_baseline}d</td>
                        <td>{component.days_to_stockout_disruption}d</td>
                        <td>{component.stockout_delta_days}d</td>
                        <td>{component.intervention_day}d</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flow-page-actions" style={{ marginTop: 10, justifyContent: 'flex-start' }}>
                <button className="flow-btn primary" onClick={() => navigateToSection('risk-dashboard')}>
                  {view === 'bom-intelligence' ? 'Continue to Disruption + Impact' : 'Continue to Risk Dashboard'}
                </button>
              </div>

            </>
          ) : (
            <div className="section-placeholder" style={{ marginTop: 14 }}>
              <h3>Preparing SKU Scope</h3>
              <p>Orders Intake automatically expands SKU into BOM and computes runway for downstream agent analysis.</p>
            </div>
          )}
        </motion.section>
      )}

      {view === 'disruption-impact' && (
        <motion.section className="panel" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.42 }}>
          <div className="panel-head">
            <h2>Page 2: Disruption + Impact</h2>
            <p>What changed, and how does it alter our economics?</p>
          </div>

          <div className="event-grid">
            {(state?.events || []).map((event) => (
              <motion.button key={event.id} className={`event-card ${selectedEventId === event.id ? 'selected' : ''}`} onClick={() => resetEvent(event.id)} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}>
                <span className="event-icon">{event.icon}</span>
                <span className="event-name">{event.name}</span>
                <span className="agent-meta">{disruptionTriggerOptions.find((opt) => opt.value === (defaultTriggerTypeByEvent[event.id] || 'tariff'))?.label || 'Event Trigger'}</span>
              </motion.button>
            ))}
          </div>
          <div className="component-selector" style={{ marginTop: 10 }}>
            {missionAnalyticalComponents.map((component) => (
              <button key={component.id} className={`comp-chip ${selectedComponentId === component.id ? 'selected' : ''}`} onClick={() => setSelectedComponentId(component.id)}>
                <span className={`crit-dot ${component.criticality}`} />
                {component.name}{component.runway ? ` · ${component.runway}d` : ''}
              </button>
            ))}
          </div>

          <div className="order-auto-status order-auto-controls" style={{ marginTop: 10 }}>
            <label>Trigger Type
              <select className="ghost-select" value={impactTriggerType} onChange={(e) => setImpactTriggerType(e.target.value)}>
                {disruptionTriggerOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <div><span>Primary Mode</span><strong>{impactTriggerType === 'tariff' ? 'US Tariff Schedule' : 'Operational Shock'}</strong></div>
            <div><span>Selected Event</span><strong>{selectedEvent?.name || selectedEventId}</strong></div>
          </div>
          {impactTriggerType === 'tariff' && (
            <div className="decision-grid" style={{ marginTop: 8 }}>
              <label>China (%)
                <input className="ghost-input" type="number" value={impactTariffProfile.cn} onChange={(e) => setImpactTariffProfile((prev) => ({ ...prev, cn: Number(e.target.value || 0) }))} />
              </label>
              <label>Mexico (%)
                <input className="ghost-input" type="number" value={impactTariffProfile.mx} onChange={(e) => setImpactTariffProfile((prev) => ({ ...prev, mx: Number(e.target.value || 0) }))} />
              </label>
              <label>Korea (%)
                <input className="ghost-input" type="number" value={impactTariffProfile.kr} onChange={(e) => setImpactTariffProfile((prev) => ({ ...prev, kr: Number(e.target.value || 0) }))} />
              </label>
              <label>Japan (%)
                <input className="ghost-input" type="number" value={impactTariffProfile.jp} onChange={(e) => setImpactTariffProfile((prev) => ({ ...prev, jp: Number(e.target.value || 0) }))} />
              </label>
              <label>India (%)
                <input className="ghost-input" type="number" value={impactTariffProfile.in} onChange={(e) => setImpactTariffProfile((prev) => ({ ...prev, in: Number(e.target.value || 0) }))} />
              </label>
              <label>Other (%)
                <input className="ghost-input" type="number" value={impactTariffProfile.other} onChange={(e) => setImpactTariffProfile((prev) => ({ ...prev, other: Number(e.target.value || 0) }))} />
              </label>
            </div>
          )}

          <div className="flow-page-actions" style={{ marginTop: 12, justifyContent: 'flex-start' }}>
            <button className="flow-btn primary" onClick={triggerDisruptionImpact} disabled={!activeOrderId || !activeDecisionComponentId}>
              Trigger Event + Deploy AI Swarm
            </button>
            {isImpactTriggered && (
              <span className="agent-meta" style={{ alignSelf: 'center' }}>
                Triggered: {selectedEvent?.name || selectedEventId} ({impactTriggerType}) on {activeDecisionComponentId}
              </span>
            )}
          </div>

          {!isImpactTriggered ? (
            <div className="section-placeholder">
              <h3>Trigger Disruption First</h3>
              <p>Select event and component, then click Trigger Event + Deploy AI Swarm to launch the knowledge graph and agent analysis.</p>
            </div>
          ) : (
            <SwarmDeployCanvas
              eventId={selectedEventId}
              event={selectedEvent}
              orderContext={orderContext}
              disruptionImpactData={disruptionImpactData}
              isDeployed={Boolean(runId)}
              isDeploying={isDeploying}
              runStatus={runStatus}
              debateLogs={debateLogs}
              causalChain={causalSteps}
              onMaterialAmplificationsChange={setMaterialAmplifications}
              navigateToSection={navigateToSection}
            />
          )}
        </motion.section>
      )}

      {showSections.riskDashboard && (
        <motion.section className="panel" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.12 }}>
          <div className="panel-head">
            <h2>Layer 2: Component Risk Dashboard (Home Screen)</h2>
            <p>Which components are healthy, which are at risk? Heat map rows, countdown bars, live signal strip, and global filters.</p>
          </div>
          {liveAgentError && <p className="flow-error">{liveAgentError}</p>}
          <div className="agent-strip sticky">
            <article className="agent-card">
              <LiveAgentCard
                agentLabel="AutoResearch · Signal Agent"
                insight={insightFor('risk.autoresearch')}
                fallbackTitle={(riskDashboard?.live_signals?.tariff_alerts || [selectedEvent?.name || 'No new signal']).slice(0, 1)[0]}
                fallbackBody="Maritime, tariff, and commodity shifts are continuously scanned for this order scope."
                isWorking={Boolean(liveAgentWorking['risk.autoresearch'])}
                timeline={liveAgentTimeline['risk.autoresearch'] || []}
                onOpenDebug={() => setSelectedAgentDebug(insightFor('risk.autoresearch') || null)}
              />
            </article>
            <article className="agent-card">
              <LiveAgentCard
                agentLabel="RiskScorer · Risk Agent"
                insight={insightFor('risk.riskscorer')}
                fallbackTitle={`Risk ${state.overview.geo_risk}/100 · ${riskRows.length} components in filter window`}
                fallbackBody="Delivery-risk spike detection combines runway, criticality, and regional stress."
                isWorking={Boolean(liveAgentWorking['risk.riskscorer'])}
                timeline={liveAgentTimeline['risk.riskscorer'] || []}
                onOpenDebug={() => setSelectedAgentDebug(insightFor('risk.riskscorer') || null)}
              />
            </article>
          </div>
          <div className="agent-chart-grid">
            <div className="intel-card">
              <h3>Risk Heatmap</h3>
              <RiskHeatmapChart items={riskHeatmapItems} />
            </div>
            <div className="intel-card">
              <h3>Inventory Trajectory</h3>
              <ForecastChart series={riskTrajectorySeries} />
            </div>
          </div>
          <div className="risk-filter-row">
            <select className="ghost-select" value={riskCriticalityFilter} onChange={(e) => setRiskCriticalityFilter(e.target.value)}>
              <option value="all">All Criticality</option>
              <option value="critical">Critical</option>
              <option value="important">Important</option>
              <option value="substitutable">Substitutable</option>
            </select>
            <select className="ghost-select" value={riskRegionFilter} onChange={(e) => setRiskRegionFilter(e.target.value)}>
              <option value="all">All Regions</option>
              {riskRegions.map((region) => <option key={region} value={region}>{region}</option>)}
            </select>
            <label>Days Remaining &lt;=
              <input className="ghost-input" type="number" min="1" max="120" value={riskDaysFilter} onChange={(e) => setRiskDaysFilter(Number(e.target.value))} />
            </label>
          </div>
          <div className="scenario-compare-wrap">
            <table className="scenario-compare-table">
              <thead>
                <tr>
                  <th>Component</th>
                  <th>Criticality</th>
                  <th>Inventory Days</th>
                  <th>Vendor Region</th>
                  <th>Risk Score</th>
                  <th>Status</th>
                  <th>Inventory Timeline</th>
                </tr>
              </thead>
              <tbody>
                {riskRows.map((row) => (
                  <tr key={`risk-${row.component_id}`} onClick={() => setSelectedRiskComponentId(row.component_id)}>
                    <td>{row.name}</td>
                    <td>{row.criticality}</td>
                    <td>{row.inventory_days}d</td>
                    <td>{row.vendor_region}</td>
                    <td>{row.risk_score}</td>
                    <td><span className={`status-pill ${row.status}`}>{row.status}</span></td>
                    <td>
                      <div className="inventory-bar-track">
                        <div className={`inventory-bar-fill ${row.timeline?.is_cliff ? 'cliff' : ''}`} style={{ width: `${Math.min(100, (row.timeline?.days_remaining / Math.max(row.timeline?.safety_stock_threshold || 1, 1)) * 100)}%` }} />
                      </div>
                      <small>{row.timeline?.days_remaining}d vs safety {row.timeline?.safety_stock_threshold}d</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {riskDashboard?.live_signals && (
            <div className="live-signal-strip">
              <span>Vessel: {(riskDashboard.live_signals.vessel_disruptions_active || []).join(', ')}</span>
              <span>Commodity 15m: {(riskDashboard.live_signals.commodity_price_changes_15m || []).map((c) => `${c.commodity} ${c.change_pct > 0 ? '+' : ''}${c.change_pct}%`).join(' | ')}</span>
              <span>Tariff Alerts: {(riskDashboard.live_signals.tariff_alerts || []).join(' | ')}</span>
            </div>
          )}
          {debateLogs.length > 0 && (
            <div className="panel-section-label">Agent Interaction Map</div>
          )}
          {debateLogs.length > 0 && (
            <SwarmInteractionBoard
              logs={debateLogs}
              replayActiveLog={replayActiveLog}
              highlightedAgents={highlightedAgents}
              onAgentFilter={handleAgentFilter}
              compact
            />
          )}
        </motion.section>
      )}

      {showSections.componentAnalysis && componentDeepDive && (
        <motion.section className="panel deep-dive-panel" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.14 }}>
          <div className="panel-head" style={{ paddingBottom: 0 }}>
            <h2>Layer 3: Geopolitical Shock Forecaster</h2>
            <p>How bad is it, and when do we run out? Baseline vs disruption, intervention clock, and live disruption details.</p>
          </div>
          <div className="agent-strip two-col">
            <article className="agent-card">
              <LiveAgentCard
                agentLabel="CausalGraph · Causal Agent"
                insight={insightFor('component.causalgraph')}
                fallbackTitle={`${selectedEvent?.name || 'Selected disruption'} propagates to ${componentDeepDive.component_name}`}
                fallbackBody={(componentDeepDive.event_route_impacts || []).slice(0, 2).join(' | ') || 'No route propagation details available yet.'}
                isWorking={Boolean(liveAgentWorking['component.causalgraph'])}
                timeline={liveAgentTimeline['component.causalgraph'] || []}
                onOpenDebug={() => setSelectedAgentDebug(insightFor('component.causalgraph') || null)}
              />
            </article>
            <article className="agent-card">
              <LiveAgentCard
                agentLabel="TimesFM · Forecast Agent"
                insight={insightFor('component.timesfm')}
                fallbackTitle={`SLA degradation risk in ${shockForecast?.intervention_window_days || '-'} days`}
                fallbackBody={`Predicted stockout shifts from ${shockForecast?.baseline_days_to_stockout ?? '-'}d baseline to ${shockForecast?.disruption_days_to_stockout ?? '-'}d under disruption.`}
                isWorking={Boolean(liveAgentWorking['component.timesfm'])}
                timeline={liveAgentTimeline['component.timesfm'] || []}
                onOpenDebug={() => setSelectedAgentDebug(insightFor('component.timesfm') || null)}
              />
            </article>
          </div>
          <div className="intel-card" style={{ marginTop: 8 }}>
            <h3>Forecast Confidence Horizon</h3>
            <OutlookChart items={componentOutlookItems} />
          </div>
          {shockForecast && (
            <div className="shock-forecast-grid">
              <div><span>Baseline</span><strong>{shockForecast.baseline_days_to_stockout}d</strong></div>
              <div><span>Disruption</span><strong>{shockForecast.disruption_days_to_stockout}d</strong></div>
              <div><span>Delta</span><strong>{shockForecast.disruption_delta_days}d buffer lost</strong></div>
              <div><span>Severity</span><strong>{shockForecast.severity_0_10}/10 ({shockForecast.disruption_score})</strong></div>
              <div className={`intervention-clock ${shockForecast.intervention_window_days < 7 ? 'critical' : ''}`}>
                <span>Intervention Window</span><strong>{shockForecast.intervention_window_days} days</strong>
              </div>
            </div>
          )}
          <div className="deep-dive-lists">
            <div>
              <h4>Active Disruptions</h4>
              <ul>{(componentDeepDive.active_disruptions || []).map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
            <div>
              <h4>Corridors Closed</h4>
              <ul>{(shockForecast?.corridors_closed || componentDeepDive.event_route_impacts || []).map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
            <div>
              <h4>Stranded Vessels</h4>
              <ul>{(shockForecast?.stranded_vessels || []).map((item) => <li key={item.id}>{item.id} · {item.corridor} · {item.status}</li>)}</ul>
            </div>
            <div>
              <h4>Commodity 7-Day</h4>
              <ul>{(shockForecast?.commodity_prices_7d || []).map((point) => <li key={point.day}>{point.day}: {point.index}</li>)}</ul>
            </div>
          </div>
        </motion.section>
      )}

      {showSections.alertsDecisions && criticalAlert && (
        <motion.section className="panel critical-alert-panel" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.16 }}>
          <div className="panel-head" style={{ paddingBottom: 0 }}>
            <h2>Layer 4: Critical Alert Panel</h2>
            <p>Which component needs a decision right now? Includes trigger logic, CFO rationale, and alert history.</p>
          </div>
          <div className={`alert-card ${criticalAlert.triggered ? 'red' : 'stable'}`}>
            <strong>{criticalAlert.component_name}</strong>
            <p>Criticality {criticalAlert.criticality} · Severity {criticalAlert.severity_score}/10 · Stockout {criticalAlert.days_to_stockout_disruption}d · Intervention {criticalAlert.intervention_day}d</p>
            <p><strong>RiskScorer:</strong> {insightFor('alerts.riskscorer')?.summary || `This alert is ${criticalAlert.severity_score >= 8 ? 'severe and immediate' : 'material and watchlisted'} based on runway collapse and disruption score.`}</p>
          </div>
          <div className="agent-strip">
            <article className="agent-card">
              <LiveAgentCard
                agentLabel="Decision Intelligence · LLM"
                insight={insightFor('alerts.decision')}
                fallbackTitle={decisionPanel?.recommended_action || criticalAlert.rationale?.what_to_do}
                fallbackBody="CFO rationale combines expected loss, intervention window, and modeled ROI."
                isWorking={Boolean(liveAgentWorking['alerts.decision'])}
                timeline={liveAgentTimeline['alerts.decision'] || []}
                onOpenDebug={() => setSelectedAgentDebug(insightFor('alerts.decision') || null)}
              />
            </article>
          </div>
          <div className="intel-card" style={{ marginTop: 8 }}>
            <h3>Alert Outcome Projection</h3>
            <OutlookChart items={alertOutlookItems} />
          </div>
          {debateLogs.length > 0 && (
            <div className="panel-section-label">Agent Reasoning Chain</div>
          )}
          {debateLogs.length > 0 && (
            <SwarmInteractionBoard
              logs={debateLogs}
              replayActiveLog={replayActiveLog}
              highlightedAgents={highlightedAgents}
              onAgentFilter={handleAgentFilter}
              compact
            />
          )}
          <div className="rationale-grid">
            <div><span>What happened</span><p>{criticalAlert.rationale?.what_happened}</p></div>
            <div><span>What it means</span><p>{criticalAlert.rationale?.what_it_means}</p></div>
            <div><span>What to do</span><p>{criticalAlert.rationale?.what_to_do}</p></div>
          </div>
          <div className="decision-grid">
            <div><span>Cost of Inaction</span><strong>${criticalAlert.cost_of_inaction_musd}M</strong></div>
            <div><span>Cost of Action</span><strong>${criticalAlert.cost_of_action_musd}M</strong></div>
            <div><span>ROI</span><strong>{criticalAlert.roi_multiple}x</strong></div>
            <div><span>Decision Window</span><strong>&lt; 15 min</strong></div>
          </div>
          <div className="execution-log-wrap">
            <h4>Alert History Log</h4>
            <ul>
              {(criticalAlert.alert_history || []).map((item) => (
                <li key={item.alert_key}><strong>{item.component_name}</strong> · {item.timestamp} · {item.action_taken} · {item.outcome} · {item.manager}</li>
              ))}
            </ul>
          </div>
        </motion.section>
      )}

      {/* ── Hero Row ── */}
      {showSections.riskDashboard && <motion.section className="hero-row" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.15 }}>
        <div className="hero-map-panel panel">
          <LivingSupplyMap
            eventId={selectedEventId}
            deployState={runId ? (runStatus?.status === 'completed' ? 'done' : 'live') : 'idle'}
          />
        </div>
        <div className="hero-command-panel panel">
          <div className="panel-head">
            <h2>Debate Launch Control</h2>
            <div className="panel-head-right">
              <span className={`swarm-badge ${runStatus?.status === 'completed' ? 'done' : runId ? 'live' : ''}`}>{swarmState}</span>
              <span>{activeAgents}/{totalAgents} agents</span>
              <button className={`ghost-btn ${showHistory ? 'active' : ''}`} onClick={() => setShowHistory((v) => !v)}>History ({runHistory.length})</button>
            </div>
          </div>
          <div className="event-grid">
            {state.events.map((event) => (
              <motion.button key={event.id} className={`event-card ${selectedEventId === event.id ? 'selected' : ''}`} onClick={() => resetEvent(event.id)} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}>
                <span className="event-icon">{event.icon}</span>
                <span className="event-name">{event.name}</span>
                <span className={`severity ${event.severity.toLowerCase()}`}>{event.severity}</span>
              </motion.button>
            ))}
          </div>
          <div className="component-selector">
            {missionAnalyticalComponents.map((component) => (
              <button key={component.id} className={`comp-chip ${selectedComponentId === component.id ? 'selected' : ''}`} onClick={() => setSelectedComponentId(component.id)}>
                <span className={`crit-dot ${component.criticality}`} />
                {component.name}{component.runway ? ` · ${component.runway}d` : ''}
              </button>
            ))}
          </div>
          <div className="mission-flow-banner">
            <span className={missionOrderReady ? 'done' : ''}>1. Intake complete (Page 1) + risk context ready</span>
            <span className={Boolean(runId) ? 'done' : ''}>2. Select disruption and deploy AI Swarm</span>
            <span className={missionReadyToAdvance ? 'done' : ''}>3. Continue to component analysis</span>
          </div>
          <div className="deploy-row">
            <motion.button className="deploy-btn" onClick={deploySwarm} disabled={isDeploying || orderLoading || !missionOrderReady} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}>
              {orderLoading ? <><span className="deploy-spinner" />Preparing Order Context...</> : isDeploying ? <><span className="deploy-spinner" />Deploying...</> : '⚡ Deploy Live AI Swarm'}
            </motion.button>
            <div className="deploy-progress-wrap">
              <div className="deploy-progress-track">
                <motion.div className="deploy-progress-fill" animate={{ width: `${runStatus?.progress || 0}%` }} transition={{ duration: 0.4 }} />
              </div>
              <span>{runStatus ? `${runStatus.status.toUpperCase()} · ${runStatus.progress}%` : 'Not started'}</span>
            </div>
          </div>
          {missionReadyToAdvance && (
            <div className="flow-page-actions" style={{ marginTop: 10, justifyContent: 'flex-start' }}>
              <button className="flow-btn primary" onClick={() => navigateToSection('component-analysis')}>
                {view === 'disruption-impact' ? 'Continue to Simulation Lab' : 'Continue to Component Analysis'}
              </button>
            </div>
          )}
          {deployError && <motion.p className="deploy-error" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{deployError}</motion.p>}
        </div>
      </motion.section>}

      {/* ── Run History ── */}
      <AnimatePresence>
        {showSections.riskDashboard && showHistory && (
          <motion.section className="panel history-panel" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <div className="panel-head"><h2>Run History</h2><p>{runHistory.length} recorded runs</p></div>
            <div className="history-list">
              {runHistory.length === 0 && <p className="empty-state">No runs yet.</p>}
              {runHistory.map((run) => (
                <div key={run.run_id} className={`history-row ${compareRunId === run.run_id ? 'pinned' : ''} ${runId === run.run_id ? 'current' : ''}`}>
                  <div className="history-info">
                    <span className="history-icon">{run.event_icon}</span>
                    <div><strong>{run.event_name}</strong><p>{run.run_id} · {run.status.toUpperCase()} · {run.progress}%</p></div>
                  </div>
                  <button className={`ghost-btn ${compareRunId === run.run_id ? 'active' : ''}`} onClick={() => setCompareRunId((prev) => prev === run.run_id ? null : run.run_id)} disabled={run.run_id === runId}>
                    {compareRunId === run.run_id ? 'Unpin' : 'Compare'}
                  </button>
                </div>
              ))}
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* ── AI Debate Stage ── */}
      {showSections.componentAnalysis && <motion.section className="panel debate-section" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2 }}>
        <AIDebateStage
          logs={debateLogs}
          displayedLogs={displayedLogs}
          highlightedAgents={highlightedAgents}
          replayCursor={replayCursor}
          isReplayPlaying={isReplayPlaying}
          debateLogs={debateLogs}
          replayActiveLog={replayActiveLog}
          graphNodeLabels={graphNodeLabels}
          onDebateClick={handleDebateClick}
          onAgentFilter={handleAgentFilter}
          onReplayChange={(v) => { setReplayCursor(v); setIsReplayPlaying(false) }}
          onReplayToggle={handleReplayToggle}
          onReplayReset={() => { setReplayCursor(null); setSelectedEdgeId(''); setIsReplayPlaying(false) }}
          agentTelemetry={agentTelemetry}
          judgeVerdict={runStatus?.judge_verdict || null}
          onAutoPlay={autoPlayHandler}
        />
      </motion.section>}

      {/* ── Intelligence Panel ── */}
      {showSections.componentAnalysis && <motion.section className="panel intelligence-panel" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.3 }}>
        <div className="panel-head">
          <h2>Intelligence Artifacts</h2>
          <p>
            {runStatus?.graph_ready ? 'Graph ready · click edges to trace' : 'Populating from debate signals'}
            {` · Graph backend: ${interactionGraph.backend || 'fallback'}`}
            {interactionGraph.configured ? (interactionGraph.connected ? ' (connected)' : ' (configured, fallback active)') : ' (not configured)'}
          </p>
        </div>
        <div className="intelligence-grid">
          <div className="intel-primary">
            <h3>Knowledge Graph 2.0</h3>
            <KnowledgeGraph2
              graphNodes={graphNodes}
              graphEdges={graphEdges}
              selectedEdgeId={selectedEdgeId}
              activatedNodeIds={activatedNodeIds}
              onEdgeSelect={(edgeId) => {
                setSelectedEdgeId(edgeId)
                const log = debateLogs.find((l) => l.edge_id === edgeId)
                if (log) setReplayCursor(log.sequence)
              }}
            />
          </div>
          <div className="intel-secondary">
            <div className="intel-card">
              <h3>Graph Runtime</h3>
              <p>Backend: {(interactionGraph.backend || 'fallback').toUpperCase()}</p>
              <p>Nodes: {graphNodes.length} · Edges: {graphEdges.length}</p>
              <p>{interactionGraphLoading ? 'Refreshing interaction graph...' : interactionGraph.summary || 'Serving interaction links for current disruption event.'}</p>
              {interactionGraphError && <p className="empty-state" style={{ marginTop: 6 }}>{interactionGraphError}</p>}
            </div>
            <div className="intel-card"><h3>Risk Matrix</h3><RiskHeatmapChart items={heatmapItems} /></div>
            <div className="intel-card"><h3>Future Outlook</h3><OutlookChart items={futureOutlook} /></div>
            {monitoringView && (
              <div className="intel-card monitoring-card">
                <h3>Continuous Monitoring</h3>
                <p className={`monitoring-status ${monitoringView.status}`}>{monitoringView.message}</p>
                <div className="monitoring-trend-row">
                  {(monitoringView.days_to_stockout_trend || []).map((value, idx) => (
                    <span key={`${value}-${idx}`} className="monitoring-trend-chip">T-{idx}: {value}d</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.section>}

      {/* ── Scenario Filmstrip ── */}
      {view === 'simulation-lab' && (
        <motion.section className="panel" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.42 }}>
          <div className="panel-head">
            <h2>Page 3: Price Simulation Engine</h2>
            <p>Monte Carlo landed-cost simulation, negotiation ceiling, and break-even boundary by scenario.</p>
          </div>
          {!profitRecommendationData ? (
            <div className="section-placeholder">
              <h3>Running Monte Carlo Engine</h3>
              <p>We generate optimistic/base/stressed/worst-case scenarios and compute full landed economics with confidence bands.</p>
            </div>
          ) : (
            <>
              <p className="ops-context-note">{profitRecommendationData.headline}</p>

              <div className="order-auto-status order-auto-controls" style={{ marginTop: 8 }}>
                <label>Locked Revenue per Unit ($)
                  <input className="ghost-input" type="number" min="1" step="0.01" value={simulationLockedRevenueUnit} onChange={(e) => setSimulationLockedRevenueUnit(Number(e.target.value || 0))} />
                </label>
                <label>Target Margin (%)
                  <input className="ghost-input" type="number" min="1" max="65" step="0.5" value={simulationTargetMarginPct} onChange={(e) => setSimulationTargetMarginPct(Number(e.target.value || 0))} />
                </label>
                <label>Freight Mode
                  <select className="ghost-select" value={simulationFreightMode} onChange={(e) => setSimulationFreightMode(e.target.value)}>
                    <option value="auto">Auto</option>
                    <option value="sea">Sea</option>
                    <option value="air">Air</option>
                  </select>
                </label>
                <label>Monte Carlo Runs
                  <input className="ghost-input" type="number" min="300" max="10000" step="100" value={simulationMonteCarloRuns} onChange={(e) => setSimulationMonteCarloRuns(Number(e.target.value || 1200))} />
                </label>
              </div>

              <div className="metrics-strip">
                <div><span>Active Scenario</span><strong>{activeSimulationScenario?.scenario_name || '-'}</strong></div>
                <div><span>Landed Cost / Component</span><strong>${Number(activeSimulationScenario?.landed_cost_per_unit || 0).toFixed(2)}</strong></div>
                <div><span>Negotiation Ceiling</span><strong>${Number(activeSimulationScenario?.negotiation_ceiling_purchase_price || 0).toFixed(2)}</strong></div>
                <div><span>Break-even Purchase</span><strong>${Number(activeSimulationScenario?.break_even_purchase_price || 0).toFixed(2)}</strong></div>
              </div>

              <div className="bom-category-row" style={{ marginTop: 8 }}>
                {topSimulationScenarios.map((scenarioItem) => (
                  <button
                    key={scenarioItem.scenario_id}
                    className={`ghost-btn ${activeSimulationScenario?.scenario_id === scenarioItem.scenario_id ? 'active' : ''}`}
                    onClick={() => setSelectedSimulationScenarioId(scenarioItem.scenario_id)}
                  >
                    {scenarioItem.scenario_name}
                  </button>
                ))}
              </div>

              <div className="scenario-compare-wrap" style={{ marginTop: 10 }}>
                <table className="scenario-compare-table">
                  <thead>
                    <tr>
                      <th>Scenario</th>
                      <th>Landed Cost / Component</th>
                      <th>Landed Cost CI (P10-P90)</th>
                      <th>Profit / Unit (Expected)</th>
                      <th>Profit CI (P10-P90)</th>
                      <th>Negotiation Ceiling</th>
                      <th>Break-even Purchase</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topSimulationScenarios.map((scenarioItem) => (
                      <tr key={`sim-${scenarioItem.scenario_id}`} onClick={() => setSelectedSimulationScenarioId(scenarioItem.scenario_id)}>
                        <td>{scenarioItem.scenario_name}</td>
                        <td>${Number(scenarioItem.landed_cost_per_unit || 0).toFixed(2)}</td>
                        <td>${Number(scenarioItem.landed_cost_per_unit_ci?.[0] || 0).toFixed(2)} to ${Number(scenarioItem.landed_cost_per_unit_ci?.[1] || 0).toFixed(2)}</td>
                        <td>${Number(scenarioItem.profit_per_unit_expected || 0).toFixed(2)}</td>
                        <td>${Number(scenarioItem.profit_per_unit_ci?.[0] || 0).toFixed(2)} to ${Number(scenarioItem.profit_per_unit_ci?.[1] || 0).toFixed(2)}</td>
                        <td>${Number(scenarioItem.negotiation_ceiling_purchase_price || 0).toFixed(2)}</td>
                        <td>${Number(scenarioItem.break_even_purchase_price || 0).toFixed(2)}</td>
                        <td>{scenarioItem.is_loss_making ? 'Loss Risk' : 'Profitable'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="ops-context-note" style={{ marginTop: 10 }}>
                {profitRecommendationData.loss_boundary_scenario
                  ? `Loss boundary starts at ${profitRecommendationData.loss_boundary_scenario.scenario_name} (${profitRecommendationData.loss_boundary_scenario.scenario_id}) where expected profit/unit is $${Number(profitRecommendationData.loss_boundary_scenario.profit_per_unit_expected || 0).toFixed(2)}.`
                  : 'All simulated scenarios remain above zero expected profit per unit.'}
              </p>

              <div className="agent-chart-grid" style={{ marginTop: 8 }}>
                <div className="intel-card">
                  <h3>Profit Waterfall ({activeSimulationScenario?.scenario_name || '-'})</h3>
                  <ProfitWaterfallChart scenario={activeSimulationScenario} />
                </div>
                <div className="intel-card">
                  <h3>Monte Carlo Profit Band (P10-P90)</h3>
                  <MonteCarloBandChart scenarios={topSimulationScenarios} />
                </div>
              </div>

              <div className="scenario-next-wrap" style={{ marginTop: 12, justifyContent: 'flex-start' }}>
                <button className="flow-btn primary" onClick={() => navigateToSection('negotiation-intelligence')}>
                  Continue to Negotiation Intelligence
                </button>
              </div>
            </>
          )}
        </motion.section>
      )}

      {showSections.procurementActions && <motion.section className="panel scenario-section" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.35 }}>
        <div className="panel-head">
          <h2>Page 5: Procurement Actions</h2>
          <div className="panel-head-right">
            <select className="ghost-select" value={plannerHorizon} onChange={(e) => setPlannerHorizon(e.target.value)}>
              {plannerHorizons.map((h) => <option key={h} value={h}>{h}d horizon</option>)}
            </select>
            <select className="ghost-select" value={plannerPriority} onChange={(e) => setPlannerPriority(e.target.value)}>
              {plannerPriorities.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>
        <div className="agent-strip two-col">
          <article className="agent-card">
            <LiveAgentCard
              agentLabel="RecEngine · Decision Agent"
              insight={insightFor('procurement.recengine')}
              fallbackTitle={decisionPanel?.recommended_action || recommendation?.title || `Scenario ${selectedScenario} recommended`}
              fallbackBody="Optimizes vendor choice using lead time, risk penalty, and intervention window economics."
              isWorking={Boolean(liveAgentWorking['procurement.recengine'])}
              timeline={liveAgentTimeline['procurement.recengine'] || []}
              onOpenDebug={() => setSelectedAgentDebug(insightFor('procurement.recengine') || null)}
            />
          </article>
          <article className="agent-card">
            <LiveAgentCard
              agentLabel="Procurement Copilot · LLM"
              insight={insightFor('procurement.copilot')}
              fallbackTitle="Ask: Why Mexico? What if we delay by 3 days?"
              fallbackBody="Use the Brief assistant for contextual procurement Q&A based on this run."
              isWorking={Boolean(liveAgentWorking['procurement.copilot'])}
              timeline={liveAgentTimeline['procurement.copilot'] || []}
              onOpenDebug={() => setSelectedAgentDebug(insightFor('procurement.copilot') || null)}
            />
          </article>
        </div>
        <div className="scenario-flow-note">
          <span>1. Set assumptions and constraints</span>
          <span>2. Review generated scenario comparisons</span>
          <span>3. Review trajectory and simulation results</span>
          <span>4. Continue to Route Intelligence</span>
        </div>
        <div className="scenario-controls-wrap">
          <div className="panel-head" style={{ paddingBottom: 0 }}>
            <h3>Assumptions Workspace</h3>
            <p>Controls below shape what-if assumptions, then outputs update in the trajectory and simulation sections.</p>
          </div>
          <SimulationControlModule
            config={scenarioConfig}
            setConfig={setScenarioConfig}
            primaryComponentId={selectedComponentId}
            primaryComponentName={selectedComponent?.name}
          />
        </div>
        <div className="scenario-comparison-stack">
          <div className="panel-head" style={{ paddingBottom: 0 }}>
            <h3>Generated Scenario Comparison</h3>
            <p>After assumptions are set, compare the available strategy paths before choosing the one to carry into downstream outputs.</p>
          </div>
          <ScenarioFilmstrip
            scenarios={scenarioComparisonRows.length ? scenarioComparisonRows : (
              ['A', 'B', 'C', 'D', 'E'].map((l) => {
                const s = state?.scenarios?.[selectedEventId]?.[l]
                return s ? { letter: l, ...s } : null
              }).filter(Boolean)
            )}
            selectedScenario={selectedScenario}
            onSelect={setSelectedScenario}
            recommendation={recommendation}
          />
          <div className="scenario-analytics-grid">
            <div className="scenario-analytics-card">
              <div className="panel-head" style={{ paddingBottom: 0 }}><h3>Scenario Comparison</h3></div>
              <ScenarioComparisonTable scenarios={scenarioComparisonRows} selectedScenario={selectedScenario} onSelect={setSelectedScenario} />
            </div>
            <div className="scenario-analytics-card">
              <div className="panel-head" style={{ paddingBottom: 0 }}><h3>Multi-Axis Comparison</h3></div>
              <ScenarioRadarChart scenarios={scenarioComparisonRows} selectedScenario={selectedScenario} />
            </div>
          </div>
        </div>

        <div className="scenario-decision-grid">
          <div className="scenario-analytics-card">
            <div className="panel-head" style={{ paddingBottom: 0 }}>
              <h3>Layer 5: Vendor Scorer + Procurement Action Panel</h3>
              <p>Who can supply it, and which option should be approved immediately?</p>
            </div>
            <div className="vendor-weight-grid">
              <label>Reliability
                <input type="range" min="0" max="1" step="0.05" value={vendorWeights.reliability} onChange={(e) => setVendorWeights((prev) => ({ ...prev, reliability: Number(e.target.value) }))} />
                <span>{vendorWeights.reliability.toFixed(2)}</span>
              </label>
              <label>Cost
                <input type="range" min="0" max="1" step="0.05" value={vendorWeights.cost} onChange={(e) => setVendorWeights((prev) => ({ ...prev, cost: Number(e.target.value) }))} />
                <span>{vendorWeights.cost.toFixed(2)}</span>
              </label>
              <label>Speed
                <input type="range" min="0" max="1" step="0.05" value={vendorWeights.speed} onChange={(e) => setVendorWeights((prev) => ({ ...prev, speed: Number(e.target.value) }))} />
                <span>{vendorWeights.speed.toFixed(2)}</span>
              </label>
              <label>Geo Penalty
                <input type="range" min="0" max="1" step="0.05" value={vendorWeights.geo_penalty} onChange={(e) => setVendorWeights((prev) => ({ ...prev, geo_penalty: Number(e.target.value) }))} />
                <span>{vendorWeights.geo_penalty.toFixed(2)}</span>
              </label>
            </div>
            <div className="vendor-tier-row">
              {vendorTierOptions.map((tier) => (
                <label key={tier} className="sim-toggle">
                  <input
                    type="checkbox"
                    checked={vendorTierFilter.includes(tier)}
                    onChange={() => setVendorTierFilter((prev) => (prev.includes(tier) ? prev.filter((t) => t !== tier) : [...prev, tier]))}
                  />
                  <span>{tier}</span>
                </label>
              ))}
              <label>Low-runway threshold (days)
                <input className="ghost-input" type="number" min="5" max="45" value={lowRunwayThreshold} onChange={(e) => setLowRunwayThreshold(Number(e.target.value))} />
              </label>
            </div>
            {vendorScore?.active_profile && (
              <p className="ops-context-note">Active profile: <strong>{vendorScore.active_profile.profile}</strong> · Dynamic switch {vendorScore.active_profile.switched ? 'ON' : 'OFF'}</p>
            )}
            {vendorScore?.primary_vendor_status && (
              <div className="ops-context-note">
                Primary vendor status: <strong>{vendorScore.primary_vendor_status.vendor_name}</strong> · {vendorScore.primary_vendor_status.status}
              </div>
            )}
            {vendorScoringError && <p className="flow-error">{vendorScoringError}</p>}
            {vendorScoringLoading ? <p className="empty-state">Scoring vendors...</p> : (
              <div className="scenario-compare-wrap">
                <table className="scenario-compare-table">
                  <thead>
                    <tr>
                      <th>Vendor</th>
                      <th>Tier</th>
                      <th>Lead</th>
                      <th>Premium</th>
                      <th>Reliability</th>
                      <th>Geo Risk</th>
                      <th>Composite</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(vendorScore?.ranked_vendors || []).map((vendor) => (
                      <tr key={vendor.vendor_id}>
                        <td>{vendor.name}</td>
                        <td>{vendor.tier}</td>
                        <td>{vendor.lead_days}d</td>
                        <td>{vendor.cost_premium}%</td>
                        <td>{vendor.reliability}</td>
                        <td>{vendor.geo_risk}</td>
                        <td>{vendor.composite_score}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="scenario-next-wrap" style={{ marginTop: 10, justifyContent: 'flex-start' }}>
              <button className="flow-btn primary" onClick={executeActions} disabled={executionLoading || !activeOrderId}>
                {executionLoading ? 'Approving...' : (decisionPanel?.approve_label || 'Approve Mexico sourcing')}
              </button>
            </div>
          </div>

          {showSections.routeIntelligence && <div className="scenario-analytics-card">
            <div className="panel-head" style={{ paddingBottom: 0 }}>
              <h3>Layer 6: Route Optimizer</h3>
              <p>How does the component physically get here on time?</p>
            </div>
            {routeError && <p className="flow-error">{routeError}</p>}
            {routePlan?.recommended_primary ? (
              <>
                <div className="route-card primary">
                  <span>Primary Route</span>
                  <strong>{routePlan.recommended_primary.route_id}</strong>
                  <p>{routePlan.recommended_primary.nodes?.join(' -> ')}</p>
                  <div className="route-chip-row">
                    <span>{routePlan.recommended_primary.transit_days}d transit</span>
                    <span>${routePlan.recommended_primary.cost_per_pallet}/pallet</span>
                    <span>Risk {routePlan.recommended_primary.risk}</span>
                  </div>
                </div>
                {(routePlan.fallback_routes || []).map((route) => (
                  <div key={route.route_id} className="route-card">
                    <span>Fallback</span>
                    <strong>{route.route_id}</strong>
                    <p>{route.nodes?.join(' -> ')}</p>
                    <div className="route-chip-row">
                      <span>{route.transit_days}d transit</span>
                      <span>${route.cost_per_pallet}/pallet</span>
                      <span>Risk {route.risk}</span>
                    </div>
                  </div>
                ))}
                <div className="corridor-list">
                  {(routePlan.corridor_graph?.nodes || []).map((node) => (
                    <span key={node.id} className={`corridor-chip ${node.status}`}>{node.label}: {node.status}</span>
                  ))}
                </div>
                {routePlan.mode_comparison && (
                  <div className="mode-comparison-grid">
                    <div>
                      <span>Air</span>
                      <strong>{routePlan.mode_comparison.air?.transit_days || '-'}d · ${routePlan.mode_comparison.air?.cost_per_pallet || '-'}</strong>
                    </div>
                    <div>
                      <span>Sea</span>
                      <strong>{routePlan.mode_comparison.sea?.transit_days || '-'}d · ${routePlan.mode_comparison.sea?.cost_per_pallet || '-'}</strong>
                    </div>
                    <div>
                      <span>Recommendation</span>
                      <strong>{routePlan.mode_comparison.recommended_mode}</strong>
                    </div>
                  </div>
                )}
                {routePlan.fuel_multipliers && (
                  <div className="route-chip-row" style={{ marginTop: 8 }}>
                    <span>Jet fuel x{routePlan.fuel_multipliers.jet_fuel_index}</span>
                    <span>Diesel x{routePlan.fuel_multipliers.diesel_index}</span>
                    <span>Freight multiplier x{routePlan.fuel_multipliers.freight_cost_multiplier}</span>
                  </div>
                )}
              </>
            ) : (
              <p className="empty-state">Route optimizer will appear after vendor scoring ranks at least one viable supplier.</p>
            )}
          </div>}
        </div>

        {plannerInventorySeries.length > 0 && (
          <div className="forecast-chart-wrap">
            <div className="panel-head" style={{ paddingBottom: 0 }}><h3>Inventory Trajectory — {plannerHorizon}d · Priority: {plannerPriority}</h3></div>
            <ForecastChart series={plannerInventorySeries} />
          </div>
        )}
      </motion.section>}

      {showSections.routeIntelligence && (
        <motion.section className="panel" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.35 }}>
          <div className="panel-head">
            <h2>Page 6: Route Intelligence</h2>
            <p>Logistics reasoning and corridor-level signal monitoring for selected sourcing plan.</p>
          </div>
          <div className="agent-strip two-col">
            <article className="agent-card">
              <LiveAgentCard
                agentLabel="CausalGraph · Light"
                insight={insightFor('route.causalgraph')}
                fallbackTitle={`${selectedEvent?.name || 'Disruption'} impacts corridor reliability`}
                fallbackBody={(shockForecast?.corridors_closed || componentDeepDive?.event_route_impacts || []).slice(0, 2).join(' | ') || 'No immediate corridor closure in current scope.'}
                isWorking={Boolean(liveAgentWorking['route.causalgraph'])}
                timeline={liveAgentTimeline['route.causalgraph'] || []}
                onOpenDebug={() => setSelectedAgentDebug(insightFor('route.causalgraph') || null)}
              />
            </article>
            <article className="agent-card">
              <LiveAgentCard
                agentLabel="AutoResearch · Corridor Signals"
                insight={insightFor('route.autoresearch')}
                fallbackTitle={(riskDashboard?.live_signals?.vessel_disruptions_active || []).slice(0, 1)[0] || 'Monitoring vessel and tariff updates'}
                fallbackBody="Filtered to route-specific developments likely to change ETA or freight cost."
                isWorking={Boolean(liveAgentWorking['route.autoresearch'])}
                timeline={liveAgentTimeline['route.autoresearch'] || []}
                onOpenDebug={() => setSelectedAgentDebug(insightFor('route.autoresearch') || null)}
              />
            </article>
          </div>
          <div className="hero-map-panel panel" style={{ marginTop: 12 }}>
            <LivingSupplyMap
              eventId={selectedEventId}
              deployState={runId ? (runStatus?.status === 'completed' ? 'done' : 'live') : 'idle'}
            />
          </div>
          {routeError && <p className="flow-error" style={{ marginTop: 10 }}>{routeError}</p>}
          {routePlan?.recommended_primary ? (
            <>
              <div className="route-card primary" style={{ marginTop: 10 }}>
                <span>Primary Route</span>
                <strong>{routePlan.recommended_primary.route_id}</strong>
                <p>{routePlan.recommended_primary.nodes?.join(' -> ')}</p>
                <div className="route-chip-row">
                  <span>{routePlan.recommended_primary.transit_days}d transit</span>
                  <span>${routePlan.recommended_primary.cost_per_pallet}/pallet</span>
                  <span>Risk {routePlan.recommended_primary.risk}</span>
                </div>
              </div>
              {routePlan.mode_comparison && (
                <div className="mode-comparison-grid">
                  <div>
                    <span>Air</span>
                    <strong>{routePlan.mode_comparison.air?.transit_days || '-'}d · ${routePlan.mode_comparison.air?.cost_per_pallet || '-'}</strong>
                  </div>
                  <div>
                    <span>Sea</span>
                    <strong>{routePlan.mode_comparison.sea?.transit_days || '-'}d · ${routePlan.mode_comparison.sea?.cost_per_pallet || '-'}</strong>
                  </div>
                  <div>
                    <span>Recommendation</span>
                    <strong>{routePlan.mode_comparison.recommended_mode}</strong>
                  </div>
                </div>
              )}
              {routePlan.fuel_multipliers && (
                <div className="route-chip-row" style={{ marginTop: 8 }}>
                  <span>Jet fuel x{routePlan.fuel_multipliers.jet_fuel_index}</span>
                  <span>Diesel x{routePlan.fuel_multipliers.diesel_index}</span>
                  <span>Freight multiplier x{routePlan.fuel_multipliers.freight_cost_multiplier}</span>
                </div>
              )}
            </>
          ) : (
            <p className="empty-state" style={{ marginTop: 10 }}>Route optimizer appears after at least one viable vendor is scored in Procurement Actions.</p>
          )}
          <div className="scenario-next-wrap" style={{ marginTop: 12, justifyContent: 'flex-start' }}>
            <button className="flow-btn primary" onClick={() => navigateToSection('delivery-promise')}>
              {view === 'simulation-lab' ? 'Continue to Negotiation Intelligence' : 'Continue to Delivery Promise'}
            </button>
          </div>
        </motion.section>
      )}

      {/* ── Simulation Agent ── */}
      <AnimatePresence>
        {showSections.procurementActions && (
          <motion.section
            className="panel simulation-section"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.38 }}
          >
            {runId ? (
              <SimulationPanel
                runId={runId}
                apiBase={API_BASE}
                selectedScenario={selectedScenario}
                scenarioConfig={scenarioConfig}
                onScenarioSelect={setSelectedScenario}
              />
            ) : (
              <div className="section-placeholder">
                <h3>Simulation Agent</h3>
                <p>Deploy the live AI swarm from Debate Launch Control to unlock simulation playback and scenario comparison.</p>
              </div>
            )}
          </motion.section>
        )}
      </AnimatePresence>

      {showSections.procurementActions && (
        <div className="scenario-next-wrap scenario-finalize-wrap">
          <p>After selecting a supplier strategy, continue to Negotiation Intelligence for deal-structure planning.</p>
          <button className="flow-btn primary" onClick={() => navigateToSection('negotiation-intelligence')}>
            {view === 'simulation-lab' ? 'Continue to Negotiation Intelligence' : 'Continue to Route Intelligence'}
          </button>
        </div>
      )}

      {['negotiation-intelligence', 'negotiation-recommendation'].includes(view) && (
        <motion.section className="panel" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.42 }}>
          <div className="panel-head">
            <h2>Module 4: Negotiation Intelligence</h2>
            <p>Define your opening offer, walk-away price, and BATNA before committing.</p>
          </div>
          {!negotiationBand ? (
            <div className="section-placeholder">
              <h3>Negotiation Inputs Pending</h3>
              <p>Run disruption impact and simulation to unlock target low/high, walk-away price, and leverage guidance.</p>
            </div>
          ) : (
            <>
              <div className="decision-grid">
                <div><span>Opening Offer</span><strong>${negotiationBand.target_low_price}</strong></div>
                <div><span>Deal Zone</span><strong>${negotiationBand.target_low_price} to ${negotiationBand.target_high_price}</strong></div>
                <div><span>Walk Away</span><strong>${negotiationBand.walk_away_price}</strong></div>
                <div><span>BATNA</span><strong>{recommendationMemo?.rollback_trigger || 'Shift to alternate vendor + route'}</strong></div>
              </div>
              <div className="rationale-grid">
                <div><span>Negotiation Band</span><p>${negotiationBand.target_low_price} to ${negotiationBand.target_high_price} · walk away at ${negotiationBand.walk_away_price}</p></div>
                <div><span>Leverage</span><p>{negotiationBand.leverage}</p></div>
                <div><span>Rationale</span><p>{negotiationBand.rationale}</p></div>
              </div>
              <div className="vendor-filter-row" style={{ marginTop: 8 }}>
                <label className="ghost-input" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  Counter-offer Unit Price ($)
                  <input
                    className="ghost-input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={vendorCounterOffer}
                    onChange={(event) => setVendorCounterOffer(event.target.value)}
                  />
                </label>
              </div>
              <p className="ops-context-note">
                Counter-offer impact: ${Math.round(counterOfferAdjustedPurchaseCost).toLocaleString()} purchase cost yields ${Math.round(liveProfit).toLocaleString()} projected profit ({liveMarginPct.toFixed(1)}% margin).
              </p>
              <div className="scenario-next-wrap" style={{ marginTop: 12, justifyContent: 'flex-start' }}>
                <button className="flow-btn primary" onClick={() => navigateToSection('recommendation-engine')}>
                  Continue to Recommendation Engine
                </button>
              </div>
            </>
          )}
        </motion.section>
      )}

      {view === 'recommendation-engine' && (
        <motion.section className="panel" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.42 }}>
          <div className="panel-head">
            <h2>Module 5: Recommendation Engine</h2>
            <p>Ranked procurement options with explicit margin outcomes, route logic, and CFO-readable rationale.</p>
          </div>
          {!sortedRecommendationOptions.length ? (
            <div className="section-placeholder">
              <h3>Recommendation Pending</h3>
              <p>Decision memo appears after simulation scenarios are evaluated.</p>
            </div>
          ) : (
            <>
              <div className="decision-grid" style={{ marginBottom: 10 }}>
                <div><span>Default Sort</span><strong>Projected Margin (High to Low)</strong></div>
                <div><span>Selected Option</span><strong>{activeRecommendation?.scenarioName || '-'}</strong></div>
                <div><span>Profit Protection vs Baseline</span><strong>${Math.round(Number(recommendationMemo?.profit_protected_vs_baseline || 0)).toLocaleString()}</strong></div>
                <div><span>Graph Backend</span><strong>{(interactionGraph.backend || 'fallback').toUpperCase()}</strong></div>
              </div>

              <div className="vendor-filter-row" style={{ marginBottom: 8, alignItems: 'center', gap: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#7aaccc', fontSize: '0.78rem' }}>
                  Re-sort recommendations by:
                  <select className="ghost-select" value={recommendationSortBy} onChange={(event) => setRecommendationSortBy(event.target.value)}>
                    <option value="margin">Projected Margin</option>
                    <option value="risk">Risk Score</option>
                    <option value="lead">Lead Time</option>
                    <option value="cost">Total Landed Cost</option>
                  </select>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#7aaccc', fontSize: '0.78rem' }}>
                  Narrative Mode:
                  <select className="ghost-select" value={recommendationNarrativeMode} onChange={(event) => setRecommendationNarrativeMode(event.target.value)}>
                    <option value="template">Deterministic CFO Template</option>
                    <option value="ollama">LLM Narrative (Ollama/OpenAI compatible)</option>
                  </select>
                </label>
              </div>

              <div className="scenario-compare-wrap" style={{ marginTop: 10 }}>
                <table className="scenario-compare-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Vendor + Country</th>
                      <th>Negotiated/Target Price</th>
                      <th>Logistics Route + Mode</th>
                      <th>Total Landed Cost</th>
                      <th>Projected Margin</th>
                      <th>Risk Score</th>
                      <th>Lead Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRecommendationOptions.map((option, index) => (
                      <tr
                        key={option.id}
                        onClick={() => setActiveRecommendationId(option.id)}
                        style={{
                          cursor: 'pointer',
                          background: activeRecommendation?.id === option.id ? 'rgba(0,191,255,0.08)' : 'transparent',
                        }}
                      >
                        <td>{index + 1}</td>
                        <td>{option.vendorName} ({option.vendorCountry})</td>
                        <td>${option.negotiatedOrTargetPrice.toFixed(2)}</td>
                        <td>{option.routeLabel}</td>
                        <td>${Math.round(option.totalLandedCost).toLocaleString()}</td>
                        <td className={option.projectedMarginPct >= simulationTargetMarginPct ? 'kpi-ok' : 'kpi-warn'}>{option.projectedMarginPct.toFixed(2)}%</td>
                        <td className={option.riskScore > 55 ? 'kpi-danger' : option.riskScore > 35 ? 'kpi-warn' : 'kpi-ok'}>{option.riskScore.toFixed(1)}</td>
                        <td>{option.leadTimeDays.toFixed(1)}d</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {activeRecommendation && (
                <>
                  <div className="rationale-grid" style={{ marginTop: 12 }}>
                    <div>
                      <span>Margin Answer</span>
                      <p>{activeRecommendation.marginAnswer}</p>
                    </div>
                    <div>
                      <span>Rollback Trigger</span>
                      <p>{recommendationMemo?.rollback_trigger || 'Switch to second-ranked option if execution risk rises beyond threshold.'}</p>
                    </div>
                    <div>
                      <span>CFO Narrative</span>
                      <p>{activeRecommendationRationale}</p>
                    </div>
                  </div>

                  <div className="agent-chart-grid" style={{ marginTop: 10 }}>
                    <div className="intel-card">
                      <h3>Ranked Metric View</h3>
                      <RecommendationRankChart options={sortedRecommendationOptions} sortBy={recommendationSortBy} />
                    </div>
                    <div className="intel-card">
                      <h3>Profit vs Risk Tradeoff</h3>
                      <RecommendationTradeoffChart options={sortedRecommendationOptions} />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: '1rem', marginTop: 12 }}>
                    <div className="panel" style={{ padding: '0.8rem 1rem', border: '1px solid rgba(0,191,255,0.14)', background: 'rgba(0,191,255,0.03)' }}>
                      <div className="panel-head" style={{ paddingBottom: 0 }}>
                        <h3>Recommendation Interaction Graph</h3>
                        <p>{interactionGraph.configured ? 'Neo4j-backed graph available for relationship traversal.' : 'Fallback in-memory graph active. Configure Neo4j env to promote live graph edges.'}</p>
                      </div>
                      <KnowledgeGraph2
                        graphNodes={recommendationGraphNodes}
                        graphEdges={recommendationGraphEdges}
                        selectedEdgeId={selectedEdgeId}
                        activatedNodeIds={activatedNodeIds}
                        onEdgeSelect={setSelectedEdgeId}
                      />
                    </div>

                    <div className="panel" style={{ padding: '0.8rem 1rem', border: '1px solid rgba(0,191,255,0.14)', background: 'rgba(0,191,255,0.03)' }}>
                      <div className="panel-head" style={{ paddingBottom: 0 }}>
                        <h3>Route Mode Mix + Decision Notes</h3>
                        <p>Distribution of selected transport modes across ranked options.</p>
                      </div>
                      <RecommendationModeMixChart options={sortedRecommendationOptions} />
                      <div className="ops-context-note" style={{ marginTop: 8 }}>
                        Best current option: <strong>{activeRecommendation.vendorName}</strong> via <strong>{activeRecommendation.routeLabel}</strong>, targeting <strong>${activeRecommendation.negotiatedOrTargetPrice.toFixed(2)}</strong> at <strong>{activeRecommendation.projectedMarginPct.toFixed(2)}%</strong> projected margin.
                      </div>
                      {recommendationNarrativeMode === 'ollama' && (
                        <div className="ops-context-note" style={{ marginTop: 8 }}>
                          Narrative runtime: {llmNarrativeDigest?.source ? String(llmNarrativeDigest.source).toUpperCase() : 'WAITING'}. This uses the narrative endpoint and can run on an Ollama-compatible backend via API base-url configuration.
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              <div className="scenario-next-wrap" style={{ marginTop: 12, justifyContent: 'flex-start' }}>
                <button className="flow-btn primary" onClick={() => navigateToSection('action-learning')}>
                  Continue to Action + Learning
                </button>
              </div>
            </>
          )}
        </motion.section>
      )}

      {/* ── Causal Chain ── */}
      {showSections.alertsDecisions && <motion.section className="panel chain-section" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.4 }}>
        <div className="panel-head"><h2>Causal Chain — {selectedEvent?.name}</h2><p>{selectedComponent?.name}</p></div>
        <div className="chain-grid">
          {causalSteps.map((step, idx) => (
            <motion.div key={`${step.stage}-${idx}`} className="chain-step" style={{ borderColor: step.color }} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: idx * 0.08 }}>
              <span>{step.stage}</span>
              <strong style={{ color: step.color }}>{step.name}</strong>
            </motion.div>
          ))}
        </div>
      </motion.section>}

      {/* ── Vendor Intelligence ── */}
      {showSections.procurementActions && <motion.section className="panel vendor-intel-section" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.45 }}>
        <div className="panel-head"><h2>Vendor Intelligence</h2><p>{vendorUniverse.length} vendors · {selectedComponent?.name} · Live baseline supplier view</p></div>
        <div className="ops-context-note">Vendor Intelligence stays anchored to live supplier baseline data. Scenario assumptions below shape action planning, not vendor master data.</div>
        {vendorOverlay && <div className="action-context-chips"><span className="action-context-chip">Scenario Overlay: {vendorOverlay.title}</span><span className="action-context-chip">{vendorOverlay.summary}</span></div>}
        <div className="vendor-metric-row">
          <div className="vendor-metric-chip"><span>Unit Cost</span><strong>${selectedVendorView.unitCost}</strong></div>
          <div className="vendor-metric-chip"><span>Lead Time</span><strong>{selectedVendorView.leadTime}</strong></div>
          <div className="vendor-metric-chip"><span>Safety Stock</span><strong>{selectedVendorView.safetyStock}</strong></div>
          <div className="vendor-metric-chip"><span>Inventory</span><strong>{selectedVendorView.inventory}</strong></div>
          <div className="vendor-metric-chip"><span>Qty/Unit</span><strong>{selectedVendorView.qtyPerLaptop}</strong></div>
        </div>
        <div className="vendor-filter-row">
          <input className="ghost-input" type="text" placeholder="Search vendor..." value={vendorSearch} onChange={(e) => setVendorSearch(e.target.value)} />
          <select className="ghost-select" value={vendorCountryFilter} onChange={(e) => setVendorCountryFilter(e.target.value)}>
            {vendorCountries.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="ghost-select" value={vendorStatusFilter} onChange={(e) => setVendorStatusFilter(e.target.value)}>
            {vendorStatusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="vendor-body">
          <div className="vendor-list-col">
            {vendorUniverse.map((vendor) => (
              <motion.button key={vendor.key} className={`vendor-list-item ${selectedVendorDetail?.key === vendor.key ? 'selected' : ''}`} onClick={() => setSelectedVendorKey(vendor.key)} whileHover={{ x: 3 }}>
                <div>
                  <strong>{vendor.name}</strong>
                  <p>{vendor.component_name} · {vendor.origin}</p>
                </div>
                <span className={`vendor-status-badge ${vendor.status?.toLowerCase()}`}>{vendor.status}</span>
              </motion.button>
            ))}
          </div>
          <div className="vendor-detail-col">
            {selectedVendorDetail ? (
              <motion.div key={selectedVendorDetail.key} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <h3>{selectedVendorDetail.name}</h3>
                <div className="vendor-detail-grid">
                  <div><span>Region</span><strong>{selectedVendorDetail.origin}</strong></div>
                  <div><span>Component</span><strong>{selectedVendorDetail.component_name}</strong></div>
                  <div><span>Lead Time</span><strong>{selectedVendorDetail.lead}</strong></div>
                  <div><span>Unit Cost</span><strong>${selectedVendorDetail.cost?.toFixed(2)}</strong></div>
                  <div><span>Risk Score</span><strong className={selectedVendorDetail.risk > 55 ? 'kpi-danger' : selectedVendorDetail.risk > 35 ? 'kpi-warn' : 'kpi-ok'}>{selectedVendorDetail.risk}/100</strong></div>
                  <div><span>Quality</span><strong>{selectedVendorDetail.quality}/100</strong></div>
                  <div><span>Capacity</span><strong>{selectedVendorDetail.capacity?.toLocaleString()}</strong></div>
                  <div><span>Status</span><span className={`vendor-status-badge ${selectedVendorDetail.status?.toLowerCase()}`}>{selectedVendorDetail.status}</span></div>
                  <div><span>Scenario Lead</span><strong>{selectedVendorDetail.scenario_lead || selectedVendorDetail.lead}</strong></div>
                  <div><span>Scenario Cost</span><strong>${selectedVendorDetail.scenario_cost?.toFixed(2) || selectedVendorDetail.cost?.toFixed(2)}</strong></div>
                  <div><span>Scenario Risk</span><strong className={selectedVendorDetail.scenario_risk > 55 ? 'kpi-danger' : selectedVendorDetail.scenario_risk > 35 ? 'kpi-warn' : 'kpi-ok'}>{selectedVendorDetail.scenario_risk || selectedVendorDetail.risk}/100</strong></div>
                  <div><span>Scenario Impact</span><strong>{selectedVendorDetail.scenario_impact || 'Stable'}</strong></div>
                </div>
                {selectedVendorDetail.scenario_note && <p className="ops-context-note">{selectedVendorDetail.scenario_note}</p>}
                {selectedVendorDetail.risk !== undefined && (
                  <div className="vendor-risk-visual">
                    <span>Risk Profile</span>
                    <div className="vendor-risk-track-full">
                      <motion.div className={`vendor-risk-fill-full ${selectedVendorDetail.risk > 55 ? 'high' : selectedVendorDetail.risk > 35 ? 'medium' : 'low'}`} initial={{ width: 0 }} animate={{ width: `${selectedVendorDetail.risk}%` }} transition={{ duration: 0.6 }} />
                    </div>
                    <span>{selectedVendorDetail.risk}/100</span>
                  </div>
                )}
                <div className="vendor-otd-wrap">
                  <span>On-Time Delivery Trend</span>
                  <svg className="vendor-otd-chart" viewBox="0 0 72 20" preserveAspectRatio="none">
                    <polyline points={selectedVendorDetail.otd} />
                  </svg>
                </div>
              </motion.div>
            ) : <p className="empty-state">Select a vendor to view details.</p>}
          </div>
          <div className="vendor-table-col">
            <div className="vendor-table-wrap">
              <table className="vendor-table">
                <thead><tr><th>Vendor</th><th>Region</th><th>Status</th><th>Capacity</th><th>Cost</th><th>Lead</th><th>Risk</th><th>Qual</th></tr></thead>
                <tbody>
                  {selectedVendorView.vendors.map((v) => (
                    <tr key={v.name}>
                      <td className="vendor-name">{v.name}</td>
                      <td>{v.origin}</td>
                      <td><span className={`vendor-status-badge ${v.status?.toLowerCase()}`}>{v.status}</span></td>
                      <td>{v.capacity?.toLocaleString()}</td>
                      <td>${v.scenario_cost?.toFixed(2) || v.cost?.toFixed(2)}</td>
                      <td>{v.scenario_lead || v.lead}</td>
                      <td><div className="vendor-risk-mini-track"><div className={`vendor-risk-mini-fill ${(v.scenario_risk || v.risk) > 55 ? 'high' : (v.scenario_risk || v.risk) > 35 ? 'medium' : 'low'}`} style={{ width: `${v.scenario_risk || v.risk}%` }} /></div></td>
                      <td>{v.quality}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div className="copilot-panel">
          <div className="panel-head" style={{ paddingBottom: 0 }}>
            <h3>Procurement Copilot</h3>
            <p>Interactive assistant for sourcing decisions and what-if questions.</p>
          </div>
          <div className="route-chip-row" style={{ marginTop: 8 }}>
            <button className="ghost-btn" onClick={() => setNarrativeOpen(true)}>Why Mexico?</button>
            <button className="ghost-btn" onClick={() => setNarrativeOpen(true)}>What if we delay 3 days?</button>
            <button className="ghost-btn" onClick={() => setNarrativeOpen(true)}>What if vendor fails?</button>
          </div>
        </div>
      </motion.section>}

      {/* ── Module 4: Negotiation Intelligence Workspace ─────────────────── */}
      {showSections.negotiationWorkspace && (
        <motion.section className="panel" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} style={{ marginBottom: '1.5rem' }}>
          <div className="panel-head">
            <h2>Module 4 — Negotiation Intelligence</h2>
            <p>{negotiationBriefData?.headline || 'Generating negotiation brief…'}</p>
          </div>

          {!negotiationBriefData ? (
            <div className="section-placeholder">
              <h3>Loading Negotiation Brief</h3>
              <p>Requires a completed disruption analysis and profit simulation in Module 3. Select a component and event, then run the simulation.</p>
            </div>
          ) : (
            <>
              {/* ── Headline metrics strip ───────────────────────────────── */}
              <div className="vendor-metric-row" style={{ marginBottom: '1rem' }}>
                {(() => {
                  const first = negotiationBriefData.vendor_briefs?.[0] || {}
                  return (
                    <>
                      <div className="vendor-metric-chip"><span>Deal Zone Low</span><strong style={{ color: '#39d353' }}>${(first.deal_zone_low || 0).toFixed(2)}</strong></div>
                      <div className="vendor-metric-chip"><span>Deal Zone High</span><strong style={{ color: '#39d353' }}>${(first.deal_zone_high || 0).toFixed(2)}</strong></div>
                      <div className="vendor-metric-chip"><span>Opening Offer</span><strong style={{ color: '#00bfff' }}>${(first.opening_offer || 0).toFixed(2)}</strong></div>
                      <div className="vendor-metric-chip"><span>Walk-Away Price</span><strong style={{ color: '#ffb300' }}>${(first.walk_away_price || 0).toFixed(2)}</strong></div>
                      <div className="vendor-metric-chip"><span>BATNA Vendor</span><strong style={{ color: '#cc66ff' }}>{negotiationBriefData.batna?.vendor_id || 'None'}</strong></div>
                      <div className="vendor-metric-chip"><span>Component</span><strong>{negotiationBriefData.component_id}</strong></div>
                    </>
                  )
                })()}
              </div>

              {/* ── Vendor tabs ───────────────────────────────────────────── */}
              <div className="route-chip-row" style={{ marginBottom: '1rem', flexWrap: 'wrap' }}>
                {negoBriefs.map((b) => (
                  <button
                    key={b.vendor_id}
                    className={`ghost-btn${activeNegVendor?.vendor_id === b.vendor_id ? ' active' : ''}`}
                    onClick={() => setActiveNegVendorId(b.vendor_id)}
                    style={{ borderColor: b.deal_feasible ? '#39d353' : '#ff5050', color: b.deal_feasible ? '#39d353' : '#aaa' }}
                  >
                    {b.vendor_name}
                    <span style={{ marginLeft: 5, fontSize: 9, opacity: 0.75 }}>{b.deal_feasible ? '✓ Feasible' : '✗ Tight'}</span>
                  </button>
                ))}
              </div>

              {activeNegVendor && (
                <>
                  {/* ── Main 3-panel workspace ────────────────────────────── */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr 1.4fr', gap: '1rem', marginBottom: '1.25rem' }}>

                    {/* LEFT: Vendor brief card */}
                    <div className="panel" style={{ padding: '1rem', background: 'rgba(0,191,255,0.04)', border: '1px solid rgba(0,191,255,0.12)' }}>
                      <h3 style={{ color: '#00bfff', marginBottom: '0.75rem', fontSize: '0.85rem' }}>{activeNegVendor.vendor_name} — Brief</h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.75rem' }}>
                        {[
                          ['Vendor Floor', `$${(activeNegVendor.estimated_vendor_floor || 0).toFixed(2)}`, '#ff5050'],
                          ['Vendor Anchor', `$${(activeNegVendor.vendor_anchor_price || 0).toFixed(2)}`, '#cc66ff'],
                          ['Opening Offer', `$${(activeNegVendor.opening_offer || 0).toFixed(2)}`, '#00bfff'],
                          ['Deal Zone', `$${(activeNegVendor.deal_zone_low || 0).toFixed(2)} – $${(activeNegVendor.deal_zone_high || 0).toFixed(2)}`, '#39d353'],
                          ['Walk-Away', `$${(activeNegVendor.walk_away_price || 0).toFixed(2)}`, '#ffb300'],
                          ['Break-Even', `$${(activeNegVendor.break_even_price || 0).toFixed(2)}`, '#aaccdd'],
                          ['Feasible?', activeNegVendor.deal_feasible ? 'YES' : 'NO', activeNegVendor.deal_feasible ? '#39d353' : '#ff5050'],
                          ['Reliability', `${activeNegVendor.reliability}%`, '#7aaccc'],
                          ['Lead Days', `${activeNegVendor.lead_days}d`, '#7aaccc'],
                          ['Geo Risk', `${activeNegVendor.geo_risk}%`, activeNegVendor.geo_risk > 55 ? '#ff5050' : '#7aaccc'],
                        ].map(([k, v, color]) => (
                          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(0,191,255,0.07)', paddingBottom: '0.2rem' }}>
                            <span style={{ color: '#4a7a90' }}>{k}</span>
                            <strong style={{ color }}>{v}</strong>
                          </div>
                        ))}
                      </div>
                      {activeNegVendor.compliance_flags?.length > 0 && (
                        <div style={{ marginTop: '0.6rem' }}>
                          <p style={{ color: '#ffb300', fontSize: '0.7rem', marginBottom: '0.3rem' }}>Compliance Flags</p>
                          {activeNegVendor.compliance_flags.map((f) => (
                            <span key={f} style={{ display: 'inline-block', background: 'rgba(255,180,0,0.1)', border: '1px solid rgba(255,180,0,0.3)', borderRadius: 4, padding: '1px 6px', fontSize: '0.65rem', color: '#ffb300', marginRight: 4, marginBottom: 3 }}>{f}</span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* CENTER: Deal zone + counter-offer */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <div className="panel" style={{ padding: '0.75rem 1rem', background: 'rgba(0,191,255,0.03)', border: '1px solid rgba(0,191,255,0.1)' }}>
                        <p style={{ color: '#7aaccc', fontSize: '0.7rem', marginBottom: '0.4rem' }}>Deal Zone Visual</p>
                        <DealZoneChart brief={activeNegVendor} />
                      </div>
                      <div className="panel" style={{ padding: '0.75rem 1rem', background: 'rgba(0,191,255,0.03)', border: '1px solid rgba(0,191,255,0.1)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
                          <p style={{ color: '#7aaccc', fontSize: '0.7rem', flex: 1 }}>Profit Impact vs Price</p>
                          <input
                            type="number"
                            className="ghost-input"
                            placeholder="Vendor counter-offer price ($)"
                            value={negoCounterInput}
                            onChange={(e) => setNegoCounterInput(e.target.value)}
                            style={{ width: 180, fontSize: '0.75rem', padding: '0.3rem 0.5rem' }}
                          />
                        </div>
                        {negoCounterPrice > 0 && negoLiveProfit && (
                          <div className="vendor-metric-row" style={{ marginBottom: '0.5rem' }}>
                            <div className="vendor-metric-chip"><span>Profit/Unit</span><strong style={{ color: negoLiveProfit.profit >= 0 ? '#39d353' : '#ff5050' }}>${negoLiveProfit.profit}</strong></div>
                            <div className="vendor-metric-chip"><span>Margin</span><strong style={{ color: negoLiveProfit.margin >= (simulationTargetMarginPct || 22) ? '#39d353' : '#ffb300' }}>{negoLiveProfit.margin}%</strong></div>
                            <div className="vendor-metric-chip"><span>In Deal Zone?</span><strong style={{ color: negoCounterPrice >= activeNegVendor.deal_zone_low && negoCounterPrice <= activeNegVendor.deal_zone_high ? '#39d353' : '#ff5050' }}>{negoCounterPrice >= activeNegVendor.deal_zone_low && negoCounterPrice <= activeNegVendor.deal_zone_high ? 'YES' : 'NO'}</strong></div>
                            <div className="vendor-metric-chip"><span>Total Order Profit</span><strong style={{ color: '#aaccdd' }}>${negoLiveProfit.profit_total?.toLocaleString()}</strong></div>
                          </div>
                        )}
                        <NegotiationImpactChart brief={activeNegVendor} counterPrice={negoCounterPrice} />
                      </div>
                    </div>

                    {/* RIGHT: Agent simulation */}
                    <div className="panel" style={{ padding: '0.75rem 1rem', background: 'rgba(0,191,255,0.03)', border: '1px solid rgba(0,191,255,0.1)' }}>
                      <p style={{ color: '#7aaccc', fontSize: '0.7rem', marginBottom: '0.4rem' }}>AI Negotiation Agent — Round Simulation</p>
                      <AgentNegotiationTimeline rounds={activeNegVendor.agent_rounds} />
                      {activeNegVendor.agent_rounds?.length > 0 && (
                        <div style={{ marginTop: '0.5rem', overflowX: 'auto' }}>
                          <table style={{ width: '100%', fontSize: '0.65rem', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr style={{ borderBottom: '1px solid rgba(0,191,255,0.15)' }}>
                                {['Rnd', 'Buyer', 'Vendor', 'Gap', 'Status', 'Margin'].map((h) => (
                                  <th key={h} style={{ padding: '3px 5px', color: '#4a7a90', fontWeight: 600, textAlign: 'right' }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {activeNegVendor.agent_rounds.map((r) => (
                                <tr key={r.round} style={{ borderBottom: '1px solid rgba(0,191,255,0.07)', background: r.agreed ? 'rgba(57,211,83,0.07)' : 'transparent' }}>
                                  <td style={{ padding: '3px 5px', color: '#7aaccc', textAlign: 'right' }}>{r.round}</td>
                                  <td style={{ padding: '3px 5px', color: '#00bfff', textAlign: 'right' }}>${(r.buyer_offer || 0).toFixed(2)}</td>
                                  <td style={{ padding: '3px 5px', color: '#ff5050', textAlign: 'right' }}>${(r.vendor_ask || 0).toFixed(2)}</td>
                                  <td style={{ padding: '3px 5px', color: '#ffb300', textAlign: 'right' }}>${(r.gap || 0).toFixed(2)}</td>
                                  <td style={{ padding: '3px 5px', color: r.agreed ? '#39d353' : '#4a7a90', textAlign: 'right' }}>{r.status}</td>
                                  <td style={{ padding: '3px 5px', color: r.buyer_margin_pct >= (simulationTargetMarginPct || 22) ? '#39d353' : '#aaccdd', textAlign: 'right' }}>{(r.buyer_margin_pct || 0).toFixed(1)}%</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── Bottom row: Radar + BATNA + Commodity context ─── */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>

                    {/* Vendor Radar */}
                    <div className="panel" style={{ padding: '0.75rem 1rem', background: 'rgba(0,191,255,0.03)', border: '1px solid rgba(0,191,255,0.1)' }}>
                      <p style={{ color: '#7aaccc', fontSize: '0.7rem', marginBottom: '0.4rem' }}>Vendor Comparison — Negotiation Angles</p>
                      <NegotiationVendorRadar briefs={negoBriefs} />
                    </div>

                    {/* BATNA card */}
                    <div className="panel" style={{ padding: '0.75rem 1rem', background: 'rgba(204,102,255,0.04)', border: '1px solid rgba(204,102,255,0.15)' }}>
                      <p style={{ color: '#cc66ff', fontSize: '0.7rem', marginBottom: '0.5rem' }}>BATNA — Best Alternative to Negotiated Agreement</p>
                      {negoBatna ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.75rem' }}>
                          {[
                            ['Vendor', negoBatna.vendor_id, '#cc66ff'],
                            ['Floor Price', `$${(negoBatna.estimated_vendor_floor || 0).toFixed(2)}`, '#aaccdd'],
                            ['Opening Offer', `$${(negoBatna.opening_offer || 0).toFixed(2)}`, '#00bfff'],
                            ['Margin at Deal', `${(negoBatna.projected_deal_margin_pct || 0).toFixed(1)}%`, negoBatna.projected_deal_margin_pct >= (simulationTargetMarginPct || 22) ? '#39d353' : '#ffb300'],
                            ['Lead Days', `${negoBatna.lead_days}d`, '#7aaccc'],
                            ['Reliability', `${negoBatna.reliability}%`, '#7aaccc'],
                          ].map(([k, v, c]) => (
                            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(204,102,255,0.08)', paddingBottom: '0.2rem' }}>
                              <span style={{ color: '#4a7a90' }}>{k}</span>
                              <strong style={{ color: c }}>{v}</strong>
                            </div>
                          ))}
                          <p style={{ color: '#4a7a90', fontSize: '0.65rem', marginTop: '0.4rem', lineHeight: 1.4 }}>
                            Activate BATNA if {activeNegVendor.vendor_name} cannot reach ${(activeNegVendor.deal_zone_high || 0).toFixed(2)} or below.
                          </p>
                          <button
                            className="ghost-btn"
                            style={{ marginTop: '0.4rem', color: '#cc66ff', borderColor: '#cc66ff50' }}
                            onClick={() => setActiveNegVendorId(negoBatna.vendor_id)}
                          >
                            Switch to BATNA Vendor →
                          </button>
                        </div>
                      ) : (
                        <p style={{ color: '#4a7a90', fontSize: '0.7rem' }}>No BATNA identified in current shortlist.</p>
                      )}
                    </div>

                    {/* Commodity context */}
                    <div className="panel" style={{ padding: '0.75rem 1rem', background: 'rgba(0,191,255,0.03)', border: '1px solid rgba(0,191,255,0.1)' }}>
                      <p style={{ color: '#7aaccc', fontSize: '0.7rem', marginBottom: '0.5rem' }}>Commodity Price Context</p>
                      {negotiationBriefData.commodity_context ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.75rem' }}>
                          {Object.entries(negotiationBriefData.commodity_context).map(([k, v]) => (
                            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(0,191,255,0.07)', paddingBottom: '0.2rem' }}>
                              <span style={{ color: '#4a7a90', textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</span>
                              <strong style={{ color: '#aaccdd' }}>{typeof v === 'number' ? (v > 100 ? `$${v.toFixed(0)}` : `${v.toFixed(2)}`) : String(v)}</strong>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p style={{ color: '#4a7a90', fontSize: '0.7rem' }}>No commodity context available.</p>
                      )}
                    </div>
                  </div>

                  {/* ── CTA ─────────────────────────────────────────────── */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                    <button
                      className="ghost-btn"
                      style={{ color: '#ffb300', borderColor: '#ffb30050' }}
                      onClick={() => { setNegoCounterInput(''); setNegoSimScenarioId('') }}
                    >
                      Reset
                    </button>
                    <button
                      className="cta-btn"
                      onClick={() => onRequestSectionChange?.('delivery-promise')}
                    >
                      Continue to Delivery Promise →
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </motion.section>
      )}

      {['action-learning', 'execution-learning'].includes(view) && (
        <motion.section className="panel" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.42 }}>
          <div className="panel-head">
            <h2>Module 6: Action + RL Learning</h2>
            <p>Closed-loop decision learning: approval log, outcome reconciliation, RL calibration, and confidence provenance for future disruptions.</p>
          </div>
          {!executionLearningData ? (
            <div className="section-placeholder">
              <h3>Waiting for Outcome Feedback</h3>
              <p>Execution and delivery signals will populate calibration deltas after a recommendation is generated.</p>
            </div>
          ) : (
            <>
              <div className="decision-grid" style={{ marginBottom: 10 }}>
                <div><span>Order Status</span><strong>{executionLearningData.order_tracking?.status || executionLearningData.feedback?.calibration_status || 'pending'}</strong></div>
                <div><span>Recommendation Confidence</span><strong>{Number(executionLearningData.next_event_guidance?.confidence_score || 0).toFixed(1)}%</strong></div>
                <div><span>Personal Accuracy</span><strong>{Number(executionLearningData.decision_history?.average_accuracy_score || 0).toFixed(1)}</strong></div>
                <div><span>Decisions Logged</span><strong>{learningHistory.length}</strong></div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: '1rem' }}>
                <div className="panel" style={{ padding: '0.8rem 1rem', border: '1px solid rgba(0,191,255,0.14)', background: 'rgba(0,191,255,0.03)' }}>
                  <div className="panel-head" style={{ paddingBottom: 0 }}>
                    <h3>Projected vs Actual Outcomes</h3>
                    <p>Captures cost, margin, and profit drift after execution close-out.</p>
                  </div>
                  <LearningDeltaBarChart feedback={executionLearningData.feedback} deltas={executionLearningData.calibration_deltas} />
                  <div className="rationale-grid" style={{ marginTop: 6 }}>
                    <div><span>Cost Delta</span><p>{executionLearningData.calibration_deltas?.cost_delta == null ? 'Pending' : `$${Math.round(executionLearningData.calibration_deltas.cost_delta).toLocaleString()}`}</p></div>
                    <div><span>Margin Delta</span><p>{executionLearningData.calibration_deltas?.margin_delta_pct == null ? 'Pending' : `${executionLearningData.calibration_deltas.margin_delta_pct.toFixed(2)}%`}</p></div>
                    <div><span>ETA Delta</span><p>{executionLearningData.calibration_deltas?.eta_delta_days == null ? 'Pending' : `${executionLearningData.calibration_deltas.eta_delta_days}d`}</p></div>
                  </div>
                </div>

                <div className="panel" style={{ padding: '0.8rem 1rem', border: '1px solid rgba(0,191,255,0.14)', background: 'rgba(0,191,255,0.03)' }}>
                  <div className="panel-head" style={{ paddingBottom: 0 }}>
                    <h3>RL Model Update Surface</h3>
                    <p>Reliability, commodity accuracy, simulation, and negotiation floor adjustments.</p>
                  </div>
                  <RLCalibrationRadarChart rlUpdates={executionLearningData.rl_updates} />
                  <div className="ops-context-note" style={{ marginTop: 8 }}>
                    Vendor reliability update: {executionLearningData.rl_updates?.vendor_reliability?.[0]?.vendor_name || '-'} {executionLearningData.rl_updates?.vendor_reliability?.[0]?.old_reliability ?? '-'} → {executionLearningData.rl_updates?.vendor_reliability?.[0]?.new_reliability ?? '-'}.
                  </div>
                  <div className="ops-context-note" style={{ marginTop: 4 }}>
                    Negotiation floor adjustment: {executionLearningData.rl_updates?.negotiation_floor_adjustment_pct == null ? 'pending' : `${executionLearningData.rl_updates.negotiation_floor_adjustment_pct.toFixed(2)}%`}.
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: 12 }}>
                <div className="panel" style={{ padding: '0.8rem 1rem', border: '1px solid rgba(0,191,255,0.14)', background: 'rgba(0,191,255,0.03)' }}>
                  <div className="panel-head" style={{ paddingBottom: 0 }}>
                    <h3>Personal Decision History</h3>
                    <p>Track your own outcome accuracy and decision drift over time.</p>
                  </div>

                  <div className="vendor-filter-row" style={{ marginBottom: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#7aaccc', fontSize: '0.75rem' }}>
                      Sort history by:
                      <select className="ghost-select" value={actionHistorySortBy} onChange={(event) => setActionHistorySortBy(event.target.value)}>
                        <option value="recent">Most Recent</option>
                        <option value="accuracy">Accuracy</option>
                        <option value="margin-delta">Margin Delta</option>
                        <option value="cost-delta">Cost Delta</option>
                      </select>
                    </label>
                  </div>

                  <DecisionAccuracyTrendChart decisions={sortedLearningHistory} />

                  <div className="scenario-compare-wrap" style={{ marginTop: 8 }}>
                    <table className="scenario-compare-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Vendor</th>
                          <th>Route</th>
                          <th>Proj Margin</th>
                          <th>Actual Margin</th>
                          <th>Accuracy</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedLearningHistory.map((row) => (
                          <tr
                            key={row.decision_id}
                            onClick={() => setSelectedLearningDecisionId(row.decision_id)}
                            style={{ cursor: 'pointer', background: selectedLearningDecision?.decision_id === row.decision_id ? 'rgba(0,191,255,0.08)' : 'transparent' }}
                          >
                            <td>{String(row.decision_date || '').slice(0, 10)}</td>
                            <td>{row.vendor_name || '-'}</td>
                            <td>{row.route_id || '-'}</td>
                            <td>{row.projected_margin_pct == null ? '-' : `${Number(row.projected_margin_pct).toFixed(1)}%`}</td>
                            <td>{row.actual_margin_pct == null ? '-' : `${Number(row.actual_margin_pct).toFixed(1)}%`}</td>
                            <td className={Number(row.accuracy_score || 0) >= 75 ? 'kpi-ok' : Number(row.accuracy_score || 0) >= 55 ? 'kpi-warn' : 'kpi-danger'}>{Number(row.accuracy_score || 0).toFixed(1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="panel" style={{ padding: '0.8rem 1rem', border: '1px solid rgba(0,191,255,0.14)', background: 'rgba(0,191,255,0.03)' }}>
                  <div className="panel-head" style={{ paddingBottom: 0 }}>
                    <h3>Confidence Provenance (Neo4j/Fallback)</h3>
                    <p>{executionLearningData.next_event_guidance?.explanation || 'Confidence explanation appears after learning data is available.'}</p>
                  </div>

                  <KnowledgeGraph2
                    graphNodes={module6GraphNodes}
                    graphEdges={module6GraphEdges}
                    selectedEdgeId={selectedEdgeId}
                    activatedNodeIds={activatedNodeIds}
                    onEdgeSelect={setSelectedEdgeId}
                  />

                  <div className="rationale-grid" style={{ marginTop: 8 }}>
                    <div><span>Influence Count</span><p>{(executionLearningData.next_event_guidance?.informed_by || []).length}</p></div>
                    <div><span>Selected Decision</span><p>{selectedLearningDecision ? `${selectedLearningDecision.vendor_name} via ${selectedLearningDecision.route_id}` : '-'}</p></div>
                    <div><span>Status</span><p>{executionLearningData.feedback?.calibration_status || '-'}</p></div>
                  </div>
                </div>
              </div>

              <div className="ops-context-note" style={{ marginTop: 10 }}>{executionLearningData.summary}</div>
            </>
          )}
        </motion.section>
      )}

      {showSections.deliveryPromise && (
        <motion.section className="panel promise-panel" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.47 }}>
          <div className="panel-head">
            <h2>Layer 7: Delivery Date Promise Engine + Outputs</h2>
            <p>When does the customer get the laptop, and who gets notified?</p>
          </div>
          <div className="agent-strip two-col">
            <article className="agent-card">
              <LiveAgentCard
                agentLabel="TimesFM · Forecast Agent"
                insight={insightFor('delivery.timesfm')}
                fallbackTitle={`Confidence forecast ${deliveryPromise?.confidence_score ?? state.overview.delivery_confidence}%`}
                fallbackBody="Reliability projection tracks bottleneck arrivals and route variability."
                isWorking={Boolean(liveAgentWorking['delivery.timesfm'])}
                timeline={liveAgentTimeline['delivery.timesfm'] || []}
                onOpenDebug={() => setSelectedAgentDebug(insightFor('delivery.timesfm') || null)}
              />
            </article>
            <article className="agent-card">
              <LiveAgentCard
                agentLabel="Customer Communication Agent · LLM"
                insight={insightFor('delivery.communication')}
                fallbackTitle={deliveryPromise?.email_preview?.subject || 'Customer ETA update draft ready'}
                fallbackBody="Generates a transparent, customer-friendly message from latest promise delta."
                isWorking={Boolean(liveAgentWorking['delivery.communication'])}
                timeline={liveAgentTimeline['delivery.communication'] || []}
                onOpenDebug={() => setSelectedAgentDebug(insightFor('delivery.communication') || null)}
              />
            </article>
          </div>
          {deliveryOutlookItems.length > 0 && (
            <div className="intel-card" style={{ marginTop: 8 }}>
              <h3>Delivery Confidence Horizon</h3>
              <OutlookChart items={deliveryOutlookItems} />
            </div>
          )}
          {!activeOrderId ? (
            <div className="section-placeholder">
              <h3>Order Context Required</h3>
              <p>Ingest a customer order in Orders Intake to unlock promise computation and customer communication.</p>
            </div>
          ) : (
            <>
              {decisionPanel && (
                <div className="decision-panel">
                  <div className="panel-head" style={{ paddingBottom: 0 }}>
                    <h3>Decision Economics</h3>
                    <p>{decisionPanel.recommended_action}</p>
                  </div>
                  <div className="decision-grid">
                    <div><span>Decision Window</span><strong>{decisionPanel.deadline_days} days</strong></div>
                    <div><span>Cost of Action</span><strong>${decisionPanel.cost_of_action_musd}M</strong></div>
                    <div><span>Cost of Inaction</span><strong>${decisionPanel.cost_of_inaction_musd}M</strong></div>
                    <div><span>ROI</span><strong>{decisionPanel.roi_multiple}x</strong></div>
                  </div>
                  <div className="decision-context-row">
                    {decisionPanel.best_vendor?.name && <span className="action-context-chip">Vendor: {decisionPanel.best_vendor.name}</span>}
                    {decisionPanel.primary_route?.route_id && <span className="action-context-chip">Route: {decisionPanel.primary_route.route_id}</span>}
                  </div>
                </div>
              )}

              <div className="promise-toolbar">
                <button className="flow-btn" onClick={generateDeliveryPromise} disabled={promiseLoading}>{promiseLoading ? 'Computing...' : 'Recompute Promise'}</button>
                <select className="ghost-select" value={executionMode} onChange={(e) => setExecutionMode(e.target.value)}>
                  <option value="mock">Mock Automation</option>
                  <option value="live">Live Integration Mode</option>
                </select>
                <button className="flow-btn primary" onClick={executeActions} disabled={executionLoading}>{executionLoading ? 'Executing...' : 'Execute PO/Freight/Notify'}</button>
              </div>

              {deliveryPromise ? (
                <div className="promise-grid">
                  <div className="promise-card">
                    <span>Promised Delivery Date</span>
                    <strong>{deliveryPromise.promised_delivery_date}</strong>
                    <p>ETA {deliveryPromise.order_level_eta_days} days · Confidence {deliveryPromise.confidence_score}%</p>
                  </div>
                  <div className="promise-card">
                    <span>Customer Impact Delta</span>
                    <strong>{deliveryPromise.delay_days || 0} days delay</strong>
                    <p>Original ETA {deliveryPromise.original_eta_days || deliveryPromise.order_level_eta_days} days · Original date {deliveryPromise.original_delivery_date || 'n/a'}</p>
                  </div>
                  <div className="promise-card">
                    <span>Bottleneck Component</span>
                    <strong>{deliveryPromise.bottleneck_component?.component_name || 'n/a'}</strong>
                    <p>{deliveryPromise.bottleneck_component?.component_arrival_days || '-'} days arrival via {deliveryPromise.bottleneck_component?.vendor_name || 'n/a'}</p>
                  </div>
                  <div className="promise-card">
                    <span>Confidence Score</span>
                    <strong>{deliveryPromise.confidence_score}%</strong>
                    <p>{deliveryPromise.confidence_score < 80 ? 'Manual review required' : 'Confidence acceptable'}</p>
                  </div>
                  <div className="promise-card">
                    <span>Customer Email Preview</span>
                    <p><strong>{deliveryPromise.email_preview?.subject}</strong></p>
                    <p>{deliveryPromise.email_preview?.body || deliveryPromise.customer_communication}</p>
                  </div>
                  <div className="promise-card">
                    <span>Procurement Log</span>
                    <p>PO: {deliveryPromise.procurement_log?.po_number || executionResult?.po_number || 'Pending approval'}</p>
                    <p>Freight: {deliveryPromise.procurement_log?.freight_booking_reference || executionResult?.freight_booking_reference || 'Pending approval'}</p>
                    <p>ETA: {deliveryPromise.procurement_log?.eta || deliveryPromise.promised_delivery_date}</p>
                  </div>
                </div>
              ) : <p className="empty-state">No delivery promise available yet.</p>}

            </>
          )}
        </motion.section>
      )}

      {showSections.executionLog && (
        <motion.section className="panel" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.46 }}>
          <div className="panel-head">
            <h2>Page 8: Execution Log</h2>
            <p>Monitoring loop closure and post-action learning signals.</p>
          </div>
          <div className="agent-strip two-col">
            <article className="agent-card">
              <LiveAgentCard
                agentLabel="AutoResearch · Light Monitor"
                insight={insightFor('execution.autoresearch')}
                fallbackTitle={monitoringView?.message || 'Tracking corridor and supplier recovery patterns'}
                fallbackBody="Checks whether disruption signals are improving after procurement and route actions."
                isWorking={Boolean(liveAgentWorking['execution.autoresearch'])}
                timeline={liveAgentTimeline['execution.autoresearch'] || []}
                onOpenDebug={() => setSelectedAgentDebug(insightFor('execution.autoresearch') || null)}
              />
            </article>
            <article className="agent-card">
              <LiveAgentCard
                agentLabel="Monitoring Agent · LLM"
                insight={insightFor('execution.monitoring')}
                fallbackTitle={metricsSummary?.financials?.roi_multiple ? `Emerging ROI trend ${metricsSummary.financials.roi_multiple}x` : 'Learning patterns are being summarized'}
                fallbackBody="Highlights recurring patterns across detect, alternative, and action latency."
                isWorking={Boolean(liveAgentWorking['execution.monitoring'])}
                timeline={liveAgentTimeline['execution.monitoring'] || []}
                onOpenDebug={() => setSelectedAgentDebug(insightFor('execution.monitoring') || null)}
              />
            </article>
          </div>
          {executionSeries.length > 0 && (
            <div className="intel-card" style={{ marginTop: 8 }}>
              <h3>Execution Performance Curve</h3>
              <ForecastChart series={executionSeries} />
            </div>
          )}
          {executionResult && (
            <div className="execution-log-wrap">
              <h4>Execution Timeline ({executionResult.mode})</h4>
              <ul>
                {executionResult.steps?.map((step) => (
                  <li key={`${step.action}-${step.timestamp}`}>
                    <strong>{step.action}</strong> · {step.status} · {step.note}
                  </li>
                ))}

                <div className="scenario-next-wrap" style={{ marginTop: 12, justifyContent: 'flex-start' }}>
                  <button className="flow-btn primary" onClick={() => navigateToSection('action-learning')}>
                    {['action-learning', 'execution-learning'].includes(view) ? 'Execution + Learning Ready' : 'Continue to Execution Log'}
                  </button>
                </div>
              </ul>
            </div>
          )}
          {metricsSummary && (
            <div className="metrics-strip">
              <div><span>Orders Observed</span><strong>{metricsSummary.orders_observed}</strong></div>
              <div><span>Detect (avg sec)</span><strong>{metricsSummary.time_to_detect_sec?.avg}</strong></div>
              <div><span>Alternative (avg sec)</span><strong>{metricsSummary.time_to_alternative_sec?.avg}</strong></div>
              <div><span>Action (avg sec)</span><strong>{metricsSummary.time_to_action_sec?.avg}</strong></div>
              <div><span>ROI Multiple</span><strong>{metricsSummary.financials?.roi_multiple}x</strong></div>
            </div>
          )}
          {openOrders.length > 0 && (
            <div className="execution-log-wrap">
              <h4>Loop Closure: Updated Open Orders</h4>
              <ul>
                {openOrders.map((order) => (
                  <li key={`open-${order.order_id}`}>
                    <strong>{order.order_id}</strong> · {order.sku_name} · {order.region} · Promise {order.promised_delivery_date || 'pending'} · Confidence {order.confidence_score ?? '-'}% · {order.status}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </motion.section>
      )}

      {/* ── Run Comparison ── */}
      <AnimatePresence>
        {showSections.componentAnalysis && (
          <motion.section className="panel compare-section" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}>
            {compareStatus ? (
              <>
                <div className="panel-head">
                  <h2>Run Comparison</h2>
                  <div className="panel-head-right"><p>Current vs {compareEntry?.event_name || compareRunId}</p><button className="ghost-btn" onClick={() => setCompareRunId(null)}>Close</button></div>
                </div>
                <div className="compare-grid">
                  <div className="compare-col">
                    <h3 className="compare-label current-label">{selectedEvent?.name || 'Current'}</h3>
                    <h4>Risk Matrix</h4><RiskHeatmapChart items={heatmapItems} />
                    <h4>Outlook</h4><OutlookChart items={futureOutlook} />
                  </div>
                  <div className="compare-divider" />
                  <div className="compare-col">
                    <h3 className="compare-label pinned-label">{compareEntry?.event_name || compareRunId}</h3>
                    <h4>Risk Matrix</h4><RiskHeatmapChart items={compareStatus.heatmap} />
                    <h4>Outlook</h4><OutlookChart items={compareStatus.future_outlook} />
                  </div>
                </div>
              </>
            ) : (
              <div className="section-placeholder">
                <h3>Run Comparison</h3>
                <p>Open run history in Risk Dashboard and pin a prior run to compare risk matrices and outlooks here.</p>
              </div>
            )}
          </motion.section>
        )}
      </AnimatePresence>

      {/* ── Commit Action ── */}
      <AnimatePresence>
        {showSections.executionLog && (
          <motion.section className="panel action-section" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            {operationsPlan && runStatus?.status === 'completed' ? (
              <>
                <div className="panel-head"><h2>Commit Action Plan</h2><p>Scenario {selectedScenario} · {selectedEvent?.name} · Assumption-adjusted actioning</p></div>
                <div className="action-context-chips">
                  {scenarioAssumptionSummary.map((item) => <span key={item} className="action-context-chip">{item}</span>)}
                </div>
                <h3 className="action-rec-title">{operationsPlan.title}</h3>
                <p className="action-rec-reasoning">{operationsPlan.reasoning}</p>
                <div className="action-chips">
                  {operationsPlan.actions?.map((action, i) => (
                    <motion.div key={action} className="action-chip" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.1 }}>
                      <span className="action-check">✓</span> {action}
                    </motion.div>
                  ))}
                </div>

                {operationsPlan.explainability && (() => {
                  const ex = operationsPlan.explainability
                  return (
                    <motion.div className="explainability-panel" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
                      <h4 className="ex-title">⚙ Explainability</h4>
                      <div className="ex-grid">
                        <div className="ex-block">
                          <span className="ex-label">Evidence Used</span>
                          <ul className="ex-list">{ex.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>
                        </div>
                        <div className="ex-block">
                          <span className="ex-label">Assumptions</span>
                          <ul className="ex-list">{ex.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
                        </div>
                        <div className="ex-block">
                          <span className="ex-label">Confidence Interval</span>
                          <div className="ex-ci-bar">
                            <div className="ex-ci-track">
                              <motion.div className="ex-ci-fill" initial={{ width: 0 }} animate={{ width: `${ex.confidence_interval[1] - ex.confidence_interval[0]}%`, marginLeft: `${ex.confidence_interval[0] - 60}%` }} transition={{ duration: 0.7 }} />
                            </div>
                            <span>{ex.confidence_interval[0]}% – {ex.confidence_interval[1]}%</span>
                          </div>
                        </div>
                        <div className="ex-block">
                          <span className="ex-label">Tradeoffs</span>
                          <p className="ex-text">{ex.tradeoffs}</p>
                        </div>
                      </div>
                      <div className="ex-rollback">
                        <span className="ex-rollback-label">↩ Rollback Trigger</span>
                        <span>{ex.rollback_trigger}</span>
                      </div>
                    </motion.div>
                  )
                })()}

                <motion.button className="commit-btn" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}>
                  ⚡ Approve and Dispatch
                </motion.button>
              </>
            ) : (
              <div className="section-placeholder">
                <h3>Commit Action Plan</h3>
                <p>Complete the swarm run and scenario evaluation to unlock the full action plan with explainability and dispatch controls.</p>
              </div>
            )}
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  )
}
