"""挑玩家：黏著優先；新鎖定才看距離 + 站位。spec v1.1「選人黏著」。"""

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
        # 已鎖定：離上次夠近就沿用，不檢查距離範圍與站位（往前彎時肩寬估距會變小，不能因此踢人）
        if self._last is not None and centers:
            dist, nearest = min((float(np.linalg.norm(c - self._last)), i) for i, c in enumerate(centers))
            if dist < STICKY_RADIUS_M:
                self._last = centers[nearest]
                return nearest
        # 新鎖定：才套用範圍與站位
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
        self._last = centers[chosen]
        return chosen
