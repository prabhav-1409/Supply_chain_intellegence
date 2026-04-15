import ReactECharts from 'echarts-for-react'
import { useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

// ─── ReactFlow Knowledge Graph 2.0 ────────────────────────────────────────────

const NODE_TYPE_COLORS = {
  root: { bg: '#3f0d17', border: '#ff4060', text: '#ff8090', glow: '#ff406080' },
  action: { bg: '#0d2033', border: '#00bfff', text: '#7ddcff', glow: '#00bfff60' },
  effect: { bg: '#0d1f10', border: '#39d353', text: '#80ee90', glow: '#39d35360' },
}

function toReactFlowNodes(graphNodes, activatedNodeIds) {
  const byType = { root: [], action: [], effect: [] }
  graphNodes.forEach((n) => {
    const bucket = byType[n.type] || byType.action
    bucket.push(n)
  })

  const positions = {}
  const colX = { root: 80, action: 320, effect: 560 }
  ;['root', 'action', 'effect'].forEach((type) => {
    const list = byType[type]
    list.forEach((n, i) => {
      positions[n.id] = {
        x: colX[type],
        y: 60 + i * 100,
      }
    })
  })

  return graphNodes.map((n) => {
    const colors = NODE_TYPE_COLORS[n.type] || NODE_TYPE_COLORS.action
    const isActive = activatedNodeIds?.has(n.id)
    return {
      id: n.id,
      position: positions[n.id] || { x: 0, y: 0 },
      data: { label: n.label },
      style: {
        background: colors.bg,
        border: `1.5px solid ${isActive ? '#ffffff' : colors.border}`,
        color: colors.text,
        borderRadius: '8px',
        padding: '8px 14px',
        fontSize: '11px',
        fontFamily: '"SF Mono", monospace',
        fontWeight: '600',
        boxShadow: isActive
          ? `0 0 22px 6px ${colors.glow}, 0 0 6px 2px #fff2`
          : `0 0 10px 2px ${colors.glow}`,
        transition: 'box-shadow 0.3s, border 0.3s',
        minWidth: '120px',
        textAlign: 'center',
      },
    }
  })
}

function toReactFlowEdges(graphEdges, selectedEdgeId) {
  return graphEdges.map((e) => {
    const id = `${e.source}-${e.target}`
    const isActive = selectedEdgeId === id
    return {
      id,
      source: e.source,
      target: e.target,
      animated: isActive,
      markerEnd: { type: MarkerType.ArrowClosed, color: isActive ? '#ffffff' : '#00bfff' },
      style: {
        stroke: isActive ? '#ffffff' : '#00bfff',
        strokeWidth: isActive ? 2.5 : 1.2,
        filter: isActive ? 'drop-shadow(0 0 6px #00bfff)' : 'none',
        opacity: isActive ? 1 : 0.45,
      },
    }
  })
}

export function KnowledgeGraph2({ graphNodes, graphEdges, selectedEdgeId, activatedNodeIds, onEdgeSelect }) {
  const rfNodes = useMemo(() => toReactFlowNodes(graphNodes, activatedNodeIds), [graphNodes, activatedNodeIds])
  const rfEdges = useMemo(() => toReactFlowEdges(graphEdges, selectedEdgeId), [graphEdges, selectedEdgeId])

  const [nodes, , onNodesChange] = useNodesState(rfNodes)
  const [edges, , onEdgesChange] = useEdgesState(rfEdges)

  if (!graphNodes.length) {
    return (
      <div className="graph2-empty">
        <p>Knowledge graph activates after AI debate completes</p>
      </div>
    )
  }

  return (
    <div className="graph2-canvas">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onEdgeClick={(_, edge) => onEdgeSelect?.(edge.id)}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
        style={{ background: 'transparent' }}
      >
        <Background color="#00bfff18" gap={24} size={1} />
        <Controls
          style={{
            background: '#0a1628',
            border: '1px solid #00bfff30',
            borderRadius: '8px',
          }}
        />
        <MiniMap
          nodeColor={(n) => {
            const t = graphNodes.find((gn) => gn.id === n.id)?.type || 'action'
            return NODE_TYPE_COLORS[t]?.border || '#00bfff'
          }}
          style={{ background: '#050c1a', border: '1px solid #00bfff20' }}
        />
      </ReactFlow>
    </div>
  )
}

// ─── Risk Heatmap (ECharts) ───────────────────────────────────────────────────

export function RiskHeatmapChart({ items }) {
  const option = useMemo(() => {
    if (!items?.length) return {}
    const categories = items.map((i) => i.dimension)
    const scores = items.map((i) => i.score)
    const colors = items.map((i) =>
      i.risk === 'high' ? '#ff4060' : i.risk === 'medium' ? '#ffbe68' : '#39d353',
    )
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis', backgroundColor: '#0a1628', borderColor: '#00bfff30', textStyle: { color: '#aaccdd' } },
      grid: { left: 16, right: 16, top: 10, bottom: 28, containLabel: true },
      xAxis: {
        type: 'value',
        min: 0,
        max: 5,
        axisLine: { lineStyle: { color: '#00bfff20' } },
        axisLabel: { color: '#4a7a90', fontSize: 10 },
        splitLine: { lineStyle: { color: '#00bfff10' } },
      },
      yAxis: {
        type: 'category',
        data: categories,
        axisLabel: { color: '#7aaccc', fontSize: 10, fontFamily: '"SF Mono", monospace' },
        axisLine: { lineStyle: { color: '#00bfff20' } },
      },
      series: [
        {
          type: 'bar',
          data: scores.map((v, i) => ({ value: v, itemStyle: { color: colors[i], borderRadius: 4 } })),
          barWidth: 16,
          label: { show: true, position: 'right', color: '#aaccdd', fontSize: 10, formatter: '{c}/5' },
        },
      ],
    }
  }, [items])

  if (!items?.length) return <p className="empty-state">Risk matrix populates after swarm debate.</p>

  return (
    <ReactECharts
      option={option}
      style={{ height: '200px', width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  )
}

// ─── Inventory Forecast Chart (ECharts) ──────────────────────────────────────

export function ForecastChart({ series, label }) {
  const option = useMemo(() => {
    if (!series?.length) return {}
    const points = series.map((v, i) => [i, v])
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis', backgroundColor: '#0a1628', borderColor: '#00bfff30', textStyle: { color: '#aaccdd' } },
      grid: { left: 10, right: 10, top: 16, bottom: 20, containLabel: true },
      xAxis: {
        type: 'value',
        axisLabel: { show: false },
        axisLine: { show: false },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        axisLabel: { color: '#4a7a90', fontSize: 10, formatter: '{value}%' },
        axisLine: { lineStyle: { color: '#00bfff20' } },
        splitLine: { lineStyle: { color: '#00bfff10' } },
      },
      series: [
        {
          type: 'line',
          data: points,
          smooth: true,
          symbol: 'none',
          lineStyle: { color: '#00bfff', width: 2 },
          areaStyle: {
            color: {
              type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(0,191,255,0.32)' },
                { offset: 1, color: 'rgba(0,191,255,0.02)' },
              ],
            },
          },
          markLine: {
            silent: true,
            symbol: 'none',
            data: [{ yAxis: 50, lineStyle: { color: '#ff4060', type: 'dashed', width: 1 }, label: { color: '#ff4060', fontSize: 9, formatter: 'THRESHOLD' } }],
          },
        },
      ],
    }
  }, [series])

  if (!series?.length) return <p className="empty-state">Inventory trajectory loads after scenario selection.</p>

  return (
    <ReactECharts
      option={option}
      style={{ height: '180px', width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  )
}

// ─── Future Outlook Bars (ECharts) ───────────────────────────────────────────

export function OutlookChart({ items }) {
  const option = useMemo(() => {
    if (!items?.length) return {}
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis', backgroundColor: '#0a1628', borderColor: '#00bfff30', textStyle: { color: '#aaccdd' } },
      grid: { left: 10, right: 10, top: 8, bottom: 24, containLabel: true },
      xAxis: {
        type: 'category',
        data: items.map((i) => i.horizon),
        axisLabel: { color: '#4a7a90', fontSize: 9 },
        axisLine: { lineStyle: { color: '#00bfff20' } },
      },
      yAxis: {
        type: 'value', min: 0, max: 100,
        axisLabel: { color: '#4a7a90', fontSize: 9, formatter: '{value}%' },
        splitLine: { lineStyle: { color: '#00bfff10' } },
      },
      series: [{
        type: 'bar',
        data: items.map((i) => ({
          value: i.value,
          itemStyle: { color: i.value > 70 ? '#39d353' : i.value > 45 ? '#ffbe68' : '#ff4060', borderRadius: 4 },
        })),
        barWidth: '60%',
      }],
    }
  }, [items])

  if (!items?.length) return <p className="empty-state">Outlook unlocks after deployment.</p>

  return (
    <ReactECharts
      option={option}
      style={{ height: '160px', width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  )
}

function parsePercent(value) {
  if (typeof value === 'number') return value
  if (!value) return 0
  return Number.parseFloat(String(value).replace('%', '')) || 0
}

function parseMoneyMillions(value) {
  if (typeof value === 'number') return value
  if (!value) return 0
  return Number.parseFloat(String(value).replace(/[^\d.]/g, '')) || 0
}

function parseLeadDays(value) {
  if (typeof value === 'number') return value
  if (!value) return 0
  return Number.parseFloat(String(value).replace(/[^\d.]/g, '')) || 0
}

export function ScenarioComparisonTable({ scenarios, selectedScenario, onSelect }) {
  if (!scenarios?.length) return <p className="empty-state">Scenario comparison appears after planner data loads.</p>

  return (
    <div className="scenario-compare-wrap">
      <table className="scenario-compare-table">
        <thead>
          <tr>
            <th>Metric</th>
            {scenarios.map((scenario) => (
              <th
                key={scenario.letter}
                className={selectedScenario === scenario.letter ? 'selected' : ''}
                onClick={() => onSelect?.(scenario.letter)}
              >
                <span className={`scenario-col-head scenario-${scenario.letter.toLowerCase()}`}>{scenario.letter}: {scenario.title}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Fulfillment %</td>
            {scenarios.map((scenario) => <td key={`${scenario.letter}-fulfillment`} className={selectedScenario === scenario.letter ? 'selected' : ''}>{scenario.fulfillment}%</td>)}
          </tr>
          <tr>
            <td>Cost</td>
            {scenarios.map((scenario) => <td key={`${scenario.letter}-cost`} className={selectedScenario === scenario.letter ? 'selected' : ''}>{scenario.cost}</td>)}
          </tr>
          <tr>
            <td>Lead Time</td>
            {scenarios.map((scenario) => <td key={`${scenario.letter}-lead`} className={selectedScenario === scenario.letter ? 'selected' : ''}>{scenario.lead_time}</td>)}
          </tr>
          <tr>
            <td>Risk Score</td>
            {scenarios.map((scenario) => <td key={`${scenario.letter}-risk`} className={selectedScenario === scenario.letter ? 'selected' : ''}>{scenario.risk}</td>)}
          </tr>
          <tr>
            <td>Confidence</td>
            {scenarios.map((scenario) => <td key={`${scenario.letter}-confidence`} className={selectedScenario === scenario.letter ? 'selected' : ''}>{scenario.confidence}</td>)}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export function ScenarioRadarChart({ scenarios, selectedScenario }) {
  const option = useMemo(() => {
    if (!scenarios?.length) return {}

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        backgroundColor: '#0a1628',
        borderColor: '#00bfff30',
        textStyle: { color: '#aaccdd' },
      },
      legend: {
        bottom: 0,
        textStyle: { color: '#6f97b2', fontSize: 10 },
      },
      radar: {
        center: ['50%', '45%'],
        radius: '62%',
        splitNumber: 4,
        axisName: { color: '#4a7a90', fontSize: 10 },
        splitLine: { lineStyle: { color: '#00bfff12' } },
        splitArea: { areaStyle: { color: ['transparent'] } },
        axisLine: { lineStyle: { color: '#00bfff16' } },
        indicator: [
          { name: 'Fulfillment', max: 100 },
          { name: 'Cost Eff.', max: 100 },
          { name: 'Speed', max: 100 },
          { name: 'Safety', max: 100 },
          { name: 'Confidence', max: 100 },
        ],
      },
      series: [
        {
          type: 'radar',
          data: scenarios.map((scenario) => {
            const fulfillment = parsePercent(scenario.fulfillment)
            const confidence = parsePercent(scenario.confidence)
            const costEfficiency = Math.max(0, 100 - parseMoneyMillions(scenario.cost) * 20)
            const speed = Math.max(0, 100 - parseLeadDays(scenario.lead_time) * 3)
            const safety = Math.max(0, 100 - Number(scenario.risk || 0))
            const colorMap = { A: '#ff4060', B: '#00bfff', C: '#a78bfa', D: '#39d353', E: '#ffbe68' }
            const color = colorMap[scenario.letter] || '#00bfff'
            return {
              name: scenario.letter,
              value: [fulfillment, costEfficiency, speed, safety, confidence],
              lineStyle: { color, width: selectedScenario === scenario.letter ? 2.5 : 1.5 },
              itemStyle: { color },
              areaStyle: { color: `${color}18` },
            }
          }),
        },
      ],
    }
  }, [scenarios, selectedScenario])

  if (!scenarios?.length) return <p className="empty-state">Multi-axis comparison appears after planner data loads.</p>

  return (
    <ReactECharts
      option={option}
      style={{ height: '290px', width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  )
}
