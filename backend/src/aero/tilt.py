"""相機座標 -> 世界座標（spec §3）。"""

from __future__ import annotations

import math

import numpy as np


def cam_to_world(
    points: dict[str, np.ndarray], camera_height_m: float, camera_pitch_deg: float
) -> dict[str, np.ndarray]:
    """flipY 後繞 x 軸轉 pitch（下俯為正），再把原點抬到相機高度。"""
    th = math.radians(camera_pitch_deg)
    c, s = math.cos(th), math.sin(th)
    out: dict[str, np.ndarray] = {}
    for name, p in points.items():
        x, y, z = float(p[0]), -float(p[1]), float(p[2])
        out[name] = np.array([x, y * c - z * s + camera_height_m, y * s + z * c])
    return out
