import { useEffect, useMemo, useRef, useState } from 'react'

const SKU_OPTIONS = [
  { id: 'poweredge-cpu', label: 'PowerEdge Server CPU' },
  { id: 'gpu-module', label: 'GPU Module' },
  { id: 'battery-pack', label: 'Battery Pack' },
  { id: 'helium-memory-chip', label: 'Helium-Dependent Memory Chip' },
  { id: 'aluminum-chassis', label: 'Aluminum Chassis Component' },
  { id: 'tungsten-precision-component', label: 'Tungsten Precision Component' },
]

const COMPONENT_SCOPE_MAP = {
  'memory-lpdddr5': {
    anchorId: 'helium-memory-chip',
    anchorLabel: 'Memory LPDDR5',
    relatedIds: ['gpu-module', 'tungsten-precision-component', 'aluminum-chassis'],
    defaultSelected: ['helium-memory-chip', 'gpu-module'],
  },
  'processor-cpu': {
    anchorId: 'poweredge-cpu',
    anchorLabel: 'Processor CPU',
    relatedIds: ['gpu-module', 'aluminum-chassis', 'tungsten-precision-component'],
    defaultSelected: ['poweredge-cpu', 'gpu-module'],
  },
  'gpu-display-chip': {
    anchorId: 'gpu-module',
    anchorLabel: 'GPU Display Chip',
    relatedIds: ['poweredge-cpu', 'helium-memory-chip', 'aluminum-chassis'],
    defaultSelected: ['gpu-module', 'helium-memory-chip'],
  },
  'battery-pack': {
    anchorId: 'battery-pack',
    anchorLabel: 'Battery Pack',
    relatedIds: ['aluminum-chassis', 'poweredge-cpu', 'gpu-module'],
    defaultSelected: ['battery-pack', 'aluminum-chassis'],
  },
}

const ROUTE_OPTIONS = [
  'Shanghai->Rotterdam',
  'Shanghai->Long Beach',
  'Shanghai->Singapore',
  'Busan->Hamburg',
  'Yantian->Los Angeles',
]

function ToggleCard({ checked, onChange, label }) {
  return (
    <label className={`sim-toggle ${checked ? 'checked' : ''}`}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  )
}

export const DEFAULT_SIMULATION_CONFIG = {
  uploadedDocs: [],
  selectedSkus: ['gpu-module', 'helium-memory-chip', 'tungsten-precision-component'],
  activeRoutes: ['Shanghai->Rotterdam', 'Shanghai->Long Beach'],
  blockedRoutes: ['Shanghai->Rotterdam'],
  disruptionIntensity: 50,
  disruptionDuration: 30,
  tariffs: {
    china: 145,
    other: 25,
    domestic: 0,
  },
}

export default function SimulationControlModule({ config, setConfig, primaryComponentId, primaryComponentName }) {

  const [localConfig, setLocalConfig] = useState(DEFAULT_SIMULATION_CONFIG)
  const activeConfig = config || localConfig
  const updateConfig = setConfig || setLocalConfig
  const uploadRef = useRef(null)
  const scopeProfile = COMPONENT_SCOPE_MAP[primaryComponentId] || {
    anchorId: 'gpu-module',
    anchorLabel: primaryComponentName || 'Selected Component',
    relatedIds: ['helium-memory-chip', 'tungsten-precision-component', 'aluminum-chassis'],
    defaultSelected: ['gpu-module', 'helium-memory-chip'],
  }
  const allowedScopeIds = useMemo(() => new Set([scopeProfile.anchorId, ...scopeProfile.relatedIds]), [scopeProfile.anchorId, scopeProfile.relatedIds])
  const relatedOptions = useMemo(
    () => SKU_OPTIONS.filter((sku) => scopeProfile.relatedIds.includes(sku.id)),
    [scopeProfile.relatedIds],
  )
  const blockedCount = activeConfig.blockedRoutes.length

  const estimatedSeconds = useMemo(() => {
    const skuFactor = Math.max(1, activeConfig.selectedSkus.length)
    const routeFactor = Math.max(1, activeConfig.activeRoutes.length)
    return Math.round((skuFactor * 1.2 + routeFactor * 0.7) * 2)
  }, [activeConfig.activeRoutes.length, activeConfig.selectedSkus.length])

  const toggleSku = (skuId) => {
    updateConfig((prev) => {
      if (skuId === scopeProfile.anchorId) return prev
      const exists = prev.selectedSkus.includes(skuId)
      const selectedSkus = exists ? prev.selectedSkus.filter((s) => s !== skuId) : [...prev.selectedSkus, skuId]
      return { ...prev, selectedSkus }
    })
  }

  useEffect(() => {
    updateConfig((prev) => {
      const filtered = prev.selectedSkus.filter((skuId) => allowedScopeIds.has(skuId) && skuId !== scopeProfile.anchorId)
      const nextRelated = filtered.length ? filtered : scopeProfile.defaultSelected.filter((skuId) => skuId !== scopeProfile.anchorId)
      const nextSelected = [scopeProfile.anchorId, ...nextRelated.filter((skuId, index, arr) => allowedScopeIds.has(skuId) && arr.indexOf(skuId) === index)]
      const same = prev.selectedSkus.length === nextSelected.length && prev.selectedSkus.every((skuId, index) => skuId === nextSelected[index])
      if (same) return prev
      return { ...prev, selectedSkus: nextSelected }
    })
  }, [allowedScopeIds, scopeProfile.anchorId, scopeProfile.defaultSelected, updateConfig])

  const toggleRoute = (route, key) => {
    updateConfig((prev) => {
      const list = prev[key]
      const next = list.includes(route) ? list.filter((r) => r !== route) : [...list, route]
      if (key === 'activeRoutes') {
        const nextBlocked = prev.blockedRoutes.filter((blocked) => next.includes(blocked))
        return { ...prev, activeRoutes: next, blockedRoutes: nextBlocked }
      }
      return { ...prev, [key]: next }
    })
  }

  const handleUpload = (event) => {
    const files = Array.from(event.target.files || [])
    if (!files.length) return
    updateConfig((prev) => ({
      ...prev,
      uploadedDocs: [...prev.uploadedDocs, ...files.map((f) => f.name)],
    }))
  }

  const blockedRatio = `${blockedCount}/${Math.max(activeConfig.activeRoutes.length, 1)}`

  return (
    <section className="sim-module">
      <div className="sim-card">
        <h3>Upload Relevant Documents</h3>
        <p>Upload PDF, DOCX, or TXT files with news, media, or supply chain reports.</p>
        <div className="drop-zone" role="button" tabIndex={0} onClick={() => uploadRef.current?.click()} onKeyDown={(e) => e.key === 'Enter' && uploadRef.current?.click()}>
          <div>
            <div className="drop-zone-icon">o</div>
            <strong>Click to upload or drag and drop</strong>
            <p>PDF, DOCX, or TXT files</p>
          </div>
        </div>
        <input ref={uploadRef} type="file" accept=".pdf,.doc,.docx,.txt" multiple onChange={handleUpload} style={{ display: 'none' }} />
        {activeConfig.uploadedDocs.length > 0 && (
          <p className="sim-upload-list">Uploaded: {activeConfig.uploadedDocs.slice(-3).join(', ')}</p>
        )}
      </div>

      <div className="sim-card">
        <h3>Analysis Scope</h3>
        <p>The Mission-selected component is the fixed primary anchor. Add related items below if the scenario should include surrounding dependencies.</p>
        <div className="sim-anchor-card">
          <span className="sim-anchor-label">Primary Anchor</span>
          <strong>{scopeProfile.anchorLabel}</strong>
          <span className="sim-anchor-note">Inherited from Mission Control</span>
        </div>
        <div className="sim-grid">
          {relatedOptions.map((sku) => (
            <ToggleCard key={sku.id} checked={activeConfig.selectedSkus.includes(sku.id)} onChange={() => toggleSku(sku.id)} label={sku.label} />
          ))}
        </div>
      </div>

      <div className="sim-card">
        <h3>Trade Routes & Disruptions</h3>
        <p>Select active trade routes and mark which ones are blocked.</p>
        <div className="route-grid">
          <div>
            <h4>Active Routes:</h4>
            <div className="sim-grid">
              {ROUTE_OPTIONS.map((route) => (
                <ToggleCard key={`active-${route}`} checked={activeConfig.activeRoutes.includes(route)} onChange={() => toggleRoute(route, 'activeRoutes')} label={route} />
              ))}
            </div>
          </div>
          <div>
            <h4>Blocked Routes (from above list):</h4>
            <div className="sim-grid">
              {activeConfig.activeRoutes.map((route) => (
                <ToggleCard key={`blocked-${route}`} checked={activeConfig.blockedRoutes.includes(route)} onChange={() => toggleRoute(route, 'blockedRoutes')} label={route} />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="sim-card">
        <h3>Custom Disruption Scenario</h3>
        <p>Define the disruption scenario parameters.</p>
        <label className="sim-slider-label">
          <span>Disruption Intensity:</span>
          <strong>{activeConfig.disruptionIntensity}%</strong>
        </label>
        <input
          type="range"
          min="0"
          max="100"
          value={activeConfig.disruptionIntensity}
          onChange={(e) => updateConfig((prev) => ({ ...prev, disruptionIntensity: Number(e.target.value) }))}
        />
        <div className="sim-slider-scale"><span>None</span><span>Moderate</span><span>Severe</span><span>Critical</span></div>
        <label className="sim-slider-label">
          <span>Disruption Duration (days):</span>
          <strong>{activeConfig.disruptionDuration}</strong>
        </label>
        <input
          type="range"
          min="1"
          max="90"
          value={activeConfig.disruptionDuration}
          onChange={(e) => updateConfig((prev) => ({ ...prev, disruptionDuration: Number(e.target.value) }))}
        />
      </div>

      <div className="sim-card">
        <h3>Tariff Rate Overrides</h3>
        <div className="tariff-grid">
          <label>China Tariff (%)
            <input type="number" value={activeConfig.tariffs.china} onChange={(e) => updateConfig((prev) => ({ ...prev, tariffs: { ...prev.tariffs, china: Number(e.target.value) } }))} />
          </label>
          <label>Other Countries Tariff (%)
            <input type="number" value={activeConfig.tariffs.other} onChange={(e) => updateConfig((prev) => ({ ...prev, tariffs: { ...prev.tariffs, other: Number(e.target.value) } }))} />
          </label>
          <label>Domestic Tariff (%)
            <input type="number" value={activeConfig.tariffs.domestic} onChange={(e) => updateConfig((prev) => ({ ...prev, tariffs: { ...prev.tariffs, domestic: Number(e.target.value) } }))} />
          </label>
        </div>
      </div>

      <div className="sim-summary">
        <div><strong>{activeConfig.uploadedDocs.length}</strong><span>Documents Uploaded</span></div>
        <div><strong>{activeConfig.selectedSkus.length}</strong><span>Items In Scope</span></div>
        <div><strong>{blockedRatio}</strong><span>Routes Blocked</span></div>
        <div><strong>~{estimatedSeconds}s</strong><span>Estimated Time</span></div>
      </div>

      <div className="sim-note">
        All inputs are optional. If nothing is selected, analysis runs on default synthetic market assumptions.
      </div>
    </section>
  )
}
