import type { RiderPose, Vec3 } from './types';

const deg = Math.PI / 180;

function unit(v: Vec3): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
}

/** 標準坐直姿勢：面積比較的基準。torsoPitch / headPitch 是契約值，手臂向量可微調讓手落在把手上。 */
export const UPRIGHT_POSE: RiderPose = {
  torsoPitch: 30 * deg,
  torsoRoll: 0,
  torsoYaw: 0,
  headPitch: 30 * deg,
  headYaw: 0,
  leftUpperArm: unit([0.05, -0.35, -0.94]),
  leftForearm: unit([0.0, -0.1, -1]),
  rightUpperArm: unit([-0.05, -0.35, -0.94]),
  rightForearm: unit([0.0, -0.1, -1]),
};

/** 待機示範用的趴低姿勢。 */
export const AERO_DEMO_POSE: RiderPose = {
  torsoPitch: 85 * deg,
  torsoRoll: 0,
  torsoYaw: 0,
  headPitch: 65 * deg,
  headYaw: 0,
  leftUpperArm: unit([0.05, 0.6, -0.8]),
  leftForearm: unit([-0.1, 0.95, -0.3]),
  rightUpperArm: unit([-0.05, 0.6, -0.8]),
  rightForearm: unit([0.1, 0.95, -0.3]),
};
