"""aero jitter：把一段錄影跑過 pipeline，量「人沒動、數字還在跳」是哪裡來的。

現場用法：玩家趴低不動，`aero record --source orbbec --name still --seconds 10`，
再 `aero jitter --replay still`。逐項看：
- 寬限期幀：MediaPipe 掉幀 / 離群值（pipeline 會沿用上一個骨架）。
- 每個關節：位置標準差、visibility 低於 0.5 的比例與穿越 0.5 的次數（前端遲滯門檻 0.5 / 0.3）、
  深度退回 MediaPipe 估值的比例。
- 軀幹俯仰：標準差與相鄰幀最大跳動（面積最敏感的一項）。
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass, field

import numpy as np

from aero.config import Settings
from aero.lift3d import measured_joints
from aero.pipeline import Detector, Pipeline
from aero.sources.base import FrameSource
from aero.types import JOINTS, PersonPose

VIS = 0.5


class _Spy:
    """記下每幀偵測到的人，事後才知道選中的是誰（看深度用的是量測還是估值）。"""

    def __init__(self, inner: Detector):
        self._inner = inner
        self.people: list[PersonPose] = []

    def detect(self, rgb: np.ndarray, ts_ms: int) -> list[PersonPose]:
        self.people = self._inner.detect(rgb, ts_ms)
        return self.people


def torso_pitch_deg(joints: dict[str, list[float]]) -> float:
    """和前端 retarget 同一個定義：髖中點 → 肩中點往鏡頭倒的角度。"""
    j = {k: np.asarray(v) for k, v in joints.items()}
    y = (j["left_shoulder"] + j["right_shoulder"]) / 2 - (j["left_hip"] + j["right_hip"]) / 2
    return math.degrees(math.atan2(-y[2], y[1]))


@dataclass
class JitterReport:
    frames: int = 0
    no_player: int = 0
    hold: int = 0
    pos: dict[str, list[list[float]]] = field(default_factory=lambda: {j: [] for j in JOINTS})
    vis: dict[str, list[float]] = field(default_factory=lambda: {j: [] for j in JOINTS})
    measured: dict[str, int] = field(default_factory=lambda: {j: 0 for j in JOINTS})
    depth_frames: int = 0
    pitch: list[float] = field(default_factory=list)

    def format(self) -> str:
        tracked = self.frames - self.no_player - self.hold
        lines = [
            f"幀數 {self.frames}｜沒有玩家 {self.no_player}｜寬限期（掉幀 / 離群，沿用上一個骨架）{self.hold}｜正常追蹤 {tracked}",
        ]
        if self.pitch:
            p = np.asarray(self.pitch)
            jump = float(np.max(np.abs(np.diff(p)))) if len(p) > 1 else 0.0
            lines.append(f"軀幹俯仰 平均 {p.mean():.1f}°  標準差 {p.std():.1f}°  相鄰幀最大跳動 {jump:.1f}°")
        lines.append(f"{'關節':<16}{'位置標準差cm':>12}{'vis<0.5':>9}{'穿越0.5':>8}{'深度用估值':>10}")
        for j in JOINTS:
            pos = np.asarray(self.pos[j])
            std_cm = float(np.linalg.norm(pos.std(axis=0)) * 100) if len(pos) > 1 else 0.0
            v = np.asarray(self.vis[j])
            low = float((v < VIS).mean()) if len(v) else 0.0
            cross = int(np.count_nonzero(np.diff((v >= VIS).astype(int)))) if len(v) > 1 else 0
            est = 1 - self.measured[j] / self.depth_frames if self.depth_frames else float("nan")
            lines.append(f"{j:<16}{std_cm:>12.1f}{low:>9.0%}{cross:>8d}{est:>10.0%}")
        return "\n".join(lines)


def analyze(source: FrameSource, detector: Detector, get_settings: Callable[[], Settings] = Settings) -> JitterReport:
    """跑到 source.read() 回 None 為止（replay 要 loop=False）。"""
    spy = _Spy(detector)
    pipe = Pipeline(source, spy, get_settings)
    rep = JitterReport()
    while (r := pipe.step()) is not None:
        rep.frames += 1
        player = r.skeleton["player"]
        if player is None:
            rep.no_player += 1
            continue
        if pipe.selector_mode == "hold":
            rep.hold += 1
            continue
        for j in JOINTS:
            rep.pos[j].append(player["joints"][j])
            rep.vis[j].append(player["visibility"][j])
        rep.pitch.append(torso_pitch_deg(player["joints"]))
        idx = next(i for i, p in enumerate(r.persons) if p["selected"])
        if r.frame.depth_m is not None:
            rep.depth_frames += 1
            for j in measured_joints(spy.people[idx], r.frame):
                rep.measured[j] += 1
    return rep
