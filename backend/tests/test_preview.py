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
    from aero.preview import render_frame

    mask = np.zeros((480, 640), np.float32)
    mask[100:300, 200:400] = 1.0
    msg = render_frame(_frame_result(mask))
    assert set(msg) == {"type", "ts", "jpeg_b64", "width", "height", "mask_b64", "mask_w", "mask_h"}
    assert msg["type"] == "frame" and msg["ts"] == 1.5
    assert (msg["width"], msg["height"]) == (960, 720)
    assert (msg["mask_w"], msg["mask_h"]) == (192, 144)
    img = cv2.imdecode(np.frombuffer(base64.b64decode(msg["jpeg_b64"]), np.uint8), cv2.IMREAD_COLOR)
    assert img.shape == (720, 960, 3)


def test_frame_不鏡像且顏色為RGB轉BGR正確():
    from aero.preview import render_frame

    msg = render_frame(_frame_result())
    img = cv2.imdecode(np.frombuffer(base64.b64decode(msg["jpeg_b64"]), np.uint8), cv2.IMREAD_COLOR)
    left, right = img[360, 100], img[360, 860]
    assert left[2] > 200 and left[0] < 60  # BGR：左半是紅
    assert right.sum() < 60  # 右半黑，沒有鏡像


def test_frame_mask長度與二值():
    from aero.preview import render_frame

    mask = np.zeros((480, 640), np.float32)
    mask[:, :320] = 1.0  # 左半
    msg = render_frame(_frame_result(mask))
    raw = base64.b64decode(msg["mask_b64"])
    assert len(raw) == msg["mask_w"] * msg["mask_h"]
    m = np.frombuffer(raw, np.uint8).reshape(msg["mask_h"], msg["mask_w"])
    assert set(np.unique(m)) <= {0, 255}
    assert m[:, :90].min() == 255 and m[:, 100:].max() == 0  # 不鏡像：mask 在左


def test_frame_無mask時mask_b64為None():
    from aero.preview import render_frame

    msg = render_frame(_frame_result(None))
    assert msg["mask_b64"] is None
    assert (msg["mask_w"], msg["mask_h"]) == (192, 144)


def test_frame_json可序列化():
    import json

    from aero.preview import render_frame

    json.dumps(render_frame(_frame_result(np.ones((480, 640), np.float32))))
