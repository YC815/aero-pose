"""source -> detect -> lift -> tilt -> select -> filter，產生 skeleton 訊息。spec §4.5。"""

from __future__ import annotations

import time
from typing import Callable, Protocol

import numpy as np

from aero.config import Settings
from aero.filter import JointFilter
from aero.lift3d import lift_person
from aero.perf import PERF
from aero.selector import PlayerSelector, torso_center
from aero.sources.base import FrameSource
from aero.tilt import cam_to_world
from aero.types import PersonPose, StepResult

class Detector(Protocol):
    def detect(self, rgb: np.ndarray, ts_ms: int) -> list[PersonPose]: ...


def _vec(p: np.ndarray) -> list[float]:
    return [float(v) for v in p]


class Pipeline:
    def __init__(self, source: FrameSource, detector: Detector, get_settings: Callable[[], Settings]):
        self._source = source
        self._detector = detector
        self._get_settings = get_settings
        self._selector = PlayerSelector()
        self._filter: JointFilter | None = None
        self._filter_params: tuple[float, float] | None = None
        self._held: dict | None = None  # 上一個可信的 player，寬限期內沿用

    def _joint_filter(self, s: Settings) -> JointFilter:
        params = (s.filter_min_cutoff, s.filter_beta)
        if self._filter is None or self._filter_params != params:  # 設定變更時重建
            self._filter, self._filter_params = JointFilter(*params), params
        return self._filter

    def step(self) -> StepResult | None:
        frame = self._source.read()
        if frame is None:
            return None
        s = self._get_settings()
        with PERF.time("detect"):
            people = self._detector.detect(frame.rgb, int(frame.ts * 1000))
        t_post = time.perf_counter()

        worlds = [
            cam_to_world(lift_person(p, frame), s.camera_height_m, s.camera_pitch_deg) for p in people
        ]
        centers = [torso_center(w) for w in worlds]
        idx = self._selector.select(centers, s, frame.ts)

        # 只有新鎖定（換人）和失去鎖定才重來。寬限期（掉幀、離群值）不碰濾波器，沿用上一個可信的骨架：
        # 否則一個壞幀就清掉濾波狀態，下一幀直接輸出沒平滑的原始值。
        mode = self._selector.mode
        if mode in ("new", None):
            self._filter, self._held = None, None
        if mode in ("new", "track"):
            joints = self._joint_filter(s)(worlds[idx], frame.ts)
            self._held = {
                "distance_m": float(centers[idx][2]),
                "joints": {j: _vec(v) for j, v in joints.items()},
                "visibility": {j: float(v) for j, v in people[idx].visibility.items()},
            }
        player = self._held

        persons = []
        for i, p in enumerate(people):
            us = [float(u) for u, _ in p.pixels.values()]
            vs = [float(v) for _, v in p.pixels.values()]
            persons.append(
                {
                    "bbox": [min(us), min(vs), max(us), max(vs)],
                    "selected": i == idx,
                    "distance_m": float(centers[i][2]),
                    "pixels": {j: [float(u), float(v)] for j, (u, v) in p.pixels.items()},
                }
            )

        skeleton = {
            "type": "skeleton",
            "ts": frame.ts,
            "source": self._source.name,
            "has_depth": frame.depth_m is not None,
            "player": player,
        }
        selected_mask = None if idx is None else people[idx].mask
        PERF.add("post", (time.perf_counter() - t_post) * 1000)
        PERF.count("step")
        return StepResult(skeleton=skeleton, frame=frame, persons=persons, selected_mask=selected_mask)
