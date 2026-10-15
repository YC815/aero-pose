import numpy as np

from aero.config import Settings
from aero.selector import PlayerSelector, torso_center
from aero.types import JOINTS

S = Settings()  # 1.5~3.0 m、站位 0±0.6


def c(x, z, y=1.0):
    return np.array([x, y, z], dtype=float)


def test_torso_center_四點平均():
    j = {k: np.zeros(3) for k in JOINTS}
    j["left_shoulder"] = np.array([1.0, 0, 0])
    j["right_shoulder"] = np.array([0.0, 4.0, 0])
    j["left_hip"] = np.array([0.0, 0, 2.0])
    j["right_hip"] = np.array([3.0, 0, 6.0])
    np.testing.assert_allclose(torso_center(j), (1.0, 1.0, 2.0))


def test_選較近者():
    assert PlayerSelector().select([c(0, 2.0), c(0, 1.8)], S) == 1


def test_太近被排除():
    assert PlayerSelector().select([c(0, 1.2), c(0, 2.5)], S) == 1


def test_太遠被排除():
    assert PlayerSelector().select([c(0, 3.5)], S) is None


def test_x超出站位被排除():
    assert PlayerSelector().select([c(0.9, 1.8), c(0.0, 2.5)], S) == 1


def test_站位中心位移():
    s = Settings(zone_center_x_m=1.0)
    assert PlayerSelector().select([c(0.0, 2.0), c(1.2, 2.5)], s) == 1


def test_黏著():
    sel = PlayerSelector()
    a, b = c(0.0, 2.0), c(0.3, 1.9)
    assert sel.select([a, c(0.3, 2.9)], S) == 0
    # 這幀 B 較近也合格，但 A 還在 -> 沿用 A
    assert sel.select([b, a + 0.05], S) == 1  # index 1 是 A（略微移動）


def test_黏著_A消失改選B():
    sel = PlayerSelector()
    a = c(0.0, 2.0)
    assert sel.select([a], S) == 0
    assert sel.select([c(0.5, 1.9)], S) == 0  # 離 A 超過 0.4 m，選 B（唯一）


def test_沒有合格_回None並清記憶():
    sel = PlayerSelector()
    a = c(0.0, 2.0)
    assert sel.select([a], S) == 0
    assert sel.select([c(0, 5.0)], S) is None
    # 記憶已清：A 回來時不黏著，改選最近者
    assert sel.select([a, c(0.0, 1.6)], S) == 1


def test_reset():
    sel = PlayerSelector()
    sel.select([c(0, 2.0)], S)
    sel.reset()
    assert sel.select([c(0, 2.0), c(0, 1.6)], S) == 1


def test_空候選():
    assert PlayerSelector().select([], S) is None
