import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const SECTION_META = {
  changed:     { label: 'SITUATION DELTA', icon: '📡', color: '#00bfff' },
  decision:    { label: 'REQUIRED ACTION', icon: '⚡', color: '#a78bfa' },
  consequence: { label: 'INACTION RISK',   icon: '⚠️', color: '#ff4060' },
}

function TypewriterText({ text, speed = 28, onDone }) {
  const [displayed, setDisplayed] = useState('')
  const idx = useRef(0)

  useEffect(() => {
    idx.current = 0
    setDisplayed('')
  }, [text])

  useEffect(() => {
    if (!text) return
    if (idx.current >= text.length) { onDone?.(); return }
    const timer = setTimeout(() => {
      setDisplayed(text.slice(0, idx.current + 1))
      idx.current += 1
    }, speed)
    return () => clearTimeout(timer)
  }, [displayed, text, speed, onDone])

  return <span>{displayed}<span className="nc-cursor">▌</span></span>
}

export default function NarrativeCopilot({ runId, eventName, apiBase, isVisible, onClose }) {
  const [narrative,   setNarrative]   = useState(null)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState('')
  const [activeIdx,   setActiveIdx]   = useState(0)
  const [voiceActive, setVoiceActive] = useState(false)
  const sections = ['changed', 'decision', 'consequence']

  useEffect(() => {
    if (!isVisible || !runId) return
    setLoading(true); setError(''); setNarrative(null); setActiveIdx(0)
    fetch(`${apiBase}/api/v2/runs/${runId}/narrative`, { method: 'POST' })
      .then((r) => r.json())
      .then((d) => setNarrative(d))
      .catch(() => setError('Narrative service unavailable.'))
      .finally(() => setLoading(false))
  }, [isVisible, runId, apiBase])

  const speakNarrative = () => {
    if (!narrative || !window.speechSynthesis) return
    window.speechSynthesis.cancel()
    const script = [
      `Situation delta. ${narrative.changed}`,
      `Required action. ${narrative.decision}`,
      `Inaction risk. ${narrative.consequence}`,
    ].join(' ')
    const utt = new SpeechSynthesisUtterance(script)
    utt.rate = 0.92; utt.pitch = 1.0
    utt.onstart = () => setVoiceActive(true)
    utt.onend   = () => setVoiceActive(false)
    window.speechSynthesis.speak(utt)
  }

  const stopSpeech = () => { window.speechSynthesis?.cancel(); setVoiceActive(false) }

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          className="nc-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
        >
          <motion.div
            className="nc-panel"
            initial={{ y: 40, opacity: 0, scale: 0.97 }}
            animate={{ y: 0,  opacity: 1, scale: 1   }}
            exit={{    y: 40, opacity: 0, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          >
            {/* Header */}
            <div className="nc-header">
              <div className="nc-header-left">
                <div className="nc-logo-dot" />
                <div>
                  <h2 className="nc-title">AI NARRATIVE COPILOT</h2>
                  <p className="nc-sub">{eventName || 'Executive Intelligence Brief'}</p>
                </div>
              </div>
              <div className="nc-header-right">
                {narrative && (
                  <button
                    className={`nc-voice-btn ${voiceActive ? 'active' : ''}`}
                    onClick={voiceActive ? stopSpeech : speakNarrative}
                    title={voiceActive ? 'Stop reading' : 'Read aloud'}
                  >
                    {voiceActive ? '⏹ Stop' : '🔊 Read Aloud'}
                  </button>
                )}
                <button className="nc-close" onClick={onClose}>✕</button>
              </div>
            </div>

            {/* Progress bar */}
            <div className="nc-progress-bar">
              {sections.map((key, i) => (
                <div
                  key={key}
                  className={`nc-progress-seg ${i <= activeIdx ? 'filled' : ''}`}
                  style={{ '--seg-color': SECTION_META[key].color }}
                />
              ))}
            </div>

            {/* Body */}
            <div className="nc-body">
              {loading && (
                <div className="nc-loading">
                  <div className="nc-spin" />
                  <span>Generating executive brief...</span>
                </div>
              )}
              {error && <p className="nc-error">{error}</p>}
              {narrative && (
                <div className="nc-sections">
                  {sections.map((key, i) => {
                    const meta = SECTION_META[key]
                    return (
                      <motion.div
                        key={key}
                        className={`nc-section ${activeIdx === i ? 'active' : activeIdx > i ? 'done' : 'pending'}`}
                        style={{ '--accent': meta.color }}
                        initial={{ opacity: 0, x: -16 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.15 }}
                      >
                        <div className="nc-section-label">
                          <span className="nc-section-icon">{meta.icon}</span>
                          <span>{meta.label}</span>
                        </div>
                        <div className="nc-section-text">
                          {activeIdx >= i ? (
                            <TypewriterText
                              text={narrative[key]}
                              speed={22}
                              onDone={() => { if (i === activeIdx && activeIdx < sections.length - 1) setActiveIdx(i + 1) }}
                            />
                          ) : (
                            <span style={{ color: 'var(--text-dim)' }}>Awaiting previous section...</span>
                          )}
                        </div>
                      </motion.div>
                    )
                  })}
                </div>
              )}
              {narrative && (
                <div className="nc-footer">
                  <span className="nc-source-badge">{narrative.source === 'llm' ? '🤖 LLM Generated' : '📋 Scripted'}</span>
                  <span className="nc-ts">{new Date().toLocaleTimeString()}</span>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
