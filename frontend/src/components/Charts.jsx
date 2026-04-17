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

export function MonteCarloBandChart({ scenarios }) {
  const option = useMemo(() => {
    if (!scenarios?.length) return {}
    const labels = scenarios.map((item) => item.scenario_name)
    const p10 = scenarios.map((item) => Number(item?.profit_per_unit_ci?.[0] ?? 0))
    const p50 = scenarios.map((item) => Number(item?.profit_per_unit_expected ?? 0))
    const p90 = scenarios.map((item) => Number(item?.profit_per_unit_ci?.[1] ?? 0))
    const band = p90.map((high, idx) => high - p10[idx])

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#0a1628',
        borderColor: '#00bfff30',
        textStyle: { color: '#aaccdd' },
      },
      grid: { left: 12, right: 12, top: 14, bottom: 34, containLabel: true },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: { color: '#7aaccc', fontSize: 10 },
        axisLine: { lineStyle: { color: '#00bfff20' } },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          color: '#4a7a90',
          fontSize: 10,
          formatter: (value) => `$${Number(value).toFixed(0)}`,
        },
        splitLine: { lineStyle: { color: '#00bfff10' } },
      },
      series: [
        {
          name: 'P10 Base',
          type: 'bar',
          stack: 'band',
          data: p10,
          itemStyle: { color: 'transparent' },
          emphasis: { disabled: true },
          tooltip: { show: false },
        },
        {
          name: 'P10-P90 Band',
          type: 'bar',
          stack: 'band',
          data: band,
          itemStyle: { color: 'rgba(0,191,255,0.24)', borderRadius: 5 },
        },
        {
          name: 'Expected (P50)',
          type: 'line',
          data: p50,
          smooth: true,
          symbol: 'circle',
          symbolSize: 7,
          lineStyle: { color: '#39d353', width: 2 },
          itemStyle: { color: '#39d353' },
        },
      ],
    }
  }, [scenarios])

  if (!scenarios?.length) return <p className="empty-state">Monte Carlo confidence bands appear after simulation runs.</p>

  return (
    <ReactECharts
      option={option}
      style={{ height: '250px', width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  )
}

export function ProfitWaterfallChart({ scenario }) {
  const option = useMemo(() => {
    if (!scenario) return {}

    const revenue = Number(scenario.revenue_per_unit || 0)
    const purchase = -Number(scenario.purchase_price_per_unit || 0)
    const freight = -Number(scenario.freight_per_unit || 0)
    const tariff = -Number(scenario.tariff_per_unit || 0)
    const customs = -Number(scenario.customs_per_unit || 0)
    const handling = -Number(scenario.handling_per_unit || 0)
    const fixed = -Number(scenario.fixed_conversion_per_unit || 0)
    const otherBom = -Number(scenario.other_bom_per_unit || 0)
    const profit = Number(scenario.profit_per_unit_expected || 0)

    const labels = ['Revenue', 'Purchase', 'Freight', 'Tariff', 'Customs', 'Handling', 'Other BOM', 'Fixed Conv.', 'Profit']
    const values = [revenue, purchase, freight, tariff, customs, handling, otherBom, fixed, profit]

    let running = 0
    const base = []
    const bars = []
    values.forEach((value, index) => {
      if (index === 0) {
        base.push(0)
        bars.push(value)
        running = value
        return
      }
      if (index === values.length - 1) {
        base.push(0)
        bars.push(value)
        return
      }
      if (value >= 0) {
        base.push(running)
        bars.push(value)
      } else {
        base.push(running + value)
        bars.push(Math.abs(value))
      }
      running += value
    })

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: '#0a1628',
        borderColor: '#00bfff30',
        textStyle: { color: '#aaccdd' },
      },
      grid: { left: 12, right: 12, top: 14, bottom: 60, containLabel: true },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: { color: '#7aaccc', fontSize: 10, rotate: 20 },
        axisLine: { lineStyle: { color: '#00bfff20' } },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          color: '#4a7a90',
          fontSize: 10,
          formatter: (value) => `$${Number(value).toFixed(0)}`,
        },
        splitLine: { lineStyle: { color: '#00bfff10' } },
      },
      series: [
        {
          type: 'bar',
          stack: 'waterfall',
          data: base,
          itemStyle: { color: 'transparent' },
          emphasis: { disabled: true },
          tooltip: { show: false },
        },
        {
          type: 'bar',
          stack: 'waterfall',
          data: bars.map((value, index) => {
            const signed = values[index]
            const isRevenue = index === 0
            const isProfit = index === values.length - 1
            return {
              value,
              itemStyle: {
                color: isRevenue ? '#00bfff' : isProfit ? (signed >= 0 ? '#39d353' : '#ff4060') : (signed >= 0 ? '#39d353' : '#ffbe68'),
                borderRadius: 4,
              },
            }
          }),
          label: {
            show: true,
            position: 'top',
            color: '#aaccdd',
            fontSize: 9,
            formatter: ({ dataIndex }) => `${values[dataIndex] >= 0 ? '+' : ''}$${values[dataIndex].toFixed(1)}`,
          },
        },
      ],
    }
  }, [scenario])

  if (!scenario) return <p className="empty-state">Profit waterfall appears after selecting a scenario.</p>

  return (
    <ReactECharts
      option={option}
      style={{ height: '280px', width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  )
}

// ── Module 4: Deal Zone Chart ─────────────────────────────────────────────────
// Horizontal range bar showing: raw floor | vendor floor | opening offer | deal zone | walk-away
export function DealZoneChart({ brief }) {
  const option = useMemo(() => {
    if (!brief) return {}
    const floor = Number(brief.estimated_vendor_floor ?? 0)
    const opening = Number(brief.opening_offer ?? 0)
    const dealLow = Number(brief.deal_zone_low ?? 0)
    const dealHigh = Number(brief.deal_zone_high ?? 0)
    const walkAway = Number(brief.walk_away_price ?? 0)
    const anchor = Number(brief.vendor_anchor_price ?? 0)
    const breakEven = Number(brief.break_even_price ?? 0)
    const all = [floor, opening, dealLow, dealHigh, walkAway, anchor, breakEven].filter(Boolean)
    const minVal = Math.floor(Math.min(...all) * 0.94)
    const maxVal = Math.ceil(Math.max(...all) * 1.06)

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: '#0a1628',
        borderColor: '#00bfff30',
        textStyle: { color: '#aaccdd', fontSize: 11 },
        formatter: (params) => {
          return params
            .filter((p) => p.value !== 0 && p.seriesName !== 'Base')
            .map((p) => `${p.seriesName}: <b>$${Number(p.value).toFixed(2)}</b>`)
            .join('<br/>')
        },
      },
      grid: { left: 12, right: 12, top: 10, bottom: 60, containLabel: true },
      xAxis: {
        type: 'value',
        min: minVal,
        max: maxVal,
        axisLabel: { color: '#7aaccc', fontSize: 10, formatter: (v) => `$${v}` },
        axisLine: { lineStyle: { color: '#00bfff20' } },
        splitLine: { lineStyle: { color: '#00bfff10' } },
      },
      yAxis: {
        type: 'category',
        data: ['Price Range'],
        axisLabel: { color: '#4a7a90', fontSize: 10 },
        axisLine: { lineStyle: { color: '#00bfff20' } },
      },
      series: [
        { name: 'Base', type: 'bar', stack: 'stack', data: [minVal], itemStyle: { color: 'transparent' }, tooltip: { show: false }, emphasis: { disabled: true } },
        { name: 'Vendor Floor Zone', type: 'bar', stack: 'stack', data: [floor - minVal], itemStyle: { color: 'rgba(255,80,80,0.18)', borderRadius: [4, 0, 0, 4] }, label: { show: false } },
        { name: 'Negotiation Zone', type: 'bar', stack: 'stack', data: [dealHigh - floor], itemStyle: { color: 'rgba(0,191,255,0.22)', borderRadius: [0, 0, 0, 0] } },
        { name: 'Above Walk-Away', type: 'bar', stack: 'stack', data: [Math.max(0, anchor - dealHigh)], itemStyle: { color: 'rgba(255,180,0,0.15)', borderRadius: [0, 4, 4, 0] } },
        {
          name: 'Vendor Floor',
          type: 'scatter',
          data: [[floor, 0]],
          symbolSize: 14,
          itemStyle: { color: '#ff5050' },
          label: { show: true, formatter: `Floor $${floor.toFixed(2)}`, position: 'top', color: '#ff5050', fontSize: 9 },
        },
        {
          name: 'Opening Offer',
          type: 'scatter',
          data: [[opening, 0]],
          symbolSize: 14,
          itemStyle: { color: '#00bfff' },
          label: { show: true, formatter: `Open $${opening.toFixed(2)}`, position: 'bottom', color: '#00bfff', fontSize: 9 },
        },
        {
          name: 'Deal Zone Low',
          type: 'scatter',
          data: [[dealLow, 0]],
          symbolSize: 10,
          itemStyle: { color: '#39d353' },
          label: { show: true, formatter: `Zone Low $${dealLow.toFixed(2)}`, position: 'top', color: '#39d353', fontSize: 9 },
        },
        {
          name: 'Deal Zone High',
          type: 'scatter',
          data: [[dealHigh, 0]],
          symbolSize: 10,
          itemStyle: { color: '#39d353' },
          label: { show: true, formatter: `Zone High $${dealHigh.toFixed(2)}`, position: 'bottom', color: '#39d353', fontSize: 9 },
        },
        {
          name: 'Walk-Away',
          type: 'scatter',
          data: [[walkAway, 0]],
          symbolSize: 16,
          itemStyle: { color: '#ffb300' },
          label: { show: true, formatter: `Walk-Away $${walkAway.toFixed(2)}`, position: 'top', color: '#ffb300', fontSize: 9 },
        },
        {
          name: 'Vendor Anchor',
          type: 'scatter',
          data: [[anchor, 0]],
          symbolSize: 10,
          symbol: 'triangle',
          itemStyle: { color: '#cc66ff' },
          label: { show: true, formatter: `Anchor $${anchor.toFixed(2)}`, position: 'bottom', color: '#cc66ff', fontSize: 9 },
        },
      ],
    }
  }, [brief])

  if (!brief) return <p className="empty-state">Deal zone chart appears after selecting a vendor brief.</p>

  return (
    <ReactECharts
      option={option}
      style={{ height: '180px', width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  )
}

// ── Module 4: Profit Impact as Counter-Offer Price Changes ────────────────────
export function NegotiationImpactChart({ brief, counterPrice }) {
  const option = useMemo(() => {
    if (!brief?.profit_impact_curve?.length) return {}
    const curve = brief.profit_impact_curve
    const prices = curve.map((p) => p.price)
    const profits = curve.map((p) => p.profit_per_unit)
    const margins = curve.map((p) => p.margin_pct)

    const markLines = []
    if (brief.estimated_vendor_floor) markLines.push({ xAxis: brief.estimated_vendor_floor, name: 'Vendor Floor', lineStyle: { color: '#ff5050', type: 'dashed', width: 1.5 } })
    if (brief.walk_away_price) markLines.push({ xAxis: brief.walk_away_price, name: 'Walk-Away', lineStyle: { color: '#ffb300', type: 'dashed', width: 1.5 } })
    if (counterPrice > 0) markLines.push({ xAxis: counterPrice, name: 'Counter-offer', lineStyle: { color: '#39d353', type: 'solid', width: 2 } })

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#0a1628',
        borderColor: '#00bfff30',
        textStyle: { color: '#aaccdd', fontSize: 11 },
        formatter: (params) => {
          const price = params[0]?.axisValue
          const profit = params.find((p) => p.seriesName === 'Profit/Unit')?.value
          const margin = params.find((p) => p.seriesName === 'Margin %')?.value
          return `Price: <b>$${Number(price).toFixed(2)}</b><br/>Profit/Unit: <b>$${Number(profit ?? 0).toFixed(2)}</b><br/>Margin: <b>${Number(margin ?? 0).toFixed(1)}%</b>`
        },
      },
      legend: { top: 4, right: 4, textStyle: { color: '#7aaccc', fontSize: 10 } },
      grid: { left: 12, right: 12, top: 28, bottom: 40, containLabel: true },
      xAxis: {
        type: 'value',
        data: prices,
        min: Math.min(...prices) * 0.95,
        max: Math.max(...prices) * 1.05,
        axisLabel: { color: '#7aaccc', fontSize: 10, formatter: (v) => `$${Number(v).toFixed(0)}` },
        axisLine: { lineStyle: { color: '#00bfff20' } },
        splitLine: { lineStyle: { color: '#00bfff10' } },
      },
      yAxis: [
        { type: 'value', name: 'Profit $', nameTextStyle: { color: '#4a7a90', fontSize: 9 }, axisLabel: { color: '#4a7a90', fontSize: 9, formatter: (v) => `$${Number(v).toFixed(0)}` }, splitLine: { lineStyle: { color: '#00bfff10' } } },
        { type: 'value', name: 'Margin %', nameTextStyle: { color: '#4a7a90', fontSize: 9 }, axisLabel: { color: '#4a7a90', fontSize: 9, formatter: (v) => `${Number(v).toFixed(0)}%` }, splitLine: { show: false } },
      ],
      series: [
        {
          name: 'Profit/Unit',
          type: 'line',
          data: prices.map((p, i) => [p, profits[i]]),
          smooth: true,
          lineStyle: { color: '#00bfff', width: 2 },
          itemStyle: { color: '#00bfff' },
          areaStyle: { color: 'rgba(0,191,255,0.08)' },
          markLine: {
            silent: true,
            symbol: 'none',
            data: markLines,
            label: { color: '#aaccdd', fontSize: 9 },
          },
        },
        {
          name: 'Margin %',
          type: 'line',
          yAxisIndex: 1,
          data: prices.map((p, i) => [p, margins[i]]),
          smooth: true,
          lineStyle: { color: '#ffb300', width: 1.5, type: 'dashed' },
          itemStyle: { color: '#ffb300' },
        },
      ],
    }
  }, [brief, counterPrice])

  if (!brief?.profit_impact_curve?.length) return <p className="empty-state">Impact curve appears after vendor data loads.</p>

  return (
    <ReactECharts
      option={option}
      style={{ height: '230px', width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  )
}

// ── Module 4: Agent Negotiation Timeline ─────────────────────────────────────
export function AgentNegotiationTimeline({ rounds }) {
  const option = useMemo(() => {
    if (!rounds?.length) return {}
    const labels = rounds.map((r) => `R${r.round}`)
    const buyerOffers = rounds.map((r) => r.buyer_offer)
    const vendorAsks = rounds.map((r) => r.vendor_ask)
    const gaps = rounds.map((r) => r.gap)

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#0a1628',
        borderColor: '#00bfff30',
        textStyle: { color: '#aaccdd', fontSize: 11 },
        formatter: (params) => {
          const r = rounds[params[0]?.dataIndex] || {}
          return [
            `<b>Round ${r.round}</b>`,
            `Buyer Offer: <b>$${Number(r.buyer_offer ?? 0).toFixed(2)}</b>`,
            `Vendor Ask: <b>$${Number(r.vendor_ask ?? 0).toFixed(2)}</b>`,
            `Gap: <b>$${Number(r.gap ?? 0).toFixed(2)}</b>`,
            `Status: <b>${r.status}</b>`,
            r.agreed ? '<span style="color:#39d353">✓ Agreement reached</span>' : '',
          ].filter(Boolean).join('<br/>')
        },
      },
      legend: { bottom: 0, textStyle: { color: '#7aaccc', fontSize: 10 } },
      grid: { left: 12, right: 12, top: 14, bottom: 44, containLabel: true },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: { color: '#7aaccc', fontSize: 11 },
        axisLine: { lineStyle: { color: '#00bfff20' } },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: '#4a7a90', fontSize: 10, formatter: (v) => `$${Number(v).toFixed(0)}` },
        splitLine: { lineStyle: { color: '#00bfff10' } },
      },
      series: [
        {
          name: 'Buyer Offer',
          type: 'line',
          data: buyerOffers,
          smooth: true,
          lineStyle: { color: '#00bfff', width: 2 },
          itemStyle: { color: '#00bfff' },
          symbol: 'circle',
          symbolSize: 8,
          label: { show: true, formatter: (params) => `$${Number(params.value).toFixed(1)}`, color: '#00bfff', fontSize: 9, position: 'bottom' },
        },
        {
          name: 'Vendor Ask',
          type: 'line',
          data: vendorAsks,
          smooth: true,
          lineStyle: { color: '#ff5050', width: 2 },
          itemStyle: { color: '#ff5050' },
          symbol: 'circle',
          symbolSize: 8,
          label: { show: true, formatter: (params) => `$${Number(params.value).toFixed(1)}`, color: '#ff5050', fontSize: 9, position: 'top' },
        },
        {
          name: 'Gap',
          type: 'bar',
          data: gaps,
          itemStyle: { color: 'rgba(255,180,0,0.25)', borderRadius: 4 },
          yAxisIndex: 0,
        },
      ],
    }
  }, [rounds])

  if (!rounds?.length) return <p className="empty-state">Negotiation simulation rounds appear after brief loads.</p>

  return (
    <ReactECharts
      option={option}
      style={{ height: '230px', width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  )
}

// ── Module 4: Vendor Comparison Radar (negotiation angle) ─────────────────────
export function NegotiationVendorRadar({ briefs }) {
  const option = useMemo(() => {
    if (!briefs?.length) return {}
    const indicators = [
      { name: 'Deal Feasibility', max: 100 },
      { name: 'Margin at Deal', max: 30 },
      { name: 'Reliability', max: 100 },
      { name: 'Speed', max: 100 },
      { name: 'Low Risk', max: 100 },
    ]
    const colors = ['#00bfff', '#39d353', '#ffb300', '#cc66ff', '#ff5050']
    const series_data = briefs.slice(0, 4).map((b, i) => ({
      name: b.vendor_name,
      value: [
        b.deal_feasible ? 85 : 35,
        Math.max(0, Math.min(30, b.projected_deal_margin_pct)),
        b.reliability,
        Math.max(0, 100 - b.lead_days * 4),
        100 - b.geo_risk,
      ],
      lineStyle: { color: colors[i], width: 1.5 },
      itemStyle: { color: colors[i] },
      areaStyle: { color: `${colors[i]}18` },
    }))

    return {
      backgroundColor: 'transparent',
      tooltip: { backgroundColor: '#0a1628', borderColor: '#00bfff30', textStyle: { color: '#aaccdd', fontSize: 11 } },
      legend: { bottom: 4, textStyle: { color: '#7aaccc', fontSize: 10 } },
      radar: {
        indicator: indicators,
        radius: '65%',
        center: ['50%', '48%'],
        axisLine: { lineStyle: { color: '#00bfff15' } },
        splitLine: { lineStyle: { color: '#00bfff10' } },
        splitArea: { areaStyle: { color: ['rgba(0,191,255,0.04)', 'rgba(0,191,255,0.02)'] } },
        name: { textStyle: { color: '#7aaccc', fontSize: 10 } },
      },
      series: [{ type: 'radar', data: series_data }],
    }
  }, [briefs])

  if (!briefs?.length) return <p className="empty-state">Vendor radar appears after brief loads.</p>

  return (
    <ReactECharts
      option={option}
      style={{ height: '260px', width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  )
}

// ── Module 5: Recommendation Ranking by Metric ─────────────────────────────
export function RecommendationRankChart({ options, sortBy = 'margin' }) {
  const option = useMemo(() => {
    if (!options?.length) return {}
    const labels = options.map((item) => item.label)
    const values = options.map((item) => {
      if (sortBy === 'risk') return item.riskScore
      if (sortBy === 'lead') return item.leadTimeDays
      if (sortBy === 'cost') return item.totalLandedCost
      return item.projectedMarginPct
    })

    const color = sortBy === 'risk'
      ? '#ff5050'
      : sortBy === 'lead'
        ? '#ffb300'
        : sortBy === 'cost'
          ? '#00e5a8'
          : '#00bfff'

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: '#0a1628',
        borderColor: '#00bfff30',
        textStyle: { color: '#aaccdd', fontSize: 11 },
      },
      grid: { left: 10, right: 10, top: 16, bottom: 44, containLabel: true },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: { color: '#7aaccc', fontSize: 10, interval: 0, rotate: 14 },
        axisLine: { lineStyle: { color: '#00bfff20' } },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          color: '#4a7a90',
          fontSize: 10,
          formatter: (v) => {
            if (sortBy === 'margin') return `${Number(v).toFixed(0)}%`
            if (sortBy === 'cost') return `$${Number(v / 1000).toFixed(1)}k`
            if (sortBy === 'lead') return `${Number(v).toFixed(0)}d`
            return Number(v).toFixed(0)
          },
        },
        splitLine: { lineStyle: { color: '#00bfff10' } },
      },
      series: [
        {
          name: sortBy,
          type: 'bar',
          data: values,
          itemStyle: {
            color,
            borderRadius: [5, 5, 0, 0],
            shadowBlur: 8,
            shadowColor: `${color}55`,
          },
          label: {
            show: true,
            position: 'top',
            color: '#aaccdd',
            fontSize: 9,
            formatter: ({ value }) => {
              if (sortBy === 'margin') return `${Number(value).toFixed(1)}%`
              if (sortBy === 'cost') return `$${Number(value).toFixed(0)}`
              if (sortBy === 'lead') return `${Number(value).toFixed(0)}d`
              return Number(value).toFixed(1)
            },
          },
        },
      ],
    }
  }, [options, sortBy])

  if (!options?.length) return <p className="empty-state">Ranking chart appears after recommendations load.</p>

  return (
    <ReactECharts
      option={option}
      style={{ height: '240px', width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  )
}

// ── Module 5: Profit vs Risk Bubble Chart ──────────────────────────────────
export function RecommendationTradeoffChart({ options }) {
  const option = useMemo(() => {
    if (!options?.length) return {}
    const points = options.map((item) => [
      item.riskScore,
      item.projectedMarginPct,
      Math.max(14, Math.min(46, 48 - item.leadTimeDays * 0.8)),
      item.label,
      item.totalLandedCost,
      item.routeLabel,
    ])

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        backgroundColor: '#0a1628',
        borderColor: '#00bfff30',
        textStyle: { color: '#aaccdd', fontSize: 11 },
        formatter: (p) => {
          const data = p.value || []
          return [
            `<b>${data[3] || 'Recommendation'}</b>`,
            `Risk Score: <b>${Number(data[0] || 0).toFixed(1)}</b>`,
            `Projected Margin: <b>${Number(data[1] || 0).toFixed(1)}%</b>`,
            `Landed Cost: <b>$${Number(data[4] || 0).toLocaleString()}</b>`,
            `Route: <b>${data[5] || '-'}</b>`,
          ].join('<br/>')
        },
      },
      grid: { left: 10, right: 12, top: 16, bottom: 38, containLabel: true },
      xAxis: {
        type: 'value',
        name: 'Risk Score',
        nameTextStyle: { color: '#4a7a90', fontSize: 10 },
        axisLabel: { color: '#7aaccc', fontSize: 10 },
        axisLine: { lineStyle: { color: '#00bfff20' } },
        splitLine: { lineStyle: { color: '#00bfff10' } },
      },
      yAxis: {
        type: 'value',
        name: 'Projected Margin %',
        nameTextStyle: { color: '#4a7a90', fontSize: 10 },
        axisLabel: { color: '#7aaccc', fontSize: 10, formatter: (v) => `${Number(v).toFixed(0)}%` },
        axisLine: { lineStyle: { color: '#00bfff20' } },
        splitLine: { lineStyle: { color: '#00bfff10' } },
      },
      series: [
        {
          type: 'scatter',
          data: points,
          symbolSize: (val) => val[2],
          itemStyle: { color: 'rgba(0,191,255,0.72)', borderColor: '#00e5ff', borderWidth: 1.2 },
          emphasis: { itemStyle: { color: '#39d353' } },
          label: {
            show: true,
            formatter: (p) => p.value?.[3] || '',
            position: 'top',
            color: '#aaccdd',
            fontSize: 9,
          },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: '#ff505060', type: 'dashed' },
            data: [{ xAxis: 50, name: 'Risk Guardrail' }],
            label: { color: '#ff7a7a', fontSize: 9 },
          },
        },
      ],
    }
  }, [options])

  if (!options?.length) return <p className="empty-state">Tradeoff chart appears after recommendations load.</p>

  return (
    <ReactECharts
      option={option}
      style={{ height: '260px', width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  )
}

// ── Module 5: Mode Mix Distribution ─────────────────────────────────────────
export function RecommendationModeMixChart({ options }) {
  const option = useMemo(() => {
    if (!options?.length) return {}
    const modeCount = options.reduce((acc, item) => {
      acc[item.routeMode] = (acc[item.routeMode] || 0) + 1
      return acc
    }, {})
    const data = Object.entries(modeCount).map(([name, value]) => ({ name: String(name).toUpperCase(), value }))

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        backgroundColor: '#0a1628',
        borderColor: '#00bfff30',
        textStyle: { color: '#aaccdd', fontSize: 11 },
      },
      legend: { bottom: 2, textStyle: { color: '#7aaccc', fontSize: 10 } },
      series: [
        {
          type: 'pie',
          radius: ['48%', '74%'],
          center: ['50%', '46%'],
          data,
          label: { color: '#aaccdd', fontSize: 10, formatter: '{b}: {d}%' },
          itemStyle: {
            borderColor: '#091626',
            borderWidth: 2,
          },
          color: ['#00bfff', '#ffb300', '#39d353', '#ff5050'],
        },
      ],
    }
  }, [options])

  if (!options?.length) return <p className="empty-state">Mode mix appears after recommendations load.</p>

  return (
    <ReactECharts
      option={option}
      style={{ height: '220px', width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  )
}

// ── Module 6: Projected vs Actual Delta View ───────────────────────────────
export function LearningDeltaBarChart({ feedback, deltas }) {
  const option = useMemo(() => {
    if (!feedback) return {}
    const categories = ['Unit Price', 'Total Cost', 'Margin %', 'Profit']
    const projected = [
      Number(feedback.predicted_unit_price || 0),
      Number(feedback.predicted_total_cost || 0),
      Number(feedback.predicted_margin_pct || 0),
      Number(feedback.predicted_profit || 0),
    ]
    const actual = [
      Number(feedback.actual_unit_price || 0),
      Number(feedback.actual_total_cost || 0),
      Number(feedback.actual_margin_pct || 0),
      Number(feedback.actual_profit || 0),
    ]

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: '#0a1628',
        borderColor: '#00bfff30',
        textStyle: { color: '#aaccdd', fontSize: 11 },
      },
      legend: { top: 2, right: 4, textStyle: { color: '#7aaccc', fontSize: 10 } },
      grid: { left: 12, right: 12, top: 30, bottom: 34, containLabel: true },
      xAxis: {
        type: 'category',
        data: categories,
        axisLabel: { color: '#7aaccc', fontSize: 10 },
        axisLine: { lineStyle: { color: '#00bfff20' } },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: '#4a7a90', fontSize: 10 },
        splitLine: { lineStyle: { color: '#00bfff10' } },
      },
      series: [
        {
          name: 'Projected',
          type: 'bar',
          data: projected,
          itemStyle: { color: 'rgba(0,191,255,0.72)', borderRadius: [4, 4, 0, 0] },
        },
        {
          name: 'Actual',
          type: 'bar',
          data: actual,
          itemStyle: { color: 'rgba(57,211,83,0.72)', borderRadius: [4, 4, 0, 0] },
          markPoint: {
            data: deltas?.profit_delta != null ? [{ type: 'max', name: 'Delta' }] : [],
            label: { color: '#aaccdd', fontSize: 9 },
          },
        },
      ],
    }
  }, [feedback, deltas])

  if (!feedback) return <p className="empty-state">Learning delta chart appears after execution feedback loads.</p>

  return (
    <ReactECharts
      option={option}
      style={{ height: '250px', width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  )
}

// ── Module 6: Decision Accuracy Trend ──────────────────────────────────────
export function DecisionAccuracyTrendChart({ decisions }) {
  const option = useMemo(() => {
    if (!decisions?.length) return {}
    const ordered = [...decisions].reverse()
    const labels = ordered.map((item, idx) => `D${idx + 1}`)
    const scores = ordered.map((item) => Number(item.accuracy_score || 0))

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#0a1628',
        borderColor: '#00bfff30',
        textStyle: { color: '#aaccdd', fontSize: 11 },
      },
      grid: { left: 12, right: 10, top: 16, bottom: 30, containLabel: true },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: { color: '#7aaccc', fontSize: 10 },
        axisLine: { lineStyle: { color: '#00bfff20' } },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        axisLabel: { color: '#4a7a90', fontSize: 10, formatter: (v) => `${Number(v).toFixed(0)}` },
        splitLine: { lineStyle: { color: '#00bfff10' } },
      },
      series: [
        {
          name: 'Outcome Accuracy',
          type: 'line',
          smooth: true,
          data: scores,
          lineStyle: { color: '#00e5a8', width: 2 },
          itemStyle: { color: '#00e5a8' },
          areaStyle: { color: 'rgba(0,229,168,0.12)' },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: '#ffb30099', type: 'dashed' },
            data: [{ yAxis: 75, name: 'Target Accuracy' }],
          },
        },
      ],
    }
  }, [decisions])

  if (!decisions?.length) return <p className="empty-state">Decision trend appears after decision history is available.</p>

  return (
    <ReactECharts
      option={option}
      style={{ height: '220px', width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  )
}

// ── Module 6: RL Calibration Radar ─────────────────────────────────────────
export function RLCalibrationRadarChart({ rlUpdates }) {
  const option = useMemo(() => {
    if (!rlUpdates) return {}
    const vendorShift = Number(Math.abs(rlUpdates?.vendor_reliability?.[0]?.delta || 0))
    const commodityDelta = Number(Math.abs(rlUpdates?.commodity_estimate_accuracy?.delta_pct || 0))
    const simBefore = rlUpdates?.simulation_calibration?.before || {}
    const simAfter = rlUpdates?.simulation_calibration?.after || {}
    const simShift = Number(
      Math.abs((simAfter.purchase_noise_pct || 0) - (simBefore.purchase_noise_pct || 0))
      + Math.abs((simAfter.logistics_noise_pct || 0) - (simBefore.logistics_noise_pct || 0))
      + Math.abs((simAfter.risk_reserve_factor || 0) - (simBefore.risk_reserve_factor || 0)) * 10
    )
    const floorShift = Number(Math.abs(rlUpdates?.negotiation_floor_adjustment_pct || 0))

    return {
      backgroundColor: 'transparent',
      tooltip: { backgroundColor: '#0a1628', borderColor: '#00bfff30', textStyle: { color: '#aaccdd', fontSize: 11 } },
      radar: {
        indicator: [
          { name: 'Vendor Reliability', max: 8 },
          { name: 'Commodity Accuracy', max: 12 },
          { name: 'Simulation Calibration', max: 12 },
          { name: 'Negotiation Floor', max: 8 },
        ],
        radius: '66%',
        center: ['50%', '52%'],
        axisLine: { lineStyle: { color: '#00bfff20' } },
        splitLine: { lineStyle: { color: '#00bfff12' } },
        splitArea: { areaStyle: { color: ['rgba(0,191,255,0.05)', 'rgba(0,191,255,0.03)'] } },
        name: { textStyle: { color: '#7aaccc', fontSize: 10 } },
      },
      series: [
        {
          type: 'radar',
          data: [
            {
              name: 'Update Magnitude',
              value: [vendorShift, commodityDelta, simShift, floorShift],
              itemStyle: { color: '#39d353' },
              lineStyle: { color: '#39d353', width: 2 },
              areaStyle: { color: 'rgba(57,211,83,0.15)' },
            },
          ],
        },
      ],
    }
  }, [rlUpdates])

  if (!rlUpdates) return <p className="empty-state">RL calibration radar appears after learning updates are computed.</p>

  return (
    <ReactECharts
      option={option}
      style={{ height: '240px', width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  )
}
