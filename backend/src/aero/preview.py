"""相機預覽圖：縮圖 + 骨架 + bbox，編成 JPEG base64。spec §4.5。"""

from __future__ import annotations

import base64

import cv2

from aero.types import StepResult

GREEN = (0, 255, 0)  # BGR
GRAY = (160, 160, 160)
BONES = (
    ("left_shoulder", "right_shoulder"),
    ("left_shoulder", "left_elbow"),
    ("left_elbow", "left_wrist"),
    ("right_shoulder", "right_elbow"),
    ("right_elbow", "right_wrist"),
    ("left_shoulder", "left_hip"),
    ("right_shoulder", "right_hip"),
    ("left_hip", "right_hip"),
    ("left_ear", "nose"),
    ("nose", "right_ear"),
)


def render_preview(r: StepResult, width: int = 480) -> dict:
    rgb = r.frame.rgb
    scale = width / rgb.shape[1]
    height = round(rgb.shape[0] * scale)
    img = cv2.cvtColor(cv2.resize(rgb, (width, height)), cv2.COLOR_RGB2BGR)

    persons = []
    for p in r.persons:
        color = GREEN if p["selected"] else GRAY
        x0, y0, x1, y1 = (v * scale for v in p["bbox"])
        cv2.rectangle(img, (round(x0), round(y0)), (round(x1), round(y1)), color, 2)
        cv2.putText(img, f"{p['distance_m']:.1f} m", (round(x0), max(round(y0) - 4, 12)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1, cv2.LINE_AA)
        px = p["pixels"]
        for a, b in BONES:
            pa, pb = px[a], px[b]
            cv2.line(img, (round(pa[0] * scale), round(pa[1] * scale)),
                     (round(pb[0] * scale), round(pb[1] * scale)), color, 2, cv2.LINE_AA)
        persons.append(
            {"bbox": [x0, y0, x1, y1], "selected": p["selected"], "distance_m": p["distance_m"]}
        )

    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 70])
    if not ok:
        raise RuntimeError("JPEG 編碼失敗")
    return {"type": "preview", "jpeg_b64": base64.b64encode(buf.tobytes()).decode("ascii"), "persons": persons}
