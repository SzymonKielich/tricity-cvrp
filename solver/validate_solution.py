"""Independent checker for solver output: re-derives everything from the raw Hedyla CSVs.

Does not import the solver. Checks file consistency (no duplicate or orphan routes), every hard
constraint, and recomputes every number in routes.csv from the stops and the raw data.
Timing rule: congestion factor of the phase in which a leg STARTS (before 12:00 morning,
12:00-15:30 midday, later afternoon), times the run's travel buffer.

Usage: uv run validate_solution.py [--out output]     exit code 0 = all checks passed
"""
import argparse
import csv
import json
import os
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
NOON, MID_END = 12 * 3600, 15 * 3600 + 30 * 60


def read(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def hhmm_to_s(s):
    h, m = s.split(":")
    return int(h) * 3600 + int(m) * 60


def s_to_hhmm(s):
    s = int(round(s))
    return f"{s // 3600:02d}:{(s % 3600) // 60:02d}"


def phase_at(t):
    return "morning" if t < NOON else ("midday" if t < MID_END else "afternoon")


CHECKS = [
    "summary dates not in data", "duplicate route_id in routes.csv", "route without stops", "stops without route row",
    "route row inconsistent with stops", "vehicle type mismatch", "stop_seq not 0..n", "route not depot-to-depot",
    "order wrong date / unknown", "pickup at wrong shop", "delivery at wrong destination",
    "delivery before pickup / other vehicle", "pickup window violated (handling done by close)",
    "delivery window violated", "high-priority after window midpoint", "capacity exceeded",
    "travel time not respected", "vehicle not empty at end", "shift too long", "cargo bike over range",
    "vehicle used twice in a day", "order not served exactly once", "dropped list inconsistent",
    "out-of-scope order served", "orders/shops_visited mismatch", "start/end mismatch", "peak load mismatch",
    "load_after mismatch", "km mismatch", "cost mismatch", "CO2 mismatch", "driving time mismatch",
    "service time mismatch",
    "vehicle unavailable in scenario", "invalid stop kind", "arrival timestamps out of order",
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=os.path.normpath(os.path.join(HERE, "..")))
    ap.add_argument("--out", default=os.path.join(HERE, "output"))
    a = ap.parse_args()
    D = lambda f: os.path.join(a.data, f)

    summ = json.load(open(os.path.join(a.out, "summary.json"), encoding="utf-8"))
    cfg, dates = summ["config"], set(summ["dates"])
    buffer = cfg.get("travel_buffer", 1.0)
    pick_svc = round(cfg.get("pickup_service_min", 0) * 60)
    shops = {r["shop_id"]: r for r in read(D("hedyla_shops.csv"))}
    orders = {r["order_id"]: r for r in read(D("hedyla_orders.csv"))}
    veh = {r["vehicle_id"]: r for r in read(D("hedyla_vehicles.csv"))}
    enabled = set(cfg.get("vehicle_ids", veh))
    cong = {(r["date"], r["time_period"]): float(r["time_factor"]) for r in read(D("hedyla_congestion.csv"))}
    km, tm = {}, {}
    for r in read(D("hedyla_distance_matrix.csv")):
        for k in ((r["origin_node"], r["destination_node"]), (r["destination_node"], r["origin_node"])):
            km[k], tm[k] = float(r["distance_km"]), float(r["base_travel_time_min"])
    dist = lambda x, y: 0.0 if x == y else km[(x, y)]
    tmin = lambda x, y: 0.0 if x == y else tm[(x, y)]

    route_rows = read(os.path.join(a.out, "routes.csv"))
    stops = defaultdict(list)
    for s in read(os.path.join(a.out, "stops.csv")):
        stops[s["route_id"]].append(s)

    errors = defaultdict(list)
    err = lambda kind, msg: errors[kind].append(msg)

    data_dates = {o["date"] for o in orders.values()}
    for d in sorted(dates - data_dates):
        err("summary dates not in data", d)
    for rid, c in Counter(r["route_id"] for r in route_rows).items():
        if c > 1:
            err("duplicate route_id in routes.csv", (rid, c))
    routes = {r["route_id"]: r for r in route_rows}
    for rid in routes.keys() - stops.keys():
        err("route without stops", rid)
    for rid in stops.keys() - routes.keys():
        err("stops without route row", rid)

    in_scope = {o for o, r in orders.items() if r["date"] in dates
                and (cfg["all_shops"] or shops[r["shop_id"]]["platform_participant"] == "1")}
    seen_p, seen_d = Counter(), Counter()
    vehicle_day = Counter()

    for rid in sorted(stops.keys() & routes.keys()):
        ss = sorted(stops[rid], key=lambda s: int(s["stop_seq"]))
        r = routes[rid]
        v = veh.get(r["vehicle_id"])
        if v is None or v["type"] != r["vehicle_type"]:
            err("vehicle type mismatch", rid); continue
        if r["vehicle_id"] not in enabled:
            err("vehicle unavailable in scenario", (rid, r["vehicle_id"]))
        if any((s["date"], s["vehicle_id"], s["vehicle_type"]) != (r["date"], r["vehicle_id"], r["vehicle_type"]) for s in ss):
            err("route row inconsistent with stops", rid)
        if [int(s["stop_seq"]) for s in ss] != list(range(len(ss))):
            err("stop_seq not 0..n", rid)
        vehicle_day[(r["date"], r["vehicle_id"])] += 1
        kinds = [s["kind"] for s in ss]
        if any(kind not in {"depot", "pickup", "delivery"} for kind in kinds):
            err("invalid stop kind", rid)
        arrival_times = [int(s["arrival_s"]) for s in ss]
        if arrival_times != sorted(arrival_times):
            err("arrival timestamps out of order", rid)
        if (len(ss) < 2 or kinds[0] != "depot" or kinds[-1] != "depot" or "depot" in kinds[1:-1]
                or ss[0]["location"] != cfg["depot"] or ss[-1]["location"] != cfg["depot"]):
            err("route not depot-to-depot", rid)
        date = r["date"]
        wl = vl = peak_w = peak_v = 0.0
        picked, shops_seen = set(), set()
        n_del = 0
        tot_km = drive = service = 0.0
        for i, s in enumerate(ss):
            t = int(s["arrival_s"])
            o = orders.get(s["order_id"]) if s["kind"] != "depot" else None
            if s["kind"] != "depot" and (o is None or o["date"] != date):
                err("order wrong date / unknown", (rid, s["order_id"])); continue
            svc_here = 0.0
            if s["kind"] == "pickup":
                seen_p[s["order_id"]] += 1
                picked.add(s["order_id"]); shops_seen.add(o["shop_id"])
                if s["location"] != o["shop_id"]:
                    err("pickup at wrong shop", (rid, s["order_id"]))
                sh = shops[o["shop_id"]]
                if not hhmm_to_s(sh["pickup_window_start"]) <= t <= hhmm_to_s(sh["pickup_window_end"]) - pick_svc:
                    err("pickup window violated (handling done by close)", (rid, s["order_id"], s_to_hhmm(t)))
                wl += float(o["weight_kg"]); vl += float(o["volume_m3"])
                svc_here = pick_svc
            elif s["kind"] == "delivery":
                seen_d[s["order_id"]] += 1
                n_del += 1
                if s["order_id"] not in picked:
                    err("delivery before pickup / other vehicle", (rid, s["order_id"]))
                if s["location"] != o["destination_id"]:
                    err("delivery at wrong destination", (rid, s["order_id"]))
                lo, hi = hhmm_to_s(o["delivery_window_start"]), hhmm_to_s(o["delivery_window_end"])
                if not lo <= t <= hi:
                    err("delivery window violated", (rid, s["order_id"], s_to_hhmm(t)))
                if cfg.get("priority_hard") and o["priority"] == "high" and t > lo + (hi - lo) // 2:
                    err("high-priority after window midpoint", (rid, s["order_id"], s_to_hhmm(t)))
                wl -= float(o["weight_kg"]); vl -= float(o["volume_m3"])
                svc_here = float(o["service_time_min"]) * 60
            elif not hhmm_to_s(cfg["day_start"]) <= t <= hhmm_to_s(cfg["day_end"]):
                err("route not depot-to-depot", (rid, "outside operating hours", s_to_hhmm(t)))
            service += svc_here / 60
            peak_w, peak_v = max(peak_w, wl), max(peak_v, vl)
            if wl > float(v["capacity_kg"]) + 1e-6 or vl > float(v["capacity_m3"]) + 1e-9:
                err("capacity exceeded", (rid, s["stop_seq"], round(wl, 2), round(vl, 4)))
            if abs(wl - float(s["load_kg_after"])) > 0.002 or abs(vl - float(s["load_m3_after"])) > 0.0002:
                err("load_after mismatch", (rid, s["stop_seq"]))
            if i + 1 < len(ss):
                nxt = ss[i + 1]
                dep = t + svc_here
                f = cong[(date, phase_at(dep))]
                leg_t = tmin(s["location"], nxt["location"])
                tot_km += dist(s["location"], nxt["location"])
                drive += leg_t * f
                if int(nxt["arrival_s"]) + 1 < dep + leg_t * 60 * f * buffer:
                    err("travel time not respected", (rid, nxt["stop_seq"], s_to_hhmm(int(nxt["arrival_s"]))))
        if abs(wl) > 1e-6 or abs(vl) > 1e-9:
            err("vehicle not empty at end", rid)
        span = int(ss[-1]["arrival_s"]) - int(ss[0]["arrival_s"])
        if cfg.get("max_shift_h") and span > cfg["max_shift_h"] * 3600 + 1:
            err("shift too long", (rid, round(span / 3600, 2)))
        if cfg.get("cargo_max_km") and v["type"] == "cargo_bike" and tot_km > cfg["cargo_max_km"] + 1e-6:
            err("cargo bike over range", (rid, round(tot_km, 2)))
        if int(r["orders"]) != n_del or int(r["shops_visited"]) != len(shops_seen):
            err("orders/shops_visited mismatch", (rid, r["orders"], n_del, r["shops_visited"], len(shops_seen)))
        if r["start"] != s_to_hhmm(int(ss[0]["arrival_s"])) or r["end"] != s_to_hhmm(int(ss[-1]["arrival_s"])):
            err("start/end mismatch", rid)
        if abs(peak_w - float(r["peak_load_kg"])) > 0.002 or abs(peak_v - float(r["peak_load_m3"])) > 0.0002:
            err("peak load mismatch", rid)
        cost = tot_km * float(v["cost_eur_per_km"]) + float(v["fixed_shift_cost_eur"])
        co2 = tot_km * float(v["emissions_kgco2e_per_km"])
        if abs(tot_km - float(r["total_km"])) > 0.002: err("km mismatch", (rid, round(tot_km, 3), r["total_km"]))
        if abs(cost - float(r["estimated_cost_eur"])) > 0.006: err("cost mismatch", (rid, round(cost, 2), r["estimated_cost_eur"]))
        if abs(co2 - float(r["estimated_emissions_kgco2e"])) > 0.0006: err("CO2 mismatch", (rid, round(co2, 3), r["estimated_emissions_kgco2e"]))
        if abs(drive - float(r["driving_time_min"])) > 0.01: err("driving time mismatch", (rid, round(drive, 2), r["driving_time_min"]))
        if abs(service - float(r["service_time_min"])) > 0.01: err("service time mismatch", (rid, round(service, 2), r["service_time_min"]))

    for k, c in vehicle_day.items():
        if c > 1:
            err("vehicle used twice in a day", k)
    dropped = set(summ["dropped_orders"])
    for o in in_scope:
        served = seen_p[o] == 1 and seen_d[o] == 1
        if o in dropped:
            if seen_p[o] or seen_d[o]:
                err("dropped list inconsistent", (o, "listed as dropped but served"))
        elif not served:
            err("order not served exactly once", (o, seen_p[o], seen_d[o]))
    for o in dropped - in_scope:
        err("dropped list inconsistent", (o, "not an in-scope order"))
    for o in set(seen_p) | set(seen_d):
        if o not in in_scope:
            err("out-of-scope order served", o)

    print(f"Checked {len(routes)} routes, {sum(len(v) for v in stops.values())} stops, {len(in_scope)} in-scope orders, "
          f"{len(dropped)} dropped | travel buffer x{buffer}")
    for c in CHECKS + [k for k in errors if k not in CHECKS]:
        e = errors.get(c, [])
        print(f"[{'OK ' if not e else 'BAD'}] {c}: {len(e)}" + (f"  e.g. {e[:3]}" if e else ""))
    if dropped:
        print(f"INCOMPLETE: {len(dropped)} orders were not planned")
    raise SystemExit(1 if errors or dropped else 0)


if __name__ == "__main__":
    main()
