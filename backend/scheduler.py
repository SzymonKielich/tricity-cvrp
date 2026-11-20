"""Single optimization slot, guarded across API processes sharing one volume."""
import fcntl
import json
import os
import signal
import subprocess
import sys
import threading
import time

from .dataset import ROOT


class Scheduler:
    def __init__(self, store):
        self.store = store
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self.loop, name="shareddrop-scheduler", daemon=True)

    def loop(self):
        with (self.store.path / "scheduler.lock").open("a") as lock:
            while not self.stop.is_set():
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    self.stop.wait(1)
            if self.stop.is_set():
                return
            self.store.recover()
            while not self.stop.is_set():
                job = self.store.claim()
                if job:
                    try:
                        self.execute(job)
                    except Exception as exc:
                        self.store.finish(job["id"], "failed", str(exc))
                else:
                    self.stop.wait(0.35)

    def execute(self, job):
        job_id = job["id"]
        out = self.store.runs / job_id
        out.mkdir()
        (out / "config.json").write_text(json.dumps(job["config"], indent=2))
        deadline = time.monotonic() + len(job["config"]["dates"]) * (job["config"]["time_limit"] + 10) + 90
        log_path = out / "worker.log"
        env = dict(os.environ, OMP_NUM_THREADS="1", OPENBLAS_NUM_THREADS="1", PYTHONUNBUFFERED="1",
                   SHAREDROP_STORAGE=str(self.store.path))
        with log_path.open("wb") as log, log_path.open(encoding="utf-8") as reader:
            process = subprocess.Popen([sys.executable, "-m", "backend.worker", str(out)], stdout=log,
                                       stderr=subprocess.STDOUT, cwd=ROOT, env=env, start_new_session=True)
            try:
                while process.poll() is None:
                    for line in reader:
                        if line.startswith("PHASE "):
                            self.store.phase(job_id, line.split()[1])
                    if self.store.job(job_id)["cancel_requested"]:
                        self.store.finish(job_id, "cancelled")
                        return
                    if self.stop.is_set() or time.monotonic() > deadline:
                        message = ("Worker stopped during deployment or shutdown." if self.stop.is_set()
                                   else "Run exceeded the worker time budget.")
                        self.store.finish(job_id, "failed", message)
                        return
                    self.stop.wait(0.35)
            finally:
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
        result_path = out / "result.json"
        if process.returncode != 0 or not result_path.is_file():
            self.store.finish(job_id, "failed", "The worker exited before publishing a result. See the run log.")
            return
        result = json.loads(result_path.read_text())
        self.store.finish(job_id, result["status"], result=result)
