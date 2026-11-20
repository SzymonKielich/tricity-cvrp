"""SharedDrop Control Center HTTP API."""
import io
import json
import os
import zipfile
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import UUID

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import Response
from typing import Literal

from .dataset import DEFAULT_DATE, FLEET_TYPES, ROOT, dataset
from .models import DuplicateScenario, RenameScenario, RunRequest, SaveScenario, StressRequest
from .reports import route_with_cargo, stress
from .scheduler import Scheduler
from .store import ACTIVE, SOLVER_VERSION, Store, default_path

Scope = Literal["participating", "all"]


def problem(status, code, message):
    return HTTPException(status, detail={"code": code, "message": message})


def create_app(storage: Path | None = None):
    @asynccontextmanager
    async def lifespan(app):
        dataset().fingerprint
        app.state.store = Store(storage or default_path())
        if os.environ.get("SHAREDROP_SEED_SAMPLE", "1") == "1":
            app.state.store.seed(ROOT / "backend" / "sample")
        scheduler = Scheduler(app.state.store)
        scheduler.thread.start()
        try:
            yield
        finally:
            scheduler.stop.set()
            scheduler.thread.join(timeout=5)

    app = FastAPI(title="SharedDrop Control Center", version="1.0", docs_url="/api/docs",
                  redoc_url=None, openapi_url="/api/openapi.json", lifespan=lifespan)

    def store(request):
        return request.app.state.store

    def get_scenario(request, identifier):
        scenario = store(request).scenarios(str(identifier))
        if scenario is None:
            raise problem(404, "scenario_not_found", "Scenario was not found.")
        return scenario

    def get_job(request, identifier):
        job = store(request).job(str(identifier))
        if job is None:
            raise problem(404, "job_not_found", "Optimization job was not found.")
        return job

    def create(request, name, config, enqueue=False, parent_id=None):
        try:
            sid, jid, duplicate = store(request).create(name, config, enqueue, parent_id)
        except OverflowError as exc:
            raise problem(429, "queue_full", str(exc)) from exc
        return {"scenario_id": sid, "job_id": jid, "duplicate": duplicate}

    def view_path(request, job, date):
        if date not in job["config"]["dates"]:
            raise problem(422, "date_not_in_run", "The selected date is not part of this run.")
        return store(request).runs / job["id"] / f"view-{date}.json"

    def route_view(request, job, date):
        date = date or job["config"]["dates"][0]
        path = view_path(request, job, date)
        if job["status"] not in {"verified", "incomplete"} or not path.is_file():
            raise problem(409, "routes_unavailable", "Routes become available after validation and reporting.")
        return date, json.loads(path.read_text())

    @app.get("/api/health", tags=["System"])
    def health():
        return {"status": "ok", "solver": SOLVER_VERSION, "dataset_fingerprint": dataset().fingerprint}

    @app.get("/api/dataset/summary", tags=["Dataset"])
    def summary():
        data = dataset()
        return {"shops": len(data.shops), "participating_shops": sum(data.participant(s) for s in data.shops),
                "destinations": len(data.dests), "orders": len(data.orders), "vehicles": len(data.vehicles),
                "days": len(data.dates), "default_date": DEFAULT_DATE, "hub": data.hub,
                "fingerprint": data.fingerprint, "synthetic": True,
                "baseline_routes": sum(len(routes) for routes in data.baseline_routes.values())}

    @app.get("/api/network", tags=["Dataset"])
    def network():
        return dataset().network

    @app.get("/api/vehicles", tags=["Dataset"])
    def vehicles():
        data = dataset()
        return {"classes": [{"type": kind, "available": data.fleet[kind],
                             **{key: float(value) for key, value in data.vehicle_by_type[kind].items()
                                if key not in {"vehicle_id", "type"}}} for kind in FLEET_TYPES],
                "vehicles": data.vehicles}

    @app.get("/api/dates", tags=["Dataset"])
    def dates():
        data = dataset()
        return [{"date": date, "orders": data.daily_orders[date],
                 "participating_orders": data.daily_participating_orders[date]} for date in data.dates]

    @app.get("/api/baseline", tags=["Dataset"])
    def baseline(date: str = DEFAULT_DATE, scope: Scope = "participating"):
        data = dataset()
        if date not in data.dates:
            raise problem(422, "invalid_date", "Choose a date in the Hedyla dataset.")
        view = data.baseline(date, scope)
        return {**view, "routes": [route_with_cargo(data, route) for route in view["routes"]]}

    @app.post("/api/scenarios", status_code=201, tags=["Scenarios"])
    def save(request: Request, payload: SaveScenario):
        return create(request, payload.name, payload.config.model_dump())

    @app.get("/api/scenarios", tags=["Scenarios"])
    def scenarios(request: Request):
        return store(request).scenarios()

    @app.get("/api/scenarios/{scenario_id}", tags=["Scenarios"])
    def scenario(request: Request, scenario_id: UUID):
        return get_scenario(request, scenario_id)

    @app.patch("/api/scenarios/{scenario_id}", tags=["Scenarios"])
    def rename(request: Request, scenario_id: UUID, payload: RenameScenario):
        get_scenario(request, scenario_id)
        store(request).rename(str(scenario_id), payload.name)
        return get_scenario(request, scenario_id)

    @app.delete("/api/scenarios/{scenario_id}", status_code=204, tags=["Scenarios"])
    def delete(request: Request, scenario_id: UUID):
        get_scenario(request, scenario_id)
        if not store(request).delete(str(scenario_id)):
            raise problem(409, "active_job", "Cancel or finish the run before deleting the scenario.")
        return Response(status_code=204)

    @app.post("/api/scenarios/{scenario_id}/duplicate", status_code=201, tags=["Scenarios"])
    def duplicate(request: Request, scenario_id: UUID, payload: DuplicateScenario):
        sc = get_scenario(request, scenario_id)
        return create(request, payload.name or f"{sc['name'][:93]} - copy", sc["config"], parent_id=sc["id"])

    @app.post("/api/scenarios/{scenario_id}/rerun", status_code=202, tags=["Scenarios"])
    def rerun(request: Request, scenario_id: UUID):
        sc = get_scenario(request, scenario_id)
        if sc["fingerprint"] != dataset().fingerprint:
            raise problem(409, "dataset_changed", "The stored configuration belongs to a different dataset fingerprint.")
        return create(request, f"{sc['name'][:92]} - rerun", sc["config"], True, sc["id"])

    @app.post("/api/optimization/run", status_code=202, tags=["Optimization"])
    def run(request: Request, payload: RunRequest):
        return create(request, payload.name, payload.config.model_dump(), True)

    @app.get("/api/optimization/jobs/{job_id}", tags=["Optimization"])
    def job(request: Request, job_id: UUID):
        return get_job(request, job_id)

    @app.post("/api/optimization/jobs/{job_id}/cancel", status_code=202, tags=["Optimization"])
    def cancel(request: Request, job_id: UUID):
        get_job(request, job_id)
        store(request).cancel(str(job_id))
        return get_job(request, job_id)

    @app.get("/api/optimization/jobs/{job_id}/events", tags=["Optimization"])
    def events(request: Request, job_id: UUID, after: int = Query(0, ge=0)):
        run_job = get_job(request, job_id)
        path = store(request).runs / run_job["id"] / "worker.log"
        lines = path.read_text(errors="replace").splitlines() if path.is_file() else []
        messages = [{"sequence": i + 1, "message": line} for i, line in enumerate(lines) if i >= after]
        return {"status": run_job["status"], "phase": run_job["phase"], "events": messages,
                "next": len(lines), "terminal": run_job["status"] not in ACTIVE}

    @app.get("/api/optimization/jobs/{job_id}/routes", tags=["Optimization"])
    def routes(request: Request, job_id: UUID, date: str | None = None):
        run_job = get_job(request, job_id)
        selected, rows = route_view(request, run_job, date)
        data = dataset()
        return {"status": run_job["status"], "date": selected,
                "routes": [route_with_cargo(data, route) for route in rows]}

    @app.get("/api/optimization/jobs/{job_id}/kpis", tags=["Optimization"])
    def kpis(request: Request, job_id: UUID):
        run_job = get_job(request, job_id)
        path = store(request).runs / run_job["id"] / "report.json"
        if run_job["status"] not in {"verified", "incomplete"} or not path.is_file():
            raise problem(409, "report_unavailable", "The job has no KPI report yet.")
        return {"status": run_job["status"], **json.loads(path.read_text())}

    @app.post("/api/scenarios/{scenario_id}/stress-test", tags=["Scenarios"])
    def stress_test(request: Request, scenario_id: UUID, payload: StressRequest):
        sc = get_scenario(request, scenario_id)
        if sc["status"] != "verified" or sc["fingerprint"] != dataset().fingerprint:
            raise problem(409, "verified_plan_required", "A verified plan on the current dataset is required.")
        run_job = get_job(request, sc["job_id"])
        _, rows = route_view(request, run_job, payload.date)
        return stress(dataset(), rows, sc["config"], payload)

    @app.get("/api/scenarios/{scenario_id}/export", tags=["Scenarios"])
    def export(request: Request, scenario_id: UUID):
        sc = get_scenario(request, scenario_id)
        job = get_job(request, sc["job_id"]) if sc["job_id"] else None
        if job and job["status"] in ACTIVE:
            raise problem(409, "run_active", "Export is available after the run finishes.")
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("manifest.json", json.dumps({"scenario": sc, "job": job}, indent=2))
            archive.writestr("README.txt", "SharedDrop · Hedyla COM-E1 synthetic dataset.\n"
                             "Only verified jobs serve every in-scope order and pass the independent validator.\n"
                             "UTC timestamps are run metadata. Schedule seconds are local time after midnight.\n"
                             "Baseline charges fixed cost per route. Shared plans charge it per vehicle-day.\n")
            if job:
                path = store(request).runs / job["id"]
                allowed = {"config.json", "routes.csv", "stops.csv", "summary.json", "validation.txt",
                           "kpis.json", "report.json", "shop_cost_sharing.csv", "worker.log"}
                if path.is_dir():
                    for file in sorted(path.iterdir()):
                        if file.name in allowed:
                            archive.write(file, file.name)
        return Response(content=output.getvalue(), media_type="application/zip",
                        headers={"Content-Disposition": f'attachment; filename="shareddrop-{scenario_id}.zip"'})

    return app


app = create_app()
