"""相機預覽圖：縮圖 + 骨架 + bbox，編成 JPEG base64。spec §4.5。"""

from __future__ import annotations

import base64
import json
import struct

import cv2
import numpy as np

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


def pack_frame(header: dict, jpeg: bytes, mask: bytes | None) -> bytes:
    """frame 的 WebSocket 二進位訊息：[u32 LE header 長度][header JSON][JPEG][mask，mask_w×mask_h bytes，可無]。
    不用 base64 包在 JSON 裡：少 33% 流量，前端也不用逐字 atob。"""
    h = json.dumps({**header, "jpeg_len": len(jpeg), "has_mask": mask is not None}).encode()
    return struct.pack("<I", len(h)) + h + jpeg + (mask or b"")


def unpack_frame(buf: bytes) -> dict:
    """pack_frame 的反函式（測試、除錯用）：header 欄位 + jpeg（bytes）+ mask（bytes 或 None）。"""
    (n,) = struct.unpack_from("<I", buf)
    header = json.loads(buf[4 : 4 + n])
    body = buf[4 + n :]
    jpeg = body[: header["jpeg_len"]]
    mask = body[header["jpeg_len"] :] if header["has_mask"] else None
    return {**header, "jpeg": jpeg, "mask": mask}


def render_frame(r: StepResult, width: int = 960, mask_width: int = 192) -> bytes:
    """前端畫面用的 frame 訊息（二進位，見 pack_frame）：相機原始方向（不鏡像）的 JPEG + 選中者的二值 mask。spec v1.1。"""
    rgb = r.frame.rgb
    src_h, src_w = rgb.shape[:2]
    height = round(src_h * width / src_w)
    img = cv2.cvtColor(cv2.resize(rgb, (width, height), interpolation=cv2.INTER_AREA), cv2.COLOR_RGB2BGR)
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 70])
    if not ok:
        raise RuntimeError("JPEG 編碼失敗")

    mask_h = round(mask_width * src_h / src_w)
    mask = None
    if r.selected_mask is not None:
        small = cv2.resize(r.selected_mask.astype(np.float32), (mask_width, mask_h), interpolation=cv2.INTER_AREA)
        mask = np.where(small > 0.5, 255, 0).astype(np.uint8).tobytes()

    header = {
        "type": "frame",
        "ts": r.frame.ts,
        "width": width,
        "height": height,
        "mask_w": mask_width,
        "mask_h": mask_h,
    }
    return pack_frame(header, buf.tobytes(), mask)
