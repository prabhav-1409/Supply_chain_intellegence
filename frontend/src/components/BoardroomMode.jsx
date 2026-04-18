import { useEffect, useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const ACTS = [
  { id: 'incident', label: 'Incident Detected', icon: '⚡' },
  { id: 'causal',   label: 'Causal Impact',     icon: '⬡' },
  { id: 'forecast', label: 'Forecast Window',   icon: '◇' },
  { id: 'action',   label: 'Recommended Action',icon: '✓' },
  { id: 'outcome',  label: 'Expected Outcome',  icon: '◈' },
]

const ACT_DURATION = 4800 // ms per act in auto-advance mode

function ActContent({ actId, event, causalSteps, debateLogs, scenario, recommendation, heatmapItems }) {
  switch (actId) {
    case 'incident':
      return (
        <div className="boardroom-act-content">
          <div className="boardroom-event-icon">{event?.icon || '⚡'}</div>
          <h2>{event?.name || 'Disruption Event'}</h2>
          <div className={`boardroom-severity ${event?.severity?.toLowerCase() || 'high'}`}>{event?.severity}</div>
          <p className="boardroom-act-sub">Live disruption signal received by SENTINEL V2</p>
        </div>
      )
    case 'causal':
      return (
        <div className="boardroom-act-content">
          <h2>Causal Impact Chain</h2>
          <div className="boardroom-chain">
            {causalSteps.map((step, i) => (
              <motion.div
                key={step.stage}
                className="boardroom-chain-step"
                style={{ borderColor: step.color }}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.25 }}
              >
                <span className="boardroom-chain-stage">{step.stage}</span>
                <strong style={{ color: step.color }}>{step.name}</strong>
              </motion.div>
            ))}
          </div>
        </div>
      )
    case 'forecast':
      return (
        <div className="boardroom-act-content">
          <h2>AI Forecast Window</h2>
          <div className="boardroom-debate-quotes">
            {debateLogs.filter((l) => ['forecast', 'risk'].includes(l.tag)).slice(0, 3).map((l, i) => (
              <motion.div
                key={i}
                className="boardroom-quote"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.3 }}
              >
                <span className={`boardroom-quote-tag ${l.tag}`}>{l.tag}</span>
                <p>"{l.message}"</p>
                <strong>— {l.agent}</strong>
              </motion.div>
            ))}
            {debateLogs.length === 0 && (
              <p className="empty-state">Deploy swarm to generate forecast signals.</p>
            )}
          </div>
          {heatmapItems.length > 0 && (
            <div className="boardroom-heatmap-row">
              {heatmapItems.map((item) => (
                <div key={item.dimension} className={`boardroom-heat-chip ${item.risk}`}>
                  <span>{item.dimension}</span>
                  <strong>{item.score}/5</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      )
    case 'action':
      return (
        <div className="boardroom-act-content">
          <h2>Recommended Action</h2>
          {recommendation ? (
            <>
              <div className="boardroom-rec-title">{recommendation.title}</div>
              <p>{recommendation.reasoning}</p>
              <div className="boardroom-action-list">
                {recommendation.actions?.map((a, i) => (
                  <motion.div key={a} className="boardroom-action-chip"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.15 }}
                  >
                    <span className="boardroom-checkmark">✓</span>{a}
                  </motion.div>
                ))}
              </div>
              {debateLogs.filter((l) => l.tag === 'decision').slice(0, 1).map((l) => (
                <div key={l.agent} className="boardroom-ai-note">
                  <span>AI: {l.agent}</span> · "{l.message}"
                </div>
              ))}
            </>
          ) : (
            <p className="empty-state">Select a scenario to load recommendation.</p>
          )}
        </div>
      )
    case 'outcome':
      return (
        <div className="boardroom-act-content">
          <h2>Expected Outcome</h2>
          {scenario ? (
            <div className="boardroom-outcome-grid">
              <div className="boardroom-outcome-kpi">
                <span>Fulfillment</span>
                <strong>{scenario.fulfillment}%</strong>
              </div>
              <div className="boardroom-outcome-kpi">
                <span>Cost Impact</span>
                <strong>{scenario.cost}</strong>
              </div>
              <div className="boardroom-outcome-kpi">
                <span>Lead Time</span>
                <strong>{scenario.lead_time}</strong>
              </div>
              <div className="boardroom-outcome-kpi">
                <span>Confidence</span>
                <strong>{scenario.confidence}</strong>
              </div>
            </div>
          ) : (
            <p className="empty-state">Run scenario simulation to see outcome projections.</p>
          )}
          <div className="boardroom-sign-off">
            <span className="boardroom-sign-off-label">Platform</span>
            <strong className="boardroom-sign-off-value">SENTINEL V2</strong>
            <span className="boardroom-sign-off-meta">AI-Driven Supply Chain Decision Intelligence</span>
          </div>
        </div>
      )
    default:
      return null
  }
}

export default function BoardroomMode({ isActive, event, causalSteps, debateLogs, scenario, recommendation, heatmapItems, onExit }) {
  const [currentAct, setCurrentAct] = useState(0)
  const [isAutoplay, setIsAutoplay] = useState(false)
  const timerRef = useRef(null)

  useEffect(() => {
    if (!isActive) return
    setCurrentAct(0)
    setIsAutoplay(false)
  }, [isActive])

  useEffect(() => {
    if (!isAutoplay) {
      clearInterval(timerRef.current)
      return
    }
    timerRef.current = setInterval(() => {
      setCurrentAct((prev) => {
        if (prev >= ACTS.length - 1) {
          setIsAutoplay(false)
          return prev
        }
        return prev + 1
      })
    }, ACT_DURATION)
    return () => clearInterval(timerRef.current)
  }, [isAutoplay])

  if (!isActive) return null

  const act = ACTS[currentAct]

  return (
    <div className="boardroom-overlay">
      {/* Background ambiance */}
      <div className="boardroom-bg-grid" />

      {/* Top bar */}
      <div className="boardroom-topbar">
        <div className="boardroom-branding">
          <span className="boardroom-logo-dot" />
          <span>SENTINEL</span>
          <span className="boardroom-version">V2</span>
        </div>
        <div className="boardroom-act-nav">
          {ACTS.map((a, i) => (
            <button
              key={a.id}
              className={`boardroom-act-dot ${i === currentAct ? 'active' : ''} ${i < currentAct ? 'done' : ''}`}
              onClick={() => setCurrentAct(i)}
              title={a.label}
            >
              <span>{a.icon}</span>
              <span className="boardroom-act-dot-label">{a.label}</span>
            </button>
          ))}
        </div>
        <div className="boardroom-topbar-actions">
          <button
            className={`boardroom-ctrl ${isAutoplay ? 'active' : ''}`}
            onClick={() => setIsAutoplay((v) => !v)}
          >
            {isAutoplay ? '⏸ Pause' : '▶ Auto'}
          </button>
          <button className="boardroom-ctrl boardroom-exit" onClick={onExit}>✕ Exit</button>
        </div>
      </div>

      {/* Act stage */}
      <div className="boardroom-stage">
        <AnimatePresence mode="wait">
          <motion.div
            key={act.id}
            className="boardroom-act-frame"
            initial={{ opacity: 0, scale: 0.96, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 1.02, y: -20 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="boardroom-act-label">
              <span className="boardroom-act-icon">{act.icon}</span>
              {act.label.toUpperCase()}
            </div>
            <ActContent
              actId={act.id}
              event={event}
              causalSteps={causalSteps}
              debateLogs={debateLogs}
              scenario={scenario}
              recommendation={recommendation}
              heatmapItems={heatmapItems}
            />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Progress bar */}
      <div className="boardroom-progress">
        <motion.div
          className="boardroom-progress-fill"
          animate={{ width: `${((currentAct + 1) / ACTS.length) * 100}%` }}
          transition={{ duration: 0.4 }}
        />
      </div>

      {/* Bottom navigation */}
      <div className="boardroom-footnav">
        <button
          className="boardroom-nav-btn"
          onClick={() => setCurrentAct((v) => Math.max(0, v - 1))}
          disabled={currentAct === 0}
        >
          ← Prev
        </button>
        <div className="boardroom-statusbar" role="status" aria-live="polite">
          <div className="boardroom-status-meta">
            <span className="boardroom-status-label">Mode</span>
            <strong className="boardroom-status-value">{isAutoplay ? 'Auto' : 'Manual'}</strong>
          </div>
          <div className="boardroom-status-meta">
            <span className="boardroom-status-label">Act</span>
            <strong className="boardroom-status-value">{currentAct + 1}/{ACTS.length}</strong>
          </div>
          <div className="boardroom-signal-dots" aria-hidden="true">
            {ACTS.map((item, idx) => (
              <span
                key={`status-${item.id}`}
                className={`boardroom-signal-dot ${idx === currentAct ? 'active' : ''} ${idx < currentAct ? 'done' : ''}`}
              />
            ))}
          </div>
        </div>
        <button
          className="boardroom-nav-btn"
          onClick={() => setCurrentAct((v) => Math.min(ACTS.length - 1, v + 1))}
          disabled={currentAct === ACTS.length - 1}
        >
          Next →
        </button>
      </div>
    </div>
  )
}
