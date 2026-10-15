"""2D 關節 -> 相機座標（x 右、y 下、z 前，公尺）。spec §4.2。"""

from __future__ import annotations

import math

import numpy as np

from aero.types import JOINTS, Frame, Intrinsics, PersonPose

SHOULDER_WIDTH_M = 0.38
NEIGHBOURHOOD = 3  # 半徑 3 -> 7x7
MAX_DEPTH_DEVIATION_M = 0.6
_TORSO = ("left_shoulder", "right_shoulder", "left_hip", "right_hip")


def estimate_intrinsics(width: int, height: int, hfov_deg: float = 60.0) -> Intrinsics:
    fx = (width / 2) / math.tan(math.radians(hfov_deg) / 2)
    return Intrinsics(fx=fx, fy=fx, cx=width / 2, cy=height / 2, width=width, height=height)


def _unproject(u: float, v: float, z: float, k: Intrinsics) -> np.ndarray:
    return np.array([(u - k.cx) / k.fx * z, (v - k.cy) / k.fy * z, z])


def _sample_depth(depth: np.ndarray, u: float, v: float) -> float | None:
    """7x7 鄰域有效深度（>0）的中位數；沒有有效值回 None。"""
    h, w = depth.shape
    ui, vi = int(round(u)), int(round(v))
    if not (0 <= ui < w and 0 <= vi < h):  # 中心在畫面外：沒有量測，交給 fallback
        return None
    r = NEIGHBOURHOOD
    patch = depth[max(vi - r, 0) : min(vi + r + 1, h), max(ui - r, 0) : min(ui + r + 1, w)]
    valid = patch[patch > 0]
    return float(np.median(valid)) if valid.size else None


def _lift_with_depth(p: PersonPose, depth: np.ndarray, k: Intrinsics) -> dict[str, np.ndarray] | None:
    raw = {j: _sample_depth(depth, *p.pixels[j]) for j in JOINTS}
    torso_d = [raw[j] for j in _TORSO if raw[j] is not None]
    if not torso_d:
        return None
    torso_depth = float(np.median(torso_d))
    torso_world_z = float(np.mean([p.world[j][2] for j in _TORSO]))
    out = {}
    for j in JOINTS:
        d = raw[j]
        if d is None or abs(d - torso_depth) > MAX_DEPTH_DEVIATION_M:
            d = torso_depth + (p.world[j][2] - torso_world_z)
        out[j] = _unproject(*p.pixels[j], d, k)
    return out


def _lift_without_depth(p: PersonPose, k: Intrinsics) -> dict[str, np.ndarray]:
    (ul, vl), (ur, vr) = p.pixels["left_shoulder"], p.pixels["right_shoulder"]
    width_px = max(math.hypot(ul - ur, vl - vr), 1.0)
    d = k.fx * SHOULDER_WIDTH_M / width_px
    hip_mid = (np.array(p.world["left_hip"]) + np.array(p.world["right_hip"])) / 2
    # 世界 landmark 的 y 向下、z 遠離相機為正，與相機座標同向，直接平移即可
    return {j: np.array(p.world[j]) - hip_mid + np.array([0.0, 0.0, d]) for j in JOINTS}


def lift_person(p: PersonPose, frame: Frame) -> dict[str, np.ndarray]:
    h, w = frame.rgb.shape[:2]
    k = frame.intrinsics or estimate_intrinsics(w, h)
    if frame.depth_m is not None:
        out = _lift_with_depth(p, frame.depth_m, k)
        if out is not None:
            return out
    return _lift_without_depth(p, k)
