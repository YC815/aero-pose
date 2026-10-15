from __future__ import annotations

import numpy as np
import pytest

from aero.config import DATA_DIR
from aero.pose import MODEL_URL, PoseDetector, ensure_model


def _network_ok() -> bool:
    import urllib.request

    try:
        urllib.request.urlopen(MODEL_URL, timeout=5).close()
        return True
    except Exception:
        return False


MODEL_AVAILABLE = (DATA_DIR / "models" / "pose_landmarker_full.task").exists()

needs_model = pytest.mark.skipif(
    not MODEL_AVAILABLE and not _network_ok(),
    reason="模型不存在且無網路",
)


@needs_model
def test_ensure_model_returns_existing_file(tmp_path):
    p = ensure_model(tmp_path)
    assert p.exists() and p.stat().st_size > 1_000_000
    assert ensure_model(tmp_path) == p  # 第二次不重新下載


@needs_model
def test_black_image_returns_empty():
    det = PoseDetector(num_poses=3)
    try:
        assert det.detect(np.zeros((480, 640, 3), dtype=np.uint8), 0) == []
    finally:
        det.close()


@needs_model
def test_timestamps_made_strictly_increasing():
    det = PoseDetector(num_poses=1)
    try:
        img = np.zeros((480, 640, 3), dtype=np.uint8)
        # 相同或倒退的 ts_ms 不可丟例外
        for ts in (100, 100, 50, 101):
            assert det.detect(img, ts) == []
    finally:
        det.close()
