"""挑玩家：黏著優先；新鎖定才看距離 + 站位。spec v1.1「選人黏著」。"""

from __future__ import annotations

import numpy as np

from aero.config import Settings

STICKY_RADIUS_M = 0.4
GRACE_S = 0.8  # 黏著失敗後保留鎖定的寬限期
_TORSO = ("left_shoulder", "right_shoulder", "left_hip", "right_hip")


def torso_center(joints_world: dict[str, np.ndarray]) -> np.ndarray:
    return np.mean([joints_world[j] for j in _TORSO], axis=0)


class PlayerSelector:
    def __init__(self) -> None:
        self._last: np.ndarray | None = None
        self._seen: float | None = None  # 最後一次「黏著成功 / 新鎖定」的時間

    def reset(self) -> None:
        self._last = None
        self._seen = None

    def _sticky(self, centers: list[np.ndarray], now: float | None) -> int | None:
        """已鎖定時的沿用邏輯；回傳沿用者的 index，沒有則 None。"""
        if self._last is None:
            return None
        if centers:
            dist, nearest = min((float(np.linalg.norm(c - self._last)), i) for i, c in enumerate(centers))
            if dist < STICKY_RADIUS_M:
                self._last, self._seen = centers[nearest], now
                return nearest
        in_grace = now is not None and self._seen is not None and now - self._seen <= GRACE_S
        if not in_grace:
            self.reset()
            return None
        # 寬限期：單幀離群 / 掉幀 / 遮擋會讓座標一次跳很遠。選最接近者，不限半徑、不套範圍；
        # 不更新 _last / _seen，所以寬限期從最後一次真正黏著起算，離群值延長不了它。
        if not centers:
            return None
        return min(range(len(centers)), key=lambda i: float(np.linalg.norm(centers[i] - self._last)))

    def select(self, centers: list[np.ndarray], s: Settings, now: float | None = None) -> int | None:
        """now：frame 時間（秒）。省略時沒有寬限期（找不到黏著對象就立刻清除）。"""
        had_lock = self._last is not None
        sticky = self._sticky(centers, now)
        if sticky is not None:
            return sticky
        if had_lock and self._last is not None:  # 寬限期內沒有候選人：維持鎖定
            return None
        eligible = [
            i
            for i, c in enumerate(centers)
            if s.depth_near_m <= c[2] <= s.depth_far_m
            and abs(c[0] - s.zone_center_x_m) <= s.zone_half_width_m
        ]
        if not eligible:
            return None
        chosen = min(eligible, key=lambda i: centers[i][2])
        self._last, self._seen = centers[chosen], now
        return chosen
