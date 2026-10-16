"""挑玩家：黏著優先；新鎖定才看距離 + 站位。spec v1.1「選人黏著」。"""

from __future__ import annotations

from typing import Literal

import numpy as np

from aero.config import Settings

STICKY_RADIUS_M = 0.4
GRACE_S = 0.8  # 黏著失敗後保留鎖定的寬限期
_TORSO = ("left_shoulder", "right_shoulder", "left_hip", "right_hip")

# select() 這一幀怎麼選的：
#   "new"   新鎖定（換人，濾波器要重來）
#   "track" 黏著成功（同一人，座標可信）
#   "hold"  寬限期：沒人在黏著半徑內（掉幀、離群值、遮擋），鎖定還在，座標不可信
#   None    沒有鎖定
Mode = Literal["new", "track", "hold"] | None


def torso_center(joints_world: dict[str, np.ndarray]) -> np.ndarray:
    return np.mean([joints_world[j] for j in _TORSO], axis=0)


class PlayerSelector:
    def __init__(self) -> None:
        self._last: np.ndarray | None = None
        self._seen: float | None = None  # 最後一次「黏著成功 / 新鎖定」的時間
        self.mode: Mode = None

    def reset(self) -> None:
        self._last = None
        self._seen = None
        self.mode = None

    def _sticky(self, centers: list[np.ndarray], now: float | None) -> int | None:
        """已鎖定時的沿用邏輯；設定 self.mode（track / hold，鎖定失效則 None）。"""
        if self._last is None:
            self.mode = None
            return None
        if centers:
            dist, nearest = min((float(np.linalg.norm(c - self._last)), i) for i, c in enumerate(centers))
            if dist < STICKY_RADIUS_M:
                self._last, self._seen, self.mode = centers[nearest], now, "track"
                return nearest
        in_grace = now is not None and self._seen is not None and now - self._seen <= GRACE_S
        if not in_grace:
            self.reset()
            return None
        # 寬限期：單幀離群 / 掉幀 / 遮擋會讓座標一次跳很遠。選最接近者（給畫面標示與 mask 用），不限半徑、不套範圍；
        # 不更新 _last / _seen，所以寬限期從最後一次真正黏著起算，離群值延長不了它。
        self.mode = "hold"
        if not centers:
            return None
        return min(range(len(centers)), key=lambda i: float(np.linalg.norm(centers[i] - self._last)))

    def select(self, centers: list[np.ndarray], s: Settings, now: float | None = None) -> int | None:
        """now：frame 時間（秒）。省略時沒有寬限期（找不到黏著對象就立刻清除）。選法寫在 self.mode。"""
        idx = self._sticky(centers, now)
        if self.mode is not None:
            return idx
        eligible = [
            i
            for i, c in enumerate(centers)
            if s.depth_near_m <= c[2] <= s.depth_far_m
            and abs(c[0] - s.zone_center_x_m) <= s.zone_half_width_m
        ]
        if not eligible:
            return None
        chosen = min(eligible, key=lambda i: centers[i][2])
        self._last, self._seen, self.mode = centers[chosen], now, "new"
        return chosen
