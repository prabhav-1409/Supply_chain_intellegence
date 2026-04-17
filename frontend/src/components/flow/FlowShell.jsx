import { Link, useLocation } from 'react-router-dom'

const STEPS = [
  { id: 1, label: 'Data Ingestion + BOM Research', icon: '1', to: '/results/bom-intelligence' },
  { id: 2, label: 'Event Trigger', icon: '2', to: '/results/disruption-impact' },
  { id: 3, label: 'Price Simulation Engine', icon: '3', to: '/results/simulation-lab' },
  { id: 4, label: 'Negotiation Intelligence', icon: '4', to: '/results/negotiation-intelligence' },
  { id: 5, label: 'Recommendation Engine', icon: '5', to: '/results/recommendation-engine' },
  { id: 6, label: 'Action + Reinforcement Learning', icon: '6', to: '/results/action-learning' },
]

export default function FlowShell({ children }) {
  const location = useLocation()
  const pathname = location.pathname

  const stepIndexByPath = {
    '/results/bom-intelligence': 1,
    '/results/disruption-impact': 2,
    '/results/simulation-lab': 3,
    '/results/negotiation-intelligence': 4,
    '/results/recommendation-engine': 5,
    '/results/action-learning': 6,
  }

  const activeStep = stepIndexByPath[pathname] || 1

  return (
    <div className="flow-shell">
      <header className="flow-topbar">
        <h1>PROCUREMENT DECISION INTELLIGENCE</h1>
        <p>We are not just tracking disruptions. We are telling the procurement head exactly what to pay, who to pay it to, and why — so every purchase protects margin.</p>
      </header>

      <nav className="flow-stepper" aria-label="Workflow steps">
        {STEPS.map((step, idx) => (
          <div key={step.id} className="flow-step-wrap">
            <Link className={`flow-step ${activeStep >= step.id ? 'active' : ''}`} to={step.to}>
              <span className="flow-step-badge">{step.id}</span>
              <span className="flow-step-icon">{step.icon}</span>
              <span>{step.label}</span>
            </Link>
            {idx < STEPS.length - 1 && <div className={`flow-step-line ${activeStep > step.id ? 'active' : ''}`} />}
          </div>
        ))}
      </nav>

      <main className="flow-content">{children}</main>
    </div>
  )
}
