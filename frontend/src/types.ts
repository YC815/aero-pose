// Shared contracts. Backend source of truth: backend/src/aero/config.py and spec §4.5.
// Coordinates (spec §3): world metres, y up, z from camera toward player.
// Player faces camera, so player forward = -z and player's LEFT = +x.

export const JOINTS = [
  'nose',
  'left_ear',
  'right_ear',
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_hip',
  'right_hip',
] as const;
export type JointName = (typeof JOINTS)[number];
export type Vec3 = [number, number, number];

export interface PlayerSkeleton {
  distance_m: number;
  joints: Record<JointName, Vec3>;
  visibility: Record<JointName, number>;
}

export interface SkeletonMsg {
  type: 'skeleton';
  ts: number;
  source: string;
  has_depth: boolean;
  player: PlayerSkeleton | null;
}
export interface StatusMsg {
  type: 'status';
  camera: 'ok' | 'disconnected';
  fps: number;
}
export interface SettingsMsg {
  type: 'settings';
  settings: Settings;
}
export interface PreviewPerson {
  bbox: [number, number, number, number];
  selected: boolean;
  distance_m: number;
}
export interface PreviewMsg {
  type: 'preview';
  jpeg_b64: string;
  persons: PreviewPerson[];
}
/**
 * Live camera frame for the full-screen camera view (v1.1). Sent to every client at <= 20 fps.
 * Both image and mask are in RAW camera orientation (not mirrored); the frontend mirrors on display.
 */
export interface FrameMsg {
  type: 'frame';
  ts: number;
  jpeg_b64: string; // JPEG, width 960, height by camera aspect
  width: number;
  height: number;
  /** Selected player's segmentation mask, 1 byte per pixel (0 or 255), row-major, row 0 = top; null if no player. */
  mask_b64: string | null;
  mask_w: number; // 192
  mask_h: number; // round(192 * height / width)
}
export type ServerMsg = SkeletonMsg | StatusMsg | SettingsMsg | PreviewMsg | FrameMsg;
// Client -> server over /ws
export interface PreviewToggle {
  type: 'preview';
  on: boolean;
}

export interface Settings {
  depth_near_m: number;
  depth_far_m: number;
  zone_center_x_m: number;
  zone_half_width_m: number;
  camera_height_m: number;
  camera_pitch_deg: number;
  filter_min_cutoff: number;
  filter_beta: number;
  start_hold_s: number;
  countdown_s: number;
  record_s: number;
  result_s: number;
  lost_timeout_s: number;
  torso_gain: number;
  cd: number;
  speed_kmh: number;
  air_density: number;
}

export const DEFAULT_SETTINGS: Settings = {
  depth_near_m: 1.5,
  depth_far_m: 3.0,
  zone_center_x_m: 0.0,
  zone_half_width_m: 0.6,
  camera_height_m: 1.2,
  camera_pitch_deg: 0.0,
  filter_min_cutoff: 1.0,
  filter_beta: 0.05,
  start_hold_s: 1.0,
  countdown_s: 3,
  record_s: 10,
  result_s: 12,
  lost_timeout_s: 3,
  torso_gain: 1.0,
  cd: 0.8,
  speed_kmh: 40,
  air_density: 1.225,
};

// REST
export interface LeaderboardEntry {
  id: string;
  number: number;
  area_m2: number;
  baseline_m2: number;
  watts_saved: number;
  ts: number;
}
export interface ResultRequest {
  area_m2: number;
  baseline_m2: number;
  watts_saved: number;
  png_b64: string; // no data: prefix
}
export interface ResultResponse {
  id: string;
  number: number;
  rank: number;
  qr_url: string | null;
}

/**
 * Rider pose. Angles in radians.
 * Torso-local frame (identical for player and rider): X = body's left, Y = spine up
 * (hip mid -> shoulder mid), Z = body's back. When standing upright facing the camera,
 * torso-local axes equal world axes.
 */
export interface RiderPose {
  torsoPitch: number; // from vertical, + = lean forward (spine top moves toward -z)
  torsoRoll: number; // + = spine top moves toward body's left (+x)
  torsoYaw: number; // about spine, + = left shoulder moves forward (-z)
  headPitch: number; // relative to torso, + = chin up
  headYaw: number; // relative to torso, + = face turns toward body's left
  leftUpperArm: Vec3; // unit vector shoulder->elbow, torso-local
  leftForearm: Vec3; // unit vector elbow->wrist, torso-local
  rightUpperArm: Vec3;
  rightForearm: Vec3;
}

export type GameState = 'ATTRACT' | 'COUNTDOWN' | 'RECORDING' | 'RESULT' | 'MAINTENANCE';

/** One scoring sample during RECORDING (every 0.1 s). */
export interface SessionSample {
  t: number; // seconds since RECORDING started
  areaM2: number; // standard rider frontal area for the pose at t
  watts: number; // watts saved vs upright baseline at speed_kmh (negative = worse than upright)
}
/** Everything the result screen / card / leaderboard need about one 10 s recording. */
export interface SessionSummary {
  samples: SessionSample[];
  poses: { t: number; pose: RiderPose }[]; // every retargeted pose received, for the replay
  baselineM2: number;
  meanAreaM2: number; // score basis sent as area_m2
  meanWatts: number; // the headline score, sent as watts_saved
  pct: number; // (baselineM2 - meanAreaM2) / baselineM2 * 100
  bestIndex: number; // index into samples with the lowest areaM2
  durationS: number;
}
