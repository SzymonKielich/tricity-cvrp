# Saved optimization result

**Viladecans · Balanced pilot**, 5 November 2026, participating shops. Both plans cover 184 of 184 orders. The independent validator returned exit code 0 and reported no dropped orders.

| Metric | Original plan | Shared plan |
|---|---:|---:|
| Orders served | 184 | 184 |
| Tours | 73 | 15 |
| Total distance | 841.974 km | 473.596 km |
| Empty distance | 318.462 km | 56.151 km |
| Modeled emissions | 81.510 kg CO₂e | 17.303 kg CO₂e |
| Modeled transport cost | 2,157.14 EUR | 490.91 EUR |
| Variable cost | 390.14 EUR | 167.91 EUR |
| Fixed charges | 1,767.00 EUR | 323.00 EUR |
| Modeled cost per order | 11.72 EUR | 2.67 EUR |

Compared with the original plan, the shared plan covers the same orders with **43.75% less distance** and **78.77% lower modeled emissions**. Total modeled transport cost is **77.24% lower** and the variable component is **56.96% lower**. The original plan applies fixed charges per shop route. The shared plan applies them per used vehicle per day. The cost model excludes coordination and handling overhead.

The original plan reconstructs shop routes from the Hedyla data and simulates their times. Shared-plan times are the output of the solver. These are results for the bundled scenario on synthetic data. A fresh optimization can produce a different solution because the search has a time limit.

## Inspect the evidence

- [Structured comparison and per-day KPIs](backend/sample/report.json)
- [Route totals](backend/sample/routes.csv) and [ordered stops](backend/sample/stops.csv)
- [Independent validation output](backend/sample/validation.txt)
- [Scenario configuration and dataset fingerprint](backend/sample/sample.json)
- [Metric definitions and sources](docs/metric-provenance.md)

Open the same scenario in [Route explorer](http://localhost:3000/routes?scenario=5c7e08ce-1aa5-4707-86b2-c4451a13e326) after starting the app. Run the independent validator from the extracted project directory with Python 3:

```sh
python3 solver/validate_solution.py --data . --out backend/sample
```

## Emissions by distance

The 64.21 kg CO₂e reduction separates into 35.66 kg from shorter distance at the original plan’s weighted average rate and 28.55 kg from changing the vehicle mix at the new distance. See [the pitch chart](artifacts/emissions-by-distance.png) or open [the interactive screen](http://localhost:3000/emissions?scenario=5c7e08ce-1aa5-4707-86b2-c4451a13e326).
