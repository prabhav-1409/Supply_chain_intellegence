import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFlow } from '../context/FlowContext'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8003'

export default function InputConfigurationPage() {
  const navigate = useNavigate()
  const { runInfo, setRunInfo } = useFlow()
  const [state, setState] = useState(null)
  const [error, setError] = useState('')
  const [selectedEventId, setSelectedEventId] = useState(runInfo.eventId || '')
  const [selectedComponentId, setSelectedComponentId] = useState(runInfo.componentId || '')

  useEffect(() => {
    fetch(`${API_BASE}/api/v2/command-center/state`)
      .then((r) => r.json())
      .then((data) => {
        setState(data)
        setSelectedEventId((prev) => prev || data?.events?.[0]?.id || '')
        setSelectedComponentId((prev) => prev || data?.components?.[0]?.id || '')
      })
      .catch(() => setError('Unable to load live events. Check backend on port 8003.'))
  }, [])

  const selectedEvent = useMemo(() => state?.events?.find((event) => event.id === selectedEventId), [selectedEventId, state])
  const selectedComponent = useMemo(() => state?.components?.find((component) => component.id === selectedComponentId), [selectedComponentId, state])

  const continueToSwarm = () => {
    setRunInfo({ eventId: selectedEventId, componentId: selectedComponentId, runId: '' })
    navigate('/swarm')
  }

  return (
    <div className="flow-page">
      <section className="sim-card">
        <h3>Select Live Event</h3>
        <p>Choose the real-world disruption signal to analyze. The AI swarm will work from this event context.</p>
        <div className="flow-choice-grid">
          {(state?.events || []).map((event) => (
            <button key={event.id} className={`flow-choice ${selectedEventId === event.id ? 'selected' : ''}`} onClick={() => setSelectedEventId(event.id)}>
              <div>
                <strong>{event.icon} {event.name}</strong>
              </div>
              <span className={`severity ${event.severity.toLowerCase()}`}>{event.severity}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="sim-card">
        <h3>Select Affected Component</h3>
        <p>Choose the component the swarm should anchor debate, vendor analysis, and scenario planning around.</p>
        <div className="flow-chip-row">
          {(state?.components || []).map((component) => (
            <button key={component.id} className={`flow-component-chip ${selectedComponentId === component.id ? 'selected' : ''}`} onClick={() => setSelectedComponentId(component.id)}>
              <span className={`crit-dot ${component.criticality}`} />
              {component.name}
            </button>
          ))}
        </div>
      </section>

      <section className="sim-card">
        <h3>Analyst Brief</h3>
        <div className="readiness-grid">
          <div><span>Event</span><strong>{selectedEvent?.name || '--'}</strong></div>
          <div><span>Severity</span><strong>{selectedEvent?.severity || '--'}</strong></div>
          <div><span>Component</span><strong>{selectedComponent?.name || '--'}</strong></div>
        </div>
      </section>

      {error && <p className="flow-error">{error}</p>}
      <div className="flow-page-actions">
        <button className="flow-btn primary" onClick={continueToSwarm} disabled={!selectedEventId || !selectedComponentId}>
          Continue to Swarm Deployment →
        </button>
      </div>
    </div>
  )
}
