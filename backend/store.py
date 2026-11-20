"""Transactional scenario and job metadata with isolated filesystem artifacts."""
import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path
from uuid import uuid4

from .dataset import ROOT, dataset

SOLVER_VERSION = f"hedyla-0.1.0+shareddrop.1 / ortools {version('ortools')}"
ACTIVE = ("queued", "running")
CAPACITY = 8


def now():
    return datetime.now(timezone.utc).isoformat()


def default_path():
    return Path(os.environ.get("SHAREDROP_STORAGE", str(ROOT / ".runtime"))).resolve()


class Store:
    def __init__(self, path):
        self.path = Path(path)
        self.runs = self.path / "runs"
        self.runs.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS scenarios (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, config TEXT NOT NULL,
                    fingerprint TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    deleted_at TEXT, parent_id TEXT
                );
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY, scenario_id TEXT NOT NULL UNIQUE REFERENCES scenarios(id),
                    status TEXT NOT NULL, phase TEXT NOT NULL, solver_version TEXT NOT NULL,
                    created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, error TEXT,
                    cancel_requested INTEGER NOT NULL DEFAULT 0, result TEXT
                );
                CREATE INDEX IF NOT EXISTS job_status_created ON jobs (status, created_at);
            """)

    @contextmanager
    def connection(self, write=False):
        db = sqlite3.connect(self.path / "shareddrop.db", timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            if write:
                db.execute("BEGIN IMMEDIATE")
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def create(self, name, config, enqueue=False, parent_id=None):
        with self.connection(write=True) as db:
            encoded = json.dumps(config, sort_keys=True)
            if enqueue:
                active = db.execute("""
                    SELECT s.id, s.config, j.id AS job_id
                    FROM jobs AS j JOIN scenarios AS s ON s.id = j.scenario_id
                    WHERE j.status IN ('queued', 'running')
                """).fetchall()
                for row in active:
                    if encoded == row["config"]:
                        return row["id"], row["job_id"], True
                if len(active) >= CAPACITY:
                    raise OverflowError("The optimization queue is full. Try again after a run finishes.")
            at, scenario_id = now(), str(uuid4())
            db.execute("INSERT INTO scenarios VALUES (?, ?, ?, ?, ?, ?, NULL, ?)",
                       (scenario_id, name, encoded, dataset().fingerprint, at, at, parent_id))
            job_id = str(uuid4()) if enqueue else None
            if job_id:
                db.execute("""INSERT INTO jobs
                    (id, scenario_id, status, phase, solver_version, created_at) VALUES (?, ?, ?, ?, ?, ?)""",
                           (job_id, scenario_id, "queued", "queued", SOLVER_VERSION, at))
            return scenario_id, job_id, False

    def seed(self, folder):
        import shutil

        manifest_path = folder / "sample.json"
        if not manifest_path.is_file():
            return
        sample = json.loads(manifest_path.read_text())
        if sample["fingerprint"] != dataset().fingerprint or sample["solver_version"] != SOLVER_VERSION:
            return
        scenario_id, job_id = sample["scenario_id"], sample["job_id"]
        with self.connection(write=True) as db:
            if db.execute("SELECT 1 FROM scenarios WHERE id=?", (scenario_id,)).fetchone():
                return
            target = self.runs / job_id
            target.mkdir(exist_ok=True)
            for file in folder.iterdir():
                if file.is_file() and file.name != "sample.json":
                    shutil.copy2(file, target / file.name)
            result = json.loads((target / "result.json").read_text())
            db.execute("INSERT INTO scenarios VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)",
                       (scenario_id, sample["name"], json.dumps(sample["config"], sort_keys=True),
                        sample["fingerprint"], sample["created_at"], sample["created_at"]))
            db.execute("""INSERT INTO jobs
                    (id, scenario_id, status, phase, solver_version, created_at, started_at, finished_at, result)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                       (job_id, scenario_id, result["status"], "finished", sample["solver_version"],
                        sample["created_at"], sample["started_at"], sample["finished_at"], json.dumps(result)))

    @staticmethod
    def scenario_dict(row):
        value = dict(row)
        value["config"] = json.loads(value["config"])
        value["result"] = json.loads(value["result"]) if value["result"] else None
        if value["result"]:
            result = value["result"]
            value["result"] = {key: result[key] for key in ("status", "metrics", "warnings")}
        return value

    def scenarios(self, scenario_id=None):
        where = "s.deleted_at IS NULL"
        args = ()
        if scenario_id:
            where += " AND s.id = ?"
            args = (scenario_id,)
        with self.connection() as db:
            rows = db.execute(f"""SELECT s.*, j.id AS job_id, j.status, j.solver_version, j.result,
                                j.finished_at FROM scenarios AS s LEFT JOIN jobs AS j
                                ON s.id = j.scenario_id WHERE {where} ORDER BY s.created_at DESC LIMIT 200""",
                              args).fetchall()
        results = [self.scenario_dict(row) for row in rows]
        return (results[0] if results else None) if scenario_id else results

    def job(self, job_id):
        with self.connection() as db:
            row = db.execute("""SELECT j.*, s.name, s.config, s.fingerprint FROM jobs AS j
                                JOIN scenarios AS s ON j.scenario_id=s.id
                                WHERE j.id=? AND s.deleted_at IS NULL""", (job_id,)).fetchone()
        if not row:
            return None
        result = dict(row)
        result["config"] = json.loads(result["config"])
        result["result"] = json.loads(result["result"]) if result["result"] else None
        return result

    def rename(self, scenario_id, name):
        with self.connection(write=True) as db:
            db.execute("UPDATE scenarios SET name=?, updated_at=? WHERE id=? AND deleted_at IS NULL",
                       (name, now(), scenario_id))

    def delete(self, scenario_id):
        with self.connection(write=True) as db:
            status = db.execute("SELECT status FROM jobs WHERE scenario_id=?", (scenario_id,)).fetchone()
            if status and status["status"] in ACTIVE:
                return False
            db.execute("UPDATE scenarios SET deleted_at=? WHERE id=? AND deleted_at IS NULL",
                       (now(), scenario_id))
        return True

    def claim(self):
        with self.connection(write=True) as db:
            row = db.execute("SELECT id FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 1").fetchone()
            if row:
                db.execute("UPDATE jobs SET status='running', phase='starting', started_at=? WHERE id=?",
                           (now(), row["id"]))
        return self.job(row["id"]) if row else None

    def phase(self, job_id, phase):
        with self.connection(write=True) as db:
            db.execute("UPDATE jobs SET phase=? WHERE id=? AND status='running'", (phase, job_id))

    def finish(self, job_id, status, error=None, result=None):
        with self.connection(write=True) as db:
            db.execute("""UPDATE jobs SET status=?, phase='finished', finished_at=?, error=?, result=?
                          WHERE id=? AND status='running'""",
                       (status, now(), error, json.dumps(result) if result else None, job_id))

    def recover(self):
        with self.connection(write=True) as db:
            db.execute("""UPDATE jobs SET status='failed', phase='finished', finished_at=?,
                          error='The worker restarted during this run. Re-run the stored configuration.'
                          WHERE status='running'""", (now(),))

    def cancel(self, job_id):
        with self.connection(write=True) as db:
            db.execute("""UPDATE jobs SET status='cancelled', phase='finished', finished_at=?
                          WHERE id=? AND status='queued'""", (now(), job_id))
            db.execute("UPDATE jobs SET cancel_requested=1 WHERE id=? AND status='running'", (job_id,))
