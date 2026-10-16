import numpy as np

from aero.cli import build_parser
from aero.config import Settings
from aero.jitter import analyze, torso_pitch_deg
from aero.types import JOINTS, Frame, Intrinsics, PersonPose

K = Intrinsics(fx=600, fy=600, cx=320, cy=240, width=640, height=480)


def _person(dx: float = 0.0, wrist_vis: float = 0.9) -> PersonPose:
    pixels = {j: (320.0 + dx, 150.0) for j in JOINTS}
    pixels.update(
        left_shoulder=(377.0 + dx, 200.0), right_shoulder=(263.0 + dx, 200.0),
        left_hip=(360.0 + dx, 300.0), right_hip=(280.0 + dx, 300.0),
        left_wrist=(600.0 + dx, 250.0),  # 落在 0.5 m 的「背景」上 → 深度用估值
    )
    world = {j: (0.0, 0.0, 0.0) for j in JOINTS}
    vis = {j: 0.9 for j in JOINTS}
    vis["left_wrist"] = wrist_vis
    return PersonPose(pixels=pixels, world=world, visibility=vis)


class Source:
    name = "fake"
    has_depth = True

    def __init__(self, n: int):
        self.n, self.t = n, 0.0

    def start(self): ...
    def stop(self): ...

    def read(self):
        if self.n == 0:
            return None
        self.n -= 1
        self.t += 1 / 30
        depth = np.full((480, 640), 2.0, np.float32)
        depth[:, 560:] = 0.5
        return Frame(np.zeros((480, 640, 3), np.uint8), depth, K, self.t)


class Detector:
    def __init__(self, seq):
        self.seq = list(seq)

    def detect(self, rgb, ts_ms):
        return self.seq.pop(0)


def test_統計寬限期_visibility穿越_深度估值():
    seq = [[_person(wrist_vis=v)] for v in (0.9, 0.4, 0.9, 0.4)] + [[]] + [[_person()]]
    rep = analyze(Source(len(seq)), Detector(seq), Settings)
    assert rep.frames == 6 and rep.hold == 1 and rep.no_player == 0
    assert rep.depth_frames == 5
    assert rep.measured["left_wrist"] == 0 and rep.measured["nose"] == 5
    out = rep.format()
    assert "寬限期" in out and "left_wrist" in out
    line = next(l for l in out.splitlines() if l.startswith("left_wrist"))
    assert line.split()[-1] == "100%" and line.split()[-2] == "4"  # 估值 100%、穿越 0.5 四次（寬限期那幀不算）


def test_torso_pitch_定義與前端一致():
    j = {k: [0.0, 0.0, 0.0] for k in JOINTS}
    j.update(left_hip=[0.1, 1.0, 2.0], right_hip=[-0.1, 1.0, 2.0])
    j.update(left_shoulder=[0.2, 1.5, 1.5], right_shoulder=[-0.2, 1.5, 1.5])  # 往鏡頭倒 45°
    assert abs(torso_pitch_deg(j) - 45.0) < 1e-9


def test_cli_有jitter子命令():
    args = build_parser().parse_args(["jitter", "--replay", "still"])
    assert args.replay == "still" and args.func.__name__ == "_cmd_jitter"
