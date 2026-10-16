"""Shared data types. Coordinate conventions: see docs/superpowers/specs/2026-10-15-aero-pose-v1-design.md §3."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

JOINTS: tuple[str, ...] = (
    "nose",
    "left_ear",
    "right_ear",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
    "left_hip",
    "right_hip",
)

# MediaPipe Pose landmark indices for JOINTS.
MP_INDEX: dict[str, int] = {
    "nose": 0,
    "left_ear": 7,
    "right_ear": 8,
    "left_shoulder": 11,
    "right_shoulder": 12,
    "left_elbow": 13,
    "right_elbow": 14,
    "left_wrist": 15,
    "right_wrist": 16,
    "left_hip": 23,
    "right_hip": 24,
}


@dataclass
class Intrinsics:
    fx: float
    fy: float
    cx: float
    cy: float
    width: int
    height: int


@dataclass
class Frame:
    rgb: np.ndarray  # HxWx3 uint8, RGB order
    depth_m: np.ndarray | None  # HxW float32 aligned to rgb, 0 = invalid
    intrinsics: Intrinsics | None
    ts: float  # seconds (time.monotonic or recording ts)


@dataclass
class PersonPose:
    """One detected person. Only JOINTS keys are present."""

    pixels: dict[str, tuple[float, float]]  # (u, v) in rgb pixel coords
    world: dict[str, tuple[float, float, float]]  # MediaPipe world landmarks: hip-centred metres, x image-right, y down, z away from camera is positive
    visibility: dict[str, float]  # 0..1
    mask: np.ndarray | None = None  # HxW float32 0..1 person segmentation at rgb resolution (raw camera orientation)


@dataclass
class StepResult:
    """Output of Pipeline.step() for one processed frame."""

    skeleton: dict  # the {"type": "skeleton", ...} WS message (spec §4.5)
    frame: Frame
    persons: list[dict] = field(default_factory=list)
    selected_mask: np.ndarray | None = None  # segmentation mask of the selected player (PersonPose.mask), or None  # [{"bbox": [x0,y0,x1,y1], "selected": bool, "distance_m": float, "pixels": {joint: [u,v]}}]
