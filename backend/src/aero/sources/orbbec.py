"""Orbbec Gemini 336L FrameSource (pyorbbecsdk2 / Orbbec SDK v2).

API 依據與來源見 docs/orbbec.md。重點：
- color：優先 MJPG（SDK 對 Gemini336L 的預設即 1280x720@30 MJPG），轉成 RGB uint8。
- depth：Y16，經 AlignFilter(COLOR_STREAM) 軟體 D2C 對齊到 color，再乘 get_depth_scale() (mm/單位) 轉公尺。
- 內參：pipeline.get_camera_param().rgb_intrinsic（color 解析度）。
- 斷線：wait_for_frames 丟例外、或超過 stall_s 沒有完整幀 → 視為斷線，read() 回 None，每 retry_s 秒重開 pipeline。
"""

from __future__ import annotations

import logging
import os
import sys
import time
from collections.abc import Callable
from types import ModuleType
from typing import Any

import cv2
import numpy as np

from aero.config import REPO_ROOT
from aero.types import Frame, Intrinsics

log = logging.getLogger("aero.orbbec")

DOC_PATH = REPO_ROOT / "docs" / "orbbec.md"
WAIT_MS = 1000  # wait_for_frames timeout


class OrbbecSdkMissing(ImportError):
    """pyorbbecsdk 匯入失敗。訊息內含處理文件路徑。"""


def load_sdk() -> ModuleType:
    try:
        import pyorbbecsdk
    except ImportError as e:
        raise OrbbecSdkMissing(
            f"無法匯入 pyorbbecsdk（{e}）。安裝：cd backend && uv sync --extra orbbec；"
            f"macOS 無 wheel 時的 source build 步驟見 {DOC_PATH}"
        ) from e
    return pyorbbecsdk


def macos_needs_sudo() -> bool:
    """macOS 的 UVCAssistant 會獨佔 UVC 裝置，沒有 root 時 SDK 常開不了相機。見 docs/orbbec.md。"""
    return sys.platform == "darwin" and hasattr(os, "geteuid") and os.geteuid() != 0


SUDO_HINT = (
    "macOS 上 UVCAssistant 會獨佔 UVC 相機，需用 root 執行："
    "sudo backend/.venv/bin/python -m aero.doctor（不要用 sudo uv run）；詳見 " + str(DOC_PATH)
)


# --------------------------------------------------------------------------
# SDK 呼叫集中在下面這幾個 helper，測試用假 module 替換即可。
# --------------------------------------------------------------------------


def _pick_profile(profile_list: Any, candidates: list[tuple[int, int, Any, int]]) -> Any:
    """依序嘗試 (w, h, format, fps)，0 表示不限。全部失敗就丟出含可用清單的錯誤。"""
    last: Exception | None = None
    for w, h, fmt, fps in candidates:
        try:
            return profile_list.get_video_stream_profile(w, h, fmt, fps)
        except Exception as e:  # SDK 找不到 profile 時丟 OBError
            last = e
    try:
        available = [str(profile_list[i]) for i in range(len(profile_list))]
    except Exception:
        available = []
    raise RuntimeError(f"找不到符合的 stream profile（{last}）。可用：{available}")


def _color_candidates(sdk: Any, w: int, h: int, fps: int) -> list[tuple[int, int, Any, int]]:
    fmts = [sdk.OBFormat.MJPG, sdk.OBFormat.RGB, sdk.OBFormat.YUYV, sdk.OBFormat.UNKNOWN_FORMAT]
    # 先要求指定 fps，找不到再放寬 fps
    return [(w, h, f, fps) for f in fmts] + [(w, h, f, 0) for f in fmts]


def _build_config(sdk: Any, pipeline: Any, w: int, h: int, fps: int) -> tuple[Any, Any, Any]:
    """回傳 (config, color_profile, depth_profile)。"""
    config = sdk.Config()
    color_list = pipeline.get_stream_profile_list(sdk.OBSensorType.COLOR_SENSOR)
    color_profile = _pick_profile(color_list, _color_candidates(sdk, w, h, fps))
    depth_list = pipeline.get_stream_profile_list(sdk.OBSensorType.DEPTH_SENSOR)
    try:
        depth_profile = _pick_profile(depth_list, [(0, 0, sdk.OBFormat.Y16, fps), (0, 0, sdk.OBFormat.Y16, 0)])
    except RuntimeError:
        depth_profile = depth_list.get_default_video_stream_profile()
    config.enable_stream(color_profile)
    config.enable_stream(depth_profile)
    # 每個 frameset 都要同時有 color + depth（官方 03_color_and_depth_aligned.py 的 SW 對齊寫法）
    config.set_frame_aggregate_output_mode(sdk.OBFrameAggregateOutputMode.FULL_FRAME_REQUIRE)
    return config, color_profile, depth_profile


def _frameset_parts(frames: Any) -> tuple[Any, Any]:
    if not hasattr(frames, "get_color_frame") and hasattr(frames, "as_frame_set"):
        frames = frames.as_frame_set()
    return frames.get_color_frame(), frames.get_depth_frame()


def color_to_rgb(sdk: Any, frame: Any) -> np.ndarray:
    """SDK color frame → HxWx3 uint8 RGB。格式不支援或解碼失敗丟 ValueError。"""
    h, w = frame.get_height(), frame.get_width()
    fmt = frame.get_format()
    data = np.frombuffer(frame.get_data(), dtype=np.uint8)
    F = sdk.OBFormat
    if fmt == F.RGB:
        return data[: h * w * 3].reshape(h, w, 3).copy()
    if fmt == F.BGR:
        return data[: h * w * 3].reshape(h, w, 3)[:, :, ::-1].copy()
    if fmt == F.MJPG:
        bgr = cv2.imdecode(data, cv2.IMREAD_COLOR)
        if bgr is None:
            raise ValueError("MJPG 解碼失敗")
        return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    if fmt == F.YUYV:
        return cv2.cvtColor(data[: h * w * 2].reshape(h, w, 2), cv2.COLOR_YUV2RGB_YUY2)
    if fmt == F.UYVY:
        return cv2.cvtColor(data[: h * w * 2].reshape(h, w, 2), cv2.COLOR_YUV2RGB_UYVY)
    planar = {F.NV12: cv2.COLOR_YUV2RGB_NV12, F.NV21: cv2.COLOR_YUV2RGB_NV21, F.I420: cv2.COLOR_YUV2RGB_I420}
    for f, code in planar.items():
        if fmt == f:
            return cv2.cvtColor(data[: h * w * 3 // 2].reshape(h * 3 // 2, w), code)
    raise ValueError(f"不支援的 color 格式：{fmt}")


def depth_to_meters(frame: Any) -> np.ndarray:
    """Y16 depth frame → HxW float32 公尺，0 = 無效。get_depth_scale() 單位是 mm / 原始值。"""
    h, w = frame.get_height(), frame.get_width()
    raw = np.frombuffer(frame.get_data(), dtype=np.uint16)[: h * w].reshape(h, w)
    return (raw.astype(np.float32) * (float(frame.get_depth_scale()) / 1000.0)).astype(np.float32)


def read_intrinsics(pipeline: Any, color_frame: Any) -> Intrinsics | None:
    """優先用 pipeline.get_camera_param().rgb_intrinsic；解析度和實際 color 不符時改試 stream profile 的內參。"""
    h, w = color_frame.get_height(), color_frame.get_width()
    candidates = []
    try:
        candidates.append(pipeline.get_camera_param().rgb_intrinsic)
    except Exception as e:
        log.warning("get_camera_param 失敗：%s", e)
    try:
        candidates.append(color_frame.get_stream_profile().as_video_stream_profile().get_intrinsic())
    except Exception as e:
        log.warning("stream profile 內參取得失敗：%s", e)
    for c in candidates:
        if (int(c.width), int(c.height)) == (w, h):
            return Intrinsics(float(c.fx), float(c.fy), float(c.cx), float(c.cy), w, h)
    if candidates:
        c = candidates[0]
        log.warning("內參解析度 %sx%s 與 color 幀 %sx%s 不符，3D 座標可能不準", c.width, c.height, w, h)
        return Intrinsics(float(c.fx), float(c.fy), float(c.cx), float(c.cy), int(c.width), int(c.height))
    return None


# --------------------------------------------------------------------------


class OrbbecSource:
    name = "orbbec"
    has_depth = True

    def __init__(
        self,
        width: int = 1280,
        height: int = 720,
        fps: int = 30,
        *,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
        retry_s: float = 2.0,
        stall_s: float = 3.0,
    ):
        self.width, self.height, self.fps = width, height, fps
        self._clock = clock
        self._sleep = sleep
        self._retry_s = retry_s
        self._stall_s = stall_s
        self._sdk: Any = None
        self._pipeline: Any = None
        self._align: Any = None
        self._intrinsics: Intrinsics | None = None
        self._last_attempt = float("-inf")
        self._last_ok = 0.0
        self.last_error: str | None = None
        self.profiles: dict[str, str] = {}  # 開啟後的 color / depth profile 描述，給 doctor 印

    @property
    def connected(self) -> bool:
        return self._pipeline is not None

    def start(self) -> None:
        """匯入失敗會丟 OrbbecSdkMissing；相機開不了則記錄在 last_error，由 read() 每 2 秒重試。"""
        self._sdk = load_sdk()
        self._try_open()

    def stop(self) -> None:
        self._close()

    def read(self) -> Frame | None:
        if self._pipeline is None:
            if self._clock() - self._last_attempt < self._retry_s:
                self._sleep(0.1)  # 斷線期間不要讓呼叫端空轉
                return None
            self._try_open()
            if self._pipeline is None:
                return None
        try:
            frames = self._pipeline.wait_for_frames(WAIT_MS)
            frame = self._to_frame(frames) if frames is not None else None
        except Exception as e:
            self._drop(f"讀取失敗：{e}")
            return None
        now = self._clock()
        if frame is not None:
            self._last_ok = now
        elif now - self._last_ok > self._stall_s:
            self._drop(f"超過 {self._stall_s:g} 秒沒有完整幀")
        return frame

    # -- internals ---------------------------------------------------------

    def _to_frame(self, frames: Any) -> Frame | None:
        aligned = self._align.process(frames)
        if not aligned:
            return None
        color, depth = _frameset_parts(aligned)
        if not color or not depth:
            return None
        try:
            rgb = color_to_rgb(self._sdk, color)
        except ValueError as e:
            log.warning("丟棄壞幀：%s", e)
            return None
        depth_m = depth_to_meters(depth)
        if depth_m.shape != rgb.shape[:2]:  # 對齊後理應同尺寸；保險起見最近鄰縮放
            depth_m = cv2.resize(depth_m, (rgb.shape[1], rgb.shape[0]), interpolation=cv2.INTER_NEAREST)
        if self._intrinsics is None:
            self._intrinsics = read_intrinsics(self._pipeline, color)
        return Frame(rgb=rgb, depth_m=depth_m, intrinsics=self._intrinsics, ts=self._clock())

    def _try_open(self) -> None:
        self._last_attempt = self._clock()
        sdk = self._sdk
        pipeline = None
        try:
            pipeline = sdk.Pipeline()
            config, color_p, depth_p = _build_config(sdk, pipeline, self.width, self.height, self.fps)
            pipeline.start(config)
            self._align = sdk.AlignFilter(align_to_stream=sdk.OBStreamType.COLOR_STREAM)
        except Exception as e:
            self.last_error = str(e) or type(e).__name__
            if macos_needs_sudo():
                self.last_error += f"（{SUDO_HINT}）"
            log.warning("Orbbec 開啟失敗：%s", self.last_error)
            self._close_pipeline(pipeline)
            self._pipeline = None
            return
        self._pipeline = pipeline
        self._intrinsics = None  # 每次重開都重取
        self._last_ok = self._clock()
        self.last_error = None
        self.profiles = {"color": str(color_p), "depth": str(depth_p)}
        log.info("Orbbec 已開啟：color=%s depth=%s", color_p, depth_p)

    def _drop(self, reason: str) -> None:
        log.warning("Orbbec 斷線（%s），%g 秒後重試", reason, self._retry_s)
        self.last_error = reason
        self._close()
        self._last_attempt = self._clock()

    def _close(self) -> None:
        p, self._pipeline = self._pipeline, None
        self._close_pipeline(p)

    @staticmethod
    def _close_pipeline(pipeline: Any) -> None:
        if pipeline is None:
            return
        try:
            pipeline.stop()
        except Exception:
            pass  # 裝置已斷線時 stop 也可能丟例外
