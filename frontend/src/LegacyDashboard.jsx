import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import './App.css'
import AmbientBackground from './components/AmbientBackground'
import LivingSupplyMap from './components/LivingSupplyMap'
import { KnowledgeGraph2, RiskHeatmapChart, ForecastChart, OutlookChart, ScenarioComparisonTable, ScenarioRadarChart } from './components/Charts'
import ScenarioFilmstrip from './components/ScenarioFilmstrip'
import AIDebateStage from './components/AIDebateStage'
import BoardroomMode from './components/BoardroomMode'
import NarrativeCopilot from './components/NarrativeCopilot'
import SimulationPanel from './components/SimulationPanel'
import SimulationControlModule, { DEFAULT_SIMULATION_CONFIG } from './components/flow/SimulationControlModule'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8003'

const storySteps = ['Select Event', 'Deploy AI Swarm', 'Debate Logs', 'Graph + Heatmap', 'Action Plan']

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

export default function App({ view = 'mission', initialEventId, initialComponentId, initialRunId, onRunIdChange, onRequestSectionChange }) {
  const shellRef = useRef(null)
  const hasAutoNavigatedRef = useRef(false)

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

  // ── New AI features ───────────────────────────────────────────────────────
  const [narrativeOpen,  setNarrativeOpen]  = useState(false)
  const [voiceListening, setVoiceListening] = useState(false)
  const voiceRef = useRef(null)

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
  const causalSteps       = useMemo(() => state?.causal_chains?.[selectedEventId] || [], [state, selectedEventId])
  const scenario          = useMemo(() => state?.scenarios?.[selectedEventId]?.[selectedScenario] || null, [state, selectedEventId, selectedScenario])
  const recommendation    = useMemo(() => state?.recommendations?.[selectedScenario] || null, [state, selectedScenario])
  const heatmapItems      = runStatus?.heatmap || []
  const futureOutlook     = runStatus?.future_outlook || []
  const graphNodes        = runStatus?.knowledge_graph?.nodes || []
  const graphEdges        = runStatus?.knowledge_graph?.edges || []
  const activeAgents      = runStatus?.active_agents || 0
  const totalAgents       = runStatus?.total_agents || 10
  const agentMode         = (runStatus?.agent_mode || state?.agents?.[0]?.mode || 'scripted').toUpperCase()
  const swarmState        = runStatus ? (runStatus.status === 'completed' ? 'READY' : 'DEBATING') : 'IDLE'
  const missionReadyToAdvance = Boolean(runId) && ((runStatus?.progress || 0) >= 100 || runStatus?.status === 'completed' || runStatus?.stage === 'artifacts')

  const activeStep = useMemo(() => {
    if (!runStatus) return 0
    if (runStatus.stage === 'trigger') return 1
    if (runStatus.stage === 'debate') return 2
    if (runStatus.stage === 'artifacts' && runStatus.status !== 'completed') return 3
    if (runStatus.status === 'completed') return 4
    return 0
  }, [runStatus])

  const showSections = useMemo(() => ({
    mission: view === 'mission',
    debate: view === 'debate',
    intelligence: view === 'intelligence',
    scenarios: view === 'scenarios',
    operations: view === 'operations',
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
    onRequestSectionChange?.('debate')
  }, [onRequestSectionChange])

  useEffect(() => {
    const hasReachedTerminalProgress = (runStatus?.progress || 0) >= 100
    const hasCompletedState = runStatus?.status === 'completed' || runStatus?.stage === 'artifacts'
    if (view === 'mission' && runId && (hasCompletedState || hasReachedTerminalProgress) && !hasAutoNavigatedRef.current) {
      hasAutoNavigatedRef.current = true
      advanceToDebate()
    }
  }, [advanceToDebate, runStatus?.progress, runStatus?.stage, runStatus?.status, runId, view])

  const resetEvent = (id) => {
    hasAutoNavigatedRef.current = false
    setSelectedEventId(id); setRunId(null); setRunStatus(null)
    setSelectedEdgeId(''); setHighlightedAgents([])
    setReplayCursor(null); setIsReplayPlaying(false)
  }

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

  const handleScenarioTemplateApply = useCallback((presetId) => {
    if (presetId === 'baseline') {
      setSelectedScenario('B')
      setPlannerPriority('Balanced')
      setPlannerHorizon('30')
      return
    }
    if (presetId === 'severe') {
      setSelectedScenario('E')
      setPlannerPriority('Risk')
      setPlannerHorizon('14')
      return
    }
    if (presetId === 'reroute') {
      setSelectedScenario('D')
      setPlannerPriority('Speed')
      setPlannerHorizon('30')
    }
  }, [])

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

      {/* ── Hero Row ── */}
      {showSections.mission && <motion.section className="hero-row" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}>
        <div className="hero-map-panel panel">
          <LivingSupplyMap
            eventId={selectedEventId}
            deployState={runId ? (runStatus?.status === 'completed' ? 'done' : 'live') : 'idle'}
          />
        </div>
        <div className="hero-command-panel panel">
          <div className="panel-head">
            <h2>Mission Control</h2>
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
            {state.components.map((component) => (
              <button key={component.id} className={`comp-chip ${selectedComponentId === component.id ? 'selected' : ''}`} onClick={() => setSelectedComponentId(component.id)}>
                <span className={`crit-dot ${component.criticality}`} />
                {component.name}
              </button>
            ))}
          </div>
          <div className="deploy-row">
            <motion.button className="deploy-btn" onClick={deploySwarm} disabled={isDeploying} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}>
              {isDeploying ? <><span className="deploy-spinner" />Deploying...</> : '⚡ Deploy Live AI Swarm'}
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
              <button className="flow-btn primary" onClick={advanceToDebate}>Continue to Debate</button>
            </div>
          )}
          {deployError && <motion.p className="deploy-error" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{deployError}</motion.p>}
        </div>
      </motion.section>}

      {/* ── Run History ── */}
      <AnimatePresence>
        {showSections.mission && showHistory && (
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
      {showSections.debate && <motion.section className="panel debate-section" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2 }}>
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
        />
      </motion.section>}

      {/* ── Intelligence Panel ── */}
      {showSections.intelligence && <motion.section className="panel intelligence-panel" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.3 }}>
        <div className="panel-head">
          <h2>Intelligence Artifacts</h2>
          <p>{runStatus?.graph_ready ? 'Graph ready · click edges to trace' : 'Populating from debate signals'}</p>
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
            <div className="intel-card"><h3>Risk Matrix</h3><RiskHeatmapChart items={heatmapItems} /></div>
            <div className="intel-card"><h3>Future Outlook</h3><OutlookChart items={futureOutlook} /></div>
          </div>
        </div>
      </motion.section>}

      {/* ── Scenario Filmstrip ── */}
      {showSections.scenarios && <motion.section className="panel scenario-section" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.35 }}>
        <div className="panel-head">
          <h2>Scenario Configuration</h2>
          <div className="panel-head-right">
            <select className="ghost-select" value={plannerHorizon} onChange={(e) => setPlannerHorizon(e.target.value)}>
              {plannerHorizons.map((h) => <option key={h} value={h}>{h}d horizon</option>)}
            </select>
            <select className="ghost-select" value={plannerPriority} onChange={(e) => setPlannerPriority(e.target.value)}>
              {plannerPriorities.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>
        <div className="scenario-flow-note">
          <span>1. Set assumptions and constraints</span>
          <span>2. Review generated scenario comparisons</span>
          <span>3. Review trajectory and simulation results</span>
          <span>4. Continue to Operations</span>
        </div>
        <div className="scenario-controls-wrap">
          <div className="panel-head" style={{ paddingBottom: 0 }}>
            <h3>Assumptions Workspace</h3>
            <p>Templates and controls below shape what-if assumptions, then outputs update in the trajectory and simulation sections.</p>
          </div>
          <SimulationControlModule
            config={scenarioConfig}
            setConfig={setScenarioConfig}
            onPresetApplied={handleScenarioTemplateApply}
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
        {plannerInventorySeries.length > 0 && (
          <div className="forecast-chart-wrap">
            <div className="panel-head" style={{ paddingBottom: 0 }}><h3>Inventory Trajectory — {plannerHorizon}d · Priority: {plannerPriority}</h3></div>
            <ForecastChart series={plannerInventorySeries} />
          </div>
        )}
      </motion.section>}

      {/* ── Simulation Agent ── */}
      <AnimatePresence>
        {showSections.scenarios && (
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
                <p>Deploy the live AI swarm from Mission Control to unlock simulation playback and scenario comparison.</p>
              </div>
            )}
          </motion.section>
        )}
      </AnimatePresence>

      {showSections.scenarios && (
        <div className="scenario-next-wrap scenario-finalize-wrap">
          <p>After reviewing assumptions, trajectory, and simulation outputs, move to Operations to commit actions.</p>
          <button className="flow-btn primary" onClick={() => onRequestSectionChange?.('operations')}>
            Continue to Operations
          </button>
        </div>
      )}

      {/* ── Causal Chain ── */}
      {showSections.intelligence && <motion.section className="panel chain-section" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.4 }}>
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
      {showSections.operations && <motion.section className="panel vendor-intel-section" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.45 }}>
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
      </motion.section>}

      {/* ── Run Comparison ── */}
      <AnimatePresence>
        {showSections.intelligence && (
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
                <p>Open Run History in Mission Control and pin a prior run to compare risk matrices and outlooks here.</p>
              </div>
            )}
          </motion.section>
        )}
      </AnimatePresence>

      {/* ── Commit Action ── */}
      <AnimatePresence>
        {showSections.operations && (
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
