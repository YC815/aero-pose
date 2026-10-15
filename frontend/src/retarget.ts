// 玩家骨架 → 騎士姿勢（spec §5.2）。
// 全部在世界座標（左手系，見 spec §3）用數值計算；軀幹局部座標 X = 本人左、Y = 脊椎向上、Z = 本人背後。

import { UPRIGHT_POSE } from './poses';
import type { JointName, PlayerSkeleton, RiderPose, Vec3 } from './types';

const deg = Math.PI / 180;
const VIS = 0.5;

const TORSO_PITCH_MIN = 20 * deg;
const TORSO_PITCH_MAX = 88 * deg;
const TORSO_ROLL_MAX = 15 * deg;
const TORSO_YAW_MAX = 20 * deg;
const HEAD_PITCH_OFFSET = 30 * deg;
/** 真人頭擺正時，耳中點→鼻在軀幹局部的俯仰（鼻子略低於耳朵，為負值）。 */
export const HEAD_NEUTRAL_REL_PITCH = -14 * deg;
const HEAD_PITCH_MIN = -40 * deg;
const HEAD_PITCH_MAX = 70 * deg;
const HEAD_YAW_MAX = 30 * deg;
const FLEX_MAX = 170 * deg;
const ABD_MIN = -10 * deg;
const ABD_MAX = 80 * deg;
const ELBOW_MAX = 150 * deg;

// ---- 向量小工具 ----

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mid = (a: Vec3, b: Vec3): Vec3 => scale(add(a, b), 0.5);
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
/** 把角度包到 (−π, π]。 */
const wrapAngle = (a: number): number => {
  const w = a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
  return w === -Math.PI ? Math.PI : w;
};

/** 正規化；長度趨近 0 時回 fallback。 */
function norm(a: Vec3, fallback: Vec3): Vec3 {
  const n = len(a);
  return n < 1e-9 ? [...fallback] : scale(a, 1 / n);
}

// ---- retarget ----

interface Frame {
  X: Vec3;
  Y: Vec3;
  Z: Vec3;
}

const toLocal = (f: Frame, v: Vec3): Vec3 => [dot(v, f.X), dot(v, f.Y), dot(v, f.Z)];

function visible(sk: PlayerSkeleton, ...joints: JointName[]): boolean {
  return joints.every((j) => sk.visibility[j] >= VIS);
}

/**
 * 上臂：屈曲 flex（0 = 下垂、90° = 前平舉）、外展 abd（正 = 往外），限角後重建單位向量。
 * side = +1 左手、−1 右手。
 */
function upperArm(u: Vec3, side: 1 | -1): Vec3 {
  // 手臂正側平舉時 flex 無定義（y、z 分量都 ≈ 0），取 0。
  let flex = Math.hypot(u[1], u[2]) < 1e-6 ? 0 : Math.atan2(-u[2], -u[1]);
  // 超出 [0°, 170°] 時夾到圓周上比較近的那一端：舉過頭再往後（≈ −180°）應該夾到 170°，不是 0°。
  if (flex < (FLEX_MAX - 2 * Math.PI) / 2) flex += 2 * Math.PI;
  flex = clamp(flex, 0, FLEX_MAX);
  const abd = clamp(Math.asin(clamp(side * u[0], -1, 1)), ABD_MIN, ABD_MAX);
  const c = Math.cos(abd);
  return [side * Math.sin(abd), -c * Math.cos(flex), -c * Math.sin(flex)];
}

/** 前臂：與上臂夾角超過 150° 時，在兩向量平面上把 f 往 u 轉到剛好 150°。 */
function limitElbow(u: Vec3, f: Vec3): Vec3 {
  if (dot(u, f) >= Math.cos(ELBOW_MAX)) return f;
  // f 在 u 垂直方向上的分量；完全反折（f ≈ −u）時平面無定義，改往前方（−Z）折。
  let perp = sub(f, scale(u, dot(f, u)));
  if (len(perp) < 1e-6) {
    const fwd: Vec3 = [0, 0, -1];
    perp = sub(fwd, scale(u, dot(fwd, u)));
    if (len(perp) < 1e-6) perp = [0, 1, 0];
  }
  const p = norm(perp, [0, 1, 0]);
  return add(scale(u, Math.cos(ELBOW_MAX)), scale(p, Math.sin(ELBOW_MAX)));
}

function arm(sk: PlayerSkeleton, frame: Frame, side: 'left' | 'right'): [Vec3, Vec3] {
  const sign = side === 'left' ? 1 : -1;
  const sh = `${side}_shoulder` as const;
  const el = `${side}_elbow` as const;
  const wr = `${side}_wrist` as const;
  const defUpper = side === 'left' ? UPRIGHT_POSE.leftUpperArm : UPRIGHT_POSE.rightUpperArm;
  const defFore = side === 'left' ? UPRIGHT_POSE.leftForearm : UPRIGHT_POSE.rightForearm;

  const u = visible(sk, sh, el)
    ? upperArm(norm(toLocal(frame, sub(sk.joints[el], sk.joints[sh])), [0, -1, 0]), sign)
    : [...defUpper] as Vec3;
  const f = visible(sk, el, wr)
    ? limitElbow(u, norm(toLocal(frame, sub(sk.joints[wr], sk.joints[el])), u))
    : [...defFore] as Vec3;
  return [u, f];
}

/** 雙肩、雙髖都可見，軀幹座標系才有意義。 */
export function torsoVisible(sk: PlayerSkeleton): boolean {
  return visible(sk, 'left_shoulder', 'right_shoulder', 'left_hip', 'right_hip');
}

/** 軀幹不可見時回 UPRIGHT_POSE 的副本（呼叫端分不出「真的坐直」和「看不到」時用 retargetVisible）。 */
export function retarget(sk: PlayerSkeleton, torsoGain = 1.0): RiderPose {
  return retargetVisible(sk, torsoGain) ?? copyPose(UPRIGHT_POSE);
}

/** 軀幹不可見回 null：呼叫端應保留上一個有效姿勢，不能把它當成坐直。 */
export function retargetVisible(sk: PlayerSkeleton, torsoGain = 1.0): RiderPose | null {
  if (!torsoVisible(sk)) return null;
  const J = sk.joints;

  // 軀幹座標系
  const hipMid = mid(J.left_hip, J.right_hip);
  const shMid = mid(J.left_shoulder, J.right_shoulder);
  const Y = norm(sub(shMid, hipMid), [0, 1, 0]);
  const L = sub(J.left_shoulder, J.right_shoulder);
  const X = norm(sub(L, scale(Y, dot(L, Y))), [1, 0, 0]);
  const frame: Frame = { X, Y, Z: cross(X, Y) };

  const pitch = Math.atan2(-Y[2], Y[1]);
  const roll = Math.asin(clamp(Y[0], -1, 1));
  // 扭轉 = 肩線相對髖線（整個人斜站不算扭轉）
  const H = sub(J.left_hip, J.right_hip);
  const yaw = wrapAngle(Math.atan2(-L[2], L[0]) - Math.atan2(-H[2], H[0]));

  // 頭
  let headPitch = UPRIGHT_POSE.headPitch;
  let headYaw = UPRIGHT_POSE.headYaw;
  if (visible(sk, 'nose', 'left_ear', 'right_ear')) {
    const d = toLocal(frame, sub(J.nose, mid(J.left_ear, J.right_ear)));
    const relPitch = Math.atan2(d[1], -d[2]);
    headPitch = clamp(relPitch - HEAD_NEUTRAL_REL_PITCH + HEAD_PITCH_OFFSET, HEAD_PITCH_MIN, HEAD_PITCH_MAX);
    headYaw = clamp(Math.atan2(d[0], -d[2]), -HEAD_YAW_MAX, HEAD_YAW_MAX);
  }

  const [leftUpperArm, leftForearm] = arm(sk, frame, 'left');
  const [rightUpperArm, rightForearm] = arm(sk, frame, 'right');

  return {
    torsoPitch: clamp(UPRIGHT_POSE.torsoPitch + torsoGain * pitch, TORSO_PITCH_MIN, TORSO_PITCH_MAX),
    torsoRoll: clamp(roll, -TORSO_ROLL_MAX, TORSO_ROLL_MAX),
    torsoYaw: clamp(yaw, -TORSO_YAW_MAX, TORSO_YAW_MAX),
    headPitch,
    headYaw,
    leftUpperArm,
    leftForearm,
    rightUpperArm,
    rightForearm,
  };
}

// ---- 姿勢插值 / 平均 ----

const ANGLES = ['torsoPitch', 'torsoRoll', 'torsoYaw', 'headPitch', 'headYaw'] as const;
const VECTORS = ['leftUpperArm', 'leftForearm', 'rightUpperArm', 'rightForearm'] as const;

function copyPose(p: RiderPose): RiderPose {
  return {
    ...p,
    leftUpperArm: [...p.leftUpperArm],
    leftForearm: [...p.leftForearm],
    rightUpperArm: [...p.rightUpperArm],
    rightForearm: [...p.rightForearm],
  };
}

/** 角度線性插值；向量 nlerp 後正規化（反向時中點退回較近的端點）。 */
export function lerpPose(a: RiderPose, b: RiderPose, t: number): RiderPose {
  const out = copyPose(a);
  for (const k of ANGLES) out[k] = a[k] + (b[k] - a[k]) * t;
  for (const k of VECTORS) {
    const v = add(scale(a[k], 1 - t), scale(b[k], t));
    out[k] = norm(v, t < 0.5 ? a[k] : b[k]);
  }
  return out;
}

/** 一階低通：每次往 target 走 1 − e^(−dt/τ)。 */
export function approachPose(cur: RiderPose, target: RiderPose, dt: number, tau = 0.1): RiderPose {
  return lerpPose(cur, target, 1 - Math.exp(-dt / tau));
}

/** 角度取平均；向量相加後正規化。空陣列回 UPRIGHT_POSE。 */
export function averagePoses(ps: RiderPose[]): RiderPose {
  if (ps.length === 0) return copyPose(UPRIGHT_POSE);
  const out = copyPose(ps[0]);
  for (const k of ANGLES) out[k] = ps.reduce((s, p) => s + p[k], 0) / ps.length;
  for (const k of VECTORS) {
    const sum = ps.reduce<Vec3>((s, p) => add(s, p[k]), [0, 0, 0]);
    out[k] = norm(sum, ps[ps.length - 1][k]);
  }
  return out;
}
