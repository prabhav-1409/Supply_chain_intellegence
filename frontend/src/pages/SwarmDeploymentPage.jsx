import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFlow } from '../context/FlowContext'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8003'

export default function SwarmDeploymentPage() {
  const navigate = useNavigate()
  const { runInfo } = useFlow()
  const [state, setState] = useState(null)

  useEffect(() => {
    fetch(`${API_BASE}/api/v2/command-center/state`)
      .then((r) => r.json())
      .then(setState)
      .catch(() => {})
  }, [])

  const selectedEvent = useMemo(() => state?.events?.find((event) => event.id === runInfo.eventId), [runInfo.eventId, state])
  const selectedComponent = useMemo(() => state?.components?.find((component) => component.id === runInfo.componentId), [runInfo.componentId, state])
  const riskSignal = useMemo(() => {
    const severityWeight = { HIGH: 84, MEDIUM: 62, LOW: 34 }
    const criticalityWeight = { high: 10, medium: 6, low: 2 }
    return Math.min(100, (severityWeight[selectedEvent?.severity] || 50) + (criticalityWeight[selectedComponent?.criticality] || 0))
  }, [selectedComponent?.criticality, selectedEvent?.severity])

  return (
    <div className="flow-page deployment-page">
      <section className="sim-card">
        <h3>Deployment Readiness</h3>
        <p>Review the selected event and component. Live swarm deployment happens inside Mission Control on the next page.</p>
        <div className="readiness-grid">
          <div><span>Event</span><strong>{selectedEvent?.name || runInfo.eventId || '--'}</strong></div>
          <div><span>Severity</span><strong>{selectedEvent?.severity || '--'}</strong></div>
          <div><span>Component</span><strong>{selectedComponent?.name || runInfo.componentId || '--'}</strong></div>
          <div><span>Criticality</span><strong>{selectedComponent?.criticality?.toUpperCase() || '--'}</strong></div>
          <div><span>Human Input</span><strong>Confirmed</strong></div>
          <div><span>Composite Risk Signal</span><strong>{riskSignal}/100</strong></div>
        </div>
      </section>

      <div className="flow-page-actions">
        <button className="flow-btn" onClick={() => navigate('/')}>← Back to Inputs</button>
        <button className="flow-btn primary" onClick={() => navigate('/results/mission')}>
          Open Mission Control →
        </button>
      </div>
    </div>
  )
}
