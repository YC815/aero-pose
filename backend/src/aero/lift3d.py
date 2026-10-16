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


def _sample_depth(depth: np.ndarray, u: float, v: float, mask: np.ndarray | None = None) -> float | None:
    """7x7 鄰域有效深度（>0）的中位數；沒有有效值回 None。

    給了 mask（該人的分割，與 depth 同尺寸）時，優先只用 mask 內的像素：關節在身體輪廓邊緣時，
    鄰域一半是背景，中位數會在身體和背景之間跳。mask 內沒有有效值（細手臂常被 mask 漏掉）才退回整個鄰域。
    """
    h, w = depth.shape
    ui, vi = int(round(u)), int(round(v))
    if not (0 <= ui < w and 0 <= vi < h):  # 中心在畫面外：沒有量測，交給 fallback
        return None
    r = NEIGHBOURHOOD
    rows, cols = slice(max(vi - r, 0), min(vi + r + 1, h)), slice(max(ui - r, 0), min(ui + r + 1, w))
    patch = depth[rows, cols]
    valid = patch > 0
    if mask is not None:
        on_body = valid & (mask[rows, cols] > 0.5)
        if on_body.any():
            valid = on_body
    return float(np.median(patch[valid])) if valid.any() else None


def _measured_depths(p: PersonPose, depth: np.ndarray) -> tuple[dict[str, float | None], float] | None:
    """每個關節量到的深度（量不到或離軀幹太遠為 None）與軀幹深度；軀幹四點都量不到回 None。"""
    mask = p.mask if p.mask is not None and p.mask.shape == depth.shape else None
    raw = {j: _sample_depth(depth, *p.pixels[j], mask) for j in JOINTS}
    torso_d = [raw[j] for j in _TORSO if raw[j] is not None]
    if not torso_d:
        return None
    torso_depth = float(np.median(torso_d))
    return {j: None if d is None or abs(d - torso_depth) > MAX_DEPTH_DEVIATION_M else d for j, d in raw.items()}, torso_depth


def measured_joints(p: PersonPose, frame: Frame) -> set[str]:
    """哪些關節用的是量到的深度（其餘是 MediaPipe 估的 z）。診斷用。"""
    if frame.depth_m is None:
        return set()
    m = _measured_depths(p, frame.depth_m)
    return set() if m is None else {j for j, d in m[0].items() if d is not None}


def _lift_with_depth(p: PersonPose, depth: np.ndarray, k: Intrinsics) -> dict[str, np.ndarray] | None:
    m = _measured_depths(p, depth)
    if m is None:
        return None
    raw, torso_depth = m
    torso_world_z = float(np.mean([p.world[j][2] for j in _TORSO]))
    out = {}
    for j in JOINTS:
        d = raw[j]
        if d is None:
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
