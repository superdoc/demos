from __future__ import annotations

import os
from pathlib import Path
import signal
import subprocess
import sys
import time


ROOT = Path(__file__).resolve().parent.parent


def load_env() -> dict[str, str]:
    env = os.environ.copy()
    env_file = ROOT / ".env"
    if not env_file.exists():
        print("Missing .env. Run: cp .env.example .env", file=sys.stderr)
        raise SystemExit(1)
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    if not env.get("OPENAI_API_KEY"):
        print("Add OPENAI_API_KEY to .env before starting the demo.", file=sys.stderr)
        raise SystemExit(1)
    collaboration_port = env.get("COLLABORATION_PORT", "18081")
    env.update(
        {
            "PORT": collaboration_port,
            "COLLABORATION_URL": f"ws://127.0.0.1:{collaboration_port}",
            "PUBLIC_COLLABORATION_URL": f"ws://localhost:{collaboration_port}",
            "DOCUMENT_ROOT": str(ROOT / "data"),
            "VITE_API_URL": "http://localhost:8000",
        }
    )
    return env


def main() -> None:
    env = load_env()
    commands = [
        ("collaboration", ["npm", "start"], ROOT / "collaboration"),
        ("api", [str(ROOT / ".venv/bin/uvicorn"), "app.main:app", "--host", "0.0.0.0", "--port", "8000"], ROOT / "server"),
        ("client", ["npm", "run", "dev"], ROOT / "client"),
    ]
    processes: list[tuple[str, subprocess.Popen[bytes]]] = []
    stopping = False

    def stop(*_: object) -> None:
        for _, process in processes:
            if process.poll() is None:
                process.terminate()
        deadline = time.monotonic() + 5
        for _, process in processes:
            try:
                process.wait(timeout=max(0.1, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                process.kill()

    def request_stop(*_: object) -> None:
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)

    try:
        for name, command, cwd in commands:
            process = subprocess.Popen(command, cwd=cwd, env=env)
            processes.append((name, process))
            print(f"[dev] started {name} (pid {process.pid})", flush=True)
        print("[dev] open http://localhost:15173", flush=True)

        while not stopping:
            for name, process in processes:
                return_code = process.poll()
                if return_code is not None:
                    print(f"[dev] {name} exited with status {return_code}", file=sys.stderr)
                    raise SystemExit(return_code or 1)
            time.sleep(0.25)
    finally:
        stop()


if __name__ == "__main__":
    main()
