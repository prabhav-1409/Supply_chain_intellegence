# Supply Chain Command Center V3

V3 is a separate integration track that preserves V2 and introduces a guided multi-page flow:

1. Input Configuration
2. Swarm Deployment
3. Results Dashboard

The final stage keeps the existing dashboard logic but splits it into focused result pages. Human what-if scenario configuration now lives inside the Scenario Futures section instead of the initial intake step.

## What Changed in V3

- Preserved existing dashboard in [frontend/src/LegacyDashboard.jsx](frontend/src/LegacyDashboard.jsx)
- Added routed flow container in [frontend/src/App.jsx](frontend/src/App.jsx)
- Added shared flow state in [frontend/src/context/FlowContext.jsx](frontend/src/context/FlowContext.jsx)
- Added reusable simulation control module in [frontend/src/components/flow/SimulationControlModule.jsx](frontend/src/components/flow/SimulationControlModule.jsx)
- Added pages:
  - [frontend/src/pages/InputConfigurationPage.jsx](frontend/src/pages/InputConfigurationPage.jsx)
  - [frontend/src/pages/SwarmDeploymentPage.jsx](frontend/src/pages/SwarmDeploymentPage.jsx)
  - [frontend/src/pages/ResultsDashboardPage.jsx](frontend/src/pages/ResultsDashboardPage.jsx)
- Added page-flow styling in [frontend/src/Flow.css](frontend/src/Flow.css)

## Run V3

Preferred startup:

```bash
cd /home/prabhav/supply-chain-intel/supply-chain-command-center-v3
./run-v3.sh
```

This script handles stale processes on ports 8003 and 5175, installs missing backend dependencies, builds the frontend, and starts the stable preview server.

### Backend

```bash
cd /home/prabhav/supply-chain-intel/supply-chain-command-center-v3/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export OPENAI_API_KEY=your_key_here
# optional: export OPENAI_MODEL=gpt-4.1-mini
# optional: export OPENAI_BASE_URL=https://your-compatible-endpoint/v1
python3 -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8003
```

If you get `ERROR: [Errno 98] Address already in use`, port 8003 is already occupied by another backend process. Stop the existing process first:

```bash
fuser -k 8003/tcp
```

Then run the backend command again, or use `./run-v3.sh` from the V3 root.

### Frontend

```bash
cd /home/prabhav/supply-chain-intel/supply-chain-command-center-v3/frontend
npm install
npm run preview -- --host 0.0.0.0 --port 5175
```

Open http://localhost:5175

Backend health endpoint: http://localhost:8003/api/v2/health

#run it yourself next time, use the single-command launcher from-
cd /home/prabhav/supply-chain-intel/supply-chain-command-center-v3
OLLAMA_BASE_URL=http://localhost:11434 OLLAMA_MODEL=qwen2.5:7b ./run-v3.sh

## Current Integration Strategy

- Input Configuration only captures the live event and affected component.
- Swarm Deployment is now a review/transition step; live deploy happens in Mission Control inside results.
- Results are split into focused pages: mission, debate, intelligence, scenario futures, and operations.
- Scenario assumptions (SKUs, routes, tariffs, disruption intensity) are configured inside Scenario Futures for human-in-the-loop what-if planning.
