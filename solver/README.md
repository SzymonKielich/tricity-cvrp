# Hedyla shared deliveries – OR-Tools solver

Mission Climate Hackathon 2026, challenge COM-E1 ("Shared deliveries for local shops").
Plans shared pickup-and-delivery routes for the shops on the platform and compares
them with the baseline routes in the dataset.

## Layout

```
Hedyla_Datasets_EN/
  COM-E1_Hedyla-shared-deliveries_EN.pdf   the challenge brief
  hedyla_*.csv, README_EN.json             the dataset
  solver/
    hedyla_opt.py            the routing model (commands: solve, pareto)
    validate_solution.py     independent checker; rebuilds everything from the raw CSVs
    kpis.py                  challenge KPIs + per-shop cost sharing, recomputed from the stops
    pyproject.toml, uv.lock  pinned dependencies (uv)
    output/                  created when you run the solver
```

## Run

Requires [uv](https://docs.astral.sh/uv/). From the `solver` folder:

```
uv sync
uv run hedyla_opt.py --time-limit 60 solve      # all 45 days, ~7 min with 8 parallel jobs
uv run validate_solution.py                      # exit code 0 = every check passed
uv run kpis.py                                   # writes output/kpis.json, output/shop_cost_sharing.csv
```

Quick test on one day: `uv run hedyla_opt.py --time-limit 20 solve --dates 2026-11-05`.
Trade-off sweep for one day: `uv run hedyla_opt.py pareto --date 2026-11-05`.
Run `uv run hedyla_opt.py --help` for every option.

The solver is a time-limited heuristic, so totals vary slightly (a few %) with CPU speed
and load. Every run is still checked by `validate_solution.py`. A run that cannot plan
every order exits with code 2, and `kpis.py` then refuses to compare it with the baseline.

## Model

One independent problem per date, with both delivery periods together:

- **Fleet:** the 24 vehicles in `hedyla_vehicles.csv`, each used at most once per day, starting
  and ending at a hub (default: the most central shop, COM018; change it with `--depot`).
- **Orders:** picked up at the shop, then delivered by the same vehicle inside the order's
  window. Handling at the shop (2 min per order, `--pickup-service-min`) must be finished by
  12:00, when shops stop handing over goods. Because pickups end when deliveries start, each
  vehicle runs one tour per day.
- **Capacity:** weight and volume per vehicle.
- **Cargo bike range:** at most 40 km per bike per day (`--cargo-max-km`, 0 = no limit).
- **Tour length:** at most 8 hours per vehicle (`--max-shift-h`, 0 = no limit).
- **Travel time:** congestion depends on when a leg *starts* (before 12:00 morning, 12:00–15:30
  midday, later afternoon). Each leg is planned with the worst factor of any phase it could
  start in, times a safety buffer of +15% (`--travel-buffer`, 1.0 = none). The plan therefore
  stays on time if traffic is up to 15% slower than the data says.
- **Priority:** high-priority orders must arrive in the first half of their window.
  `--priority-soft` turns this into a penalty instead.
- **Objective:** € + €1 per kg CO₂e by default (`--w-eur`, `--w-co2`), using each vehicle
  type's €/km, fixed shift cost and emission factor.
- **Scope:** shops with `platform_participant = 0` keep their baseline routes. Use
  `--all-shops` to include them.

## What the checker verifies

`validate_solution.py` does not import the solver. It checks that `routes.csv` and `stops.csv`
agree (no duplicate or orphan routes), every hard constraint above (including timing under
departure-time congestion with the run's buffer), that every in-scope order is served exactly
once, and it recomputes every number in `routes.csv` from the stops.

## Assumptions to keep in mind

- **No timestamps in the baseline:** on-time rates for it are simulated, with each route
  leaving its shop at the start of the delivery window.
- **Hub legs are counted:** km include driving to and from the hub, which the baseline loops
  don't have.
- **Fixed shift cost:** the baseline pays it per route, the optimiser per vehicle per day.
  km and CO₂ don't depend on it, so quote variable cost (`km × €/km`) next to total cost.
- **Waiting time:** goods must be collected by 12:00 but afternoon deliveries start at 15:30,
  so part of each paid tour is waiting (reported in `kpis.json` under `time`). Hub storage or
  split shifts would remove it.
- **Not modelled:** coordination and transfer costs; these belong in the pilot business case.
