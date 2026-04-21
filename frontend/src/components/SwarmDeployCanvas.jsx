/**
 * SwarmDeployCanvas — Module 2 full redesign.
 *
 * Renders a live force-directed knowledge graph, active agents sidebar,
 * activity log, causal chain flowchart, material boost signals, and route signals
 * after the user triggers "Trigger Event + Deploy AI Swarm" on Page 2.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { BaseEdge, Background, Handle, MarkerType, Panel, Position, ReactFlow, getBezierPath } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8003'

// ── Agent definitions ─────────────────────────────────────────────────────────
const SWARM_AGENTS = [
  { id: 'dataloader', name: 'DataLoader',  color: '#00bfff', startDelay: 0,    duration: 1800, role: 'Ingesting BOM + order context' },
  { id: 'research',   name: 'Research',    color: '#39d353', startDelay: 800,   duration: 2600, role: 'Scanning live disruption signals' },
  { id: 'sentinel',   name: 'Sentinel',    color: '#ff6080', startDelay: 2000,  duration: 2200, role: 'Evaluating route & supplier risk' },
  { id: 'pricer',     name: 'Pricer',      color: '#ffbe68', startDelay: 3000,  duration: 3000, role: 'Computing price impact deltas' },
  { id: 'scorer',     name: 'Scorer',      color: '#a78bfa', startDelay: 4400,  duration: 2500, role: 'Scoring vendor resilience' },
  { id: 'sourcing',   name: 'Sourcing',    color: '#50fa7b', startDelay: 5600,  duration: 2800, role: 'Evaluating sourcing alternatives' },
  { id: 'advisor',    name: 'Advisor',     color: '#ffd700', startDelay: 7600,  duration: 2500, role: 'Synthesizing decision recommendation' },
]
const SWARM_COMPLETE_MS = Math.max(...SWARM_AGENTS.map(a => a.startDelay + a.duration)) // ~10100

const AGENT_LOG_MESSAGES = {
  dataloader: [
    'BOM loaded — {count} components, order {sku}',
    'Margin floor anchored at {margin}%',
    'Order context hydrated — DataLoader ✓',
  ],
  research: [
    'RSS scan: {count} articles indexed for {event}',
    'Live signal: {commodity} +{pct}% (7-day)',
    'Corridor watch flag raised on {corridor}',
  ],
  sentinel: [
    'Route risk elevated: {corridor}',
    'Vendor capacity loss: {vendor} at {pct}%',
    'Geo-risk threshold breached in {region}',
  ],
  pricer: [
    'Tariff delta: +{pct}% on {country} sourcing',
    'Freight multiplier: {mult}x on disrupted lane',
    'Blended impact: +${delta} per order',
  ],
  scorer: [
    'Vendor ranked: {vendor} score {score}/100',
    'Runway emergency profile: {days}d remaining',
    'Tier shift: {tier} vendors elevated',
  ],
  sourcing: [
    'Alt route confirmed: {route}',
    'Fallback vendor: {vendor} ({country})',
    'Lead-time swing: +{days}d with alt sourcing',
  ],
  advisor: [
    'Consensus: Scenario {scenario} recommended',
    'Decision confidence: {confidence}%',
    'Action window: {days}d before stockout cascade',
  ],
}

const FILL_VALUES = {
  count: '4', sku: 'OptiPlex-7090', margin: '22', event: 'Disruption', commodity: 'Helium',
  pct: '18', corridor: 'Red Sea', vendor: 'AUO Corp', region: 'SE Asia', country: 'CN',
  mult: '1.4', delta: '128K', score: '73', days: '14', tier: 'nearshore', route: 'Seoul→Dallas',
  scenario: 'B', confidence: '87', total: '3',
}

function fillTemplate(tpl, vals) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vals[k] ?? k)
}

// ── Node type styles ──────────────────────────────────────────────────────────
const NODE_STYLE = {
  demand:     { bg: '#250810', border: '#ff4060', text: '#ff8090', radius: '50%', glow: '#ff406060' },
  component:  { bg: '#081828', border: '#00bfff', text: '#7ddcff', radius: '50%', glow: '#00bfff40' },
  nearshore:  { bg: '#081a0e', border: '#39d353', text: '#80ee90', radius: '50%', glow: '#39d35340' },
  friendshore:{ bg: '#081a1a', border: '#00d4aa', text: '#60eecc', radius: '50%', glow: '#00d4aa40' },
  domestic:   { bg: '#081220', border: '#4488ff', text: '#88aaff', radius: '50%', glow: '#4488ff40' },
  port:       { bg: '#12121e', border: '#6a7a90', text: '#9aaccc', radius: '6px', glow: '#6a7a9030' },
  carrier:    { bg: '#1e150a', border: '#ff8c00', text: '#ffaa44', radius: '50%', glow: '#ff8c0040' },
  risk:       { bg: '#200808', border: '#ff3333', text: '#ff7777', radius: '6px', glow: '#ff333340' },
}

// ── Graph data builders ───────────────────────────────────────────────────────
function buildGraphNodes(eventId, orderContext, impactData) {
  const nodes = []
  // Central demand node
  nodes.push({ id: 'demand-hq', nodeType: 'demand', label: 'Dell HQ\nDemand', revealOrder: 0 })

  // BOM components
  const bom = orderContext?.bom?.components || []
  bom.slice(0, 5).forEach((c, i) => {
    nodes.push({ id: c.component_id, nodeType: 'component', label: c.component_name?.replace(' ', '\n') || c.component_id, revealOrder: 1 + i })
  })

  // Vendors from disruption impact data
  const impactedVendors = impactData?.impacted_vendors || []
  const seen = new Set()
  let vOrder = 1 + bom.length
  impactedVendors.slice(0, 8).forEach((v) => {
    if (seen.has(v.vendor_id)) return
    seen.add(v.vendor_id)
    const tierMap = { domestic: 'domestic', nearshore: 'nearshore', 'friend-shore': 'friendshore' }
    const nodeType = tierMap[v.tier] || 'friendshore'
    nodes.push({ id: v.vendor_id, nodeType, label: (v.vendor_name || v.vendor_id).slice(0, 14), country: v.country, revealOrder: vOrder++ })
  })

  // Ports / hubs from impacted routes
  const impactedRoutes = impactData?.impacted_routes || []
  const seenPorts = new Set()
  let pOrder = vOrder
  impactedRoutes.slice(0, 4).forEach((r) => {
    const portId = `port-${r.route_id || r.vendor_id || pOrder}`
    if (seenPorts.has(portId)) return
    seenPorts.add(portId)
    const portLabel = r.mode === 'air' ? 'Air\nHub' : 'Sea\nPort'
    nodes.push({ id: portId, nodeType: 'port', label: portLabel, revealOrder: pOrder++ })
  })

  // Carriers
  const modes = [...new Set(impactedRoutes.map(r => r.mode).filter(Boolean))].slice(0, 2)
  modes.forEach((mode, i) => {
    nodes.push({ id: `carrier-${mode}`, nodeType: 'carrier', label: `${mode.charAt(0).toUpperCase() + mode.slice(1)}\nFreight`, revealOrder: pOrder + i })
  })
  pOrder += modes.length

  // Risk zones — event-specific
  const riskLabels = {
    'hormuz-closure':      ['Strait of\nHormuz', 'Red Sea\nRisk', 'Insurance\nSpike'],
    'us-china-tariff':     ['Tariff\nZone', 'CN Export\nRisk', 'Margin\nPressure'],
    'taiwan-earthquake':   ['Seismic\nZone', 'Fab\nOutage', 'Wafer\nShortage'],
    'us-china-trade-war':  ['Export\nControls', 'Policy\nRisk', 'Route\nBlock'],
    'malaysia-floods':     ['Flood\nZone', 'Port\nClosure', 'Labor\nRisk'],
    'tsmc-factory-fire':   ['Factory\nFire', 'Fab\nOutage', 'Wafer\nShortage'],
  }
  const risks = riskLabels[eventId] || ['Risk Zone 1', 'Risk Zone 2', 'Risk Zone 3']
  risks.slice(0, 3).forEach((label, i) => {
    nodes.push({ id: `risk-${i}`, nodeType: 'risk', label, revealOrder: pOrder + i })
  })

  return nodes
}

function buildGraphEdges(nodes, impactData) {
  const edges = []
  const byType = (t) => nodes.filter(n => n.nodeType === t)
  const byTypes = (...ts) => nodes.filter(n => ts.includes(n.nodeType))

  const components = byType('component')
  const vendors = byTypes('nearshore', 'friendshore', 'domestic')
  const ports = byType('port')
  const carriers = byType('carrier')
  const impactedVendors = impactData?.impacted_vendors || []

  // component → demand
  components.forEach(c => {
    edges.push({ id: `e-${c.id}-demand`, source: c.id, target: 'demand-hq', edgeType: 'active' })
  })

  // vendor → component
  vendors.forEach((v, i) => {
    const target = components[i % Math.max(1, components.length)]
    const impV = impactedVendors.find(iv => iv.vendor_id === v.id)
    const blocked = impV && (impV.price_impact_pct || 0) > 25
    edges.push({ id: `e-${v.id}-${target?.id || 'demand-hq'}`, source: v.id, target: target?.id || 'demand-hq', edgeType: blocked ? 'blocked' : 'active' })
  })

  // port → vendor
  ports.forEach((p, i) => {
    const vendor = vendors[i % Math.max(1, vendors.length)]
    if (vendor) edges.push({ id: `e-${p.id}-${vendor.id}`, source: p.id, target: vendor.id, edgeType: 'research' })
  })

  // carrier → port
  carriers.forEach((c, i) => {
    const port = ports[i % Math.max(1, ports.length)]
    if (port) edges.push({ id: `e-${c.id}-${port.id}`, source: c.id, target: port.id, edgeType: 'active' })
  })

  return edges
}

// Seed nodes on rings first, then run a lightweight force simulation for Neo4j-style spacing.
function computeLayout(nodes, edges) {
  const cx = 460, cy = 290
  const rings = {
    demand:     nodes.filter(n => n.nodeType === 'demand'),
    component:  nodes.filter(n => n.nodeType === 'component'),
    vendor:     nodes.filter(n => ['nearshore','friendshore','domestic'].includes(n.nodeType)),
    portcarrier:nodes.filter(n => ['port','carrier'].includes(n.nodeType)),
    risk:       nodes.filter(n => n.nodeType === 'risk'),
  }
  const radii = { demand: 0, component: 130, vendor: 250, portcarrier: 370, risk: 450 }
  const positions = {}

  Object.entries(rings).forEach(([key, rNodes]) => {
    const r = radii[key]
    if (!rNodes.length) return
    if (r === 0) {
      const centerNode = rNodes[0]
      if (centerNode?.id) positions[centerNode.id] = { x: cx - 40, y: cy - 20 }
      return
    }
    const step = (2 * Math.PI) / rNodes.length
    const offset = key === 'risk' ? Math.PI / 6 : 0
    rNodes.forEach((n, i) => {
      const angle = offset + i * step
      positions[n.id] = { x: Math.round(cx + r * Math.cos(angle)) - 40, y: Math.round(cy + r * Math.sin(angle)) - 20 }
    })
  })

  const nodeIndex = new Map(nodes.map((n, idx) => [n.id, idx]))
  const points = nodes.map((n) => {
    const p = positions[n.id] || { x: cx, y: cy }
    return {
      id: n.id,
      nodeType: n.nodeType,
      x: p.x,
      y: p.y,
      vx: 0,
      vy: 0,
      fixed: n.nodeType === 'demand',
    }
  })

  const edgeList = (edges || []).map((e) => {
    const s = nodeIndex.get(e.source)
    const t = nodeIndex.get(e.target)
    if (s == null || t == null) return null
    const targetLen = e.edgeType === 'blocked' ? 210 : e.edgeType === 'research' ? 190 : 175
    return { s, t, targetLen }
  }).filter(Boolean)

  const repulsion = 94000
  const springK = 0.015
  const centerPull = 0.007
  const damping = 0.86
  const maxStep = 8
  const minX = 50
  const maxX = 860
  const minY = 40
  const maxY = 520

  for (let step = 0; step < 180; step++) {
    // Repulsive force between every pair of nodes.
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i]
        const b = points[j]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const distSq = Math.max(90, dx * dx + dy * dy)
        const dist = Math.sqrt(distSq)
        const force = repulsion / distSq
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        if (!a.fixed) { a.vx -= fx; a.vy -= fy }
        if (!b.fixed) { b.vx += fx; b.vy += fy }
      }
    }

    // Spring attraction along edges.
    for (const e of edgeList) {
      const a = points[e.s]
      const b = points[e.t]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy))
      const pull = (dist - e.targetLen) * springK
      const fx = (dx / dist) * pull
      const fy = (dy / dist) * pull
      if (!a.fixed) { a.vx += fx; a.vy += fy }
      if (!b.fixed) { b.vx -= fx; b.vy -= fy }
    }

    // Gentle pull to center and integrate velocity.
    for (const p of points) {
      if (p.fixed) {
        p.x = cx - 40
        p.y = cy - 20
        p.vx = 0
        p.vy = 0
        continue
      }
      p.vx += (cx - p.x) * centerPull * 0.5
      p.vy += (cy - p.y) * centerPull
      p.vx *= damping
      p.vy *= damping
      p.vx = Math.max(-maxStep, Math.min(maxStep, p.vx))
      p.vy = Math.max(-maxStep, Math.min(maxStep, p.vy))
      p.x = Math.max(minX, Math.min(maxX, p.x + p.vx))
      p.y = Math.max(minY, Math.min(maxY, p.y + p.vy))
    }
  }

  points.forEach((p) => {
    positions[p.id] = { x: Math.round(p.x), y: Math.round(p.y) }
  })

  return positions
}

function NeoNode({ data }) {
  const liveClass = data.visible ? 'visible' : 'hidden'
  return (
    <div className={`swarm-neo-node ${data.nodeType} ${liveClass}`}>
      {/* Invisible handles keep edge anchors reliable for custom nodes in ReactFlow */}
      <Handle type="target" position={Position.Top} style={{ opacity: 0, width: 2, height: 2 }} />
      <Handle type="target" position={Position.Left} style={{ opacity: 0, width: 2, height: 2 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0, width: 2, height: 2 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, width: 2, height: 2 }} />
      <div className="swarm-neo-core" />
      <div className="swarm-neo-aura" />
      <div className="swarm-neo-content">
        <span className="swarm-neo-kind">{data.kindLabel}</span>
        <strong className="swarm-neo-label">{data.label}</strong>
        {data.country ? <span className="swarm-neo-meta">{data.country}</span> : null}
      </div>
    </div>
  )
}

function NeoEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data }) {
  const [edgePath] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  const edgeType = data?.edgeType || 'active'
  const visible = data?.visible
  const edgeClass = `swarm-neo-edge ${edgeType} ${visible ? 'visible' : 'hidden'}`
  return (
    <>
      <BaseEdge id={`${id}-glow`} path={edgePath} className={`${edgeClass} glow`} />
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} className={edgeClass} />
    </>
  )
}

const KIND_LABELS = {
  demand: 'Demand Node',
  component: 'SKU / Component',
  nearshore: 'Nearshore Supplier',
  friendshore: 'Friend-shore Supplier',
  domestic: 'Domestic Supplier',
  port: 'Port / Hub',
  carrier: 'Carrier',
  risk: 'Risk Zone',
}

function mapInteractionGraphToSwarm(interactionGraph) {
  const fallbackNodes = (interactionGraph?.nodes || []).filter((n) => n && n.id).map((n, idx) => ({
    id: n.id,
    nodeType: idx === 0 ? 'demand' : (idx % 3 === 0 ? 'risk' : idx % 2 === 0 ? 'port' : 'component'),
    label: n.label || n.id,
    revealOrder: idx,
  }))
  const fallbackEdges = (interactionGraph?.edges || []).filter((e) => e && e.source && e.target).map((e, idx) => ({
    id: e.id || `ie-${idx}`,
    source: e.source,
    target: e.target,
    edgeType: e.type === 'blocked' ? 'blocked' : e.type === 'research' ? 'research' : 'active',
  }))
  return { nodes: fallbackNodes, edges: fallbackEdges }
}

function inflateSparseTopology(nodes, edges) {
  const safeNodes = (nodes || []).filter((n) => n && n.id)
  const safeEdges = (edges || []).filter((e) => e && e.source && e.target)
  if ((safeNodes.length || 0) >= 12) return { nodes: safeNodes, edges: safeEdges }

  const existingIds = new Set(safeNodes.map((n) => n.id))
  const extraNodes = []
  const extraEdges = []
  let order = safeNodes.reduce((m, n) => Math.max(m, Number(n.revealOrder || 0)), 0) + 1
  const components = safeNodes.filter((n) => n.nodeType === 'component')
  const ports = safeNodes.filter((n) => n.nodeType === 'port')

  components.forEach((c, idx) => {
    const supplierId = `synthetic-supplier-${idx + 1}`
    if (!existingIds.has(supplierId)) {
      extraNodes.push({
        id: supplierId,
        nodeType: idx % 2 === 0 ? 'nearshore' : 'friendshore',
        label: idx % 2 === 0 ? 'Nearshore\nAlt Supplier' : 'Friendshore\nAlt Supplier',
        revealOrder: order++,
      })
      existingIds.add(supplierId)
    }
    extraEdges.push({ id: `se-${supplierId}-${c.id}`, source: supplierId, target: c.id, edgeType: 'active' })

    const fallbackPortId = ports[idx % Math.max(1, ports.length)]?.id || 'synthetic-port-main'
    if (!existingIds.has(fallbackPortId) && fallbackPortId === 'synthetic-port-main') {
      extraNodes.push({ id: fallbackPortId, nodeType: 'port', label: 'Global\nHub', revealOrder: order++ })
      existingIds.add(fallbackPortId)
    }
    extraEdges.push({ id: `se-${fallbackPortId}-${supplierId}`, source: fallbackPortId, target: supplierId, edgeType: 'research' })
  })

  const riskSeed = safeNodes.some((n) => n.nodeType === 'risk')
  if (!riskSeed) {
    const riskId = 'synthetic-risk-zone'
    if (!existingIds.has(riskId)) {
      extraNodes.push({ id: riskId, nodeType: 'risk', label: 'Macro\nRisk Zone', revealOrder: order++ })
      existingIds.add(riskId)
    }
    const attachTo = components[0]?.id || safeNodes[0]?.id
    if (attachTo) extraEdges.push({ id: `se-${riskId}-${attachTo}`, source: riskId, target: attachTo, edgeType: 'blocked' })
  }

  return {
    nodes: [...safeNodes, ...extraNodes],
    edges: [...safeEdges, ...extraEdges],
  }
}

// ── ReactFlow node/edge converters ────────────────────────────────────────────
function toRFNodes(nodes, positions, revealedIds) {
  return (nodes || []).filter((n) => n && n.id).map(n => {
    const visible = revealedIds.has(n.id)
    return {
      id: n.id,
      type: 'neoNode',
      position: positions[n.id] || { x: 200, y: 200 },
      data: {
        label: n.label,
        nodeType: n.nodeType,
        country: n.country,
        visible,
        kindLabel: KIND_LABELS[n.nodeType] || 'Entity',
      },
      selectable: visible,
      draggable: false,
    }
  })
}

function toRFEdges(edges, revealedIds) {
  const styleDefs = {
    active:   { stroke: '#00bfff', dash: 'none', opacity: 0.65, animated: true },
    blocked:  { stroke: '#ff4060', dash: '6 3', opacity: 0.9, animated: false },
    research: { stroke: '#ff8c00', dash: '4 4', opacity: 0.55, animated: false },
  }
  return (edges || []).filter((e) => e && e.id && e.source && e.target).map(e => {
    const visible = revealedIds.has(e.source) && revealedIds.has(e.target)
    const s = styleDefs[e.edgeType] || styleDefs.active
    return {
      id: e.id,
      type: 'neoEdge',
      source: e.source,
      target: e.target,
      animated: s.animated && visible,
      markerEnd: { type: MarkerType.ArrowClosed, color: s.stroke, width: 8, height: 8 },
      data: { edgeType: e.edgeType, visible },
      style: {
        stroke: s.stroke,
        strokeDasharray: s.dash,
        strokeWidth: 1.5,
        opacity: visible ? s.opacity : 0,
      },
    }
  })
}

// ── CausalChainFlow ───────────────────────────────────────────────────────────
function CausalChainFlow({ chain, eventId }) {
  const defaultChain = [
    { stage: 'Event', name: eventId?.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'Disruption', color: '#ff4060', confidence: 95 },
    { stage: 'Price Impact', name: 'Cost Stack Change', color: '#ffbe68', confidence: 84 },
    { stage: 'Supply Reduction', name: 'Capacity Contraction', color: '#ffd700', confidence: 78 },
    { stage: 'Stockout Risk', name: 'Stockout Probability', color: '#ff6080', confidence: 70 },
  ]
  const items = chain?.length
    ? chain.map((c, i) => ({ stage: c.stage || `Step ${i + 1}`, name: c.description || c.name || c, color: defaultChain[i]?.color || '#00bfff', confidence: c.confidence ?? (92 - i * 7) }))
    : defaultChain

  return (
    <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, minWidth: items.length * 168, padding: '4px 2px' }}>
        {items.map((n, i) => {
          const arcConfidence = items[i + 1]?.confidence ?? n.confidence
          const arcWidth = 1.6 + (Math.max(0, Math.min(100, Number(arcConfidence || 0))) / 100) * 4.8
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + i * 0.1 }}
                style={{
                  background: `${n.color}12`,
                  border: `1px solid ${n.color}55`,
                  borderRadius: 8,
                  padding: '10px 14px',
                  minWidth: 136,
                  textAlign: 'center',
                  cursor: 'default',
                }}
              >
                <div style={{ color: n.color, fontSize: '0.65rem', fontFamily: 'SF Mono, monospace', marginBottom: 3, opacity: 0.8 }}>{n.stage}</div>
                <div style={{ color: '#dbe9ff', fontSize: '0.72rem', fontWeight: 600, lineHeight: 1.3 }}>{n.name}</div>
                <div style={{ color: n.color, fontSize: '0.62rem', marginTop: 5, fontFamily: 'SF Mono, monospace' }}>{n.confidence ?? '--'}% conf</div>
              </motion.div>
              {i < items.length - 1 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.35 + i * 0.1 }}
                  style={{ width: 42, height: 26, margin: '0 4px' }}
                  aria-hidden="true"
                >
                  <svg width="42" height="26" viewBox="0 0 42 26">
                    <path
                      d="M2 20 C 14 4, 28 4, 40 20"
                      fill="none"
                      stroke="#4f87b0"
                      strokeWidth={arcWidth}
                      strokeLinecap="round"
                      opacity="0.88"
                    />
                  </svg>
                </motion.div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Material Boost Signal cards ───────────────────────────────────────────────
function MaterialBoostCards({ components, amplifications, onAmplificationChange }) {
  if (!components?.length) return null
  return (
    <div className="swarm-signal-cards">
      {components.slice(0, 6).map(c => {
        const amp = amplifications[c.component_id] ?? c.price_impact_pct ?? 0
        const approved = amp > 0
        return (
          <motion.div
            key={c.component_id}
            className="swarm-signal-card"
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            style={{ borderColor: approved ? 'rgba(255,156,77,0.45)' : 'rgba(0,191,255,0.2)' }}
          >
            {approved && (
              <span className="swarm-badge-approved">APPROVED</span>
            )}
            <div className="swarm-signal-label">{c.component_name}</div>
            <div className="swarm-signal-value" style={{ color: '#ff9c4d' }}>+{Number(amp).toFixed(1)}%</div>
            <div className="swarm-signal-sub">risk amplification</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}>
              <input
                type="range" min="0" max="60" step="0.5" value={amp}
                onChange={e => onAmplificationChange(c.component_id, Number(e.target.value))}
                style={{ flex: 1, accentColor: '#ff9c4d', height: 3 }}
              />
              <button
                className="swarm-reset-btn"
                onClick={() => onAmplificationChange(c.component_id, c.price_impact_pct ?? 0)}
              >Reset</button>
            </div>
          </motion.div>
        )
      })}
    </div>
  )
}

// ── Route Signal cards ────────────────────────────────────────────────────────
const EVENT_ROUTE_SIGNALS = {
  'hormuz-closure':     [{ route: 'Dubai → Rotterdam via Suez',  keywords: ['red sea', 'hormuz', 'suez'],               risk: 'BLOCKED'  }, { route: 'Dubai → Rotterdam via Cape', keywords: ['cape of good hope', 'reroute', '+14d'],    risk: 'DEGRADED' }],
  'us-china-tariff':    [{ route: 'Shanghai → Los Angeles',      keywords: ['cn tariff', '145%', 'customs hold'],        risk: 'COST+'    }, { route: 'Shanghai → KL re-export',    keywords: ['transshipment', 'origin rules', 'audit'], risk: 'WATCH'    }],
  'taiwan-earthquake':  [{ route: 'Kaohsiung → Los Angeles',     keywords: ['fab outage', 'taiwan risk', 'allocation'], risk: 'DEGRADED' }, { route: 'Anchorage → Dallas (Air)',   keywords: ['korea backup', 'north pacific air'],      risk: 'ACTIVE'   }],
  'malaysia-floods':    [{ route: 'Port Klang → Dallas',         keywords: ['flood', 'port closure', 'delay'],           risk: 'BLOCKED'  }, { route: 'Kaohsiung → Los Angeles',    keywords: ['nearshore', 'taiwan backup'],              risk: 'ACTIVE'   }],
  'tsmc-factory-fire':  [{ route: 'Kaohsiung → Los Angeles',     keywords: ['tsmc', 'fab fire', 'wafer', 'alloc'],       risk: 'DEGRADED' }, { route: 'Seoul → Dallas (Air)',        keywords: ['korea backup', 'air freight', 'premium'], risk: 'ACTIVE'   }],
  'us-china-trade-war': [{ route: 'Shanghai → Los Angeles',      keywords: ['export controls', 'bis', 'classification'], risk: 'BLOCKED'  }, { route: 'Vietnam → Los Angeles',      keywords: ['vietnam', 'alternative', 'ramp 3wk'],     risk: 'WATCH'    }],
}
const RISK_COLOR = { BLOCKED: '#ff4060', DEGRADED: '#ffbe68', WATCH: '#a78bfa', ACTIVE: '#39d353', 'COST+': '#ff9c4d' }
const ROUTE_SEVERITY = { BLOCKED: 92, DEGRADED: 68, 'COST+': 58, WATCH: 34, ACTIVE: 12 }

function inferBlockedCorridors(routeSignals) {
  const map = {
    'red sea': 'red-sea',
    hormuz: 'hormuz',
    suez: 'suez',
    'south china sea': 'south-china-sea',
    pacific: 'pacific-sea',
    malacca: 'malacca-strait',
  }
  const blocked = new Set()
  routeSignals.forEach((signal) => {
    const risk = String(signal?.risk || '').toUpperCase()
    if (risk !== 'BLOCKED') return
    const haystack = `${signal.route || ''} ${(signal.keywords || []).join(' ')}`.toLowerCase()
    Object.entries(map).forEach(([needle, corridorId]) => {
      if (haystack.includes(needle)) blocked.add(corridorId)
    })
  })
  return Array.from(blocked)
}

function RouteSignalCards({ eventId }) {
  const signals = EVENT_ROUTE_SIGNALS[eventId] || []
  if (!signals.length) return null
  return (
    <div className="swarm-signal-cards">
      {signals.map((s, i) => (
        <motion.div
          key={i} className="swarm-signal-card"
          initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.12 }}
          style={{ borderColor: `${RISK_COLOR[s.risk] || '#00bfff'}40` }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
            <div className="swarm-signal-label" style={{ color: '#dbe9ff', marginBottom: 0 }}>{s.route}</div>
            <span className="swarm-risk-badge" style={{ background: `${RISK_COLOR[s.risk] || '#00bfff'}20`, color: RISK_COLOR[s.risk] || '#00bfff', borderColor: `${RISK_COLOR[s.risk] || '#00bfff'}50` }}>{s.risk}</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {s.keywords.map((kw, ki) => (
              <span key={ki} className="swarm-kw-chip">{kw}</span>
            ))}
          </div>
        </motion.div>
      ))}
    </div>
  )
}

// ── Agents sidebar ────────────────────────────────────────────────────────────
function AgentsPanel({ progress, runStatus, agentNarratives }) {
  const [expandedByAgent, setExpandedByAgent] = useState({})

  return (
    <div className="swarm-agents-panel">
      <div className="swarm-panel-title">Active Agents</div>
      {SWARM_AGENTS.map(agent => {
        const pct = progress[agent.id] ?? 0
        const done = pct >= 100
        const running = pct > 0 && !done
        const narrative = agentNarratives?.[agent.id]
        const text = String(narrative?.text || '')
        const textLineEstimate = Math.max((text.match(/\n/g) || []).length + 1, Math.ceil(text.length / 96))
        const needsExpand = textLineEstimate > 3
        const expanded = Boolean(expandedByAgent[agent.id])
        const previewText = needsExpand && !expanded ? `${text.slice(0, 280)}...` : text
        const completedAt = narrative?.completedAt || null

        return (
          <div key={agent.id} className="swarm-agent-row">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: agent.color, boxShadow: running ? `0 0 8px 2px ${agent.color}` : `0 0 8px 1px ${agent.color}66`, flexShrink: 0 }} />
                <span style={{ color: '#b8d4e8', fontSize: '0.72rem', fontWeight: 600, fontFamily: 'SF Mono, monospace' }}>{agent.name}</span>
              </div>
              <span className={`swarm-status-badge ${done ? 'done' : running ? 'running' : 'idle'}`}>
                {done ? 'DONE' : running ? 'RUNNING' : 'IDLE'}
              </span>
            </div>
            {!done && (
              <div className="swarm-progress-track">
                <motion.div
                  className="swarm-progress-fill"
                  animate={{ width: `${pct}%`, background: `${agent.color}cc` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            )}
            {!done && (running || pct > 0) && (
              <div style={{ color: '#4a7a90', fontSize: '0.62rem', marginTop: 4, fontFamily: 'SF Mono, monospace' }}>{agent.role}</div>
            )}
            {done && text && (
              <motion.div
                className="swarm-speech-bubble"
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.28, ease: 'easeOut' }}
              >
                <div className="swarm-speech-head">
                  <div className="swarm-speech-avatar" style={{ background: agent.color }} />
                  <strong>{agent.name}</strong>
                  <span>{completedAt ? `Completed ${completedAt}` : 'Completed'}</span>
                </div>
                <p>{previewText}</p>
                {needsExpand && (
                  <button
                    className="swarm-reasoning-toggle"
                    onClick={() => setExpandedByAgent((prev) => ({ ...prev, [agent.id]: !expanded }))}
                  >
                    {expanded ? 'Collapse reasoning' : 'Show full reasoning'}
                  </button>
                )}
              </motion.div>
            )}
          </div>
        )
      })}
      {runStatus && (
        <div style={{ marginTop: 8, padding: '6px 8px', background: 'rgba(0,191,255,0.05)', borderRadius: 6, fontSize: '0.65rem', color: '#4a7a90', fontFamily: 'SF Mono, monospace' }}>
          Run: {runStatus.status?.toUpperCase()} · {runStatus.progress ?? 0}%
        </div>
      )}
    </div>
  )
}

// ── Activity log ──────────────────────────────────────────────────────────────
function ActivityLog({ entries }) {
  const logRef = useRef(null)
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [entries.length])

  return (
    <div className="swarm-activity-log" ref={logRef}>
      <div className="swarm-panel-title">Activity Log</div>
      {entries.length === 0 && <div style={{ color: '#2a4a6a', fontSize: '0.65rem', fontFamily: 'SF Mono, monospace', padding: '4px 0' }}>Awaiting agent output…</div>}
      {entries.map((e, i) => {
        const agent = SWARM_AGENTS.find(a => a.id === e.agentId)
        return (
          <div key={i} style={{ marginBottom: 4, lineHeight: 1.4 }}>
            <span style={{ color: '#2a4a6a', fontSize: '0.6rem', fontFamily: 'SF Mono, monospace' }}>{e.ts} </span>
            <span style={{ color: agent?.color || '#00bfff', fontSize: '0.62rem', fontFamily: 'SF Mono, monospace', fontWeight: 700 }}>[{agent?.name || e.agentId}] </span>
            <span style={{ color: '#7aaccc', fontSize: '0.65rem', fontFamily: 'SF Mono, monospace' }}>{e.msg}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Graph legend ──────────────────────────────────────────────────────────────
function GraphLegend() {
  const nodeTypes = [
    { label: 'SKU / Component', color: '#00bfff' }, { label: 'Nearshore Supplier', color: '#39d353' },
    { label: 'Friend-shore Supplier', color: '#00d4aa' }, { label: 'Domestic Supplier', color: '#4488ff' },
    { label: 'Port / Hub', color: '#6a7a90' }, { label: 'Carrier', color: '#ff8c00' },
    { label: 'Risk Zone', color: '#ff3333' }, { label: 'Dell HQ Demand', color: '#ff4060' },
  ]
  const edgeTypes = [
    { label: 'Active route', color: '#00bfff', dash: 'none' },
    { label: 'Blocked route', color: '#ff4060', dash: '6 3' },
    { label: 'Research signal', color: '#ff8c00', dash: '4 4' },
  ]
  return (
    <div className="swarm-graph-legend">
      {nodeTypes.map(t => (
        <div key={t.label} className="swarm-legend-item">
          <div style={{ width: 9, height: 9, borderRadius: '50%', background: t.color, opacity: 0.85, flexShrink: 0 }} />
          <span>{t.label}</span>
        </div>
      ))}
      {edgeTypes.map(t => (
        <div key={t.label} className="swarm-legend-item">
          <svg width="20" height="10" style={{ flexShrink: 0 }}>
            <line x1="0" y1="5" x2="20" y2="5" stroke={t.color} strokeWidth="1.5" strokeDasharray={t.dash} />
          </svg>
          <span>{t.label}</span>
        </div>
      ))}
    </div>
  )
}

function SwarmConsensusBar({ agentNarratives, runStatus }) {
  const [hoveredVote, setHoveredVote] = useState(null)
  const verdict = runStatus?.judge_verdict || {}
  const recommendation = verdict?.verdict || 'Advisor recommendation active.'
  const dissentSummary = verdict?.dissent_summary || verdict?.dissenting_voice?.message || verdict?.dissenting_voice || verdict?.dissent || ''

  const votes = useMemo(() => SWARM_AGENTS.map((agent) => {
    const text = String(agentNarratives?.[agent.id]?.text || '').toLowerCase()
    let stance = 'agree'
    if (agent.id === 'advisor') {
      stance = 'agree'
    } else if (/(dissent|disagree|overstat|contradict|reject|oppose|not\s+supported)/i.test(text)) {
      stance = 'dissent'
    } else if (/(partial|mixed|watch|caution|conditional|hedge|uncertain)/i.test(text)) {
      stance = 'partial'
    }

    const stanceText = stance === 'agree'
      ? `${agent.name} agrees with advisor recommendation.`
      : stance === 'partial'
        ? `${agent.name} partially agrees and requests conditional guardrails.`
        : `${agent.name} dissents: ${agentNarratives?.[agent.id]?.text || 'model assumptions differ.'}`

    return {
      id: agent.id,
      label: agent.name,
      stance,
      color: stance === 'agree' ? '#00d4aa' : stance === 'partial' ? '#ffbe68' : '#ff4060',
      text: stanceText,
    }
  }), [agentNarratives])

  const agreeCount = votes.filter((v) => v.stance === 'agree').length
  const consensusPct = Math.round((agreeCount / Math.max(1, votes.length)) * 100)
  const dissentAgent = votes.find((v) => v.stance === 'dissent')
  const summaryLine = dissentSummary
    ? `${dissentAgent?.label || 'One agent'} dissents — ${dissentSummary}`
    : consensusPct === 100
      ? 'No dissenting voices. All agents align with the recommendation.'
      : `${dissentAgent?.label || 'One agent'} dissents — model assumptions diverge from advisor baseline.`

  return (
    <div className="swarm-consensus-wrap">
      <div className="swarm-section-label" style={{ marginBottom: 6 }}>
        Swarm Consensus Breakdown
        <span className="swarm-section-hint">Segment color: teal agree · amber partial · red dissent</span>
      </div>
      <div className="swarm-consensus-card">
        <div className="swarm-consensus-bar" role="presentation">
          {votes.map((vote) => (
            <div
              key={vote.id}
              className="swarm-consensus-segment"
              style={{ background: `${vote.color}33`, borderColor: `${vote.color}80`, color: vote.color }}
              onMouseEnter={() => setHoveredVote(vote)}
              onMouseLeave={() => setHoveredVote(null)}
            >
              {vote.label}
            </div>
          ))}
        </div>
        <div className="swarm-consensus-meta">
          <div className="swarm-consensus-arc" style={{ '--consensus': `${consensusPct}%` }}>
            <strong>{consensusPct}%</strong>
            <span>consensus</span>
          </div>
          <div className="swarm-consensus-text">
            <p>{recommendation}</p>
            <p>{hoveredVote?.text || summaryLine}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function SwarmDeployCanvas({
  eventId,
  event,
  orderContext,
  disruptionImpactData,
  runId,
  isDeployed,
  isDeploying,
  runStatus,
  debateLogs,
  causalChain,
  onMaterialAmplificationsChange,
  onSwarmSignalPackChange,
  navigateToSection,
}) {
  const [phase, setPhase] = useState('idle') // idle | deploying | running | complete
  const [agentProgress, setAgentProgress] = useState({})
  const [agentNarratives, setAgentNarratives] = useState({})
  const [activityLog, setActivityLog] = useState([])
  const [revealedIds, setRevealedIds] = useState(new Set(['demand-hq']))
  const [materialAmplifications, setMaterialAmplifications] = useState({})
  const [graphApiData, setGraphApiData] = useState(null)
  const [rfInstance, setRfInstance] = useState(null)
  const deployStartRef = useRef(null)
  const progressTimerRef = useRef(null)
  const revealTimerRef = useRef(null)
  const loggedAgents = useRef(new Set())
  const revealStartedRef = useRef(false)
  const rawNodesRef = useRef([])
  const lastRunIdRef = useRef('')

  // New run bootstrap: reset animation/runtime state so first render shows live build.
  useEffect(() => {
    if (!runId) return
    if (lastRunIdRef.current === runId) return
    lastRunIdRef.current = runId

    deployStartRef.current = null
    revealStartedRef.current = false
    loggedAgents.current = new Set()
    setRevealedIds(new Set(['demand-hq']))
    setAgentProgress({})
    setAgentNarratives({})
    setActivityLog([])
    setGraphApiData(null)
    setPhase(isDeploying ? 'deploying' : 'running')
  }, [runId, isDeploying])

  // Fetch full topology from backend when triggered (richer than locally derived data)
  useEffect(() => {
    if (!isDeployed && !isDeploying) return
    fetch(`${API_BASE}/api/v2/swarm/knowledge-graph?event_id=${encodeURIComponent(eventId || 'hormuz-closure')}`)
      .then(r => r.ok ? r.json() : null)
      .then(async (data) => {
        if (data?.nodes?.length && data?.edges?.length) {
          setGraphApiData(data)
          return
        }
        // Fallback path: map interaction graph into swarm schema when topology endpoint is thin.
        const alt = await fetch(`${API_BASE}/api/v2/agents/interaction-graph?event_id=${encodeURIComponent(eventId || 'hormuz-closure')}&limit=200`)
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)
        if (alt?.nodes?.length) {
          setGraphApiData(mapInteractionGraphToSwarm(alt))
          return
        }
        if (data) setGraphApiData(data)
      })
      .catch(() => {})
  }, [isDeployed, isDeploying, eventId])

  // Derive graph data — prefer backend API topology, fall back to locally derived
  const rawNodes = useMemo(() => {
    const base = graphApiData?.nodes || buildGraphNodes(eventId, orderContext, disruptionImpactData)
    return (base || []).filter((node) => node && typeof node === 'object' && node.id)
  }, [graphApiData, eventId, orderContext, disruptionImpactData])
  const rawEdges = useMemo(() => {
    const base = graphApiData?.edges || buildGraphEdges(rawNodes, disruptionImpactData)
    return (base || []).filter((edge) => edge && edge.source && edge.target).map((edge, idx) => ({
      ...edge,
      id: edge.id || `edge-${idx}`,
    }))
  }, [graphApiData, rawNodes, disruptionImpactData])
  const stableGraph = useMemo(() => inflateSparseTopology(rawNodes, rawEdges), [rawNodes, rawEdges])

  // Mirofish-like staged force build: recompute layout as the visible frontier grows.
  const positions = useMemo(() => {
    const visible = stableGraph.nodes.filter((n) => revealedIds.has(n.id))
    if (visible.length <= 1) return computeLayout(stableGraph.nodes, stableGraph.edges)
    const visibleIds = new Set(visible.map((n) => n.id))
    const visEdges = stableGraph.edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))
    const visPos = computeLayout(visible, visEdges)
    const hiddenPos = computeLayout(stableGraph.nodes, stableGraph.edges)
    return { ...hiddenPos, ...visPos }
  }, [stableGraph.nodes, stableGraph.edges, revealedIds])

  const rfNodes = useMemo(() => toRFNodes(stableGraph.nodes, positions, revealedIds), [stableGraph.nodes, positions, revealedIds])
  const rfEdges = useMemo(() => toRFEdges(stableGraph.edges, revealedIds), [stableGraph.edges, revealedIds])
  const nodeTypes = useMemo(() => ({ neoNode: NeoNode }), [])
  const edgeTypes = useMemo(() => ({ neoEdge: NeoEdge }), [])
  const routeSignals = useMemo(() => {
    return (EVENT_ROUTE_SIGNALS[eventId] || []).map((signal) => ({
      route: signal.route,
      risk: signal.risk,
      keywords: signal.keywords || [],
      severity: ROUTE_SEVERITY[signal.risk] ?? 25,
    }))
  }, [eventId])

  // Keep camera fitted to currently revealed nodes so graph visibly builds live.
  useEffect(() => {
    if (!rfInstance) return
    if (!rfNodes.length) return
    if (phase === 'idle') return
    const visibleNodeIds = new Set(rfNodes.filter(n => n.data?.visible).map(n => n.id))
    if (!visibleNodeIds.size) return
    rfInstance.fitView({
      padding: 0.16,
      duration: 420,
      minZoom: 0.35,
      maxZoom: 1.1,
      nodes: rfNodes.filter(n => visibleNodeIds.has(n.id)),
    })
  }, [rfInstance, rfNodes, phase, revealedIds])

  // Keep ref in sync so reveal-timer closure always sees the latest node list
  useEffect(() => { rawNodesRef.current = stableGraph.nodes }, [stableGraph.nodes])

  // Phase state machine — backend completion does NOT shortcut animation to 'complete'
  useEffect(() => {
    if (!isDeploying && !isDeployed) {
      setPhase('idle')
      deployStartRef.current = null
      revealStartedRef.current = false
      setRevealedIds(new Set(['demand-hq']))
      setAgentProgress({})
      setAgentNarratives({})
      setActivityLog([])
      setGraphApiData(null)
      return
    }
    if (isDeploying && phase !== 'deploying') { setPhase('deploying'); return }
    if (!isDeploying && isDeployed && (phase === 'idle' || phase === 'deploying')) {
      setPhase('running')
      return
    }
  }, [isDeploying, isDeployed, phase])

  // Initialize material amplifications from impact data
  useEffect(() => {
    if (!disruptionImpactData?.affected_components) return
    const amps = {}
    disruptionImpactData.affected_components.forEach(c => {
      amps[c.component_id] = c.price_impact_pct ?? 0
    })
    setMaterialAmplifications(amps)
    onMaterialAmplificationsChange?.(amps)
  }, [disruptionImpactData])

  // Start progress timer when phase becomes 'running'
  useEffect(() => {
    if (phase !== 'running') return
    if (deployStartRef.current) return // already running

    deployStartRef.current = Date.now()
    loggedAgents.current = new Set()

    progressTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - deployStartRef.current
      const newProgress = {}
      SWARM_AGENTS.forEach(agent => {
        if (elapsed < agent.startDelay) newProgress[agent.id] = 0
        else if (elapsed >= agent.startDelay + agent.duration) newProgress[agent.id] = 100
        else newProgress[agent.id] = Math.round(((elapsed - agent.startDelay) / agent.duration) * 100)
      })
      // Never downgrade agents already marked 100% (e.g. by backend-complete effect)
      setAgentProgress(prev => {
        const merged = { ...newProgress }
        Object.keys(prev).forEach(k => { if ((prev[k] ?? 0) >= 100) merged[k] = 100 })
        return merged
      })

      // Log agent completions
      SWARM_AGENTS.forEach(agent => {
        if (newProgress[agent.id] >= 100 && !loggedAgents.current.has(agent.id)) {
          loggedAgents.current.add(agent.id)
          const msgs = AGENT_LOG_MESSAGES[agent.id] || []
          const completedAt = new Date().toLocaleTimeString('en-US', { hour12: false })
          msgs.forEach((tpl, ti) => {
            const ts = new Date().toLocaleTimeString('en-US', { hour12: false })
            const msg = fillTemplate(tpl, FILL_VALUES)
            setTimeout(() => {
              setActivityLog(prev => [...prev, { agentId: agent.id, msg, ts }])
            }, ti * 300)
          })
          const fallbackSpeech = msgs.length ? fillTemplate(msgs[msgs.length - 1], FILL_VALUES) : `${agent.name} completed analysis.`
          setAgentNarratives((prev) => {
            if (prev[agent.id]?.text) return prev
            return {
              ...prev,
              [agent.id]: { text: fallbackSpeech, completedAt },
            }
          })
        }
      })

      // All complete → clear timer
      if (elapsed > SWARM_COMPLETE_MS + 500) {
        clearInterval(progressTimerRef.current)
        setPhase('complete')
      }
    }, 80)

    return () => {
      clearInterval(progressTimerRef.current)
    }
  }, [phase])

  // Progressive node reveal — starts once when 'running', does NOT restart on 'complete'
  useEffect(() => {
    if (phase !== 'running') return
    if (revealStartedRef.current) return
    revealStartedRef.current = true

    let idx = 1 // demand-hq already seeded
    revealTimerRef.current = setInterval(() => {
      const sortedNodes = [...rawNodesRef.current].sort((a, b) => a.revealOrder - b.revealOrder)
      if (idx >= sortedNodes.length) { clearInterval(revealTimerRef.current); return }
      const nextNodeId = sortedNodes[idx]?.id
      if (nextNodeId) {
        setRevealedIds(prev => new Set([...prev, nextNodeId]))
      }
      idx++
    }, 420)
    return () => clearInterval(revealTimerRef.current)
  }, [phase]) // rawNodes intentionally omitted — rawNodesRef used inside closure

  // Backend completion → flash all agent bars to 100% immediately (phase stays 'running')
  useEffect(() => {
    if (runStatus?.status !== 'completed') return
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false })
    setAgentProgress(prev => {
      const full = {}
      SWARM_AGENTS.forEach(a => { full[a.id] = 100 })
      return { ...prev, ...full }
    })
    const verdictLine = runStatus?.judge_verdict?.verdict || runStatus?.judge_verdict?.dissent_summary || runStatus?.judge_verdict?.dissent || ''
    if (verdictLine) {
      setAgentNarratives((prev) => ({
        ...prev,
        advisor: {
          text: verdictLine,
          completedAt: prev.advisor?.completedAt || ts,
        },
      }))
    }
  }, [runStatus?.status, runStatus?.judge_verdict])

  // Feed debate logs into activity log
  useEffect(() => {
    if (!debateLogs?.length) return
    const last = debateLogs[debateLogs.length - 1]
    if (!last) return
    const agentMap = {
      AutoResearch: 'research', CausalGraph: 'sentinel', TimesFM: 'pricer',
      RiskScorer: 'scorer', RecEngine: 'sourcing', JudgeAgent: 'advisor',
    }
    const agentId = agentMap[last.agent] || 'dataloader'
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false })
    const fullText = String(last.message || last.summary || '...')
    setActivityLog(prev => {
      const alreadyHas = prev.some(e => e.msg === fullText && e.agentId === agentId)
      if (alreadyHas) return prev
      return [...prev, { agentId, msg: fullText, ts }]
    })
    setAgentNarratives((prev) => ({
      ...prev,
      [agentId]: {
        text: fullText,
        completedAt: prev[agentId]?.completedAt || ts,
      },
    }))
  }, [debateLogs?.length])

  const handleAmplificationChange = useCallback((componentId, value) => {
    setMaterialAmplifications(prev => {
      const next = { ...prev, [componentId]: value }
      onMaterialAmplificationsChange?.(next)
      return next
    })
  }, [onMaterialAmplificationsChange])

  useEffect(() => {
    if (!onSwarmSignalPackChange) return
    const verdict = runStatus?.judge_verdict || {}
    const dissentText = verdict?.dissenting_voice?.message || verdict?.dissenting_voice || null
    const confidence = Number(verdict?.decision_confidence ?? 75)
    const consensus = Number(verdict?.consensus_score ?? 7)
    const contradictionCount = Number(verdict?.contradiction_count ?? (dissentText ? 1 : 0))
    const evidenceStrength = Number(verdict?.evidence_strength ?? confidence)
    const dissentSummary = verdict?.dissent_summary || dissentText || null

    onSwarmSignalPackChange({
      run_id: runId || null,
      event_id: eventId,
      material_amplifications: materialAmplifications,
      route_signals: routeSignals,
      blocked_corridors: inferBlockedCorridors(routeSignals),
      judge: {
        consensus_score: Number.isFinite(consensus) ? consensus : 7,
        confidence: Number.isFinite(confidence) ? confidence : 75,
        dissent: dissentText,
        contradiction_count: Number.isFinite(contradictionCount) ? Math.max(0, contradictionCount) : 0,
        evidence_strength: Number.isFinite(evidenceStrength) ? Math.max(0, Math.min(100, evidenceStrength)) : 75,
        dissent_summary: dissentSummary,
      },
      agent_completion_pct: phase === 'complete'
        ? 100
        : Math.round((Object.values(agentProgress).reduce((sum, value) => sum + Number(value || 0), 0) / Math.max(1, SWARM_AGENTS.length)) * 10) / 10,
    })
  }, [
    agentProgress,
    eventId,
    materialAmplifications,
    onSwarmSignalPackChange,
    phase,
    routeSignals,
    runId,
    runStatus?.judge_verdict,
  ])

  const affectedComponents = disruptionImpactData?.affected_components || []

  if (phase === 'idle') return null

  return (
    <div className="swarm-deploy-canvas">
      {/* ── Graph + sidebar layout ── */}
      <div className="swarm-main-layout">
        {/* Graph area */}
        <div className="swarm-graph-area">
          <div className="swarm-graph-header">
            <span className="swarm-graph-title">Supply Chain Knowledge Graph</span>
            <span className="swarm-graph-subtitle">{rawNodes.length} nodes · {rawEdges.length} edges · building live</span>
          </div>
          <div className="swarm-graph-shell" style={{ height: 520, position: 'relative' }}>
            <div className="swarm-graph-orbit orbit-a" />
            <div className="swarm-graph-orbit orbit-b" />
            <div className="swarm-graph-orbit orbit-c" />
            <div className="swarm-graph-grid-glow" />
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
              onInit={setRfInstance}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              fitView
              fitViewOptions={{ padding: 0.15 }}
              minZoom={0.3}
              maxZoom={1.2}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              zoomOnScroll={false}
              panOnScroll={false}
              preventScrolling={false}
              panOnDrag={false}
              style={{ background: 'transparent' }}
            >
              <Background color="#0a1a2a" gap={24} size={1} />
              <Panel position="bottom-left">
                <GraphLegend />
              </Panel>
            </ReactFlow>
            {phase === 'deploying' && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(3,10,20,0.85)', gap: 12 }}>
                <div className="swarm-deploy-spinner" />
                <div style={{ color: '#00bfff', fontSize: '0.8rem', fontFamily: 'SF Mono, monospace' }}>Initializing AI Swarm…</div>
              </div>
            )}
          </div>
        </div>

        {/* Right sidebar */}
        <div className="swarm-sidebar">
          <AgentsPanel progress={agentProgress} runStatus={runStatus} agentNarratives={agentNarratives} />
          <ActivityLog entries={activityLog} />
        </div>
      </div>

      <SwarmConsensusBar agentNarratives={agentNarratives} runStatus={runStatus} />

      {/* ── CausalGraph horizontal flowchart ── */}
      <div className="swarm-sub-section">
        <div className="swarm-section-label">Causal Propagation Chain</div>
        <div className="intel-card" style={{ padding: '1rem 1.25rem' }}>
          <CausalChainFlow chain={causalChain} eventId={eventId} />
        </div>
      </div>

      {/* ── Material Boost Signals ── */}
      {affectedComponents.length > 0 && (
        <div className="swarm-sub-section">
          <div className="swarm-section-label">
            Material Boost Signals
            <span className="swarm-section-hint">Amplification values feed into Module 3 simulation weights</span>
          </div>
          <MaterialBoostCards
            components={affectedComponents}
            amplifications={materialAmplifications}
            onAmplificationChange={handleAmplificationChange}
          />
        </div>
      )}

      {/* ── Route Signals ── */}
      <div className="swarm-sub-section">
        <div className="swarm-section-label">
          Route Signals
          <span className="swarm-section-hint">Blocked and at-risk corridors feed Module 3 logistics cost model</span>
        </div>
        <RouteSignalCards eventId={eventId} />
      </div>

      {/* ── Completion banner ── */}
      <AnimatePresence>
        {phase === 'complete' && (
          <motion.div
            className="swarm-completion-banner"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.45 }}
          >
            <div>
              <div className="swarm-completion-title">Swarm Analysis Complete</div>
              <div className="swarm-completion-sub">{SWARM_AGENTS.length} agents deployed · {affectedComponents.length} material signals · graph topology mapped · staying on Module 2</div>
            </div>
            <div className="swarm-completion-pill">Simulation Lab unlocked</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
