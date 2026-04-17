import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import LegacyDashboard from '../LegacyDashboard'
import { useFlow } from '../context/FlowContext'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8003'

const RESULTS_TABS = [
  { id: 'bom-intelligence', label: '1. BOM + Global Intelligence' },
  { id: 'disruption-impact', label: '2. Event Trigger + Cost Impact' },
  { id: 'simulation-lab', label: '3. Price Simulation Engine' },
  { id: 'negotiation-intelligence', label: '4. Negotiation Intelligence' },
  { id: 'recommendation-engine', label: '5. Recommendation Engine' },
  { id: 'action-learning', label: '6. Action + Reinforcement Learning' },
]

export default function ResultsDashboardPage() {
  const navigate = useNavigate()
  const { section } = useParams()
  const { runInfo, setRunInfo, orderContext, setOrderContext, initialOrderContext } = useFlow()
  const isKnownSection = useMemo(() => RESULTS_TABS.some((tab) => tab.id === section), [section])
  const [localSection, setLocalSection] = useState(isKnownSection ? section : 'bom-intelligence')
  const autoAdvanceLockRef = useRef('')
  const activeSection = localSection
  const activeIndex = useMemo(() => RESULTS_TABS.findIndex((tab) => tab.id === activeSection), [activeSection])
  const previousTab = activeIndex > 0 ? RESULTS_TABS[activeIndex - 1] : null
  const nextTab = activeIndex >= 0 && activeIndex < RESULTS_TABS.length - 1 ? RESULTS_TABS[activeIndex + 1] : null

  const goToSection = useCallback((targetSection, options = {}) => {
    if (!targetSection) return
    setLocalSection((prev) => (prev === targetSection ? prev : targetSection))
    const targetPath = `/results/${targetSection}`
    navigate(targetPath, options)
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    })
  }, [navigate])

  useEffect(() => {
    if (section && !isKnownSection) {
      setLocalSection('bom-intelligence')
      navigate('/results/bom-intelligence', { replace: true })
      return
    }
    if (isKnownSection && section) {
      setLocalSection((prev) => (prev === section ? prev : section))
    }
  }, [isKnownSection, navigate, section])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [activeSection])

  useEffect(() => {
    if (activeSection !== 'disruption-impact' || !runInfo.runId) return
    let cancelled = false
    const lockKey = runInfo.runId

    const pollForCompletion = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/v2/runs/${runInfo.runId}/status`)
        if (!response.ok || cancelled) return
        const status = await response.json()
        if (cancelled) return
        const progress = Number(status?.progress || 0)
        const completed = status?.status === 'completed' || status?.stage === 'artifacts' || progress >= 100
        if (completed && autoAdvanceLockRef.current !== lockKey) {
          autoAdvanceLockRef.current = lockKey
          goToSection('simulation-lab')
        }
      } catch {}
    }

    pollForCompletion()
    const intervalId = window.setInterval(pollForCompletion, 1000)
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [activeSection, goToSection, runInfo.runId])

  useEffect(() => {
    if (!runInfo.runId) autoAdvanceLockRef.current = ''
  }, [runInfo.runId])

  const startNewFlow = () => {
    setRunInfo({ eventId: '', componentId: '', runId: '' })
    setOrderContext(initialOrderContext)
    goToSection('bom-intelligence', { replace: true })
  }

  const handleOrderContextChange = useCallback((nextContext) => {
    if (!nextContext) return
    setOrderContext((prev) => ({ ...prev, ...nextContext }))
  }, [setOrderContext])

  const handleRunIdChange = useCallback((nextRunId) => {
    if (!nextRunId) return
    setRunInfo((prev) => (prev.runId === nextRunId ? prev : { ...prev, runId: nextRunId }))
  }, [setRunInfo])

  return (
    <div className="flow-page results-page">
      <div className="results-toolbar">
        <div>
          <h3>{RESULTS_TABS[activeIndex]?.label || '1. BOM + Global Intelligence'} · Step {activeIndex + 1} / {RESULTS_TABS.length}</h3>
          <p>Run ID: {runInfo.runId || 'not deployed yet'} · Revenue − Purchase Cost − Logistics Cost = Profit.</p>
        </div>
        <div className="results-toolbar-actions">
          {RESULTS_TABS.map((tab) => (
            <Link
              key={tab.id}
              to={`/results/${tab.id}`}
              className={`flow-btn ${activeSection === tab.id ? 'primary' : ''}`}
              onClick={(event) => {
                event.preventDefault()
                goToSection(tab.id)
              }}
            >
              {tab.label}
            </Link>
          ))}
          <button className="flow-btn" onClick={startNewFlow}>Start New Flow</button>
        </div>
      </div>

      <div className="results-sequence-nav">
        <Link
          className={`flow-btn ${!previousTab ? 'disabled' : ''}`}
          to={previousTab ? `/results/${previousTab.id}` : '#'}
          aria-disabled={!previousTab}
          onClick={(event) => {
            if (!previousTab) event.preventDefault()
            else goToSection(previousTab.id)
          }}
        >
          Back: {previousTab?.label || 'Start'}
        </Link>
        <div className="results-progress-strip" role="presentation">
          <div className="results-progress-fill" style={{ width: `${((activeIndex + 1) / RESULTS_TABS.length) * 100}%` }} />
        </div>
        <Link
          className={`flow-btn primary ${!nextTab ? 'disabled' : ''}`}
          to={nextTab ? `/results/${nextTab.id}` : '#'}
          aria-disabled={!nextTab}
          onClick={(event) => {
            if (!nextTab) event.preventDefault()
            else goToSection(nextTab.id)
          }}
        >
          Next: {nextTab?.label || 'Done'}
        </Link>
      </div>

      <LegacyDashboard
        view={activeSection}
        initialEventId={runInfo.eventId}
        initialComponentId={runInfo.componentId}
        initialRunId={runInfo.runId}
        initialOrderContext={orderContext}
        onRunIdChange={handleRunIdChange}
        onOrderContextChange={handleOrderContextChange}
        onRequestSectionChange={goToSection}
      />
    </div>
  )
}
