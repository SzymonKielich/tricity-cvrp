"""Run the same-origin web service and loopback API as one deployable container."""
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request

from .dataset import ROOT


def main():
    api_port = os.environ.get("BACKEND_PORT", "8123")
    web_env = dict(os.environ, HOSTNAME="0.0.0.0")
    processes = []
    stopping = False

    def stop_service(*_):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop_service)
    signal.signal(signal.SIGINT, stop_service)
    try:
        processes.append(subprocess.Popen([sys.executable, "-m", "uvicorn", "backend.main:app",
                                           "--host", "127.0.0.1", "--port", api_port], cwd=ROOT))
        backend_url = f"http://127.0.0.1:{api_port}/api/health"
        for _ in range(100):
            if stopping or processes[0].poll() is not None:
                return 1
            try:
                with urllib.request.urlopen(backend_url, timeout=1):
                    break
            except urllib.error.URLError:
                time.sleep(0.2)
        else:
            raise RuntimeError("FastAPI did not become healthy.")
        processes.append(subprocess.Popen(["node", "server.js"], cwd=ROOT / "web", env=web_env))
        while not stopping:
            for child in processes:
                if child.poll() is not None:
                    return child.returncode or 1
            time.sleep(0.25)
        return 0
    finally:
        for child in reversed(processes):
            if child.poll() is None:
                child.terminate()
        for child in processes:
            try:
                child.wait(timeout=8)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()


if __name__ == "__main__":
    sys.exit(main())
