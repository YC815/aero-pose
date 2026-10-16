"""Settings schema shared by backend and frontend (frontend mirrors it in src/types.ts)."""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, fields
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = Path(os.environ.get("AERO_DATA_DIR", REPO_ROOT / "data"))
FRONTEND_DIST = REPO_ROOT / "frontend" / "dist"


@dataclass
class Settings:
    depth_near_m: float = 1.5
    depth_far_m: float = 3.0
    zone_center_x_m: float = 0.0
    zone_half_width_m: float = 0.6
    camera_height_m: float = 1.2
    camera_pitch_deg: float = 0.0
    filter_min_cutoff: float = 1.0
    filter_beta: float = 0.05
    start_hold_s: float = 1.0
    countdown_s: float = 3
    record_s: float = 10
    result_s: float = 12
    lost_timeout_s: float = 3
    torso_gain: float = 1.0
    cd: float = 0.8
    speed_kmh: float = 40
    air_density: float = 1.225


def settings_from_dict(d: dict) -> Settings:
    """Missing keys get defaults, unknown keys are ignored, values coerced to float."""
    known = {f.name for f in fields(Settings)}
    return Settings(**{k: float(v) for k, v in d.items() if k in known})


def settings_to_dict(s: Settings) -> dict:
    return asdict(s)


def load_settings(path: Path) -> Settings:
    if not path.exists():
        return Settings()
    return settings_from_dict(json.loads(path.read_text()))


def save_settings(path: Path, s: Settings) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(settings_to_dict(s), indent=2))
    tmp.replace(path)
