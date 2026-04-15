import { motion, AnimatePresence } from 'framer-motion'
import { useState } from 'react'

const SCENARIO_COLORS = {
  A: '#ff4060',
  B: '#00bfff',
  C: '#a78bfa',
  D: '#39d353',
  E: '#ffbe68',
}

const SCENARIO_ICONS = {
  A: '🛡',
  B: '⚖',
  C: '✈',
  D: '⚡',
  E: '🔥',
}

export default function ScenarioFilmstrip({ scenarios, selectedScenario, onSelect, recommendation }) {
  const [hoveredLetter, setHoveredLetter] = useState(null)

  return (
    <div className="filmstrip-container">
      <div className="filmstrip-track">
        {scenarios.map((s, idx) => {
          const letter = s.letter
          const color = SCENARIO_COLORS[letter] || '#00bfff'
          const isSelected = selectedScenario === letter
          const isHovered = hoveredLetter === letter

          return (
            <motion.button
              key={letter}
              className={`filmstrip-card ${isSelected ? 'selected' : ''}`}
              style={{ '--card-color': color }}
              onClick={() => onSelect(letter)}
              onMouseEnter={() => setHoveredLetter(letter)}
              onMouseLeave={() => setHoveredLetter(null)}
              initial={{ opacity: 0, y: 20, scale: 0.9 }}
              animate={{
                opacity: 1,
                y: isSelected ? -8 : 0,
                scale: isSelected ? 1.06 : isHovered ? 1.02 : 1,
              }}
              transition={{ duration: 0.3, delay: idx * 0.05 }}
              whileTap={{ scale: 0.97 }}
            >
              <div className="filmstrip-card-glow" style={{ background: `radial-gradient(circle at 50% 0%, ${color}30, transparent 70%)` }} />
              <div className="filmstrip-card-header">
                <div className="filmstrip-icon" style={{ color }}>{SCENARIO_ICONS[letter] || '◆'}</div>
                <div className="filmstrip-letter" style={{ color }}>{letter}</div>
              </div>
              <div className="filmstrip-title">{s.title || `Scenario ${letter}`}</div>
              <div className="filmstrip-metrics">
                <div className="filmstrip-metric">
                  <span>Fulfillment</span>
                  <div className="filmstrip-bar-wrap">
                    <motion.div
                      className="filmstrip-bar"
                      style={{ background: color }}
                      initial={{ width: 0 }}
                      animate={{ width: `${s.fulfillment || 0}%` }}
                      transition={{ duration: 0.6, delay: 0.2 + idx * 0.05 }}
                    />
                  </div>
                  <strong style={{ color }}>{s.fulfillment}%</strong>
                </div>
                <div className="filmstrip-metric">
                  <span>Risk</span>
                  <div className="filmstrip-bar-wrap">
                    <motion.div
                      className="filmstrip-bar"
                      style={{ background: s.risk > 50 ? '#ff4060' : s.risk > 30 ? '#ffbe68' : '#39d353' }}
                      initial={{ width: 0 }}
                      animate={{ width: `${s.risk || 0}%` }}
                      transition={{ duration: 0.6, delay: 0.25 + idx * 0.05 }}
                    />
                  </div>
                  <strong>{s.risk}</strong>
                </div>
                <div className="filmstrip-kv">
                  <div><span>Cost</span><strong>{s.cost}</strong></div>
                  <div><span>Lead</span><strong>{s.lead_time}</strong></div>
                  <div><span>Confidence</span><strong>{s.confidence}</strong></div>
                </div>
              </div>
              {isSelected && (
                <motion.div
                  className="filmstrip-selected-indicator"
                  style={{ background: color }}
                  layoutId="filmstripSelector"
                  initial={false}
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                />
              )}
            </motion.button>
          )
        })}
      </div>

      <AnimatePresence mode="wait">
        {recommendation && (
          <motion.div
            key={selectedScenario}
            className="filmstrip-rec"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            style={{ borderColor: SCENARIO_COLORS[selectedScenario] || '#00bfff' }}
          >
            <div className="filmstrip-rec-title">{recommendation.title}</div>
            <p>{recommendation.reasoning}</p>
            <div className="filmstrip-actions">
              {recommendation.actions?.map((action) => (
                <div key={action} className="filmstrip-action-chip">{action}</div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
