/**
 * SwarmDeployCanvas — Module 2 full redesign.
 *
 * Renders a live force-directed knowledge graph, active agents sidebar,
 * activity log, causal chain flowchart, material boost signals, and route signals
 * after the user triggers "Trigger Event + Deploy AI Swarm" on Page 2.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ReactFlow, Background, MarkerType, Panel } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

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

// Radial layout: demand→center, components→ring1, vendors→ring2, ports+carriers→ring3, risks→ring4
function computeLayout(nodes) {
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
    if (r === 0) { positions[rNodes[0].id] = { x: cx - 40, y: cy - 20 }; return }
    const step = (2 * Math.PI) / rNodes.length
    const offset = key === 'risk' ? Math.PI / 6 : 0
    rNodes.forEach((n, i) => {
      const angle = offset + i * step
      positions[n.id] = { x: Math.round(cx + r * Math.cos(angle)) - 40, y: Math.round(cy + r * Math.sin(angle)) - 20 }
    })
  })
  return positions
}

// ── ReactFlow node/edge converters ────────────────────────────────────────────
function toRFNodes(nodes, positions, revealedIds) {
  return nodes.map(n => {
    const s = NODE_STYLE[n.nodeType] || NODE_STYLE.component
    const visible = revealedIds.has(n.id)
    return {
      id: n.id,
      position: positions[n.id] || { x: 200, y: 200 },
      data: { label: n.label },
      style: {
        background: s.bg,
        border: `1.5px solid ${s.border}`,
        color: s.text,
        borderRadius: s.radius,
        padding: '8px 12px',
        fontSize: '9.5px',
        fontFamily: 'var(--font-sans)',
        fontWeight: '600',
        boxShadow: visible ? `0 0 14px 4px ${s.glow}` : 'none',
        minWidth: '64px',
        textAlign: 'center',
        opacity: visible ? 1 : 0,
        transform: visible ? 'scale(1)' : 'scale(0.25)',
        transition: 'opacity 0.45s ease, transform 0.45s ease, box-shadow 0.45s ease',
        whiteSpace: 'pre-line',
        lineHeight: '1.35',
        pointerEvents: visible ? 'auto' : 'none',
      },
      selectable: visible,
    }
  })
}

function toRFEdges(edges, revealedIds) {
  const styleDefs = {
    active:   { stroke: '#00bfff', dash: 'none', opacity: 0.65, animated: true },
    blocked:  { stroke: '#ff4060', dash: '6 3', opacity: 0.9, animated: false },
    research: { stroke: '#ff8c00', dash: '4 4', opacity: 0.55, animated: false },
  }
  return edges.map(e => {
    const visible = revealedIds.has(e.source) && revealedIds.has(e.target)
    const s = styleDefs[e.edgeType] || styleDefs.active
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      animated: s.animated && visible,
      markerEnd: { type: MarkerType.ArrowClosed, color: s.stroke, width: 8, height: 8 },
      style: {
        stroke: s.stroke,
        strokeDasharray: s.dash,
        strokeWidth: 1.5,
        opacity: visible ? s.opacity : 0,
        transition: 'opacity 0.6s ease 0.15s',
      },
    }
  })
}

// ── CausalChainFlow ───────────────────────────────────────────────────────────
function CausalChainFlow({ chain, eventId }) {
  const defaultChain = [
    { stage: 'Event',      name: eventId?.replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase()) || 'Disruption', color: '#ff4060', confidence: 95 },
    { stage: 'Materials',  name: 'Affected Components',  color: '#ff9c4d', confidence: 88 },
    { stage: 'Price',      name: 'Cost Stack Change',    color: '#ffbe68', confidence: 82 },
    { stage: 'Supply',     name: 'Supply Reduction',     color: '#ffd700', confidence: 75 },
    { stage: 'Inventory',  name: 'Burn Acceleration',    color: '#a78bfa', confidence: 70 },
    { stage: 'Risk',       name: 'Stockout Probability', color: '#ff6080', confidence: 65 },
  ]
  const items = chain?.length
    ? chain.map((c, i) => ({ stage: c.stage || `Step ${i+1}`, name: c.description || c.name || c, color: defaultChain[i]?.color || '#00bfff', confidence: c.confidence ?? (95 - i * 6) }))
    : defaultChain

  return (
    <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, minWidth: items.length * 136, padding: '4px 2px' }}>
        {items.map((n, i) => (
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
                minWidth: 112,
                textAlign: 'center',
                cursor: 'default',
              }}
            >
              <div style={{ color: n.color, fontSize: '0.65rem', fontFamily: 'var(--font-sans)', marginBottom: 3, opacity: 0.8 }}>{n.stage}</div>
              <div style={{ color: '#dbe9ff', fontSize: '0.72rem', fontWeight: 600, lineHeight: 1.3 }}>{n.name}</div>
              <div style={{ color: n.color, fontSize: '0.62rem', marginTop: 5, fontFamily: 'var(--font-sans)' }}>{n.confidence ?? '--'}% conf</div>
            </motion.div>
            {i < items.length - 1 && (
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 + i * 0.1 }}
                style={{ color: '#2a4a6a', fontSize: '1rem', padding: '0 3px', flexShrink: 0, userSelect: 'none' }}
              >→</motion.div>
            )}
          </div>
        ))}
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
function AgentsPanel({ progress, runStatus }) {
  return (
    <div className="swarm-agents-panel">
      <div className="swarm-panel-title">Active Agents</div>
      {SWARM_AGENTS.map(agent => {
        const pct = progress[agent.id] ?? 0
        const done = pct >= 100
        const running = pct > 0 && !done
        return (
          <div key={agent.id} className="swarm-agent-row">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: agent.color, boxShadow: running ? `0 0 8px 2px ${agent.color}` : 'none', flexShrink: 0 }} />
                <span style={{ color: '#b8d4e8', fontSize: '0.72rem', fontWeight: 600, fontFamily: 'var(--font-sans)' }}>{agent.name}</span>
              </div>
              <span className={`swarm-status-badge ${done ? 'done' : running ? 'running' : 'idle'}`}>
                {done ? 'DONE' : running ? 'RUNNING' : 'IDLE'}
              </span>
            </div>
            <div className="swarm-progress-track">
              <motion.div
                className="swarm-progress-fill"
                animate={{ width: `${pct}%`, background: done ? agent.color : `${agent.color}cc` }}
                transition={{ duration: 0.3 }}
              />
            </div>
            {(running || done) && (
              <div style={{ color: '#4a7a90', fontSize: '0.62rem', marginTop: 3, fontFamily: 'var(--font-sans)' }}>{agent.role}</div>
            )}
          </div>
        )
      })}
      {runStatus && (
        <div style={{ marginTop: 8, padding: '6px 8px', background: 'rgba(0,191,255,0.05)', borderRadius: 6, fontSize: '0.65rem', color: '#4a7a90', fontFamily: 'var(--font-sans)' }}>
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
      {entries.length === 0 && <div style={{ color: '#2a4a6a', fontSize: '0.65rem', fontFamily: 'var(--font-sans)', padding: '4px 0' }}>Awaiting agent output…</div>}
      {entries.map((e, i) => {
        const agent = SWARM_AGENTS.find(a => a.id === e.agentId)
        return (
          <div key={i} style={{ marginBottom: 4, lineHeight: 1.4 }}>
            <span style={{ color: '#2a4a6a', fontSize: '0.6rem', fontFamily: 'var(--font-sans)' }}>{e.ts} </span>
            <span style={{ color: agent?.color || '#00bfff', fontSize: '0.62rem', fontFamily: 'var(--font-sans)', fontWeight: 700 }}>[{agent?.name || e.agentId}] </span>
            <span style={{ color: '#7aaccc', fontSize: '0.65rem', fontFamily: 'var(--font-sans)' }}>{e.msg}</span>
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

// ── Main component ────────────────────────────────────────────────────────────
export default function SwarmDeployCanvas({
  eventId,
  event,
  orderContext,
  disruptionImpactData,
  isDeployed,
  isDeploying,
  runStatus,
  debateLogs,
  causalChain,
  onMaterialAmplificationsChange,
  navigateToSection,
}) {
  const [phase, setPhase] = useState('idle') // idle | deploying | running | complete
  const [agentProgress, setAgentProgress] = useState({})
  const [activityLog, setActivityLog] = useState([])
  const [revealedIds, setRevealedIds] = useState(new Set(['demand-hq']))
  const [materialAmplifications, setMaterialAmplifications] = useState({})
  const deployStartRef = useRef(null)
  const progressTimerRef = useRef(null)
  const revealTimerRef = useRef(null)
  const loggedAgents = useRef(new Set())

  // Derive graph data
  const rawNodes = useMemo(
    () => buildGraphNodes(eventId, orderContext, disruptionImpactData),
    [eventId, orderContext, disruptionImpactData],
  )
  const rawEdges = useMemo(
    () => buildGraphEdges(rawNodes, disruptionImpactData),
    [rawNodes, disruptionImpactData],
  )
  const positions = useMemo(() => computeLayout(rawNodes), [rawNodes])
  const rfNodes = useMemo(() => toRFNodes(rawNodes, positions, revealedIds), [rawNodes, positions, revealedIds])
  const rfEdges = useMemo(() => toRFEdges(rawEdges, revealedIds), [rawEdges, revealedIds])

  // Phase state machine
  useEffect(() => {
    if (isDeploying) { setPhase('deploying'); return }
    if (isDeployed && runStatus?.status === 'completed') { setPhase('complete'); return }
    if (isDeployed) { setPhase('running'); return }
  }, [isDeploying, isDeployed, runStatus?.status])

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
    if (phase !== 'running' && phase !== 'deploying') return
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
      setAgentProgress(newProgress)

      // Log agent completions
      SWARM_AGENTS.forEach(agent => {
        if (newProgress[agent.id] >= 100 && !loggedAgents.current.has(agent.id)) {
          loggedAgents.current.add(agent.id)
          const msgs = AGENT_LOG_MESSAGES[agent.id] || []
          msgs.forEach((tpl, ti) => {
            const ts = new Date().toLocaleTimeString('en-US', { hour12: false })
            setTimeout(() => {
              setActivityLog(prev => [...prev, { agentId: agent.id, msg: fillTemplate(tpl, FILL_VALUES), ts }])
            }, ti * 300)
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

  // Progressive node reveal
  useEffect(() => {
    if (phase !== 'running' && phase !== 'complete') return
    const sortedNodes = [...rawNodes].sort((a, b) => a.revealOrder - b.revealOrder)
    let idx = 1 // demand-hq already revealed
    revealTimerRef.current = setInterval(() => {
      if (idx >= sortedNodes.length) { clearInterval(revealTimerRef.current); return }
      const nodeId = sortedNodes[idx].id
      setRevealedIds(prev => new Set([...prev, nodeId]))
      idx++
    }, 420)
    return () => clearInterval(revealTimerRef.current)
  }, [phase, rawNodes])

  // Sync phase → complete when runStatus says so (backend-driven)
  useEffect(() => {
    if (runStatus?.status === 'completed' && phase === 'running') {
      setPhase('complete')
      // Ensure all agents show 100%
      const full = {}
      SWARM_AGENTS.forEach(a => { full[a.id] = 100 })
      setAgentProgress(full)
    }
  }, [runStatus?.status, phase])

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
    setActivityLog(prev => {
      const alreadyHas = prev.some(e => e.msg === last.summary && e.agentId === agentId)
      if (alreadyHas) return prev
      return [...prev, { agentId, msg: last.summary || last.message || '…', ts }]
    })
  }, [debateLogs?.length])

  const handleAmplificationChange = useCallback((componentId, value) => {
    setMaterialAmplifications(prev => {
      const next = { ...prev, [componentId]: value }
      onMaterialAmplificationsChange?.(next)
      return next
    })
  }, [onMaterialAmplificationsChange])

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
          <div style={{ height: 520, position: 'relative', borderRadius: 10, overflow: 'hidden', background: '#030a14' }}>
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
              fitView
              fitViewOptions={{ padding: 0.15 }}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              zoomOnScroll={false}
              panOnScroll={false}
              preventScrolling={false}
              style={{ background: '#030a14' }}
            >
              <Background color="#0a1a2a" gap={24} size={1} />
              <Panel position="bottom-left">
                <GraphLegend />
              </Panel>
            </ReactFlow>
            {phase === 'deploying' && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(3,10,20,0.85)', gap: 12 }}>
                <div className="swarm-deploy-spinner" />
                <div style={{ color: '#00bfff', fontSize: '0.8rem', fontFamily: 'var(--font-sans)' }}>Initializing AI Swarm…</div>
              </div>
            )}
          </div>
        </div>

        {/* Right sidebar */}
        <div className="swarm-sidebar">
          <AgentsPanel progress={agentProgress} runStatus={runStatus} />
          <ActivityLog entries={activityLog} />
        </div>
      </div>

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
              <div className="swarm-completion-sub">{SWARM_AGENTS.length} agents deployed · {affectedComponents.length} material signals · graph topology mapped</div>
            </div>
            <button
              className="flow-btn primary"
              onClick={() => navigateToSection?.('simulation-lab')}
            >
              View Results Dashboard →
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
