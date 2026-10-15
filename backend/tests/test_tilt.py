import math

import numpy as np

from aero.tilt import cam_to_world


def _one(p, h, pitch):
    return cam_to_world({"a": np.array(p, dtype=float)}, h, pitch)["a"]


def test_pitch0_只翻y加高度():
    out = _one((0.3, 0.5, 2.0), 1.2, 0.0)
    np.testing.assert_allclose(out, (0.3, 1.2 - 0.5, 2.0), atol=1e-9)


def test_pitch30_檢查點():
    out = _one((0, 0, 1), 1.2, 30.0)
    np.testing.assert_allclose(out, (0, 1.2 - 0.5, math.cos(math.radians(30))), atol=1e-9)


def test_pitch90_光軸朝下():
    out = _one((0, 0, 1), 1.2, 90.0)
    np.testing.assert_allclose(out, (0, 0.2, 0.0), atol=1e-9)


def test_不改動輸入且保留所有key():
    src = {"a": np.array([1.0, 2.0, 3.0]), "b": np.array([0.0, 0.0, 0.0])}
    out = cam_to_world(src, 1.0, 10.0)
    assert set(out) == {"a", "b"}
    np.testing.assert_array_equal(src["a"], [1.0, 2.0, 3.0])
