import base64

import cv2
import numpy as np

from aero.preview import render_preview
from aero.types import JOINTS, Frame, StepResult


def _result():
    pix = {j: [100.0 + i * 5, 80.0 + i * 8] for i, j in enumerate(JOINTS)}
    persons = [
        {"bbox": [90.0, 70.0, 200.0, 300.0], "selected": True, "distance_m": 2.1, "pixels": pix},
        {"bbox": [400.0, 100.0, 500.0, 400.0], "selected": False, "distance_m": 2.8, "pixels": pix},
    ]
    frame = Frame(np.zeros((480, 960, 3), np.uint8), None, None, 0.0)
    return StepResult(skeleton={"type": "skeleton"}, frame=frame, persons=persons)


def test_preview_格式與寬度():
    msg = render_preview(_result(), 480)
    assert msg["type"] == "preview"
    img = cv2.imdecode(np.frombuffer(base64.b64decode(msg["jpeg_b64"]), np.uint8), cv2.IMREAD_COLOR)
    assert img is not None and img.shape[1] == 480 and img.shape[0] == 240


def test_preview_persons不含pixels_bbox縮放():
    msg = render_preview(_result(), 480)
    p0 = msg["persons"][0]
    assert set(p0) == {"bbox", "selected", "distance_m"}
    assert p0["bbox"] == [45.0, 35.0, 100.0, 150.0]  # scale = 0.5
    assert p0["selected"] is True and msg["persons"][1]["selected"] is False


def test_preview_有畫東西():
    msg = render_preview(_result(), 480)
    img = cv2.imdecode(np.frombuffer(base64.b64decode(msg["jpeg_b64"]), np.uint8), cv2.IMREAD_COLOR)
    assert img.sum() > 0  # 原圖全黑，有疊圖就不為 0


def _frame_result(mask=None, w=640, h=480, ts=1.5):
    rgb = np.zeros((h, w, 3), np.uint8)
    rgb[:, : w // 2] = (255, 0, 0)  # 左半純紅（RGB）
    return StepResult(
        skeleton={"type": "skeleton"}, frame=Frame(rgb, None, None, ts), selected_mask=mask
    )


def test_frame_格式與尺寸():
    from aero.preview import render_frame, unpack_frame

    mask = np.zeros((480, 640), np.float32)
    mask[100:300, 200:400] = 1.0
    msg = unpack_frame(render_frame(_frame_result(mask)))
    assert msg["type"] == "frame" and msg["ts"] == 1.5
    assert (msg["width"], msg["height"]) == (960, 720)
    assert (msg["mask_w"], msg["mask_h"]) == (192, 144)
    img = cv2.imdecode(np.frombuffer(msg["jpeg"], np.uint8), cv2.IMREAD_COLOR)
    assert img.shape == (720, 960, 3)


def test_frame_不鏡像且顏色為RGB轉BGR正確():
    from aero.preview import render_frame, unpack_frame

    msg = unpack_frame(render_frame(_frame_result()))
    img = cv2.imdecode(np.frombuffer(msg["jpeg"], np.uint8), cv2.IMREAD_COLOR)
    left, right = img[360, 100], img[360, 860]
    assert left[2] > 200 and left[0] < 60  # BGR：左半是紅
    assert right.sum() < 60  # 右半黑，沒有鏡像


def test_frame_mask長度與二值():
    from aero.preview import render_frame, unpack_frame

    mask = np.zeros((480, 640), np.float32)
    mask[:, :320] = 1.0  # 左半
    msg = unpack_frame(render_frame(_frame_result(mask)))
    raw = msg["mask"]
    assert len(raw) == msg["mask_w"] * msg["mask_h"]
    m = np.frombuffer(raw, np.uint8).reshape(msg["mask_h"], msg["mask_w"])
    assert set(np.unique(m)) <= {0, 255}
    assert m[:, :90].min() == 255 and m[:, 100:].max() == 0  # 不鏡像：mask 在左


def test_frame_無mask時mask為None():
    from aero.preview import render_frame, unpack_frame

    msg = unpack_frame(render_frame(_frame_result(None)))
    assert msg["mask"] is None and msg["has_mask"] is False
    assert (msg["mask_w"], msg["mask_h"]) == (192, 144)


def test_frame_二進位格式():
    """[u32 LE header 長度][header JSON][JPEG][mask]：前端 net/ws.ts 照這個解。"""
    import json
    import struct

    from aero.preview import render_frame

    buf = render_frame(_frame_result(np.ones((480, 640), np.float32)))
    (n,) = struct.unpack_from("<I", buf)
    header = json.loads(buf[4 : 4 + n])
    assert header["has_mask"] is True
    jpeg = buf[4 + n : 4 + n + header["jpeg_len"]]
    assert jpeg[:2] == b"\xff\xd8"
    assert len(buf) == 4 + n + header["jpeg_len"] + header["mask_w"] * header["mask_h"]


def _standing(wrist_y=200.0):
    """640×480 畫面裡面對相機站著的人：肩 y=120、肩寬 100 px、髖 y=240，手腕高度可調。"""
    return {
        "nose": [320.0, 80.0],
        "left_ear": [340.0, 75.0],
        "right_ear": [300.0, 75.0],
        "left_shoulder": [370.0, 120.0],
        "right_shoulder": [270.0, 120.0],
        "left_elbow": [400.0, 180.0],
        "right_elbow": [240.0, 180.0],
        "left_wrist": [410.0, wrist_y],
        "right_wrist": [230.0, wrist_y],
        "left_hip": [350.0, 240.0],
        "right_hip": [290.0, 240.0],
    }


def _player_result(pixels, mask, selected=True):
    r = _frame_result(mask)
    r.persons = [{"bbox": [0.0, 0.0, 1.0, 1.0], "selected": selected, "distance_m": 2.0, "pixels": pixels}]
    return r


def _mask_rows(r):
    from aero.preview import render_frame, unpack_frame

    msg = unpack_frame(render_frame(r))
    return np.frombuffer(msg["mask"], np.uint8).reshape(msg["mask_h"], msg["mask_w"])


def test_frame_mask只留髖部以上():
    """計分只看上半身：送給前端的 mask 把腿裁掉，紅色迎風面才不會出現在腿上。"""
    mask = np.zeros((480, 640), np.float32)
    mask[50:480, 200:440] = 1.0  # 整個人到畫面底
    m = _mask_rows(_player_result(_standing(), mask))  # mask 座標 = 原圖 × 0.3
    assert m[int(100 * 0.3), int(320 * 0.3)] == 255  # 胸口
    assert m[int(240 * 0.3), int(320 * 0.3)] == 255  # 髖線本身保留
    assert m[int(320 * 0.3):, :].max() == 0  # 大腿以下全清掉


def test_frame_手低於髖線時保留手():
    """趴低時手可能比髖低，手臂有算分，不能一起切掉。"""
    mask = np.zeros((480, 640), np.float32)
    mask[50:480, 200:440] = 1.0
    m = _mask_rows(_player_result(_standing(wrist_y=330.0), mask))
    assert m[int(330 * 0.3), int(410 * 0.3)] == 255  # 左手腕
    assert m[int(330 * 0.3), int(320 * 0.3)] == 0  # 兩手之間的腿
    assert m[int(450 * 0.3):, :].max() == 0


def test_frame_沒有選中者時mask不裁():
    mask = np.ones((480, 640), np.float32)
    m = _mask_rows(_player_result(_standing(), mask, selected=False))
    assert m.min() == 255
