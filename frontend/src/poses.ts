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
  // 手腕落在把手上段（x ±0.13）、肘微彎朝外
  leftUpperArm: unit([0.029, -0.555, -0.831]),
  leftForearm: unit([-0.304, -0.215, -0.928]),
  rightUpperArm: unit([-0.029, -0.555, -0.831]),
  rightForearm: unit([0.304, -0.215, -0.928]),
};

/** 待機示範用的趴低姿勢。 */
export const AERO_DEMO_POSE: RiderPose = {
  torsoPitch: 85 * deg,
  torsoRoll: 0,
  torsoYaw: 0,
  headPitch: 65 * deg,
  headYaw: 0,
  // 手臂前伸、前臂往內收（像握著休息把），手臂從把手上方越過
  leftUpperArm: unit([-0.08, 0.936, -0.343]),
  leftForearm: unit([-0.221, 0.975, -0.025]),
  rightUpperArm: unit([0.08, 0.936, -0.343]),
  rightForearm: unit([0.221, 0.975, -0.025]),
};
