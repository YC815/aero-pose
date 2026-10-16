"""MediaPipe PoseLandmarker 包裝（Tasks API，VIDEO 模式）。"""

from __future__ import annotations

import urllib.request
from pathlib import Path

import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions, vision

from aero.config import DATA_DIR
from aero.types import MP_INDEX, PersonPose

MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task"
MODEL_NAME = "pose_landmarker_full.task"


def ensure_model(dest_dir: Path = DATA_DIR / "models") -> Path:
    """模型不存在就下載（先寫 .part 再 rename，避免留下半個檔）。"""
    dest = Path(dest_dir) / MODEL_NAME
    if dest.exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".part")
    with urllib.request.urlopen(MODEL_URL, timeout=60) as resp, open(tmp, "wb") as f:
        while chunk := resp.read(1 << 20):
            f.write(chunk)
    tmp.replace(dest)
    return dest


class PoseDetector:
    def __init__(self, num_poses: int = 3, model_path: Path | None = None):
        path = model_path if model_path is not None else ensure_model()
        options = vision.PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(path)),
            running_mode=vision.RunningMode.VIDEO,
            num_poses=num_poses,
            min_pose_detection_confidence=0.5,
            output_segmentation_masks=True,
        )
        self._landmarker = vision.PoseLandmarker.create_from_options(options)
        self._last_ts = -1

    def detect(self, rgb: np.ndarray, ts_ms: int) -> list[PersonPose]:
        ts_ms = int(ts_ms)
        if ts_ms <= self._last_ts:
            ts_ms = self._last_ts + 1
        self._last_ts = ts_ms

        h, w = rgb.shape[:2]
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
        result = self._landmarker.detect_for_video(image, ts_ms)

        masks = result.segmentation_masks or []
        persons: list[PersonPose] = []
        for i, (lms, world_lms) in enumerate(zip(result.pose_landmarks, result.pose_world_landmarks)):
            pixels, world, visibility = {}, {}, {}
            for name, idx in MP_INDEX.items():
                lm, wl = lms[idx], world_lms[idx]
                pixels[name] = (lm.x * w, lm.y * h)
                world[name] = (wl.x, wl.y, wl.z)
                visibility[name] = lm.visibility
            # numpy_view 指向 MediaPipe 內部緩衝，必須複製
            mask = np.array(masks[i].numpy_view(), dtype=np.float32) if i < len(masks) else None
            persons.append(PersonPose(pixels=pixels, world=world, visibility=visibility, mask=mask))
        return persons

    def close(self) -> None:
        self._landmarker.close()
