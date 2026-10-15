import json

import numpy as np

from aero.config import Settings
from aero.pipeline import Pipeline
from aero.types import JOINTS, Frame, Intrinsics, PersonPose

K = Intrinsics(fx=600, fy=600, cx=320, cy=240, width=640, height=480)


def make_person(cx_px: float, shoulder_v=200.0, hip_v=300.0, half_w=57.0) -> PersonPose:
    pixels = {j: (cx_px, 150.0) for j in JOINTS}
    pixels["left_shoulder"] = (cx_px + half_w, shoulder_v)
    pixels["right_shoulder"] = (cx_px - half_w, shoulder_v)
    pixels["left_hip"] = (cx_px + half_w * 0.7, hip_v)
    pixels["right_hip"] = (cx_px - half_w * 0.7, hip_v)
    world = {j: (0.0, -0.7, 0.0) for j in JOINTS}  # 頭
    world["left_shoulder"] = (0.19, -0.5, 0.0)
    world["right_shoulder"] = (-0.19, -0.5, 0.0)
    world["left_hip"] = (0.1, 0.0, 0.0)
    world["right_hip"] = (-0.1, 0.0, 0.0)
    return PersonPose(pixels=pixels, world=world, visibility={j: 0.9 for j in JOINTS})


class FakeSource:
    name = "fake"

    def __init__(self, depth_val=2.0, none=False, right_val=None):
        self.right_val = right_val  # 若給定，畫面右半邊的深度
        self.has_depth = True
        self.none = none
        self.depth_val = depth_val
        self.t = 0.0

    def start(self): ...
    def stop(self): ...

    def read(self):
        if self.none:
            return None
        self.t += 1 / 30
        depth = np.full((480, 640), self.depth_val, np.float32)
        if self.right_val is not None:
            depth[:, 320:] = self.right_val
        return Frame(np.zeros((480, 640, 3), np.uint8), depth, K, self.t)


class FakeDetector:
    def __init__(self, persons):
        self.persons = persons
        self.calls = []

    def detect(self, rgb, ts_ms):
        self.calls.append((rgb.shape, ts_ms))
        return self.persons


def test_選較近者_且輸出世界座標():
    # 深度圖左半 2.0 m、右半 1.8 m；兩人都在深度與站位範圍內
    left = make_person(160.0)  # x ≈ -0.53
    right = make_person(480.0)  # x ≈ +0.53
    det = FakeDetector([left, right])
    pipe = Pipeline(FakeSource(right_val=1.8), det, lambda: Settings())
    r = pipe.step()
    assert r is not None
    sk = r.skeleton
    assert sk["type"] == "skeleton" and sk["source"] == "fake" and sk["has_depth"] is True
    assert sk["player"] is not None
    assert abs(sk["player"]["distance_m"] - 1.8) < 1e-6
    j = sk["player"]["joints"]
    assert set(j) == set(JOINTS)
    assert j["left_shoulder"][1] > j["left_hip"][1]  # y 朝上：肩高於髖
    assert j["left_shoulder"][1] > 1.0  # 世界座標：相機高 1.2 m，玩家肩在其上下合理範圍
    assert [p["selected"] for p in r.persons] == [False, True]
    assert det.calls[0][1] == int(sk["ts"] * 1000)


def test_兩人皆合格_選z較小者():
    # 用無深度走肩寬估距：肩寬 114px -> 2.0 m；肩寬 126.7px -> 1.8 m
    class NoDepth(FakeSource):
        def read(self):
            f = super().read()
            f.depth_m = None
            return f

    a = make_person(250.0, half_w=57.0)
    b = make_person(390.0, half_w=63.3)
    pipe = Pipeline(NoDepth(), FakeDetector([a, b]), lambda: Settings(zone_half_width_m=2.0))
    r = pipe.step()
    assert r.skeleton["has_depth"] is False
    assert [p["selected"] for p in r.persons] == [False, True]
    assert r.persons[1]["distance_m"] < r.persons[0]["distance_m"]


def test_json可序列化():
    pipe = Pipeline(FakeSource(), FakeDetector([make_person(320.0)]), lambda: Settings())
    r = pipe.step()
    json.dumps(r.skeleton)
    json.dumps(r.persons)
    p = r.persons[0]
    assert len(p["bbox"]) == 4 and set(p["pixels"]) == set(JOINTS)
    assert all(type(v) is float for v in p["bbox"])


def test_沒人_player為None():
    pipe = Pipeline(FakeSource(), FakeDetector([]), lambda: Settings())
    r = pipe.step()
    assert r.skeleton["player"] is None and r.persons == []


def test_source回None_step回None():
    pipe = Pipeline(FakeSource(none=True), FakeDetector([]), lambda: Settings())
    assert pipe.step() is None


def test_超出深度範圍_player為None():
    pipe = Pipeline(FakeSource(depth_val=5.0), FakeDetector([make_person(320.0)]), lambda: Settings())
    r = pipe.step()
    assert r.skeleton["player"] is None
    assert r.persons[0]["selected"] is False


def test_濾波生效_且換人時reset():
    s = FakeSource()
    det = FakeDetector([make_person(320.0)])
    pipe = Pipeline(s, det, lambda: Settings())
    pipe.step()
    # 同一人橫移 0.05 m 內：有被平滑（不等於原始）
    det.persons = [make_person(320.0 + 30.0)]  # 2.0*30/600 = 0.1 m
    r = pipe.step()
    x = r.skeleton["player"]["joints"]["left_hip"][0]
    raw_x = (320.0 + 30.0 + 57.0 * 0.7 - 320.0) / 600 * 2.0
    assert x < raw_x - 1e-4
    # 換人：跳 0.5 m -> reset，輸出等於原始
    det.persons = [make_person(320.0 + 170.0)]  # 0.567 m，跳 > 0.4 m
    r = pipe.step()
    x = r.skeleton["player"]["joints"]["left_hip"][0]
    raw_x = (320.0 + 170.0 + 57.0 * 0.7 - 320.0) / 600 * 2.0
    assert abs(x - raw_x) < 1e-6
