import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ReactECharts from 'echarts-for-react'

const SCENARIO_COLORS = {
  A: '#00bfff', B: '#a78bfa', C: '#ffbe68', D: '#39d353', E: '#ff4060',
}

function buildOption(distributions, selected) {
  const letters = ['A', 'B', 'C', 'D', 'E']
  const colors  = letters.map((l) => SCENARIO_COLORS[l])

  // boxplot data: [min (p10), Q1 (p25), median (p50), Q3 (p75), max (p90)]
  const boxData = letters.map((l) => {
    const d = distributions[l]
    if (!d) return [0, 0, 0, 0, 0]
    return [d.p10, d.p25, d.p50, d.p75, d.p90]
  })

  return {
    backgroundColor: 'transparent',
    grid: { top: 32, bottom: 48, left: 48, right: 16 },
    xAxis: {
      type: 'category',
      data: letters,
      axisLine:  { lineStyle: { color: '#00bfff20' } },
      axisTick:  { show: false },
      axisLabel: {
        color: (val) => SCENARIO_COLORS[val] || '#7aaccc',
        fontSize: 12, fontWeight: 700,
      },
    },
    yAxis: {
      type: 'value',
      min: 60, max: 100,
      axisLabel:  { color: '#4a7a90', fontSize: 10, formatter: '{value}%' },
      splitLine:  { lineStyle: { color: '#00bfff0d' } },
      axisLine:   { show: false },
      axisTick:   { show: false },
    },
    tooltip: {
      backgroundColor: '#07101f',
      borderColor:     '#00bfff30',
      textStyle:       { color: '#cce4f0', fontSize: 11 },
      formatter: (params) => {
        const l   = params.name
        const d   = distributions[l]
        if (!d) return ''
        return [
          `<b style="color:${SCENARIO_COLORS[l]}">Scenario ${l}</b>`,
          `p90: ${d.p90}%   p50: ${d.p50}%   p10: ${d.p10}%`,
          `Risk ${d.risk}  ·  Cost ${d.cost}  ·  Lead ${d.lead_time}`,
          `<i>1,000 simulation runs</i>`,
        ].join('<br/>')
      },
    },
    series: [
      {
        type: 'boxplot',
        data: boxData,
        itemStyle: {
          color:       (params) => SCENARIO_COLORS[letters[params.dataIndex]] + '30',
          borderColor: (params) => SCENARIO_COLORS[letters[params.dataIndex]],
          borderWidth: selected ? (params) => letters[params.dataIndex] === selected ? 2.5 : 1 : 1.5,
        },
        boxWidth: ['40%', '62%'],
      },
    ],
  }
}

export default function SimulationPanel({ runId, apiBase, selectedScenario, scenarioConfig, onScenarioSelect }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  useEffect(() => {
    if (!runId) { setData(null); return }
    setLoading(true); setError('')
    fetch(`${apiBase}/api/v2/runs/${runId}/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selected_scenario: selectedScenario, assumptions: scenarioConfig }),
    })
      .then((r) => r.json())
      .then(setData)
      .catch(() => setError('Simulation unavailable.'))
      .finally(() => setLoading(false))
  }, [runId, apiBase, selectedScenario, scenarioConfig])

  const dist = data?.distributions || {}
  const rec  = data?.recommendation

  return (
    <div className="sim-panel">
      <div className="sim-header">
        <div>
          <h3 className="sim-title">SIMULATION AGENT</h3>
          <p className="sim-sub">Monte Carlo outcome distributions · 1,000 rollouts per scenario</p>
        </div>
        {rec && (
          <div className="sim-rec-badge" style={{ '--rec-color': SCENARIO_COLORS[rec] }}>
            Best Path: <strong>Scenario {rec}</strong>
          </div>
        )}
      </div>

      {loading && (
        <div className="sim-loading">
          <div className="sim-spin" />
          <span>Running simulations...</span>
        </div>
      )}
      {error && <p className="sim-error">{error}</p>}
      {!loading && !error && !data && (
        <div className="sim-empty">
          <p>Deploy a swarm run to generate outcome distributions.</p>
        </div>
      )}

      <AnimatePresence>
        {data && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {/* ECharts boxplot */}
            <div className="sim-chart-wrap">
              <ReactECharts
                option={buildOption(dist, selectedScenario)}
                style={{ height: 220 }}
                opts={{ renderer: 'svg' }}
              />
            </div>

            {/* Scenario stat strip */}
            <div className="sim-stat-strip">
              {['A', 'B', 'C', 'D', 'E'].map((l) => {
                const d = dist[l]; if (!d) return null
                const isSelected = selectedScenario === l
                const isRec      = rec === l
                return (
                  <motion.button
                    key={l}
                    className={`sim-stat-card ${isSelected ? 'selected' : ''} ${isRec ? 'recommended' : ''}`}
                    style={{ '--card-color': SCENARIO_COLORS[l] }}
                    onClick={() => onScenarioSelect?.(l)}
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.97 }}
                  >
                    {isRec && <div className="sim-rec-crown">★</div>}
                    <div className="sim-stat-letter">{l}</div>
                    <div className="sim-stat-row">
                      <span>p50</span><strong>{d.p50}%</strong>
                    </div>
                    <div className="sim-stat-spread">
                      <span>{d.p10}% – {d.p90}%</span>
                    </div>
                    <div className="sim-risk-bar">
                      <div className="sim-risk-fill" style={{ width: `${d.risk}%`, background: SCENARIO_COLORS[l] }} />
                    </div>
                    <div className="sim-stat-cost">{d.cost}</div>
                  </motion.button>
                )
              })}
            </div>

            <p className="sim-note">{data.note}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
