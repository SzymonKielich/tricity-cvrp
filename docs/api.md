# SharedDrop API and planning presets

Interactive OpenAPI documentation is available at `/api/docs`. The JSON contract is at `/api/openapi.json`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | /api/health | Solver version and source fingerprint |
| GET | /api/dataset/summary | Dataset counts, geographic hub and representative date |
| GET | /api/network | Nodes, coordinates, participation and zones |
| GET | /api/vehicles | Source fleet IDs and classes |
| GET | /api/dates | Available dates and their order counts |
| GET | /api/baseline | Source cluster routes and simulated KPI by `date` and `scope` |
| GET, POST | /api/scenarios | List scenarios or save a draft |
| GET, PATCH, DELETE | /api/scenarios/{id} | Read, rename or remove a scenario from the library |
| POST | /api/scenarios/{id}/duplicate | Copy a configuration as a draft |
| POST | /api/scenarios/{id}/rerun | Enqueue the stored configuration as a new scenario and job |
| GET | /api/scenarios/{id}/export | Download the scenario and immutable run evidence as ZIP |
| POST | /api/scenarios/{id}/stress-test | Evaluate the fixed verified route sequence under changed conditions |
| POST | /api/optimization/run | Create a scenario and a persisted job |
| GET | /api/optimization/jobs/{id} | Read job phase, status, result and validator evidence |
| GET | /api/optimization/jobs/{id}/events | Poll log lines. Pass `after` as the prior `next` cursor |
| GET | /api/optimization/jobs/{id}/routes | Read ordered stops and timeline segments for a service date |
| GET | /api/optimization/jobs/{id}/kpis | Read recomputed totals, day metrics and shop allocations |
| POST | /api/optimization/jobs/{id}/cancel | Cancel a queued job or signal its running process |

```sh
curl -X POST http://localhost:3000/api/optimization/run \
  -H 'Content-Type: application/json' \
  -d '{"name":"Viladecans comparison","config":{"dates":["2026-11-05"],"scope":"participating","time_limit":15}}'
```

The run request returns HTTP 202 with `scenario_id`, `job_id`, and `duplicate`. HTTP 422 errors describe invalid fields or source references. HTTP 409 indicates an unavailable report or incompatible scenario state, HTTP 404 an unknown record, and HTTP 429 a full optimization queue. Business-rule errors provide `detail.code` and `detail.message`. Schema errors use the standard FastAPI field error list.

The service day is local to Viladecans. Stop arrival, leg and segment times use seconds after local midnight. Run timestamps use UTC. The validation export includes absolute departure and arrival times, stop sequence, load, vehicle assignments and constraint evidence.

## Presets

All ordinary presets start with the selected day or date range, participating shops, COM018, an 8-hour tour limit, 40 km cargo-bike range, 2-minute pickups, hard high-priority midpoint deadlines, and up to eight vehicles in each of three source classes. Each row shows the preset-specific values. **Custom** retains values already entered.

| Preset | Buffer | Cost weight | CO₂ weight | Pickup time | Search budget per day |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline comparison | 0% | 1 | 1 | 2 min | 15 s |
| Balanced | 15% | 1 | 1 | 2 min | 15 s |
| Lowest emissions | 15% | 0 | 1 | 2 min | 30 s |
| Lowest modeled cost | 15% | 1 | 0 | 2 min | 30 s |
| Operationally conservative | 25% | 1 | 1 | 5 min | 45 s |

Fast mode uses 8 seconds per day. Standard mode uses 30 seconds. Discovery of a complete plan depends on scope, settings, search budget and compute resources. All 45 days can also be queued as a batch.

## Scenario result statuses

| Status | Meaning |
| --- | --- |
| Queued / Running | Waiting for the worker or executing a named phase |
| Verified | Complete coverage, independent validation and KPI calculation |
| Incomplete | Diagnostic routes from a run with unserved orders. Change percentages are omitted |
| Failed | Worker, independent validation or reporting failure |
| Cancelled | Stopped while queued or running |
| Unverified | Original sequence and derived schedule from the synthetic baseline |
