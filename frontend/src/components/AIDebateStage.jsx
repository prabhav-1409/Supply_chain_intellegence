import { motion, AnimatePresence } from 'framer-motion'
import { useEffect, useMemo, useRef } from 'react'

const TAG_CONFIG = {
  signal:   { color: '#00d4ff', icon: '◈', label: 'Signal',   confidence: 82 },
  causal:   { color: '#ffbe68', icon: '⬡', label: 'Causal',   confidence: 74 },
  forecast: { color: '#a78bfa', icon: '◇', label: 'Forecast', confidence: 79 },
  risk:     { color: '#ff6080', icon: '⚠', label: 'Risk',     confidence: 86 },
  decision: { color: '#39d353', icon: '✓', label: 'Decision', confidence: 91 },
  verdict:  { color: '#ffd700', icon: '⚖', label: 'Verdict',  confidence: 95 },
}

const AGENT_COLORS = {
  AutoResearch: '#00d4ff',
  CausalGraph:  '#ffbe68',
  TimesFM:      '#a78bfa',
  RiskScorer:   '#ff6080',
  RecEngine:    '#39d353',
  VendorIntel:  '#50fa7b',
  JudgeAgent:   '#ffd700',
}

const AGENT_ORBIT_LAYOUT = {
  AutoResearch: { x: 50, y: 10 },
  CausalGraph:  { x: 84, y: 30 },
  TimesFM:      { x: 84, y: 70 },
  RiskScorer:   { x: 50, y: 90 },
  RecEngine:    { x: 16, y: 70 },
  JudgeAgent:   { x: 16, y: 30 },
}

// Maps agent tag → semantic step label shown on handoff edge
const TAG_EDGE_LABELS = {
  signal:   'Signal',
  causal:   'Cause',
  forecast: 'Forecast',
  risk:     'Risk',
  decision: 'Decision',
  verdict:  'Verdict',
}

function DebateCard({ entry, index, isActive, isDimmed, isHighlighted, graphNodeLabels, onClick }) {
  const cfg = TAG_CONFIG[entry.tag] || TAG_CONFIG.signal
  const color = AGENT_COLORS[entry.agent] || cfg.color
  const edgeLabel = entry.edge_id
    ? `${graphNodeLabels[entry.edge_id.split('-')[0]] || 'Root'} → ${graphNodeLabels[entry.edge_id.split('-')[1]] || 'Effect'}`
    : null

  return (
    <motion.article
      className={`debate-card ${isActive ? 'active' : ''} ${isDimmed ? 'dimmed' : ''} ${isHighlighted ? 'highlighted' : ''}`}
      style={{ '--agent-color': color }}
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: isDimmed ? 0.3 : 1, x: 0 }}
      transition={{ duration: 0.35, delay: index * 0.04 }}
      onClick={onClick}
    >
      <div className="debate-card-accent" style={{ background: color }} />

      <div className="debate-card-header">
        <div className="debate-agent-id">
          <div className="debate-agent-dot" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
          <strong style={{ color }}>{entry.agent}</strong>
          {isActive && (
            <motion.span className="debate-speaking-badge" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring' }}>
              SPEAKING
            </motion.span>
          )}
        </div>
        <div className="debate-tag-chip" style={{ borderColor: cfg.color, color: cfg.color }}>
          {cfg.icon} {entry.tag.toUpperCase()}
        </div>
      </div>

      <p className="debate-card-message">{entry.message}</p>

      {/* Tool evidence citation chips */}
      {entry.tool_evidence?.length > 0 && (
        <div className="debate-evidence-row">
          {entry.tool_evidence.map((ev, i) => (
            <span key={i} className="debate-evidence-chip" title={ev}>
              🔗 {ev.length > 40 ? ev.slice(0, 40) + '…' : ev}
            </span>
          ))}
        </div>
      )}

      <div className="debate-card-footer">
        <div className="debate-confidence-block">
          <span>{cfg.label} Conf.</span>
          <div className="debate-conf-track">
            <motion.div className="debate-conf-fill" style={{ background: color }} initial={{ width: 0 }} animate={{ width: `${cfg.confidence}%` }} transition={{ duration: 0.6 }} />
          </div>
          <span style={{ color }}>{cfg.confidence}%</span>
        </div>
        {edgeLabel && (
          <div className="debate-edge-chip" style={{ borderColor: `${color}50` }}>
            <span className="edge-arrow">⟶</span> {edgeLabel}
          </div>
        )}
        <span className="debate-timestamp">{entry.timestamp}</span>
      </div>
    </motion.article>
  )
}

export function SwarmInteractionBoard({ logs, replayActiveLog, highlightedAgents, onAgentFilter, compact }) {
  const activeAgents = highlightedAgents.length > 0 ? highlightedAgents : null
  const recentRelay = useMemo(() => logs.slice(-6), [logs])
  const transitions = useMemo(() => {
    const items = []
    for (let index = 1; index < recentRelay.length; index += 1) {
      const from = recentRelay[index - 1]
      const to = recentRelay[index]
      if (!from || !to || from.agent === to.agent) continue
      items.push({
        id: `${from.sequence}-${to.sequence}`,
        from: from.agent,
        to: to.agent,
        tag: to.tag,
        message: to.message,
        edgeLabel: TAG_EDGE_LABELS[to.tag] || 'Relay',
      })
    }
    return items
  }, [recentRelay])

  const nodes = useMemo(() => {
    const orderedNames = ['AutoResearch', 'CausalGraph', 'TimesFM', 'RiskScorer', 'RecEngine', 'JudgeAgent']
    return orderedNames.map((name) => {
      const latest = [...logs].reverse().find((entry) => entry.agent === name)
      return {
        name,
        latest,
        position: AGENT_ORBIT_LAYOUT[name] || { x: 50, y: 50 },
        active: replayActiveLog?.agent === name,
        muted: activeAgents ? !activeAgents.includes(name) : false,
      }
    })
  }, [activeAgents, logs, replayActiveLog])

  return (
    <div className={`swarm-interaction-grid${compact ? ' compact' : ''}`}>
      <div className="swarm-board">
        <div className="swarm-core-ring" />
        <div className="swarm-core-pulse" />
        <div className="swarm-core-label">
          <span>Swarm Core</span>
          <strong>{replayActiveLog?.agent || 'Awaiting debate'}</strong>
        </div>

        <svg className="swarm-links" viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            {transitions.map((transition) => {
              const color = AGENT_COLORS[transition.to] || '#00d4ff'
              return (
                <marker key={`mk-${transition.id}`} id={`arrow-${transition.id}`} markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto">
                  <path d="M0,0 L0,4 L4,2 z" fill={color} />
                </marker>
              )
            })}
          </defs>
          {transitions.map((transition, index) => {
            const from = AGENT_ORBIT_LAYOUT[transition.from]
            const to = AGENT_ORBIT_LAYOUT[transition.to]
            const color = AGENT_COLORS[transition.to] || '#00d4ff'
            if (!from || !to) return null
            const mx = (from.x + to.x) / 2
            const my = (from.y + to.y) / 2
            return (
              <g key={transition.id}>
                <motion.line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={color}
                  strokeWidth="0.8"
                  strokeDasharray="2 2"
                  markerEnd={`url(#arrow-${transition.id})`}
                  initial={{ opacity: 0.2 }}
                  animate={{ opacity: 0.9 }}
                  transition={{ duration: 0.5, delay: index * 0.08 }}
                />
                <motion.text
                  x={mx}
                  y={my - 1.5}
                  textAnchor="middle"
                  className="swarm-edge-label"
                  fill={color}
                  fontSize="3.5"
                  fontFamily="monospace"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.85 }}
                  transition={{ duration: 0.4, delay: index * 0.08 + 0.2 }}
                >
                  {transition.edgeLabel}
                </motion.text>
              </g>
            )
          })}
        </svg>

        {nodes.map((node, index) => {
          const color = AGENT_COLORS[node.name] || '#00d4ff'
          return (
            <motion.button
              key={node.name}
              className={`swarm-agent-node ${node.active ? 'active' : ''} ${node.muted ? 'muted' : ''}`}
              style={{ left: `${node.position.x}%`, top: `${node.position.y}%`, '--swarm-color': color }}
              onClick={() => onAgentFilter({ name: node.name, sequence: node.latest?.sequence, edgeId: node.latest?.edge_id })}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: node.muted ? 0.35 : 1, scale: node.active ? 1.06 : 1 }}
              transition={{ duration: 0.25, delay: index * 0.04 }}
            >
              <div className="swarm-agent-dot" />
              <strong>{node.name}</strong>
              <span>{node.latest?.tag || 'standby'}</span>
            </motion.button>
          )
        })}
      </div>

      {!compact && (
        <div className="swarm-relay-panel">
          <div className="swarm-relay-head">
            <h3>Live Agent Relay</h3>
            <span>{transitions.length} handoffs</span>
          </div>
          <div className="swarm-relay-list">
            {transitions.length === 0 && <p className="empty-state">Interactions appear as agents hand work to each other.</p>}
            {transitions.map((transition) => (
              <motion.div key={transition.id} className="swarm-relay-item" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}>
                <div className="swarm-relay-route">
                  <span style={{ color: AGENT_COLORS[transition.from] || '#00d4ff' }}>{transition.from}</span>
                  <strong>→</strong>
                  <span style={{ color: AGENT_COLORS[transition.to] || '#00d4ff' }}>{transition.to}</span>
                  <span className="swarm-relay-tag-pill" style={{ borderColor: AGENT_COLORS[transition.to] || '#00d4ff', color: AGENT_COLORS[transition.to] || '#00d4ff' }}>
                    {transition.edgeLabel}
                  </span>
                </div>
                <p>{transition.message}</p>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function AIDebateStage({
  logs,
  displayedLogs,
  highlightedAgents,
  replayCursor,
  isReplayPlaying,
  debateLogs,
  replayActiveLog,
  graphNodeLabels,
  onDebateClick,
  onAgentFilter,
  onReplayChange,
  onReplayToggle,
  onReplayReset,
  agentTelemetry,
  judgeVerdict,
  onAutoPlay,
}) {
  // Autoplay: fire onAutoPlay once when logs cross 2 entries and replay is idle
  const autoPlayFired = useRef(false)
  useEffect(() => {
    if (!autoPlayFired.current && logs.length >= 2 && replayCursor === null && !isReplayPlaying && onAutoPlay) {
      autoPlayFired.current = true
      // Small delay so the board renders first
      const timer = setTimeout(() => onAutoPlay(), 800)
      return () => clearTimeout(timer)
    }
  }, [isReplayPlaying, logs.length, onAutoPlay, replayCursor])

  // Reset autoPlayFired when logs are cleared (new run)
  useEffect(() => {
    if (logs.length === 0) autoPlayFired.current = false
  }, [logs.length])
  const replayIndex = replayCursor ?? Math.max(logs.length - 1, 0)

  const visibleLogs = useMemo(() =>
    highlightedAgents.length > 0
      ? displayedLogs.filter((l) => highlightedAgents.includes(l.agent))
      : displayedLogs,
  [displayedLogs, highlightedAgents])

  return (
    <div className="debate-stage">
      {/* Stage header */}
      <div className="debate-stage-header">
        <div>
          <h2 className="debate-stage-title">
            <span className="stage-pulse" />
            AI WAR ROOM
          </h2>
          <p>{logs.length > 0 ? `${logs.length} analyses · live debate` : 'Deploy swarm to start debate'}</p>
        </div>
        {logs.length > 1 && (
          <div className="debate-stage-controls">            {isReplayPlaying && replayCursor !== null && (
              <span className="swarm-autoplay-badge">⚡ Auto-replaying</span>
            )}            <button
              className={`stage-btn ${isReplayPlaying ? 'active' : ''}`}
              onClick={onReplayToggle}
              disabled={logs.length < 2}
            >
              {isReplayPlaying ? '⏸ Pause' : '▶ Replay'}
            </button>
            <button className="stage-btn" onClick={onReplayReset} disabled={replayCursor === null}>
              ↩ Live
            </button>
          </div>
        )}
      </div>

      {/* Agent identity bar */}
      <div className="debate-identity-bar">
        {agentTelemetry.map((agent) => {
          const color = AGENT_COLORS[agent.name] || '#00d4ff'
          const isActive = agent.status === 'speaking'
          const isFiltered = highlightedAgents.includes(agent.name)
          return (
            <motion.button
              key={agent.name}
              className={`agent-identity-chip ${isActive ? 'speaking' : ''} ${isFiltered ? 'filtered' : ''} ${agent.status}`}
              style={{ '--chip-color': color }}
              onClick={() => onAgentFilter(agent)}
              animate={{ scale: isActive ? 1.05 : 1 }}
              transition={{ duration: 0.2 }}
            >
              <div className="chip-dot" style={{ background: color, boxShadow: isActive ? `0 0 10px ${color}` : 'none' }} />
              <span style={{ color: isActive ? color : undefined }}>{agent.name}</span>
              <div className="chip-progress-wrap">
                <motion.div
                  className="chip-progress"
                  style={{ background: color }}
                  initial={{ width: '8%' }}
                  animate={{ width: `${agent.score}%` }}
                  transition={{ duration: 0.5 }}
                />
              </div>
            </motion.button>
          )
        })}
      </div>

      <SwarmInteractionBoard
        logs={visibleLogs}
        replayActiveLog={replayActiveLog}
        highlightedAgents={highlightedAgents}
        onAgentFilter={onAgentFilter}
      />

      {/* Timeline scrubber */}
      {logs.length > 1 && (
        <div className="debate-scrubber-wrap">
          <div className="scrubber-ticks">
            {logs.map((_, i) => (
              <div
                key={i}
                className={`scrubber-tick ${i <= replayIndex ? 'passed' : ''} ${i === replayIndex ? 'current' : ''}`}
                style={{ left: `${(i / (logs.length - 1)) * 100}%` }}
              />
            ))}
          </div>
          <input
            type="range"
            className="cinematic-scrubber"
            min={0}
            max={Math.max(logs.length - 1, 0)}
            value={replayIndex}
            onChange={(e) => onReplayChange(Number(e.target.value))}
          />
          <div className="scrubber-labels">
            <span>{logs[0]?.timestamp || 'T+00:00'}</span>
            {replayActiveLog && <span className="scrubber-active-label">{replayActiveLog.timestamp} · {replayActiveLog.agent}</span>}
            <span>{logs[logs.length - 1]?.timestamp || '--'}</span>
          </div>
        </div>
      )}

      {/* Trace filter banner */}
      <AnimatePresence>
        {highlightedAgents.length > 0 && (
          <motion.div
            className="debate-trace-banner"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <span>Tracing: <strong>{highlightedAgents.join(', ')}</strong></span>
            <button onClick={() => onAgentFilter({ name: null })}>✕ Clear</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Debate lane */}
      <div className="debate-lane">
        <AnimatePresence>
          {visibleLogs.length === 0 && (
            <motion.p className="empty-state" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              {logs.length === 0 ? 'Deploy swarm to see agent debate unfold here.' : 'No agents match filter.'}
            </motion.p>
          )}
        </AnimatePresence>
        {visibleLogs.map((entry, idx) => (
          <DebateCard
            key={`${entry.agent}-${entry.sequence}`}
            entry={entry}
            index={idx}
            isActive={replayActiveLog?.agent === entry.agent && replayCursor === entry.sequence}
            isDimmed={highlightedAgents.length > 0 && !highlightedAgents.includes(entry.agent)}
            isHighlighted={highlightedAgents.includes(entry.agent)}
            graphNodeLabels={graphNodeLabels}
            onClick={() => onDebateClick(entry)}
          />
        ))}
      </div>

      {/* Judge Verdict */}
      <AnimatePresence>
        {judgeVerdict && (
          <motion.div
            className="judge-verdict"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            <div className="judge-header">
              <span className="judge-icon">⚖</span>
              <strong className="judge-title">JUDGE AGENT VERDICT</strong>
              <div className="judge-scores">
                <span className="judge-score-chip">Consensus <strong>{judgeVerdict.consensus_score}/10</strong></span>
                <span className="judge-score-chip">Confidence <strong>{judgeVerdict.confidence}%</strong></span>
              </div>
            </div>
            <p className="judge-text">{judgeVerdict.verdict}</p>
            {judgeVerdict.dissent && (
              <div className="judge-dissent">
                <span>⚑ Dissent: </span>{judgeVerdict.dissent}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
