import { useEffect, useRef, useMemo } from 'react'
import { motion } from 'framer-motion'

// Supply chain route data: hub nodes + sea/air lanes
const HUBS = [
  { id: 'TW', label: 'Taiwan', x: 72, y: 36, type: 'fab' },
  { id: 'KR', label: 'Korea', x: 68, y: 28, type: 'fab' },
  { id: 'US', label: 'USA', x: 14, y: 34, type: 'market' },
  { id: 'CN', label: 'China', x: 65, y: 33, type: 'mfg' },
  { id: 'MY', label: 'Malaysia', x: 65, y: 50, type: 'pkg' },
  { id: 'DE', label: 'Germany', x: 46, y: 24, type: 'market' },
  { id: 'JP', label: 'Japan', x: 76, y: 30, type: 'mfg' },
  { id: 'SG', label: 'Singapore', x: 66, y: 52, type: 'logistics' },
  { id: 'AE', label: 'Dubai', x: 52, y: 38, type: 'logistics' },
]

const ROUTES = [
  { from: 'TW', to: 'US', type: 'sea', risk: 0.72 },
  { from: 'KR', to: 'US', type: 'sea', risk: 0.3 },
  { from: 'CN', to: 'US', type: 'sea', risk: 0.6 },
  { from: 'MY', to: 'DE', type: 'sea', risk: 0.5 },
  { from: 'TW', to: 'JP', type: 'air', risk: 0.2 },
  { from: 'SG', to: 'AE', type: 'sea', risk: 0.88 },
  { from: 'AE', to: 'DE', type: 'air', risk: 0.55 },
  { from: 'CN', to: 'MY', type: 'sea', risk: 0.35 },
]

const EVENT_DISRUPTIONS = {
  'taiwan-earthquake': ['TW'],
  'us-china-tariff': ['CN', 'US'],
  'hormuz-closure': ['AE', 'SG'],
  'us-china-trade-war': ['CN', 'US'],
  'malaysia-floods': ['MY', 'SG'],
  'tsmc-factory-fire': ['TW'],
}

function lerp(a, b, t) { return a + (b - a) * t }

export default function LivingSupplyMap({ eventId, deployState }) {
  const canvasRef = useRef(null)
  const frameRef = useRef(0)
  const particlesRef = useRef([])

  const disruptedHubs = useMemo(() => new Set(EVENT_DISRUPTIONS[eventId] || []), [eventId])

  // Animate pulse particles along routes
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')

    const resize = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio
      canvas.height = canvas.offsetHeight * window.devicePixelRatio
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
    }
    resize()

    const W = () => canvas.offsetWidth
    const H = () => canvas.offsetHeight
    const px = (pct) => (pct / 100) * W()
    const py = (pct) => (pct / 100) * H()

    const getHub = (id) => HUBS.find((h) => h.id === id)

    // Seed particles for active routes
    const seedParticles = () => {
      particlesRef.current = []
      ROUTES.forEach((route, ri) => {
        const count = deployState === 'live' ? 3 : 1
        for (let i = 0; i < count; i++) {
          particlesRef.current.push({
            route: ri,
            t: Math.random(),
            speed: 0.0012 + Math.random() * 0.001,
            size: route.type === 'air' ? 2.5 : 3.5,
          })
        }
      })
    }
    seedParticles()

    let animId
    let tick = 0
    const draw = () => {
      tick++
      ctx.clearRect(0, 0, W(), H())

      // Draw routes
      ROUTES.forEach((route) => {
        const from = getHub(route.from)
        const to = getHub(route.to)
        if (!from || !to) return
        const disrupted = disruptedHubs.has(from.id) || disruptedHubs.has(to.id)
        const isDashed = route.type === 'air'

        ctx.save()
        ctx.beginPath()
        ctx.setLineDash(isDashed ? [6, 6] : [])
        ctx.strokeStyle = disrupted
          ? `rgba(255,80,80,${0.4 + 0.2 * Math.sin(tick * 0.06)})`
          : `rgba(0,200,255,${0.12 + route.risk * 0.08})`
        ctx.lineWidth = disrupted ? 1.5 : 1
        ctx.shadowColor = disrupted ? '#ff4060' : '#00c8ff'
        ctx.shadowBlur = disrupted ? 8 : 3

        // Curved bezier
        const fx = px(from.x), fy = py(from.y)
        const tx = px(to.x), ty = py(to.y)
        const mx = (fx + tx) / 2
        const my = Math.min(fy, ty) - Math.abs(tx - fx) * 0.18
        ctx.moveTo(fx, fy)
        ctx.quadraticCurveTo(mx, my, tx, ty)
        ctx.stroke()
        ctx.restore()
      })

      // Draw particles
      particlesRef.current.forEach((p) => {
        const route = ROUTES[p.route]
        const from = getHub(route.from)
        const to = getHub(route.to)
        if (!from || !to) return
        p.t = (p.t + p.speed) % 1

        const fx = px(from.x), fy = py(from.y)
        const tx = px(to.x), ty = py(to.y)
        const mx = (fx + tx) / 2
        const my = Math.min(fy, ty) - Math.abs(tx - fx) * 0.18

        const t = p.t
        const x = (1 - t) * (1 - t) * fx + 2 * (1 - t) * t * mx + t * t * tx
        const y = (1 - t) * (1 - t) * fy + 2 * (1 - t) * t * my + t * t * ty

        const disrupted = disruptedHubs.has(from.id) || disruptedHubs.has(to.id)
        ctx.save()
        ctx.beginPath()
        ctx.arc(x, y, p.size, 0, Math.PI * 2)
        ctx.fillStyle = disrupted ? `rgba(255,100,100,0.9)` : `rgba(0,220,255,0.85)`
        ctx.shadowColor = disrupted ? '#ff4060' : '#00d4ff'
        ctx.shadowBlur = 10
        ctx.fill()
        ctx.restore()
      })

      // Draw hub nodes
      HUBS.forEach((hub) => {
        const x = px(hub.x)
        const y = py(hub.y)
        const isDisrupted = disruptedHubs.has(hub.id)
        const pulse = 0.6 + 0.4 * Math.sin(tick * 0.05 + hub.x)
        const radius = isDisrupted ? 7 + 3 * pulse : 5

        // Outer ring
        ctx.save()
        ctx.beginPath()
        ctx.arc(x, y, radius + 5, 0, Math.PI * 2)
        ctx.strokeStyle = isDisrupted ? `rgba(255,50,50,${0.2 * pulse})` : `rgba(0,200,255,${0.12 * pulse})`
        ctx.lineWidth = 1
        ctx.stroke()

        // Core dot
        ctx.beginPath()
        ctx.arc(x, y, radius, 0, Math.PI * 2)
        ctx.fillStyle = isDisrupted ? `rgba(255,70,70,${0.9})` : hub.type === 'fab' ? '#00e5ff' : hub.type === 'market' ? '#a78bfa' : '#50fa7b'
        ctx.shadowColor = isDisrupted ? '#ff2040' : '#00c8ff'
        ctx.shadowBlur = isDisrupted ? 16 : 8
        ctx.fill()
        ctx.restore()

        // Label
        ctx.save()
        ctx.font = `bold 9px "SF Mono", monospace`
        ctx.fillStyle = isDisrupted ? '#ff8080' : '#aaccdd'
        ctx.textAlign = 'center'
        ctx.fillText(hub.label, x, y - radius - 5)
        ctx.restore()
      })

      animId = requestAnimationFrame(draw)
    }

    draw()
    return () => cancelAnimationFrame(animId)
  }, [disruptedHubs, deployState])

  return (
    <div className="supply-map-container">
      <div className="supply-map-header">
        <span className="supply-map-title">GLOBAL SUPPLY NETWORK</span>
        <div className="supply-map-legend">
          <span className="legend-dot fab" />FAB
          <span className="legend-dot mfg" />MFG
          <span className="legend-dot logistics" />LOGISTICS
          <span className="legend-dot disrupted" />DISRUPTED
        </div>
      </div>
      <div className="supply-map-canvas-wrap">
        <canvas ref={canvasRef} className="supply-map-canvas" />
        {/* Country label overlay */}
        <svg className="supply-map-overlay" viewBox="0 0 100 70" preserveAspectRatio="none">
          {/* Faint continental outline suggestion */}
          <ellipse cx="50" cy="38" rx="48" ry="30" fill="none" stroke="rgba(0,200,255,0.04)" strokeWidth="0.3" />
        </svg>
      </div>
      {disruptedHubs.size > 0 && (
        <motion.div
          className="supply-map-alert"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <span className="alert-dot" />
          DISRUPTION ACTIVE · {[...disruptedHubs].join(', ')} nodes at risk
        </motion.div>
      )}
    </div>
  )
}
