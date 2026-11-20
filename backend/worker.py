"""Isolated process entry point for one persisted optimization run."""
import json
import subprocess
import sys
from importlib.metadata import version
from pathlib import Path

from solver import hedyla_opt

from .dataset import ROOT, dataset
from .models import ScenarioConfig
from .reports import metrics, optimized_routes


def write_json(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False))
    temporary.replace(path)


def run_script(script, data, out):
    return subprocess.run([sys.executable, str(ROOT / "solver" / script), "--data", data.dir, "--out", str(out)],
                          text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=False, timeout=45)


def run(out):
    source = dataset()
    config = ScenarioConfig.model_validate_json((out / "config.json").read_text())
    cfg = config.solver_config(source)
    routes, stops, missing, days = [], [], [], []
    print(f"PHASE solving · OR-Tools {version('ortools')} · {len(config.dates)} day(s)", flush=True)
    print(f"Seed search: {cfg['first_solution_strategy']}", flush=True)
    for date in config.dates:
        print(f"Solving {date} · {config.time_limit}s search limit", flush=True)
        solved = hedyla_opt.solve_day(date, cfg)
        routes.extend(solved["routes"])
        stops.extend(solved["stops"])
        missing.extend(solved["dropped"])
        days.append({key: value for key, value in solved.items() if key not in {"routes", "stops", "dropped"}})
        print(f"{date}: {solved['status']} · {len(solved['routes'])} tours · "
              f"{len(solved['dropped'])} unserved of {solved['orders']} · {solved['seconds']}s", flush=True)

    hedyla_opt.write_csv(out / "routes.csv", routes, hedyla_opt.ROUTE_COLUMNS)
    hedyla_opt.write_csv(out / "stops.csv", stops, hedyla_opt.STOP_COLUMNS)
    write_json(out / "summary.json", {"config": {key: val for key, val in cfg.items() if key != "data"},
                                     "dates": config.dates, "dropped_orders": missing, "days": days,
                                     "status": "INCOMPLETE" if missing else "COMPLETE"})
    print("PHASE validating · independent constraint checker", flush=True)
    validator = run_script("validate_solution.py", source, out)
    (out / "validation.txt").write_text(validator.stdout)
    checks = [line for line in validator.stdout.splitlines() if line.startswith("[")]
    failure = (not checks or any(line.startswith("[BAD") for line in checks)
               or (validator.returncode != 0 and not missing))
    status = "failed" if failure else "incomplete" if missing else "verified"
    warnings = []
    if failure:
        warnings.append("The independent checker rejected the solver output.")
    if missing:
        warnings.append(f"{len(missing)} orders are unserved. Savings are suppressed.")
    validation = {"exit_code": validator.returncode, "checks": checks,
                  "coverage_complete": not missing, "validator": "solver/validate_solution.py",
                  "report": validator.stdout}
    print(validator.stdout, end="", flush=True)

    kpis = None
    if not failure:
        print("PHASE reporting · recalculating metrics from stop sequence", flush=True)
        enriched = optimized_routes(source, routes, stops, config.pickup_service_min)
        requested = sum(day["orders"] for day in days)
        kpis = {"optimized": metrics(enriched, requested), "baseline": None, "changes": None,
                "by_day": {}, "shop_cost_sharing": []}
        baseline_routes = []
        for date in config.dates:
            base = source.baseline(date, config.scope)
            baseline_routes.extend(base["routes"])
            selected = [route for route in enriched if route["date"] == date]
            kpis["by_day"][date] = {"baseline": base["kpis"],
                                   "optimized": metrics(selected, base["kpis"]["requested"])}
            write_json(out / f"view-{date}.json", selected)
        kpis["baseline"] = metrics(baseline_routes, requested, baseline=True)
        if status == "verified":
            original = run_script("kpis.py", source, out)
            if original.returncode:
                print(original.stdout, end="", flush=True)
                raise RuntimeError("The independent KPI script failed.")
            kpis["shop_cost_sharing"] = hedyla_opt.read_csv(str(out), "shop_cost_sharing.csv")
            kpis["changes"] = {
                key: round(100 * (kpis["optimized"][key] - kpis["baseline"][key]) / kpis["baseline"][key], 2)
                for key in ("km", "co2_kg", "cost_eur", "variable_eur")
                if kpis["baseline"][key]
            }
        write_json(out / "report.json", kpis)
    write_json(out / "result.json", {"status": status, "warnings": warnings, "validation": validation,
                                    "unserved_order_ids": missing, "days": days,
                                    "metrics": {key: kpis[key] for key in ("optimized", "baseline", "changes")}
                                    if kpis else None})
    print(f"Result: {status}", flush=True)


if __name__ == "__main__":
    run(Path(sys.argv[1]))
