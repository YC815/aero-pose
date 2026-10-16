"""AERO_ORBBEC_ALIGN / AERO_ORBBEC_DEPTH：沿用 test_orbbec 的假 SDK，補上硬體 D2C 需要的 API。"""

from __future__ import annotations

import enum
import sys

import pytest

from aero.sources import orbbec
from test_orbbec import FakeProfile, OBFormat, World, make_sdk


class OBAlignMode(enum.Enum):
    DISABLE = 0
    HW_MODE = 1
    SW_MODE = 2


class ProfileList:
    def __init__(self, profiles):
        self.profiles = profiles

    def __len__(self): return len(self.profiles)
    def __getitem__(self, i): return self.profiles[i]


DEPTHS = [
    FakeProfile(1280, 800, OBFormat.Y16, 30),
    FakeProfile(424, 240, OBFormat.Y16, 30),
    FakeProfile(848, 480, OBFormat.Y16, 30),
    FakeProfile(424, 240, OBFormat.Y16, 60),  # fps 不符
    FakeProfile(320, 200, OBFormat.UNKNOWN_FORMAT, 30),  # 不是 Y16
]


@pytest.fixture
def sdk(monkeypatch):
    world = World()
    m = make_sdk(world)
    m.OBAlignMode = OBAlignMode
    m.calls = {"align_mode": [], "d2c": [], "filters": 0}
    m.hw_profiles = list(DEPTHS)

    class Config(m.Config):
        def set_align_mode(self, mode): m.calls["align_mode"].append(mode)

    base_pipeline, base_filter = m.Pipeline, m.AlignFilter

    class Pipeline(base_pipeline):
        def get_stream_profile_list(self, sensor):
            lst = super().get_stream_profile_list(sensor)
            if sensor.name == "DEPTH_SENSOR":  # depth：列舉得到 DEPTHS，預設仍是 848x480
                lst.__class__ = type("DepthList", (ProfileList, type(lst)), {})
                lst.profiles = list(DEPTHS)
            return lst

        def get_d2c_depth_profile_list(self, color_profile, mode):
            m.calls["d2c"].append(mode)
            if isinstance(m.hw_profiles, Exception):
                raise m.hw_profiles
            return ProfileList(m.hw_profiles)

    class AlignFilter(base_filter):
        def __init__(self, align_to_stream):
            m.calls["filters"] += 1
            super().__init__(align_to_stream)

    m.Config, m.Pipeline, m.AlignFilter = Config, Pipeline, AlignFilter
    monkeypatch.setitem(sys.modules, "pyorbbecsdk", m)
    return m


def _open(**kw):
    src = orbbec.OrbbecSource(sleep=lambda s: None, color_format="mjpg", **kw)
    src.start()
    return src


def test_預設仍是軟體對齊與SDK預設depth(sdk):
    src = _open()
    assert src.profiles["align"] == "sw" and src.profiles["depth"] == "848x480 Y16 @30fps"
    assert sdk.calls["filters"] == 1 and sdk.calls["align_mode"] == [] and sdk.calls["d2c"] == []
    assert src.read() is not None


def test_sw_low挑同fps最小的Y16(sdk):
    src = _open(depth="low")
    assert src.profiles["depth"] == "424x240 Y16 @30fps" and src.profiles["align"] == "sw"


def test_hw用硬體D2C_不建AlignFilter(sdk):
    src = _open(align="hw")
    assert src.profiles["align"] == "hw" and src.profiles["depth"] == "1280x800 Y16 @30fps"
    assert sdk.calls["align_mode"] == [OBAlignMode.HW_MODE] and sdk.calls["filters"] == 0
    assert src.read() is not None


def test_hw_low挑最小(sdk):
    src = _open(align="hw", depth="low")
    assert src.profiles["depth"] == "424x240 Y16 @30fps"


@pytest.mark.parametrize("hw", [[], RuntimeError("not supported")])
def test_hw不支援退回軟體對齊(sdk, hw):
    sdk.hw_profiles = hw
    src = _open(align="hw")
    assert src.profiles["align"] == "sw" and sdk.calls["align_mode"] == [] and sdk.calls["filters"] == 1
    assert src.read() is not None


def test_環境變數(sdk, monkeypatch):
    monkeypatch.setenv(orbbec.ALIGN_ENV, "HW")
    monkeypatch.setenv(orbbec.DEPTH_ENV, "low")
    src = _open()
    assert src.profiles["align"] == "hw" and src.profiles["depth"] == "424x240 Y16 @30fps"
    monkeypatch.setenv(orbbec.ALIGN_ENV, "gpu")
    with pytest.raises(ValueError):
        orbbec.OrbbecSource()
