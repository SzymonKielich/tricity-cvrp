"""Challenge KPIs from the COM-E1 brief, baseline vs optimised, plus a per-shop cost-sharing check.

Everything is recomputed from output/stops.csv and the raw CSVs (routes.csv totals are not trusted).
All clock times in this file are MINUTES after midnight.

KPIs (brief, "Challenge KPIs"):
  Climate:  distance travelled and reduction (km); transport emissions and reduction (kgCO2e, %)
  Economic: total and variable cost, cost per delivery (EUR) and savings; on-time rate (%);
            vehicle utilisation (% of load, distance-weighted); shops taking part and % of orders grouped
Cost sharing (brief, "Pilot tip"): each shared route's cost is split over its orders in
proportion to the order's stand-alone round trip (shop -> destination -> shop); every shop's
share is compared with what its own baseline routes cost.

Usage: uv run kpis.py [--out output] [--allow-incomplete]
"""
import argparse
import csv
import json
import os
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
NOON_MIN, MID_END_MIN = 12 * 60, 15 * 60 + 30


def read(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def hhmm_to_min(s):
    h, m = s.split(":")
    return int(h) * 60 + int(m)


def phase_at_min(t):
    return "morning" if t < NOON_MIN else ("midday" if t < MID_END_MIN else "afternoon")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=os.path.normpath(os.path.join(HERE, "..")))
    ap.add_argument("--out", default=os.path.join(HERE, "output"))
    ap.add_argument("--allow-incomplete", action="store_true", help="report even if some orders were not planned")
    a = ap.parse_args()
    D = lambda f: os.path.join(a.data, f)

    summ = json.load(open(os.path.join(a.out, "summary.json"), encoding="utf-8"))
    cfg, dates = summ["config"], set(summ["dates"])
    if summ["dropped_orders"] and not a.allow_incomplete:
        raise SystemExit(f"INCOMPLETE run: {len(summ['dropped_orders'])} orders not planned; comparisons would be "
                         "misleading. Re-run the solver or pass --allow-incomplete.")
    pick_svc_min = cfg.get("pickup_service_min", 0)
    shops = {r["shop_id"]: r for r in read(D("hedyla_shops.csv"))}
    orders = {r["order_id"]: r for r in read(D("hedyla_orders.csv"))}
    veh_t = {r["type"]: r for r in read(D("hedyla_vehicles.csv"))}
    cong = {(r["date"], r["time_period"]): float(r["time_factor"]) for r in read(D("hedyla_congestion.csv"))}
    km, tm = {}, {}
    for r in read(D("hedyla_distance_matrix.csv")):
        for k in ((r["origin_node"], r["destination_node"]), (r["destination_node"], r["origin_node"])):
            km[k], tm[k] = float(r["distance_km"]), float(r["base_travel_time_min"])
    dist = lambda x, y: 0.0 if x == y else km[(x, y)]
    ttime = lambda x, y: 0.0 if x == y else tm[(x, y)]

    in_scope = lambda shop: cfg["all_shops"] or shops[shop]["platform_participant"] == "1"
    b_routes = [r for r in read(D("hedyla_baseline_routes.csv")) if r["date"] in dates]
    b_assign = defaultdict(list)
    for x in read(D("hedyla_baseline_assignments.csv")):
        b_assign[x["route_id"]].append(x)
    o_stops = defaultdict(list)
    for s in read(os.path.join(a.out, "stops.csv")):
        o_stops[s["route_id"]].append(s)

    def new_acc():
        return dict(routes=0, km=0.0, cost=0.0, fixed=0.0, co2=0.0, active_min=0.0, span_min=0.0, deliveries=0,
                    on_time=0, hp=0, hp_first_half=0, grouped=0, wkm=0.0, vkm=0.0, empty_km=0.0, peak_w=[], peak_v=[],
                    types=defaultdict(int))

    def add_leg(acc, v, leg_km, load_w, load_v):
        acc["km"] += leg_km
        acc["wkm"] += leg_km * load_w / float(v["capacity_kg"])
        acc["vkm"] += leg_km * load_v / float(v["capacity_m3"])
        if load_w <= 1e-9:
            acc["empty_km"] += leg_km

    def close_route(acc, v, route_km, peak_w, peak_v):
        acc["routes"] += 1
        acc["types"][v["type"]] += 1
        acc["fixed"] += float(v["fixed_shift_cost_eur"])
        acc["cost"] += route_km * float(v["cost_eur_per_km"]) + float(v["fixed_shift_cost_eur"])
        acc["co2"] += route_km * float(v["emissions_kgco2e_per_km"])
        acc["peak_w"].append(peak_w / float(v["capacity_kg"]))
        acc["peak_v"].append(peak_v / float(v["capacity_m3"]))

    def deliver(acc, o, t):
        lo, hi = hhmm_to_min(o["delivery_window_start"]), hhmm_to_min(o["delivery_window_end"])
        acc["deliveries"] += 1
        acc["on_time"] += lo <= t <= hi + 1e-9
        if o["priority"] == "high":
            acc["hp"] += 1
            acc["hp_first_half"] += t <= (lo + hi) / 2 + 1e-9

    # ---------------- baseline: loop shop -> stops -> shop, leaving at the window start; departure-phase congestion
    def baseline(routes):
        acc = new_acc()
        for r in routes:
            v = veh_t[r["vehicle_type"]]
            seq = [orders[x["order_id"]] for x in sorted(b_assign[r["route_id"]], key=lambda x: int(x["visit_order"]))]
            t, here = hhmm_to_min(seq[0]["delivery_window_start"]), r["shop_id"]
            load_w, load_v = sum(float(o["weight_kg"]) for o in seq), sum(float(o["volume_m3"]) for o in seq)
            peak_w, peak_v, route_km = load_w, load_v, 0.0
            for o in seq:
                leg = dist(here, o["destination_id"])
                add_leg(acc, v, leg, load_w, load_v); route_km += leg
                drive = ttime(here, o["destination_id"]) * cong[(r["date"], phase_at_min(t))]
                t += drive; acc["active_min"] += drive
                deliver(acc, o, t)
                t += float(o["service_time_min"]); acc["active_min"] += float(o["service_time_min"])
                load_w -= float(o["weight_kg"]); load_v -= float(o["volume_m3"]); here = o["destination_id"]
            leg = dist(here, r["shop_id"])
            add_leg(acc, v, leg, 0.0, 0.0); route_km += leg
            acc["active_min"] += ttime(here, r["shop_id"]) * cong[(r["date"], phase_at_min(t))]
            close_route(acc, v, route_km, peak_w, peak_v)
        return acc

    # ---------------- optimised: rebuilt from stops
    route_cost, route_orders = {}, {}

    def optimised():
        acc = new_acc()
        for rid, ss in o_stops.items():
            ss = sorted(ss, key=lambda s: int(s["stop_seq"]))
            v = veh_t[ss[0]["vehicle_type"]]
            date = ss[0]["date"]
            load_w = load_v = peak_w = peak_v = route_km = 0.0
            dl, shop_set = [], set()
            for i, s in enumerate(ss):
                o = orders.get(s["order_id"])
                t = int(s["arrival_s"]) / 60
                svc = 0.0
                if s["kind"] == "pickup":
                    load_w += float(o["weight_kg"]); load_v += float(o["volume_m3"]); shop_set.add(o["shop_id"])
                    svc = pick_svc_min
                elif s["kind"] == "delivery":
                    deliver(acc, o, t); dl.append(o)
                    load_w -= float(o["weight_kg"]); load_v -= float(o["volume_m3"])
                    svc = float(o["service_time_min"])
                peak_w, peak_v = max(peak_w, load_w), max(peak_v, load_v)
                acc["active_min"] += svc
                if i + 1 < len(ss):
                    nxt = ss[i + 1]
                    leg = dist(s["location"], nxt["location"])
                    add_leg(acc, v, leg, load_w, load_v); route_km += leg
                    acc["active_min"] += ttime(s["location"], nxt["location"]) * cong[(date, phase_at_min(t + svc))]
            acc["span_min"] += (int(ss[-1]["arrival_s"]) - int(ss[0]["arrival_s"])) / 60
            if len(shop_set) > 1:
                acc["grouped"] += len(dl)
            close_route(acc, v, route_km, peak_w, peak_v)
            route_cost[rid] = route_km * float(v["cost_eur_per_km"]) + float(v["fixed_shift_cost_eur"])
            route_orders[rid] = dl
        return acc

    b_in = [r for r in b_routes if in_scope(r["shop_id"])]
    b_out = [r for r in b_routes if not in_scope(r["shop_id"])]
    B, O, X = baseline(b_in), optimised(), baseline(b_out)
    avg = lambda l: sum(l) / len(l) * 100 if l else 0.0
    pct = lambda new, old: (new - old) / old * 100
    r1, r2 = lambda x: round(x, 1), lambda x: round(x, 2)

    total_orders = sum(1 for o in orders.values() if o["date"] in dates)
    k = {
        "status": summ.get("status", "COMPLETE" if not summ["dropped_orders"] else "INCOMPLETE"),
        "assumptions": {k2: cfg.get(k2) for k2 in ("depot", "pickup_service_min", "max_shift_h", "cargo_max_km",
                                                     "travel_buffer", "timing", "priority_hard", "all_shops", "time_limit")},
        "scope": {"dates": len(dates), "orders_total": total_orders, "orders_optimised": O["deliveries"],
                  "orders_kept_on_baseline": X["deliveries"], "dropped": len(summ["dropped_orders"]),
                  "shops_total": len(shops), "shops_taking_part": sum(1 for s in shops if in_scope(s))},
        "climate": {
            "km": {"baseline": r1(B["km"]), "optimised": r1(O["km"]), "reduction_km": r1(B["km"] - O["km"]),
                   "reduction_pct": r1(-pct(O["km"], B["km"]))},
            "kgco2e": {"baseline": r1(B["co2"]), "optimised": r1(O["co2"]), "reduction_kg": r1(B["co2"] - O["co2"]),
                       "reduction_pct": r1(-pct(O["co2"], B["co2"]))},
            "network_incl_non_participants": {
                "km": {"baseline": r1(B["km"] + X["km"]), "optimised": r1(O["km"] + X["km"]),
                       "reduction_pct": r1(-pct(O["km"] + X["km"], B["km"] + X["km"]))},
                "kgco2e": {"baseline": r1(B["co2"] + X["co2"]), "optimised": r1(O["co2"] + X["co2"]),
                           "reduction_pct": r1(-pct(O["co2"] + X["co2"], B["co2"] + X["co2"]))}},
        },
        "economic": {
            "total_cost_eur": {"baseline": r2(B["cost"]), "optimised": r2(O["cost"]), "savings_eur": r2(B["cost"] - O["cost"]),
                               "savings_pct": r1(-pct(O["cost"], B["cost"])),
                               "note": "baseline pays the fixed shift cost per route, the plan per vehicle per day"},
            "variable_cost_eur": {"baseline": r2(B["cost"] - B["fixed"]), "optimised": r2(O["cost"] - O["fixed"]),
                                  "savings_pct": r1(-pct(O["cost"] - O["fixed"], B["cost"] - B["fixed"]))},
            "cost_per_delivery_eur": {"baseline": r2(B["cost"] / B["deliveries"]), "optimised": r2(O["cost"] / O["deliveries"])},
            "on_time_rate_pct": {"baseline": r2(B["on_time"] / B["deliveries"] * 100), "optimised": r2(O["on_time"] / O["deliveries"] * 100)},
            "high_priority_in_first_half_of_window_pct": {"baseline": r1(B["hp_first_half"] / B["hp"] * 100),
                                                          "optimised": r1(O["hp_first_half"] / O["hp"] * 100)},
            "vehicle_utilisation_pct": {
                "weight_distance_weighted": {"baseline": r1(B["wkm"] / B["km"] * 100), "optimised": r1(O["wkm"] / O["km"] * 100)},
                "volume_distance_weighted": {"baseline": r1(B["vkm"] / B["km"] * 100), "optimised": r1(O["vkm"] / O["km"] * 100)},
                "weight_average_peak": {"baseline": r1(avg(B["peak_w"])), "optimised": r1(avg(O["peak_w"]))},
                "note": "distance-weighted = average load over every km driven, empty legs included (headline metric)"},
            "empty_km_pct": {"baseline": r1(B["empty_km"] / B["km"] * 100), "optimised": r1(O["empty_km"] / O["km"] * 100)},
            "orders_grouped_pct": {"baseline": 0.0, "optimised": r1(O["grouped"] / O["deliveries"] * 100),
                                   "of_all_orders": r1(O["grouped"] / total_orders * 100)},
            "vehicle_days": {"baseline_routes": B["routes"], "optimised": O["routes"]},
            "fleet_mix": {"baseline": dict(B["types"]), "optimised": dict(O["types"])},
        },
        "time": {
            "active_hours_driving_and_service": {"baseline": r1(B["active_min"] / 60), "optimised": r1(O["active_min"] / 60)},
            "optimised_paid_tour_hours": r1(O["span_min"] / 60),
            "optimised_waiting_share_pct": r1((1 - O["active_min"] / O["span_min"]) * 100) if O["span_min"] else 0.0,
            "note": "baseline has no shift times, only driving + service; waiting comes from the 09-12 pickup window",
        },
    }

    # ---------------- cost sharing: split each optimised route over its orders by stand-alone round trip
    shop_alloc = defaultdict(float)
    for rid, dl in route_orders.items():
        wts = [2 * dist(o["shop_id"], o["destination_id"]) or 1e-6 for o in dl]
        tot = sum(wts)
        for o, wgt in zip(dl, wts):
            shop_alloc[o["shop_id"]] += route_cost[rid] * wgt / tot
    shop_base = defaultdict(float)
    for r in b_in:
        shop_base[r["shop_id"]] += float(r["estimated_cost_eur"])
    rows = []
    for s in sorted(shop_base):
        n_s = sum(1 for o in orders.values() if o["date"] in dates and o["shop_id"] == s)
        rows.append({"shop_id": s, "shop_type": shops[s]["shop_type"], "orders": n_s,
                     "baseline_cost_eur": r2(shop_base[s]), "shared_cost_eur": r2(shop_alloc[s]),
                     "saving_pct": r1(-pct(shop_alloc[s], shop_base[s])),
                     "baseline_eur_per_delivery": r2(shop_base[s] / n_s),
                     "shared_eur_per_delivery": r2(shop_alloc[s] / n_s)})
    with open(os.path.join(a.out, "shop_cost_sharing.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader(); w.writerows(rows)
    sv = [r["saving_pct"] for r in rows]
    k["cost_sharing"] = {"rule": "route cost split by each order's stand-alone round trip km",
                         "shops_better_off": sum(1 for x in sv if x > 0), "shops": len(rows),
                         "min_saving_pct": min(sv), "median_saving_pct": sorted(sv)[len(sv) // 2], "max_saving_pct": max(sv)}
    with open(os.path.join(a.out, "kpis.json"), "w", encoding="utf-8") as f:
        json.dump(k, f, indent=2)
    print(json.dumps(k, indent=2))


if __name__ == "__main__":
    main()
