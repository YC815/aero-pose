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
