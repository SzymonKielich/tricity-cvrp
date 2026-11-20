"""Read-only source data and baseline route reconstruction."""
import hashlib
import os
from collections import Counter, defaultdict
from functools import cached_property, lru_cache
from pathlib import Path

from solver.hedyla_opt import Data, hhmm_to_s, phase_at, read_csv

ROOT = Path(__file__).resolve().parents[1]
FILES = ("shops", "destinations", "orders", "vehicles", "congestion", "distance_matrix",
         "baseline_routes", "baseline_assignments")
DEFAULT_DATE = "2026-11-05"
FLEET_TYPES = ("cargo_bike", "electric_van", "diesel_van")


class Dataset(Data):
    def __init__(self, path):
        super().__init__(str(path))
        self.path = Path(path)
        self.hub = self.central_shop()
        self.orders_by_id = {order["order_id"]: order for order in self.orders}
        self.vehicle_by_id = {vehicle["vehicle_id"]: vehicle for vehicle in self.vehicles}
        self.vehicle_by_type = {vehicle["type"]: vehicle for vehicle in self.vehicles}
        self.fleet = Counter(vehicle["type"] for vehicle in self.vehicles)
        self.baseline_routes = defaultdict(list)
        for route in read_csv(self.dir, "hedyla_baseline_routes.csv"):
            self.baseline_routes[route["date"]].append(route)
        self.assignments = defaultdict(list)
        for assignment in read_csv(self.dir, "hedyla_baseline_assignments.csv"):
            self.assignments[assignment["route_id"]].append(assignment)
        for assignments in self.assignments.values():
            assignments.sort(key=lambda assignment: int(assignment["visit_order"]))
        self.daily_orders = Counter(order["date"] for order in self.orders)
        self.daily_participating_orders = Counter(
            order["date"] for order in self.orders if self.participant(order["shop_id"])
        )

    @cached_property
    def fingerprint(self):
        digest = hashlib.sha256()
        for name in FILES:
            file = self.path / f"hedyla_{name}.csv"
            digest.update(file.name.encode())
            digest.update(file.read_bytes())
        return digest.hexdigest()

    @cached_property
    def network(self):
        zones_by_shop = defaultdict(set)
        shops_by_destination = defaultdict(set)
        for order in self.orders:
            zone = self.dests[order["destination_id"]]["delivery_zone"]
            zones_by_shop[order["shop_id"]].add(zone)
            shops_by_destination[order["destination_id"]].add(order["shop_id"])
        nodes = [
            dict(id=key, kind="shop", category=row["shop_type"], participant=self.participant(key),
                 latitude=float(row["latitude"]), longitude=float(row["longitude"]),
                 zones=sorted(zones_by_shop[key]), window_start=row["pickup_window_start"],
                 window_end=row["pickup_window_end"])
            for key, row in self.shops.items()
        ] + [
            dict(id=key, kind="destination", category=row["destination_type"],
                 latitude=float(row["latitude"]), longitude=float(row["longitude"]),
                 zones=[row["delivery_zone"]], shops=sorted(shops_by_destination[key]))
            for key, row in self.dests.items()
        ]
        return {"hub": self.hub, "nodes": nodes,
                "zones": sorted({row["delivery_zone"] for row in self.dests.values()})}

    def leg(self, date, a, b, departure_s):
        i, j = self.li[a], self.li[b]
        return self.km[i][j], self.tmin[i][j] * 60 * self.cong[(date, phase_at(departure_s))]

    @lru_cache(maxsize=24)
    def baseline(self, date, scope):
        from .reports import enrich_route, metrics

        routes = []
        for raw in self.baseline_routes[date]:
            shop = raw["shop_id"]
            if scope == "participating" and not self.participant(shop):
                continue
            orders = [self.orders_by_id[a["order_id"]] for a in self.assignments[raw["route_id"]]]
            arrival = hhmm_to_s(orders[0]["delivery_window_start"])
            location = shop
            stops = [{"location": shop, "kind": "depot", "arrival_s": arrival, "order_id": ""}]
            for order in orders:
                destination = order["destination_id"]
                arrival += self.leg(date, location, destination, arrival)[1]
                stops.append({"location": destination, "kind": "delivery", "order_id": order["order_id"],
                              "arrival_s": arrival})
                arrival += float(order["service_time_min"]) * 60
                location = destination
            arrival += self.leg(date, location, shop, arrival)[1]
            stops.append({"location": shop, "kind": "depot", "arrival_s": arrival, "order_id": ""})
            routes.append(enrich_route(
                self, raw["route_id"], date, self.vehicle_by_type[raw["vehicle_type"]], stops,
                pickup_min=0, baseline=True, shop=shop,
            ))
        total = self.daily_orders[date] if scope == "all" else self.daily_participating_orders[date]
        return {"date": date, "scope": scope, "status": "unverified", "routes": routes,
                "kpis": metrics(routes, total, baseline=True)}


@lru_cache(maxsize=1)
def dataset():
    return Dataset(os.environ.get("SHAREDROP_DATA_DIR", str(ROOT)))
