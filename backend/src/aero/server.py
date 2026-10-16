"""FastAPI app：REST + WebSocket，並在 daemon thread 跑 pipeline 迴圈。

thread → asyncio 的交接只有一條路：loop.call_soon_threadsafe(hub.broadcast / hub.broadcast_frame, msg)。
Hub 的所有狀態只在 event loop thread 內改動；pipeline thread 只讀 preview_count / client_count（int）。
JPEG 編碼等 render 成本都在 pipeline thread 做，event loop 只負責轉送。
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import contextlib
import json
import logging
import os
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
FRAME_INTERVAL_S = 0.05  # frame 串流上限 20 fps
IDLE_SLEEP_S = 0.02  # step() 回 None 時的退讓，避免空轉
QUEUE_SIZE = 4
CAMERA_FRESH_S = 2.0  # 最後一幀在這麼久以內才算相機 ok
WATCHDOG_S = 30.0  # 這麼久沒有任何成功的幀 → 結束行程，由 start.sh 的迴圈重啟（清掉卡死的 SDK 呼叫）
_ID_RE = re.compile(r"^([0-9a-f]{10})\.png$")


def _render_preview(r: Any) -> dict:
    from aero.preview import render_preview  # lazy：Task 1 的模組

    return render_preview(r)


def _render_frame(r: Any) -> dict:
    from aero.preview import render_frame

    return render_frame(r)


class SettingsStore:
    def __init__(self, path: Path):
        self._path = path
        self._lock = threading.Lock()
        self._settings = self._load(path)

    @staticmethod
    def _load(path: Path) -> Settings:
        """壞檔不能讓無人攤位 crash-loop：改名備份、用預設值。"""
        try:
            return load_settings(path)
        except (ValueError, TypeError, AttributeError, OSError):  # JSON 壞、非 dict、值無法轉 float
            log.exception("settings.json 無法讀取，改用預設值")
        bad = path.with_name(f"{path.name}.bad-{int(time.time())}")
        try:
            path.replace(bad)
            log.warning("壞檔已改名為 %s", bad)
        except OSError:
            log.exception("壞檔改名失敗")
        return Settings()

    def get(self) -> Settings:
        with self._lock:
            return self._settings

    def set(self, s: Settings) -> None:
        with self._lock:
            save_settings(self._path, s)
            self._settings = s


class Conn:
    """每個 client 兩個出口：
    - queue：有界的控制訊息（skeleton / status / settings / preview），滿了丟最舊的。
    - frame：單一槽位，只留最新的 frame。frame 很大又很多，不能跟控制訊息搶 queue。
    next() 永遠先出控制訊息，所以慢 client 也收得到 status / settings。
    """

    def __init__(self) -> None:
        self.queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=QUEUE_SIZE)
        self.frame: dict | None = None
        self.preview = False
        self._wake = asyncio.Event()

    def put(self, msg: dict) -> None:
        """滿了就丟最舊的，慢 client 不會卡住別人。"""
        if self.queue.full():
            self.queue.get_nowait()
        self.queue.put_nowait(msg)
        self._wake.set()

    def put_frame(self, msg: dict) -> None:
        self.frame = msg  # 覆寫：舊 frame 直接丟
        self._wake.set()

    async def next(self) -> dict:
        while True:
            if not self.queue.empty():
                return self.queue.get_nowait()
            if self.frame is not None:
                msg, self.frame = self.frame, None
                return msg
            self._wake.clear()  # 單一 event loop thread：檢查與 clear 之間沒有 await，不會漏訊號
            await self._wake.wait()


class Hub:
    def __init__(self) -> None:
        self._conns: set[Conn] = set()
        self.preview_count = 0
        self.client_count = 0

    def add(self, initial: list[dict]) -> Conn:
        conn = Conn()
        for m in initial:
            conn.put(m)
        self._conns.add(conn)
        self.client_count += 1
        return conn

    def remove(self, conn: Conn) -> None:
        if conn in self._conns:
            self._conns.discard(conn)
            self.client_count -= 1
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

    def broadcast_frame(self, msg: dict) -> None:
        for c in self._conns:
            c.put_frame(msg)


class CameraState:
    """由 pipeline thread 寫、event loop 讀；都是單一賦值 / 單調遞增 int，GIL 下安全。

    相機狀態看「最後一幀多久以前」，不是瞬間旗標：step() 卡死會變 disconnected，單一空幀不會。
    """

    def __init__(self) -> None:
        self.last_frame_t: float | None = None  # time.monotonic()
        self.frames = 0

    def camera(self, now: float) -> str:
        t = self.last_frame_t
        return "ok" if t is not None and now - t < CAMERA_FRESH_S else "disconnected"

    def status_msg(self, fps: float, now: float | None = None) -> dict:
        now = time.monotonic() if now is None else now
        return {"type": "status", "camera": self.camera(now), "fps": round(fps, 1)}


def _exit_for_restart() -> None:
    """卡死的 SDK 呼叫救不回來，只能整個行程重來。os._exit 不等 daemon thread、不跑 atexit。"""
    logging.shutdown()
    os._exit(1)


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
                self._close(pipeline)
            self._stop.wait(RESTART_DELAY_S)

    def _emit_frame(self, msg: dict) -> None:
        try:
            self._loop.call_soon_threadsafe(self._hub.broadcast_frame, msg)
        except RuntimeError:  # loop 已關閉（shutdown 競態）
            self._stop.set()

    def _loop_steps(self, pipeline: Any) -> None:
        last_preview = 0.0
        last_frame = float("-inf")
        while not self._stop.is_set():
            r = pipeline.step()
            if r is None:
                self._stop.wait(IDLE_SLEEP_S)
                continue
            self._state.last_frame_t = time.monotonic()
            self._state.frames += 1
            self._emit(r.skeleton)
            now = time.monotonic()
            if self._hub.preview_count > 0 and now - last_preview >= PREVIEW_INTERVAL_S:
                last_preview = now
                self._emit_preview(r)
            if self._hub.client_count > 0 and now - last_frame >= FRAME_INTERVAL_S:
                last_frame = now
                self._render_and_emit_frame(r)

    def _render_and_emit_frame(self, r: Any) -> None:
        try:
            msg = _render_frame(r)  # 在 pipeline thread 編碼，不佔 event loop
        except Exception:
            log.exception("render_frame 失敗")
            return
        self._emit_frame(msg)

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
    *,
    watchdog_s: float | None = None,
    on_stall: Callable[[], None] = _exit_for_restart,
) -> FastAPI:
    """watchdog_s：沒有成功幀多久就呼叫 on_stall（預設 WATCHDOG_S → 結束行程）。只在有 pipeline 時啟用。"""
    settings_store = SettingsStore(data_dir / "settings.json")
    store = ResultStore(data_dir)
    uploader = uploader or LocalUploader(port)
    hub = Hub()
    state = CameraState()

    async def status_loop() -> None:
        started = last_t = time.monotonic()
        last_frames = state.frames
        limit = WATCHDOG_S if watchdog_s is None else watchdog_s
        stalled = False
        while True:
            await asyncio.sleep(STATUS_INTERVAL_S)
            now = time.monotonic()
            fps = (state.frames - last_frames) / max(now - last_t, 1e-6)
            last_frames, last_t = state.frames, now
            hub.broadcast(state.status_msg(fps, now))
            ref = state.last_frame_t if state.last_frame_t is not None else started
            if pipeline_factory is not None and not stalled and now - ref > limit:
                stalled = True
                log.critical("超過 %.0f 秒沒有任何成功的相機幀，結束行程讓 start.sh 重啟", limit)
                on_stall()

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
                await ws.send_json(await conn.next())
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
