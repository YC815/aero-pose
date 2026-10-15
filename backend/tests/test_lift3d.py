import numpy as np

from aero.lift3d import estimate_intrinsics, lift_person
from aero.types import JOINTS, Frame, Intrinsics, PersonPose

K = Intrinsics(fx=600, fy=600, cx=320, cy=240, width=640, height=480)


def _person(pixels, world=None, vis=1.0):
    if world is None:
        world = {j: (0.0, 0.0, 0.0) for j in JOINTS}
    return PersonPose(pixels=pixels, world=world, visibility={j: vis for j in JOINTS})


def _pixels(default=(320.0, 240.0), **over):
    px = {j: default for j in JOINTS}
    px.update(over)
    return px


def _frame(depth, intr=K, w=1280, h=480):
    return Frame(rgb=np.zeros((h, w, 3), np.uint8), depth_m=depth, intrinsics=intr, ts=0.0)


def test_有深度_反投影():
    depth = np.full((480, 1280), 2.0, np.float32)
    p = _person(_pixels(nose=(920.0, 240.0)))
    out = lift_person(p, _frame(depth))
    np.testing.assert_allclose(out["left_hip"], (0, 0, 2.0), atol=1e-6)
    np.testing.assert_allclose(out["nose"], (2.0, 0, 2.0), atol=1e-6)
    assert set(out) == set(JOINTS)


def test_關節深度為0_走fallback():
    depth = np.full((480, 1280), 2.0, np.float32)
    depth[225:256, 400:431] = 0.0  # 蓋掉整個 7x7 鄰域
    world = {j: (0.0, 0.0, 0.0) for j in JOINTS}
    world["left_wrist"] = (0.0, 0.0, -0.3)  # 比軀幹近 0.3 m
    p = _person(_pixels(left_wrist=(415.0, 240.0)), world=world)
    out = lift_person(p, _frame(depth))
    assert abs(out["left_wrist"][2] - 1.7) < 1e-6
    # xy 仍由像素反投影：(415-320)/600*1.7
    assert abs(out["left_wrist"][0] - (95 / 600) * 1.7) < 1e-6


def test_關節深度與軀幹差過大_走fallback():
    depth = np.full((480, 1280), 2.0, np.float32)
    depth[225:256, 400:431] = 0.9  # 差 1.1 m，背景/誤抓
    p = _person(_pixels(left_wrist=(415.0, 240.0)))
    out = lift_person(p, _frame(depth))
    assert abs(out["left_wrist"][2] - 2.0) < 1e-6


def test_七乘七鄰域取中位數():
    depth = np.full((480, 1280), 2.0, np.float32)
    depth[240, 320] = 9.0  # 單點雜訊
    out = lift_person(_person(_pixels()), _frame(depth))
    assert abs(out["nose"][2] - 2.0) < 1e-6


def test_無深度_用肩寬估距():
    # 肩寬 114 px、fx=600 -> d = 600*0.38/114 = 2.0
    px = _pixels(left_shoulder=(377.0, 200.0), right_shoulder=(263.0, 200.0))
    world = {j: (0.0, 0.0, 0.0) for j in JOINTS}
    world["left_hip"] = (0.1, 0.0, 0.0)
    world["right_hip"] = (-0.1, 0.0, 0.0)
    world["left_shoulder"] = (0.1, -0.5, 0.0)
    world["right_shoulder"] = (-0.1, -0.5, 0.0)
    out = lift_person(_person(px, world=world), _frame(None))
    hip_mid = (out["left_hip"] + out["right_hip"]) / 2
    np.testing.assert_allclose(hip_mid, (0, 0, 2.0), atol=1e-6)
    # 肩在髖上方 0.5 m（相機座標 y 向下 -> -0.5）
    assert abs(out["left_shoulder"][1] - (-0.5)) < 1e-6


def test_無深度無intrinsics_用估算內參():
    px = _pixels(left_shoulder=(377.0, 200.0), right_shoulder=(263.0, 200.0))
    f = _frame(None, intr=None, w=640, h=480)
    out = lift_person(_person(px), f)
    fx = estimate_intrinsics(640, 480).fx
    expected_d = fx * 0.38 / 114
    np.testing.assert_allclose(out["left_hip"][2], expected_d, atol=1e-6)


def test_estimate_intrinsics():
    k = estimate_intrinsics(1280, 720, 60.0)
    assert k.cx == 640 and k.cy == 360 and k.width == 1280 and k.height == 720
    assert abs(k.fx - 640 / np.tan(np.radians(30))) < 1e-6
    assert k.fx == k.fy
