"""Hedyla daily pickup-and-delivery optimiser (Google OR-Tools).

One independent problem per date (both delivery periods together):
- Fleet: the 24 vehicles in hedyla_vehicles.csv, each used at most once per day,
  starting and ending at a hub depot (default: the most central shop).
- Every order is picked up at its shop and delivered by the same vehicle inside its
  delivery window. Handling at the shop (2 min per order by default) must be finished
  by the end of the shop pickup window (12:00). Since pickups end when deliveries
  start, each vehicle does exactly one tour per day.
- Weight and volume capacity per vehicle; cargo bikes drive at most 40 km per day.
- Travel time: congestion depends on the clock time a leg STARTS (before 12:00 =
  morning, 12:00-15:30 = midday, later = afternoon). Each leg is planned with the
  largest factor of any phase it could start in, times a safety buffer (+15% by
  default), so the plan stays on time if traffic is up to 15% slower than the data.
- Each tour lasts at most 8 hours by default.
- Objective: w_eur * EUR + w_co2 * kgCO2e, where EUR = km * EUR/km + fixed shift cost
  and kgCO2e = km * emission factor, both specific to the vehicle type.
  High-priority orders must arrive in the first half of their window (or, with
  --priority-soft, are penalised when later). Orders can be dropped only at a very
  large penalty; a run with dropped orders exits with code 2.
- Shops with platform_participant = 0 are left on their baseline routes unless
  --all-shops is given.

Usage:
  uv run hedyla_opt.py solve [--dates 2026-11-05 ...] [--time-limit 60] [--jobs 8]
  uv run hedyla_opt.py pareto --date 2026-11-05
"""
import argparse
import csv
import json
import math
import os
import sys
import time as _time
from concurrent.futures import ProcessPoolExecutor

from ortools.constraint_solver import pywrapcp, routing_enums_pb2

HERE = os.path.dirname(os.path.abspath(__file__))
SCALE = 1000            # objective units per EUR (and per kgCO2e at weight 1)
DROP_PENALTY = 10**9    # per dropped node; far above any real route cost
HORIZON = 24 * 3600
NOON, MID_END = 12 * 3600, 15 * 3600 + 30 * 60   # phase boundaries, as in the order windows
ROUTE_COLUMNS = ["route_id", "date", "vehicle_id", "vehicle_type", "orders", "shops_visited", "total_km",
                 "driving_time_min", "service_time_min", "start", "end", "peak_load_kg", "peak_load_m3",
                 "estimated_cost_eur", "estimated_emissions_kgco2e"]
STOP_COLUMNS = ["route_id", "date", "vehicle_id", "vehicle_type", "stop_seq", "kind", "order_id", "location",
                "arrival_s", "arrival", "load_kg_after", "load_m3_after"]


# ----------------------------------------------------------------------------- data
def read_csv(data_dir, name):
    with open(os.path.join(data_dir, name), encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def hhmm_to_s(s):
    h, m = s.split(":")
    return int(h) * 3600 + int(m) * 60


def s_to_hhmm(s):
    s = int(round(s))
    return f"{s // 3600:02d}:{(s % 3600) // 60:02d}"


def phase_at(t):
    """Congestion phase for a leg that starts at clock time t (seconds after midnight)."""
    return "morning" if t < NOON else ("midday" if t < MID_END else "afternoon")


def phases_between(a, b):
    """Phases a leg can start in when it leaves no earlier than a and arrives no later than b."""
    if b < a:
        return []
    return [p for p, lo, hi in (("morning", 0, NOON), ("midday", NOON, MID_END), ("afternoon", MID_END, HORIZON))
            if a < hi and b >= lo]


class Data:
    def __init__(self, data_dir):
        self.dir = data_dir
        self.shops = {r["shop_id"]: r for r in read_csv(data_dir, "hedyla_shops.csv")}
        self.dests = {r["destination_id"]: r for r in read_csv(data_dir, "hedyla_destinations.csv")}
        self.orders = read_csv(data_dir, "hedyla_orders.csv")
        self.dates = sorted({o["date"] for o in self.orders})
        self.vehicles = read_csv(data_dir, "hedyla_vehicles.csv")
        self.cong = {(r["date"], r["time_period"]): float(r["time_factor"])
                     for r in read_csv(data_dir, "hedyla_congestion.csv")}
        self.locs = list(self.shops) + list(self.dests)
        self.li = {n: i for i, n in enumerate(self.locs)}
        n = len(self.locs)
        self.km = [[0.0] * n for _ in range(n)]
        self.tmin = [[0.0] * n for _ in range(n)]
        for r in read_csv(data_dir, "hedyla_distance_matrix.csv"):
            a, b = self.li[r["origin_node"]], self.li[r["destination_node"]]
            self.km[a][b] = self.km[b][a] = float(r["distance_km"])
            self.tmin[a][b] = self.tmin[b][a] = float(r["base_travel_time_min"])

    def participant(self, shop_id):
        return self.shops[shop_id]["platform_participant"] == "1"

    def central_shop(self):
        dest_idx = [self.li[d] for d in self.dests]
        return min(self.shops, key=lambda s: sum(self.km[self.li[s]][j] for j in dest_idx))


_DATA = None


def get_data(data_dir):
    global _DATA
    if _DATA is None or _DATA.dir != data_dir:
        _DATA = Data(data_dir)
    return _DATA


# ----------------------------------------------------------------------------- model
def solve_day(date, cfg):
    data = get_data(cfg["data"])
    t0 = _time.time()
    orders = [o for o in data.orders
              if o["date"] == date and (cfg["all_shops"] or data.participant(o["shop_id"]))]
    depot = cfg["depot"]
    pick_svc = int(round(cfg["pickup_service_min"] * 60))

    # nodes: 0 = depot, then (pickup, delivery) per order; win = allowed arrival (service start) times
    loc, kind, svc, win = [data.li[depot]], ["depot"], [0], [(hhmm_to_s(cfg["day_start"]), hhmm_to_s(cfg["day_end"]))]
    for o in orders:
        shop = data.shops[o["shop_id"]]
        loc.append(data.li[o["shop_id"]]); kind.append("pickup"); svc.append(pick_svc)
        # handling must be finished when the shop stops handing over goods
        win.append((hhmm_to_s(shop["pickup_window_start"]), hhmm_to_s(shop["pickup_window_end"]) - pick_svc))
        loc.append(data.li[o["destination_id"]]); kind.append("delivery")
        svc.append(int(round(float(o["service_time_min"]) * 60)))
        a, b = hhmm_to_s(o["delivery_window_start"]), hhmm_to_s(o["delivery_window_end"])
        if cfg["priority_hard"] and o["priority"] == "high":
            b = a + (b - a) // 2
        win.append((a, b))
    N = len(loc)

    # matrices (integer): planned travel + service seconds, and per-vehicle-type arc cost
    T = [[0] * N for _ in range(N)]
    vtypes = {v["type"]: v for v in data.vehicles}
    C = {t: [[0] * N for _ in range(N)] for t in vtypes}
    unit = {t: SCALE * (cfg["w_eur"] * float(v["cost_eur_per_km"]) + cfg["w_co2"] * float(v["emissions_kgco2e_per_km"]))
            for t, v in vtypes.items()}
    worst = {}  # (earliest departure, latest arrival) -> worst congestion factor
    for i in range(N):
        li, Ti = loc[i], T[i]
        kmrow, trow = data.km[li], data.tmin[li]
        for j in range(N):
            if i == j:
                continue
            lj = loc[j]
            dom = (win[i][0] + svc[i], win[j][1])
            if dom not in worst:
                worst[dom] = max((data.cong[(date, p)] for p in phases_between(*dom)), default=0.0)
            f = worst[dom]
            Ti[j] = (math.ceil(trow[lj] * 60 * f * cfg["travel_buffer"] - 1e-9) + svc[i]) if f else HORIZON + 1
            km = kmrow[lj]
            for t in vtypes:
                C[t][i][j] = int(round(km * unit[t]))

    enabled = cfg.get("vehicle_ids")
    V = data.vehicles if enabled is None else [v for v in data.vehicles if v["vehicle_id"] in enabled]
    manager = pywrapcp.RoutingIndexManager(N, len(V), 0)
    routing = pywrapcp.RoutingModel(manager)
    solver = routing.solver()

    cost_cb = {t: routing.RegisterTransitMatrix(C[t]) for t in vtypes}
    for v, veh in enumerate(V):
        routing.SetArcCostEvaluatorOfVehicle(cost_cb[veh["type"]], v)
        routing.SetFixedCostOfVehicle(int(round(SCALE * cfg["w_eur"] * float(veh["fixed_shift_cost_eur"]))), v)

    w = [0] * N
    vol = [0] * N
    for k, o in enumerate(orders):
        g, cm3 = int(round(float(o["weight_kg"]) * 1000)), int(round(float(o["volume_m3"]) * 1e6))
        w[1 + 2 * k], w[2 + 2 * k] = g, -g
        vol[1 + 2 * k], vol[2 + 2 * k] = cm3, -cm3
    routing.AddDimensionWithVehicleCapacity(routing.RegisterUnaryTransitVector(w), 0,
                                            [int(round(float(v["capacity_kg"]) * 1000)) for v in V], True, "Weight")
    routing.AddDimensionWithVehicleCapacity(routing.RegisterUnaryTransitVector(vol), 0,
                                            [int(round(float(v["capacity_m3"]) * 1e6)) for v in V], True, "Volume")

    if cfg["cargo_max_km"]:
        dist_m = [[int(round(data.km[loc[i]][loc[j]] * 1000)) for j in range(N)] for i in range(N)]
        no_limit = 10**9
        routing.AddDimensionWithVehicleCapacity(
            routing.RegisterTransitMatrix(dist_m), 0,
            [int(cfg["cargo_max_km"] * 1000) if v["type"] == "cargo_bike" else no_limit for v in V], True, "Range")

    routing.AddDimension(routing.RegisterTransitMatrix(T), HORIZON, HORIZON, False, "Time")
    tdim = routing.GetDimensionOrDie("Time")
    for node in range(1, N):
        tdim.CumulVar(manager.NodeToIndex(node)).SetRange(*win[node])
    for v in range(len(V)):
        for idx in (routing.Start(v), routing.End(v)):
            tdim.CumulVar(idx).SetRange(*win[0])
        if cfg["max_shift_h"]:
            tdim.SetSpanUpperBoundForVehicle(int(cfg["max_shift_h"] * 3600), v)
        routing.AddVariableMaximizedByFinalizer(tdim.CumulVar(routing.Start(v)))
        routing.AddVariableMinimizedByFinalizer(tdim.CumulVar(routing.End(v)))

    for k, o in enumerate(orders):
        p, d = manager.NodeToIndex(1 + 2 * k), manager.NodeToIndex(2 + 2 * k)
        routing.AddPickupAndDelivery(p, d)
        solver.Add(routing.VehicleVar(p) == routing.VehicleVar(d))
        solver.Add(tdim.CumulVar(p) <= tdim.CumulVar(d))
        routing.AddDisjunction([p], DROP_PENALTY)
        routing.AddDisjunction([d], DROP_PENALTY)
        if o["priority"] == "high" and not cfg["priority_hard"] and cfg["priority_weight"] > 0:
            a, b = hhmm_to_s(o["delivery_window_start"]), hhmm_to_s(o["delivery_window_end"])
            tdim.SetCumulVarSoftUpperBound(d, a + (b - a) // 2, int(cfg["priority_weight"]))

    params = pywrapcp.DefaultRoutingSearchParameters()
    # Use local insertion to seed the heterogeneous fleet. Cost-aware insertion
    # worked better on participant scope, while local insertion covered all shops.
    default_strategy = "LOCAL_CHEAPEST_INSERTION" if cfg["all_shops"] else "LOCAL_CHEAPEST_COST_INSERTION"
    params.first_solution_strategy = getattr(
        routing_enums_pb2.FirstSolutionStrategy, cfg.get("first_solution_strategy", default_strategy)
    )
    params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    params.time_limit.FromSeconds(int(cfg["time_limit"]))
    sol = routing.SolveWithParameters(params)
    build_and_solve_s = round(_time.time() - t0, 1)
    if sol is None:
        return {"date": date, "status": "NO_SOLUTION", "orders": len(orders), "seconds": build_and_solve_s,
                "routes": [], "stops": [], "dropped": [o["order_id"] for o in orders]}

    # ------------------------------------------------------------------ extract
    routes, stops, visited = [], [], set()
    for v, veh in enumerate(V):
        if not routing.IsVehicleUsed(sol, v):
            continue
        rid = f"{date}_{veh['vehicle_id']}"
        seq, idx = [], routing.Start(v)
        while True:
            seq.append((manager.IndexToNode(idx), sol.Value(tdim.CumulVar(idx))))
            if routing.IsEnd(idx):
                break
            idx = sol.Value(routing.NextVar(idx))
        km = drive = service = 0.0
        load_w = load_v = peak_w = peak_v = 0
        n_orders = 0
        for s, (node, t) in enumerate(seq):
            if s > 0:
                prev, t_prev = seq[s - 1]
                km += data.km[loc[prev]][loc[node]]
                # expected driving time: data factor for the phase the leg starts in (no buffer)
                drive += data.tmin[loc[prev]][loc[node]] * data.cong[(date, phase_at(t_prev + svc[prev]))]
            service += svc[node] / 60
            load_w += w[node]; load_v += vol[node]
            peak_w, peak_v = max(peak_w, load_w), max(peak_v, load_v)
            oid = orders[(node - 1) // 2]["order_id"] if node > 0 else ""
            if kind[node] == "delivery":
                n_orders += 1
            visited.add(node)
            stops.append({"route_id": rid, "date": date, "vehicle_id": veh["vehicle_id"], "vehicle_type": veh["type"],
                          "stop_seq": s, "kind": kind[node], "order_id": oid, "location": data.locs[loc[node]],
                          "arrival_s": t, "arrival": s_to_hhmm(t), "load_kg_after": round(load_w / 1000, 3),
                          "load_m3_after": round(load_v / 1e6, 4)})
        cost = km * float(veh["cost_eur_per_km"]) + float(veh["fixed_shift_cost_eur"])
        routes.append({"route_id": rid, "date": date, "vehicle_id": veh["vehicle_id"], "vehicle_type": veh["type"],
                       "orders": n_orders, "shops_visited": len({orders[(n - 1) // 2]["shop_id"] for n, _ in seq if kind[n] == "pickup"}),
                       "total_km": round(km, 3), "driving_time_min": round(drive, 2), "service_time_min": round(service, 2),
                       "start": s_to_hhmm(seq[0][1]), "end": s_to_hhmm(seq[-1][1]),
                       "peak_load_kg": round(peak_w / 1000, 3), "peak_load_m3": round(peak_v / 1e6, 4),
                       "estimated_cost_eur": round(cost, 2),
                       "estimated_emissions_kgco2e": round(km * float(veh["emissions_kgco2e_per_km"]), 3)})
    dropped = [orders[k]["order_id"] for k in range(len(orders)) if (2 + 2 * k) not in visited]
    return {"date": date, "status": "INCOMPLETE" if dropped else "OK", "orders": len(orders),
            "seconds": build_and_solve_s, "objective": sol.ObjectiveValue(),
            "routes": routes, "stops": stops, "dropped": dropped}


def _solve_job(job):
    date, cfg = job
    return solve_day(date, cfg)


# ----------------------------------------------------------------------------- reporting
def totals(routes):
    return {"routes": len(routes),
            "total_km": round(sum(float(r["total_km"]) for r in routes), 1),
            "cost_eur": round(sum(float(r["estimated_cost_eur"]) for r in routes), 2),
            "emissions_kgco2e": round(sum(float(r["estimated_emissions_kgco2e"]) for r in routes), 2),
            "driving_h": round(sum(float(r["driving_time_min"]) for r in routes) / 60, 1),
            "by_type": {t: sum(1 for r in routes if r["vehicle_type"] == t)
                        for t in sorted({r["vehicle_type"] for r in routes})}}


def write_csv(path, rows, columns):
    """Always writes the file (header only when empty) so no stale file from an earlier run survives."""
    with open(path, "w", newline="", encoding="utf-8") as f:
        wr = csv.DictWriter(f, fieldnames=columns)
        wr.writeheader()
        wr.writerows(rows)


def pct(new, old):
    return f"{(new - old) / old * 100:+.1f}%" if old else "n/a"


def baseline_routes(cfg):
    data = read_csv(cfg["data"], "hedyla_baseline_routes.csv")
    shops = get_data(cfg["data"]).shops
    in_scope = lambda r: cfg["all_shops"] or shops[r["shop_id"]]["platform_participant"] == "1"
    return [r for r in data if in_scope(r)], [r for r in data if not in_scope(r)]


def cmd_solve(args, cfg, dates):
    jobs = [(d, cfg) for d in dates]
    print(f"Depot: {cfg['depot']} | dates: {len(dates)} | time limit {cfg['time_limit']}s/day | jobs {args.jobs} | "
          f"travel buffer x{cfg['travel_buffer']}", flush=True)
    results = []

    def keep(r):
        results.append(r)
        print(f"  {r['date']}: {r['status']} orders={r['orders']} routes={len(r['routes'])} dropped={len(r['dropped'])} ({r['seconds']}s)", flush=True)

    if args.jobs > 1 and len(jobs) > 1:
        with ProcessPoolExecutor(max_workers=args.jobs) as ex:
            for r in ex.map(_solve_job, jobs):
                keep(r)
    else:
        for j in jobs:
            keep(_solve_job(j))

    os.makedirs(args.out, exist_ok=True)
    for stale in ("kpis.json", "shop_cost_sharing.csv"):   # belong to an earlier run
        try:
            os.remove(os.path.join(args.out, stale))
        except FileNotFoundError:
            pass
    routes = [x for r in results for x in r["routes"]]
    stops = [x for r in results for x in r["stops"]]
    dropped = [x for r in results for x in r["dropped"]]
    write_csv(os.path.join(args.out, "routes.csv"), routes, ROUTE_COLUMNS)
    write_csv(os.path.join(args.out, "stops.csv"), stops, STOP_COLUMNS)

    ds = set(dates)
    b_in, b_out = baseline_routes(cfg)
    base_in = [r for r in b_in if r["date"] in ds]
    base_out = [r for r in b_out if r["date"] in ds]
    opt, bas = totals(routes), totals(base_in)
    summary = {"status": "INCOMPLETE" if dropped else "COMPLETE",
               "config": {k: v for k, v in cfg.items() if k != "data"},  # no machine-specific paths
               "dates": dates, "dropped_orders": dropped,
               "optimised": opt, "baseline_same_orders": bas,
               "baseline_out_of_scope": totals(base_out),
               "network_total_optimised": totals(routes + base_out),
               "network_total_baseline": totals(base_in + base_out)}
    with open(os.path.join(args.out, "summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    print("\n=== Optimised vs baseline (same orders) ===")
    print(f"{'metric':<18}{'baseline':>12}{'optimised':>12}{'change':>10}")
    for k, lab in [("routes", "routes/vehicles"), ("total_km", "km"), ("cost_eur", "cost EUR"),
                   ("emissions_kgco2e", "kgCO2e"), ("driving_h", "driving h")]:
        print(f"{lab:<18}{bas[k]:>12}{opt[k]:>12}{pct(opt[k], bas[k]):>10}")
    print(f"vehicle types used: {opt['by_type']}   dropped orders: {len(dropped)}")
    nt, nb = summary["network_total_optimised"], summary["network_total_baseline"]
    if base_out:
        print(f"\nWhole network incl. {len(base_out)} unchanged non-participant routes: "
              f"kgCO2e {nb['emissions_kgco2e']} -> {nt['emissions_kgco2e']} ({pct(nt['emissions_kgco2e'], nb['emissions_kgco2e'])}), "
              f"EUR {nb['cost_eur']} -> {nt['cost_eur']} ({pct(nt['cost_eur'], nb['cost_eur'])})")
    print(f"\nWrote {args.out}/routes.csv, stops.csv, summary.json")
    if dropped:
        print(f"WARNING: {len(dropped)} orders could not be planned; comparisons above are not valid.")
        return 2
    return 0


def cmd_pareto(args, cfg, dates):
    """Weight sweep: minimise EUR + w_co2 * kgCO2e for increasing carbon weights; keep non-dominated points."""
    date = dates[0]
    weights = [float(x) for x in args.co2_weights.split(",")]
    jobs = [(date, dict(cfg, w_eur=1.0, w_co2=wc)) for wc in weights]
    jobs.append((date, dict(cfg, w_eur=0.0, w_co2=1.0)))  # pure CO2 minimum
    with ProcessPoolExecutor(max_workers=min(args.jobs, len(jobs))) as ex:
        res = list(ex.map(_solve_job, jobs))
    pts = []
    for (d, c), r in zip(jobs, res):
        t = totals(r["routes"])
        pts.append({"w_eur": c["w_eur"], "w_co2_eur_per_kg": c["w_co2"], "cost_eur": t["cost_eur"],
                    "emissions_kgco2e": t["emissions_kgco2e"], "total_km": t["total_km"], "routes": t["routes"],
                    "by_type": json.dumps(t["by_type"]), "dropped": len(r["dropped"]), "pareto_optimal": False})
    complete = [p for p in pts if p["dropped"] == 0]   # a plan that drops orders is never on the front
    for p in complete:
        p["pareto_optimal"] = not any(q["cost_eur"] <= p["cost_eur"] and q["emissions_kgco2e"] <= p["emissions_kgco2e"]
                                      and (q["cost_eur"], q["emissions_kgco2e"]) != (p["cost_eur"], p["emissions_kgco2e"])
                                      for q in complete)
    b_in, _ = baseline_routes(cfg)
    base = totals([r for r in b_in if r["date"] == date])
    os.makedirs(args.out, exist_ok=True)
    path = os.path.join(args.out, f"pareto_{date}.csv")
    write_csv(path, pts, list(pts[0].keys()))
    print(f"Baseline {date}: cost {base['cost_eur']} EUR, {base['emissions_kgco2e']} kgCO2e, {base['routes']} routes")
    print(f"{'w_co2':>7}{'cost EUR':>11}{'kgCO2e':>9}{'km':>8}{'routes':>8}{'dropped':>9}  types / pareto")
    for p in pts:
        print(f"{p['w_co2_eur_per_kg']:>7}{p['cost_eur']:>11}{p['emissions_kgco2e']:>9}{p['total_km']:>8}{p['routes']:>8}"
              f"{p['dropped']:>9}  {p['by_type']} {'*' if p['pareto_optimal'] else ''}")
    print(f"Wrote {path}")
    return 0 if complete else 2


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default=os.path.normpath(os.path.join(HERE, "..")), help="folder with the Hedyla CSVs")
    ap.add_argument("--out", default=os.path.join(HERE, "output"))
    ap.add_argument("--time-limit", type=int, default=60, help="solver seconds per day")
    ap.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 2) // 2))
    ap.add_argument("--w-eur", type=float, default=1.0, help="objective weight per EUR")
    ap.add_argument("--w-co2", type=float, default=1.0, help="objective weight per kgCO2e (EUR-equivalent)")
    ap.add_argument("--priority-weight", type=float, default=1.0,
                    help="penalty (0.001 EUR-equivalent) per second a high-priority order arrives after its window midpoint")
    ap.add_argument("--priority-soft", action="store_true",
                    help="make the high-priority rule a penalty (--priority-weight) instead of the default hard rule "
                         "that high-priority orders arrive in the first half of their window")
    ap.add_argument("--pickup-service-min", type=float, default=2.0, help="handling minutes per order at the shop")
    ap.add_argument("--max-shift-h", type=float, default=8.0, help="max vehicle tour duration in hours (0 = no limit)")
    ap.add_argument("--cargo-max-km", type=float, default=40.0, help="max km per cargo bike per day (0 = no limit)")
    ap.add_argument("--travel-buffer", type=float, default=1.15,
                    help="planned travel time = data time x worst congestion factor x this buffer (1.0 = no buffer)")
    ap.add_argument("--day-start", default="08:00")
    ap.add_argument("--day-end", default="22:00")
    ap.add_argument("--depot", default="central", help="shop id used as hub, or 'central'")
    ap.add_argument("--all-shops", action="store_true", help="also consolidate non-participant shops")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("solve")
    s.add_argument("--dates", nargs="*")
    p = sub.add_parser("pareto")
    p.add_argument("--date", required=True)
    p.add_argument("--co2-weights", default="0,0.1,0.3,1,3,10,30")
    args = ap.parse_args()

    if args.time_limit <= 0 or args.jobs <= 0:
        ap.error("--time-limit and --jobs must be positive")
    if not (1.0 <= args.travel_buffer <= 3.0 and args.pickup_service_min >= 0 and args.max_shift_h >= 0
            and args.cargo_max_km >= 0):
        ap.error("invalid --travel-buffer (1..3), --pickup-service-min, --max-shift-h or --cargo-max-km")
    data = get_data(args.data)
    dates = (args.dates or data.dates) if args.cmd == "solve" else [args.date]
    unknown = sorted(set(dates) - set(data.dates))
    if unknown or len(set(dates)) != len(dates):
        ap.error(f"dates must be unique and present in the data; unknown: {unknown}")
    depot = data.central_shop() if args.depot == "central" else args.depot
    if depot not in data.shops:
        ap.error(f"unknown depot {depot}")
    cfg = {"data": args.data, "depot": depot, "time_limit": args.time_limit, "w_eur": args.w_eur, "w_co2": args.w_co2,
           "priority_weight": args.priority_weight, "priority_hard": not args.priority_soft,
           "pickup_service_min": args.pickup_service_min, "max_shift_h": args.max_shift_h or None,
           "cargo_max_km": args.cargo_max_km or None, "travel_buffer": args.travel_buffer,
           "timing": "departure_phase_worst_case", "day_start": args.day_start, "day_end": args.day_end,
           "all_shops": args.all_shops}
    return (cmd_solve if args.cmd == "solve" else cmd_pareto)(args, cfg, sorted(dates))


if __name__ == "__main__":
    sys.exit(main())
