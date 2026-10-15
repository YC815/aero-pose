import { JOINTS, type JointName, type PlayerSkeleton, type Vec3 } from '../src/types';

const deg = Math.PI / 180;

export interface StandingOpts {
  leanDeg?: number; // 上半身繞髖中點往 −z（前方）轉
  armsForwardDeg?: number; // 打直的手臂從下垂往前抬（0 = 下垂、90 = 前平舉、180 = 舉過頭）
}

/** 標準站姿：面向相機，本人左 = +x。 */
export function standingSkeleton(opts: StandingOpts = {}): PlayerSkeleton {
  const lean = (opts.leanDeg ?? 0) * deg;
  const arm = (opts.armsForwardDeg ?? 0) * deg;
  const armDir: Vec3 = [0, -Math.cos(arm), -Math.sin(arm)];
  const upperLen = 0.3;
  const foreLen = 0.25;

  const joints: Record<JointName, Vec3> = {
    nose: [0, 1.65, 1.92],
    left_ear: [0.07, 1.67, 2.0],
    right_ear: [-0.07, 1.67, 2.0],
    left_shoulder: [0.2, 1.45, 2.0],
    right_shoulder: [-0.2, 1.45, 2.0],
    left_elbow: [0, 0, 0],
    right_elbow: [0, 0, 0],
    left_wrist: [0, 0, 0],
    right_wrist: [0, 0, 0],
    left_hip: [0.15, 0.95, 2.0],
    right_hip: [-0.15, 0.95, 2.0],
  };
  for (const side of ['left', 'right'] as const) {
    const sh = joints[`${side}_shoulder`];
    const el: Vec3 = [sh[0], sh[1] + armDir[1] * upperLen, sh[2] + armDir[2] * upperLen];
    joints[`${side}_elbow`] = el;
    joints[`${side}_wrist`] = [el[0], el[1] + armDir[1] * foreLen, el[2] + armDir[2] * foreLen];
  }

  // 上半身繞髖中點（繞 x 軸）往 −z 轉。
  const pivotY = 0.95;
  const pivotZ = 2.0;
  for (const j of JOINTS) {
    if (j === 'left_hip' || j === 'right_hip') continue;
    const [x, y, z] = joints[j];
    const ry = y - pivotY;
    const rz = z - pivotZ;
    joints[j] = [
      x,
      pivotY + ry * Math.cos(lean) + rz * Math.sin(lean),
      pivotZ + rz * Math.cos(lean) - ry * Math.sin(lean),
    ];
  }

  const visibility = {} as Record<JointName, number>;
  for (const j of JOINTS) visibility[j] = 1;
  return { distance_m: 2.0, joints, visibility };
}

/** 整個骨架平移（測靜止偵測用）。 */
export function translated(sk: PlayerSkeleton, d: Vec3): PlayerSkeleton {
  const joints = {} as Record<JointName, Vec3>;
  for (const j of JOINTS) {
    const p = sk.joints[j];
    joints[j] = [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
  }
  return { ...sk, joints, visibility: { ...sk.visibility } };
}
