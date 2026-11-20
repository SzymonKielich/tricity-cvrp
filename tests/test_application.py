import csv
import io
import json
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.dataset import DEFAULT_DATE, ROOT, dataset
from backend.main import create_app
from backend.models import ScenarioConfig

SAMPLE = ROOT / "backend" / "sample"
SAMPLE_META = json.loads((SAMPLE / "sample.json").read_text())


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path)) as api:
        yield api


def test_source_and_baseline(client):
    source = dataset()
    health = client.get("/api/health").json()
    summary = client.get("/api/dataset/summary").json()
    dates = client.get("/api/dates").json()
    network = client.get("/api/network").json()
    assert health["status"] == "ok" and "ortools" in health["solver"]
    assert summary["fingerprint"] == health["dataset_fingerprint"] == SAMPLE_META["fingerprint"]
    assert (summary["shops"], summary["participating_shops"], summary["destinations"], summary["orders"]) == (55, 44, 170, 10087)
    assert summary["vehicles"] == 24 and len(network["nodes"]) == 225
    assert len(dates) == 45 and dates[0]["date"] == DEFAULT_DATE and network["hub"] == "COM018"
    assert len(client.get("/api/vehicles").json()["classes"]) == 3
    base = client.get("/api/baseline").json()
    all_shops = client.get("/api/baseline?scope=all").json()
    assert base["status"] == "unverified" and base["kpis"]["pickup_on_time_pct"] is None
    assert base["kpis"]["requested"] == 184 < all_shops["kpis"]["requested"]
    assert {r["id"] for r in base["routes"]} < {r["id"] for r in all_shops["routes"]}
    route = base["routes"][0]
    assert [s["order_id"] for s in route["stops"][1:-1]] == [a["order_id"] for a in source.assignments[route["id"]]]


def test_cargo_for_persisted_sample_and_original_shop_routes(client):
    source = dataset()
    saved = client.get(f"/api/optimization/jobs/{SAMPLE_META['job_id']}/routes").json()["routes"]
    original = client.get("/api/baseline").json()["routes"]
    assert len(saved) == 15 and sum(route["orders"] for route in saved) == 184
    for route in saved + original:
        cargo = route["cargo"]
        vehicle = (source.vehicle_by_id[route["vehicle_id"]] if route["vehicle_id"]
                   else source.vehicle_by_type[route["vehicle_type"]])
        assert cargo["capacity_kg"] == float(vehicle["capacity_kg"])
        assert cargo["capacity_m3"] == float(vehicle["capacity_m3"])
        onboard = set(cargo["initial_order_ids"])
        assert len(onboard) == (0 if route["vehicle_id"] else route["orders"])
        for stop in route["stops"]:
            oid = stop["order_id"]
            if oid:
                order = cargo["orders"][oid]
                assert order["shop_id"] == source.orders_by_id[oid]["shop_id"]
                assert order["destination_id"] == source.orders_by_id[oid]["destination_id"]
            if stop["kind"] == "pickup":
                assert oid not in onboard
                onboard.add(oid)
            elif stop["kind"] == "delivery":
                onboard.remove(oid)
            assert sum(cargo["orders"][oid]["weight_kg"] for oid in onboard) == pytest.approx(stop["load_kg"], abs=.001)
            assert sum(cargo["orders"][oid]["volume_m3"] for oid in onboard) == pytest.approx(stop["load_m3"], abs=.00001)
        assert not onboard


@pytest.mark.parametrize("values", [
    {"dates": ["2025-01-01"]}, {"dates": [DEFAULT_DATE, DEFAULT_DATE]}, {"hub": "DST001"},
    {"fleet": {"cargo_bike": 0, "electric_van": 0, "diesel_van": 0}}, {"fleet": {"cargo_bike": 9}},
    {"time_limit": "5"}, {"time_limit": 121}, {"w_eur": 0, "w_co2": 0}, {"travel_buffer_pct": -10},
    {"max_shift_h": 0}, {"pickup_service_min": 2.1}, {"unknown": 1},
])
def test_configuration_validation(values):
    with pytest.raises(ValidationError):
        ScenarioConfig.model_validate({"dates": [DEFAULT_DATE], **values})


def test_api_error_contract(client):
    res = client.post("/api/optimization/run", json={"name": "Invalid", "config": {"dates": [DEFAULT_DATE], "hub": "MISSING"}})
    assert res.status_code == 422
    assert "shop node" in res.json()["detail"][0]["msg"]
    res = client.get("/api/baseline?date=2020-01-01")
    assert res.status_code == 422 and res.json()["detail"]["code"] == "invalid_date"
    assert client.get("/api/openapi.json").json()["paths"]["/api/optimization/run"]["post"]


def wait_for_result(client, jid, timeout=45):
    path = f"/api/optimization/jobs/{jid}"
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        current = client.get(path).json()
        if current["status"] not in {"queued", "running"}:
            return current
        time.sleep(0.3)
    pytest.fail(f"Job {jid} timed out with {current}")


def optimize(client, name, **config):
    response = client.post("/api/optimization/run", json={"name": name, "config": {"dates": [DEFAULT_DATE], **config}})
    assert response.status_code == 202, response.text
    return response.json()


def test_real_solve_independent_validation_and_persistence(tmp_path, monkeypatch):
    monkeypatch.setenv("SHAREDROP_SEED_SAMPLE", "0")
    with TestClient(create_app(tmp_path)) as client:
        record = optimize(client, "Integration test")
        again = optimize(client, "Duplicate active request")
        assert again == {**record, "duplicate": True}
        jid = record["job_id"]
        final = wait_for_result(client, jid)
        assert final["status"] == "verified", final
        assert final["result"]["validation"]["exit_code"] == 0
        assert final["result"]["validation"]["coverage_complete"]
        routes = client.get(f"/api/optimization/jobs/{jid}/routes").json()["routes"]
        assert len({r["vehicle_id"] for r in routes}) == len(routes) <= 24
        served = [s["order_id"] for r in routes for s in r["stops"] if s["kind"] == "delivery"]
        target = [o["order_id"] for o in dataset().orders if o["date"] == DEFAULT_DATE and dataset().participant(o["shop_id"])]
        assert sorted(served) == sorted(target)
        report = client.get(f"/api/optimization/jobs/{jid}/kpis").json()
        planned = report["optimized"]
        assert planned["km"] == pytest.approx(sum(r["km"] for r in routes), abs=.001)
        assert planned["co2_kg"] == pytest.approx(sum(r["co2_kg"] for r in routes), abs=.001)
        assert planned["cost_eur"] == pytest.approx(planned["variable_eur"] + planned["fixed_eur"], abs=.01)
        assert planned["fulfillment_pct"] == planned["pickup_on_time_pct"] == planned["delivery_on_time_pct"] == 100
        assert report["baseline"]["km"] == pytest.approx(841.974)
        events = client.get(f"/api/optimization/jobs/{jid}/events").json()
        assert events["terminal"] and any("independent constraint checker" in e["message"] for e in events["events"])
        rerun = client.post(f"/api/scenarios/{record['scenario_id']}/rerun").json()
        assert rerun["job_id"] != jid and rerun["scenario_id"] != record["scenario_id"]
        assert client.get(f"/api/optimization/jobs/{rerun['job_id']}").json()["config"] == final["config"]
        client.post(f"/api/optimization/jobs/{rerun['job_id']}/cancel")
        assert wait_for_result(client, rerun["job_id"])["status"] == "cancelled"

    with TestClient(create_app(tmp_path)) as client:
        assert client.get(f"/api/optimization/jobs/{jid}/kpis").json() == report
        exported = client.get(f"/api/scenarios/{record['scenario_id']}/export")
        assert exported.headers["content-type"] == "application/zip"
        with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
            assert {"manifest.json", "routes.csv", "stops.csv", "validation.txt", "kpis.json"} <= set(archive.namelist())
            manifest = json.loads(archive.read("manifest.json"))
            assert manifest["job"]["result"] == final["result"]
            assert manifest["scenario"]["config"] == final["config"]


def test_incomplete_run_and_actual_fleet_settings(client):
    record = optimize(client, "One cargo bike", hub="COM001", time_limit=3, pickup_service_min=5,
                      cargo_max_km=30, max_shift_h=10, travel_buffer_pct=25, priority_hard=False,
                      fleet={"cargo_bike": 1, "electric_van": 0, "diesel_van": 0})
    jid = record["job_id"]
    job = wait_for_result(client, jid)
    assert job["status"] == "incomplete", job
    assert not job["result"]["validation"]["coverage_complete"]
    assert job["result"]["unserved_order_ids"]
    report = client.get(f"/api/optimization/jobs/{jid}/kpis").json()
    assert report["changes"] is None and report["optimized"]["fulfillment_pct"] < 100
    for route in client.get(f"/api/optimization/jobs/{jid}/routes").json()["routes"]:
        assert route["vehicle_id"] == "VEH001" and route["km"] <= 30
        assert route["stops"][0]["location"] == route["stops"][-1]["location"] == "COM001"
        assert route["end_s"] - route["start_s"] <= 36000
        assert all(s["departure_s"] - s["arrival_s"] == 300 for s in route["stops"] if s["kind"] == "pickup")
    assert client.post(f"/api/scenarios/{record['scenario_id']}/stress-test", json={"date": DEFAULT_DATE}).status_code == 409


def test_saved_configuration_management_and_fixed_schedule_stress(client):
    config = {"dates": [DEFAULT_DATE], "scope": "all"}
    result = client.post("/api/scenarios", json={"name": "Draft scenario", "config": config})
    assert result.status_code == 201
    sid = result.json()["scenario_id"]
    rename = client.patch(f"/api/scenarios/{sid}", json={"name": "Renamed"})
    assert rename.json()["name"] == "Renamed"
    duplicate = client.post(f"/api/scenarios/{sid}/duplicate", json={}).json()
    copy = client.get(f"/api/scenarios/{duplicate['scenario_id']}").json()
    assert copy["parent_id"] == sid and copy["config"] == rename.json()["config"] and copy["job_id"] is None
    assert client.delete(f"/api/scenarios/{duplicate['scenario_id']}").status_code == 204
    assert client.get(f"/api/scenarios/{duplicate['scenario_id']}").status_code == 404

    base = f"/api/scenarios/{SAMPLE_META['scenario_id']}/stress-test"
    clean = client.post(base, json={"date": DEFAULT_DATE}).json()
    stressed = client.post(base, json={"date": DEFAULT_DATE, "traffic_pct": 25, "pickup_service_min": 5, "cargo_max_km": 30}).json()
    assert clean["type"] == stressed["type"] == "fixed_schedule_stress_test"
    assert clean["routes_affected"] == 0 < stressed["routes_affected"]
    assert [[s["location"] for s in r["stops"]] for r in clean["routes"]] == [[s["location"] for s in r["stops"]] for r in stressed["routes"]]


def validator(directory):
    return subprocess.run([sys.executable, str(ROOT / "solver" / "validate_solution.py"), "--out", str(directory)],
                          check=False, text=True, capture_output=True)


def test_packaged_sample_passes_independent_checker():
    result = validator(SAMPLE)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "184 in-scope orders, 0 dropped" in result.stdout


@pytest.mark.parametrize("mutation, diagnostic", [
    ("remove_delivery", "order not served exactly once"),
    ("swap_order", "arrival timestamps out of order"),
    ("short_travel", "travel time not respected"),
    ("remove_vehicle", "vehicle unavailable in scenario"),
    ("short_shift", "shift too long"),
    ("short_range", "cargo bike over range"),
    ("late_pickup", "pickup window violated"),
    ("overload", "capacity exceeded"),
])
def test_checker_rejects_corrupt_solutions(tmp_path, mutation, diagnostic):
    for filename in ("routes.csv", "stops.csv", "summary.json"):
        shutil.copy2(SAMPLE / filename, tmp_path)
    stops_path = tmp_path / "stops.csv"
    with stops_path.open() as f:
        stops = list(csv.DictReader(f))
    stops_head = list(stops[0])
    first_pickup = next(r for r in stops if r["kind"] == "pickup")
    first_delivery = next(r for r in stops if r["kind"] == "delivery")
    summary_path = tmp_path / "summary.json"
    summary = json.loads(summary_path.read_text())
    if mutation == "remove_delivery":
        stops.remove(first_delivery)
    if mutation == "swap_order":
        first_pickup["stop_seq"], first_delivery["stop_seq"] = first_delivery["stop_seq"], first_pickup["stop_seq"]
    if mutation == "short_travel":
        first_delivery["arrival_s"] = first_pickup["arrival_s"]
    if mutation == "remove_vehicle":
        summary["config"]["vehicle_ids"].remove(first_pickup["vehicle_id"])
    if mutation == "short_shift":
        summary["config"]["max_shift_h"] = 1
    if mutation == "short_range":
        summary["config"]["cargo_max_km"] = 1
    if mutation == "late_pickup":
        first_pickup["arrival_s"] = 15 * 3600
    if mutation == "overload":
        # Repeating the heaviest pickup inside the same bike tour forces a cumulative overload.
        bike_route = next(r for r in stops if r["vehicle_type"] == "cargo_bike" and r["kind"] == "pickup")
        copies = [dict(bike_route) for _ in range(60)]
        stops.extend(copies)
    summary_path.write_text(json.dumps(summary))
    with stops_path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=stops_head)
        writer.writeheader()
        writer.writerows(stops)
    result = validator(tmp_path)
    assert result.returncode == 1, result.stdout + result.stderr
    assert f"[BAD] {diagnostic}" in result.stdout, result.stdout
