import { Link, useLocation } from 'react-router-dom'

const STEPS = [
  { id: 1, label: 'Mission', icon: 'M', to: '/results/mission' },
  { id: 2, label: 'Debate', icon: 'D', to: '/results/debate' },
  { id: 3, label: 'Intelligence', icon: 'I', to: '/results/intelligence' },
  { id: 4, label: 'Scenario Configuration', icon: 'S', to: '/results/scenarios' },
  { id: 5, label: 'Operations', icon: 'O', to: '/results/operations' },
]

export default function FlowShell({ children }) {
  const location = useLocation()
  const pathname = location.pathname

  const stepIndexByPath = {
    '/results/mission': 1,
    '/results/debate': 2,
    '/results/intelligence': 3,
    '/results/scenarios': 4,
    '/results/operations': 5,
  }

  const activeStep = stepIndexByPath[pathname] || 1

  return (
    <div className="flow-shell">
      <header className="flow-topbar">
        <h1>SENTINEL V2 FLOW</h1>
        <p>Step-by-step dashboard journey from mission signal to action plan.</p>
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
