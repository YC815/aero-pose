"""挑玩家：距離 + 站位 + 黏著。spec §4.3。"""

from __future__ import annotations

import numpy as np

from aero.config import Settings

STICKY_RADIUS_M = 0.4
_TORSO = ("left_shoulder", "right_shoulder", "left_hip", "right_hip")


def torso_center(joints_world: dict[str, np.ndarray]) -> np.ndarray:
    return np.mean([joints_world[j] for j in _TORSO], axis=0)


class PlayerSelector:
    def __init__(self) -> None:
        self._last: np.ndarray | None = None

    def reset(self) -> None:
        self._last = None

    def select(self, centers: list[np.ndarray], s: Settings) -> int | None:
        eligible = [
            i
            for i, c in enumerate(centers)
            if s.depth_near_m <= c[2] <= s.depth_far_m
            and abs(c[0] - s.zone_center_x_m) <= s.zone_half_width_m
        ]
        if not eligible:
            self._last = None
            return None
        chosen = min(eligible, key=lambda i: centers[i][2])
        if self._last is not None:
            dist, nearest = min((float(np.linalg.norm(centers[i] - self._last)), i) for i in eligible)
            if dist < STICKY_RADIUS_M:
                chosen = nearest
        self._last = centers[chosen]
        return chosen
