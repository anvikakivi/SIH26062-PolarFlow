"""
Antarctic Operational Planning Map - desktop app launcher.

Starts the FastAPI backend (uvicorn) on a local port and opens the React UI
in a native window (pywebview). Not a public website: it only listens on
127.0.0.1 and runs inside its own window.

Development in a browser instead:
    uvicorn backend.app:app --port 8000      (terminal 1)
    cd frontend && npm run dev                (terminal 2, opens :5173)
"""
import os
import socket
import threading
import time

import uvicorn
import webview

from backend.app import DATA_DIR, DIST_DIR, app


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.isdir(DIST_DIR):
        raise SystemExit("Frontend not built. Run:  cd frontend && npm install && npm run build")

    port = free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    while not server.started:
        time.sleep(0.05)

    webview.create_window(
        "Antarctic Operational Planning Map",
        f"http://127.0.0.1:{port}/",
        width=1280, height=800, min_size=(1000, 650),
    )
    webview.start()
    server.should_exit = True


if __name__ == "__main__":
    main()
