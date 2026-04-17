import { Suspense, lazy } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './Flow.css'
import FlowShell from './components/flow/FlowShell'
import { FlowProvider } from './context/FlowContext'

const ResultsDashboardPage = lazy(() => import('./pages/ResultsDashboardPage'))

export default function App() {
  return (
    <BrowserRouter>
      <FlowProvider>
        <Suspense fallback={<div style={{ minHeight: '100vh', color: '#dbe9ff', padding: '20px' }}>Loading V3 flow...</div>}>
          <FlowShell>
            <Routes>
              <Route path="/" element={<Navigate to="/results/bom-intelligence" replace />} />
              <Route path="/swarm" element={<Navigate to="/results/bom-intelligence" replace />} />
              <Route path="/results" element={<Navigate to="/results/bom-intelligence" replace />} />
              <Route path="/results/:section" element={<ResultsDashboardPage />} />
              <Route path="*" element={<Navigate to="/results/bom-intelligence" replace />} />
            </Routes>
          </FlowShell>
        </Suspense>
      </FlowProvider>
    </BrowserRouter>
  )
}
