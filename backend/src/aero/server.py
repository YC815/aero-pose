"""FastAPI app：REST + WebSocket，並在 daemon thread 跑 pipeline 迴圈。

thread → asyncio 的交接只有一條路：loop.call_soon_threadsafe(hub.broadcast, msg)。
Hub 的所有狀態只在 event loop thread 內改動；pipeline thread 只讀 preview_count（int）。
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import contextlib
import json
import logging
import re
import threading
import time
from collections.abc import Callable
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import Body, FastAPI, HTTPException, WebSocket
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from aero.config import (
    FRONTEND_DIST,
    Settings,
    load_settings,
    save_settings,
    settings_from_dict,
    settings_to_dict,
)
from aero.results import ResultStore
from aero.uploader import LocalUploader, Uploader

log = logging.getLogger(__name__)

STATUS_INTERVAL_S = 1.0
RESTART_DELAY_S = 2.0
PREVIEW_INTERVAL_S = 0.1
IDLE_SLEEP_S = 0.02  # step() 回 None 時的退讓，避免空轉
QUEUE_SIZE = 4
_ID_RE = re.compile(r"^([0-9a-f]{10})\.png$")


def _render_preview(r: Any) -> dict:
    from aero.preview import render_preview  # lazy：Task 1 的模組

    return render_preview(r)


class SettingsStore:
    def __init__(self, path: Path):
        self._path = path
        self._lock = threading.Lock()
        self._settings = load_settings(path)

    def get(self) -> Settings:
        with self._lock:
            return self._settings

    def set(self, s: Settings) -> None:
        with self._lock:
            save_settings(self._path, s)
            self._settings = s


class Conn:
    def __init__(self) -> None:
        self.queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=QUEUE_SIZE)
        self.preview = False

    def put(self, msg: dict) -> None:
        """滿了就丟最舊的，慢 client 不會卡住別人。"""
        if self.queue.full():
            self.queue.get_nowait()
        self.queue.put_nowait(msg)


class Hub:
    def __init__(self) -> None:
        self._conns: set[Conn] = set()
        self.preview_count = 0

    def add(self, initial: list[dict]) -> Conn:
        conn = Conn()
        for m in initial:
            conn.put(m)
        self._conns.add(conn)
        return conn

    def remove(self, conn: Conn) -> None:
        if conn in self._conns:
            self._conns.discard(conn)
            if conn.preview:
                self.preview_count -= 1

    def set_preview(self, conn: Conn, on: bool) -> None:
        if conn not in self._conns or conn.preview == on:
            return
        conn.preview = on
        self.preview_count += 1 if on else -1

    def broadcast(self, msg: dict, preview_only: bool = False) -> None:
        for c in self._conns:
            if preview_only and not c.preview:
                continue
            c.put(msg)


class CameraState:
    """由 pipeline thread 寫、event loop 讀；都是單一賦值 / 單調遞增 int，GIL 下安全。"""

    def __init__(self) -> None:
        self.camera = "disconnected"
        self.frames = 0

    def status_msg(self, fps: float) -> dict:
        return {"type": "status", "camera": self.camera, "fps": round(fps, 1)}


class PipelineRunner:
    def __init__(
        self,
        factory: Callable[[Callable[[], Settings]], Any],
        get_settings: Callable[[], Settings],
        hub: Hub,
        loop: asyncio.AbstractEventLoop,
        state: CameraState,
    ) -> None:
        self._factory = factory
        self._get_settings = get_settings
        self._hub = hub
        self._loop = loop
        self._state = state
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="aero-pipeline", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._thread.join(timeout=3)

    def _emit(self, msg: dict, preview_only: bool = False) -> None:
        try:
            self._loop.call_soon_threadsafe(self._hub.broadcast, msg, preview_only)
        except RuntimeError:  # loop 已關閉（shutdown 競態）
            self._stop.set()

    def _run(self) -> None:
        while not self._stop.is_set():
            pipeline = None
            try:
                pipeline = self._factory(self._get_settings)  # 在本 thread 內建立
                self._loop_steps(pipeline)
            except Exception:
                log.exception("pipeline 例外，%.1f 秒後重建", RESTART_DELAY_S)
            finally:
                self._state.camera = "disconnected"
                self._close(pipeline)
            self._stop.wait(RESTART_DELAY_S)

    def _loop_steps(self, pipeline: Any) -> None:
        last_preview = 0.0
        while not self._stop.is_set():
            r = pipeline.step()
            if r is None:
                self._state.camera = "disconnected"
                self._stop.wait(IDLE_SLEEP_S)
                continue
            self._state.camera = "ok"
            self._state.frames += 1
            self._emit(r.skeleton)
            now = time.monotonic()
            if self._hub.preview_count > 0 and now - last_preview >= PREVIEW_INTERVAL_S:
                last_preview = now
                self._emit_preview(r)

    def _emit_preview(self, r: Any) -> None:
        try:
            msg = _render_preview(r)
        except Exception:
            log.exception("render_preview 失敗")
            return
        self._emit(msg, preview_only=True)

    @staticmethod
    def _close(pipeline: Any) -> None:
        close = getattr(pipeline, "close", None)
        if close is None:
            return
        try:
            close()
        except Exception:
            log.exception("pipeline close 失敗")


class ResultIn(BaseModel):
    area_m2: float
    baseline_m2: float
    watts_saved: float
    png_b64: str


def create_app(
    pipeline_factory: Callable[[Callable[[], Settings]], Any] | None,
    data_dir: Path,
    port: int = 8000,
    uploader: Uploader | None = None,
) -> FastAPI:
    settings_store = SettingsStore(data_dir / "settings.json")
    store = ResultStore(data_dir)
    uploader = uploader or LocalUploader(port)
    hub = Hub()
    state = CameraState()

    async def status_loop() -> None:
        last_frames, last_t = state.frames, time.monotonic()
        while True:
            await asyncio.sleep(STATUS_INTERVAL_S)
            now = time.monotonic()
            fps = (state.frames - last_frames) / max(now - last_t, 1e-6)
            last_frames, last_t = state.frames, now
            hub.broadcast(state.status_msg(fps))

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        runner = None
        if pipeline_factory is not None:
            runner = PipelineRunner(
                pipeline_factory, settings_store.get, hub, asyncio.get_running_loop(), state
            )
            runner.start()
        task = asyncio.create_task(status_loop())
        try:
            yield
        finally:
            task.cancel()
            if runner is not None:
                await run_in_threadpool(runner.stop)

    app = FastAPI(lifespan=lifespan)

    def settings_msg() -> dict:
        return {"type": "settings", "settings": settings_to_dict(settings_store.get())}

    @app.get("/api/settings")
    async def get_settings() -> dict:
        return settings_to_dict(settings_store.get())

    @app.put("/api/settings")
    async def put_settings(body: dict = Body(...)) -> dict:
        try:
            s = settings_from_dict(body)
        except (TypeError, ValueError) as e:
            raise HTTPException(422, f"設定值無效：{e}") from e
        await run_in_threadpool(settings_store.set, s)
        hub.broadcast(settings_msg())
        return settings_to_dict(s)

    @app.get("/api/leaderboard")
    async def leaderboard(date: str | None = None) -> list[dict]:
        date = date or datetime.now().astimezone().strftime("%Y-%m-%d")
        return store.top(date)

    @app.post("/api/results")
    async def post_result(body: ResultIn) -> dict:
        try:
            png = base64.b64decode(body.png_b64, validate=True)
        except (binascii.Error, ValueError) as e:
            raise HTTPException(400, "png_b64 不是合法的 base64") from e
        entry = await run_in_threadpool(
            store.add, body.area_m2, body.baseline_m2, body.watts_saved, png
        )
        try:
            qr_url = await run_in_threadpool(uploader.upload, entry["id"], png)
        except Exception:
            log.exception("上傳失敗")
            qr_url = None
        return {
            "id": entry["id"],
            "number": entry["number"],
            "rank": store.rank(entry),
            "qr_url": qr_url,
        }

    @app.get("/r/{name}")
    async def get_png(name: str) -> FileResponse:
        m = _ID_RE.match(name)
        if m is None:
            raise HTTPException(404)
        path = store.png_path(m.group(1))
        if not path.is_file():
            raise HTTPException(404)
        return FileResponse(path, media_type="image/png")

    async def ws_sender(ws: WebSocket, conn: Conn) -> None:
        try:
            while True:
                await ws.send_json(await conn.queue.get())
        except Exception:  # 送不出去 → 結束，由外層移除連線
            return

    async def ws_receiver(ws: WebSocket, conn: Conn) -> None:
        try:
            while True:
                text = await ws.receive_text()
                try:
                    msg = json.loads(text)
                except json.JSONDecodeError:
                    continue
                if (
                    isinstance(msg, dict)
                    and msg.get("type") == "preview"
                    and isinstance(msg.get("on"), bool)
                ):
                    hub.set_preview(conn, msg["on"])
        except Exception:  # 斷線
            return

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket) -> None:
        await ws.accept()
        conn = hub.add([settings_msg(), state.status_msg(0.0)])
        tasks = {
            asyncio.create_task(ws_sender(ws, conn)),
            asyncio.create_task(ws_receiver(ws, conn)),
        }
        try:
            _, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for t in pending:
                t.cancel()
        finally:
            hub.remove(conn)
            with contextlib.suppress(Exception):
                await ws.close()

    # 必須放在所有路由之後
    if FRONTEND_DIST.exists():
        app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")

    return app
