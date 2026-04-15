import { motion, AnimatePresence } from 'framer-motion'
import { useMemo } from 'react'

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
}) {
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
          <div className="debate-stage-controls">
            <button
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
