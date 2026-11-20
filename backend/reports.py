"""Route-level visualizations and independently reconstructed metrics."""
import math
from collections import Counter, defaultdict

from solver.hedyla_opt import hhmm_to_s


def ratio(numerator, denominator):
    return round(100 * numerator / denominator, 2) if denominator else None


def enrich_route(data, route_id, date, vehicle, stops, pickup_min, baseline=False, shop=None):
    orders = [data.orders_by_id[s["order_id"]] for s in stops if s["kind"] == "delivery"]
    shops = sorted({order["shop_id"] for order in orders})
    cap_w, cap_v = float(vehicle["capacity_kg"]), float(vehicle["capacity_m3"])
    load_w = sum(float(o["weight_kg"]) for o in orders) if baseline else 0
    load_v = sum(float(o["volume_m3"]) for o in orders) if baseline else 0
    peak_w, peak_v = load_w, load_v
    segments, rendered = [], []
    km = empty_km = wkm = vkm = 0.0
    delivery_on_time = pickup_on_time = pickups = 0

    def segment(kind, start, end, origin, destination=None):
        if end > start:
            segments.append({"kind": kind, "start_s": round(start, 3), "end_s": round(end, 3),
                             "from": origin, "to": destination or origin})

    for i, stop in enumerate(stops):
        arrival, place, kind = float(stop["arrival_s"]), stop["location"], stop["kind"]
        order = data.orders_by_id.get(stop["order_id"])
        service, start, end = 0, None, None
        if kind == "pickup":
            source = data.shops[order["shop_id"]]
            start, end = (hhmm_to_s(source[f"pickup_window_{boundary}"]) for boundary in ("start", "end"))
            load_w += float(order["weight_kg"])
            load_v += float(order["volume_m3"])
            service = round(pickup_min * 60)
            pickups += 1
            pickup_on_time += start <= arrival and arrival + service <= end
        if kind == "delivery":
            start, end = (hhmm_to_s(order[f"delivery_window_{boundary}"]) for boundary in ("start", "end"))
            load_w -= float(order["weight_kg"])
            load_v -= float(order["volume_m3"])
            service = round(float(order["service_time_min"]) * 60)
            delivery_on_time += start <= arrival <= end
        peak_w, peak_v = max(peak_w, load_w), max(peak_v, load_v)
        slack = end - arrival - (service if kind == "pickup" else 0) if end is not None else None
        rendered.append({"location": place, "kind": kind, "arrival_s": round(arrival, 3),
                         "departure_s": round(arrival + service, 3), "order_id": stop["order_id"],
                         "load_kg": round(max(0, load_w), 3), "load_m3": round(max(0, load_v), 5),
                         "priority": order["priority"] if order else None,
                         "window_start_s": start, "window_end_s": end,
                         "slack_s": round(slack, 3) if slack is not None else None})
        segment(kind, arrival, arrival + service, place)
        if i + 1 < len(stops):
            nxt = stops[i + 1]
            depart = arrival + service
            leg_km, drive = data.leg(date, place, nxt["location"], depart)
            end_drive = min(depart + drive, float(nxt["arrival_s"]))
            km += leg_km
            wkm += leg_km * max(0, load_w) / cap_w
            vkm += leg_km * max(0, load_v) / cap_v
            if load_w < 1e-8:
                empty_km += leg_km
            segment("drive", depart, end_drive, place, nxt["location"])
            segment("wait", end_drive, float(nxt["arrival_s"]), nxt["location"])

    fixed = float(vehicle["fixed_shift_cost_eur"])
    variable = km * float(vehicle["cost_eur_per_km"])
    return {"id": route_id, "date": date, "vehicle_id": None if baseline else vehicle["vehicle_id"],
            "vehicle_type": vehicle["type"], "shops": shops, "shop": shop, "orders": len(orders),
            "stops": rendered, "segments": segments, "km": km, "empty_km": empty_km,
            "weight_km": wkm, "volume_km": vkm, "co2_kg": km * float(vehicle["emissions_kgco2e_per_km"]),
            "cost_eur": variable + fixed, "fixed_eur": fixed, "variable_eur": variable,
            "start_s": rendered[0]["arrival_s"], "end_s": rendered[-1]["arrival_s"],
            "peak_weight_pct": ratio(peak_w, cap_w), "peak_volume_pct": ratio(peak_v, cap_v),
            "delivery_on_time": delivery_on_time, "pickup_on_time": pickup_on_time, "pickups": pickups,
            "weight_utilization_pct": ratio(wkm, km), "volume_utilization_pct": ratio(vkm, km),
            "delivery_on_time_pct": ratio(delivery_on_time, len(orders)),
            "tight_windows": sum(s["slack_s"] is not None and s["slack_s"] <= 900 for s in rendered)}


def route_with_cargo(data, route):
    """Attach source order details even for views saved before cargo playback."""
    vehicle = (data.vehicle_by_id[route["vehicle_id"]] if route["vehicle_id"]
               else data.vehicle_by_type[route["vehicle_type"]])
    order_ids = dict.fromkeys(stop["order_id"] for stop in route["stops"] if stop["order_id"])
    fields = ("order_id", "shop_id", "destination_id")
    orders = {}
    for order_id in order_ids:
        source = data.orders_by_id[order_id]
        orders[order_id] = {**{key: source[key] for key in fields},
                            "weight_kg": float(source["weight_kg"]), "volume_m3": float(source["volume_m3"])}
    baseline = route["vehicle_id"] is None
    return {**route, "cargo": {
        "capacity_kg": float(vehicle["capacity_kg"]), "capacity_m3": float(vehicle["capacity_m3"]),
        "orders": orders, "initial_order_ids": list(order_ids) if baseline else [],
    }}


def metrics(routes, requested, baseline=False):
    def total(key):
        return sum(route[key] for route in routes)

    delivered, km = total("orders"), total("km")
    span = sum(route["end_s"] - route["start_s"] for route in routes)
    wait = sum(s["end_s"] - s["start_s"] for r in routes for s in r["segments"] if s["kind"] == "wait")
    grouped = sum(r["orders"] for r in routes if len(r["shops"]) > 1)
    return {"requested": requested, "delivered": delivered, "km": round(km, 3),
            "co2_kg": round(total("co2_kg"), 3), "cost_eur": round(total("cost_eur"), 2),
            "variable_eur": round(total("variable_eur"), 2), "fixed_eur": round(total("fixed_eur"), 2),
            "cost_per_order_eur": round(total("cost_eur") / delivered, 2) if delivered else None,
            "fulfillment_pct": ratio(delivered, requested),
            "delivery_on_time_pct": ratio(total("delivery_on_time"), delivered),
            "pickup_on_time_pct": None if baseline else ratio(total("pickup_on_time"), total("pickups")),
            "weight_utilization_pct": ratio(total("weight_km"), km),
            "volume_utilization_pct": ratio(total("volume_km"), km),
            "empty_km": round(total("empty_km"), 3), "grouped_orders": grouped,
            "grouped_pct": ratio(grouped, delivered),
            "vehicle_hours": round(span / 3600, 2), "waiting_hours": None if baseline else round(wait / 3600, 2),
            "routes": len(routes), "fleet": dict(Counter(r["vehicle_type"] for r in routes))}


def optimized_routes(data, route_rows, stop_rows, pickup_min):
    stops_by_route = defaultdict(list)
    for stop in stop_rows:
        stops_by_route[stop["route_id"]].append(stop)
    result = []
    for route in route_rows:
        rid = route["route_id"]
        stops = sorted(stops_by_route[rid], key=lambda s: int(s["stop_seq"]))
        result.append(enrich_route(data, rid, route["date"], data.vehicle_by_id[route["vehicle_id"]],
                                   stops, pickup_min))
    return result


def stress(data, routes, config, request):
    pickup_min = config["pickup_service_min"] if request.pickup_service_min is None else request.pickup_service_min
    shift_h = config["max_shift_h"] if request.max_shift_h is None else request.max_shift_h
    cargo_km = config["cargo_max_km"] if request.cargo_max_km is None else request.cargo_max_km
    affected = []
    for route in routes:
        violations, times = [], []
        arrival = route["start_s"]
        depart = arrival
        for i, stop in enumerate(route["stops"]):
            if i:
                source = route["stops"][i - 1]["location"]
                _, drive = data.leg(request.date, source, stop["location"], depart)
                arrival = max(stop["arrival_s"], depart + math.ceil(drive * (1 + request.traffic_pct / 100) - 1e-9))
            kind = stop["kind"]
            handling = pickup_min * 60 if kind == "pickup" else stop["departure_s"] - stop["arrival_s"]
            depart = arrival + handling
            times.append({"location": stop["location"], "arrival_s": round(arrival, 3), "order_id": stop["order_id"]})
            deadline = stop["window_end_s"]
            if kind == "delivery" and config["priority_hard"] and stop["priority"] == "high":
                deadline = (stop["window_start_s"] + deadline) / 2
            if deadline is not None and (depart if kind == "pickup" else arrival) > deadline:
                violations.append({"kind": f"{kind}_window", "order_id": stop["order_id"],
                                   "seconds_late": round((depart if kind == "pickup" else arrival) - deadline, 3)})
        if arrival - route["start_s"] > shift_h * 3600:
            violations.append({"kind": "shift_duration"})
        if arrival > 22 * 3600:
            violations.append({"kind": "hub_close"})
        if route["vehicle_type"] == "cargo_bike" and route["km"] > cargo_km + 1e-6:
            violations.append({"kind": "cargo_range"})
        affected.append({"route_id": route["id"], "vehicle_id": route["vehicle_id"],
                         "end_s": round(arrival, 3), "violations": violations, "stops": times})
    counts = Counter(v["kind"] for r in affected for v in r["violations"])
    return {"type": "fixed_schedule_stress_test", "date": request.date, "traffic_pct": request.traffic_pct,
            "pickup_service_min": pickup_min, "max_shift_h": shift_h, "cargo_max_km": cargo_km,
            "routes_tested": len(affected), "routes_affected": sum(bool(r["violations"]) for r in affected),
            "violations": dict(counts), "routes": affected,
            "method": "Fixed stop sequence and planned service times as earliest starts. Delays propagate using departure-phase congestion."}
