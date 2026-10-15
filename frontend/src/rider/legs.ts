// 腿：pelvis → hip → thigh → knee → shank → foot，解析式雙骨 IK。
// 前提：pelvis group 沒有旋轉，所以 hip 的局部方向 = root 方向。
import * as THREE from 'three';
import { capsule, type RiderMaterials } from './body';
import type { Side } from './bike';

export const LEG = {
  thigh: 0.43,
  thighR: 0.075,
  shank: 0.43,
  shankR: 0.055,
  foot: 0.26,
} as const;

/** 腳底板固定的前傾（負 = 腳尖朝下）。 */
const FOOT_PITCH = -0.12;
/** 腳底中心（踩在踏板上的點）在 foot group（原點 = 踝）局部座標的位置。 */
const SOLE_CENTER = new THREE.Vector3(0, -0.085, -0.07);
/** 鞋底在踏板中心上方多少（踏板厚度一半）。 */
const SOLE_ABOVE_PEDAL = 0.01;

const FOOT_Q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), FOOT_PITCH);
/** 踝 = 踏板中心 + ANKLE_FROM_PEDAL（root 方向）。 */
export const ANKLE_FROM_PEDAL = SOLE_CENTER.clone().applyQuaternion(FOOT_Q).negate().add(new THREE.Vector3(0, SOLE_ABOVE_PEDAL, 0));

const DOWN = new THREE.Vector3(0, -1, 0);

/**
 * 雙骨 IK：回傳膝蓋位置。pole = 膝蓋偏好的方向。
 * 距離超出可達範圍時夾住，腳會停在最接近目標的位置。
 */
export function solveKnee(
  hip: THREE.Vector3,
  ankle: THREE.Vector3,
  l1: number,
  l2: number,
  pole: THREE.Vector3,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  const axis = new THREE.Vector3().subVectors(ankle, hip);
  const raw = axis.length();
  const d = THREE.MathUtils.clamp(raw, Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
  if (raw < 1e-9) axis.set(0, -1, 0);
  else axis.divideScalar(raw);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const w = pole.clone().addScaledVector(axis, -pole.dot(axis));
  if (w.lengthSq() < 1e-12) w.set(0, 0, -1).addScaledVector(axis, axis.z);
  w.normalize();
  return out.copy(hip).addScaledVector(axis, a).addScaledVector(w, h);
}

export interface Leg {
  hip: THREE.Group;
  thigh: THREE.Group;
  knee: THREE.Group;
  shank: THREE.Group;
  foot: THREE.Group;
  /** hip、ankle 都是 pelvis 局部座標（= root 方向）。 */
  solve(ankleTarget: THREE.Vector3): void;
}

export function createLeg(side: Side, m: RiderMaterials, hipPos: THREE.Vector3): Leg {
  const sx = side === 'L' ? -1 : 1; // 本人左 = −x
  const hip = new THREE.Group();
  hip.name = `hip_${side}`;
  hip.position.copy(hipPos);

  const thigh = new THREE.Group();
  thigh.name = `thigh_${side}`;
  hip.add(thigh);
  thigh.add(capsule(m.shorts, LEG.thighR, LEG.thigh, [0, -LEG.thigh / 2, 0]));

  const knee = new THREE.Group();
  knee.name = `knee_${side}`;
  knee.position.set(0, -LEG.thigh, 0);
  thigh.add(knee);

  const shank = new THREE.Group();
  shank.name = `shank_${side}`;
  knee.add(shank);
  shank.add(capsule(m.skin, LEG.shankR, LEG.shank, [0, -LEG.shank / 2, 0]));
  // 襪子
  const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.04, 0.09, 12), m.shoe);
  sock.position.set(0, -LEG.shank + 0.035, 0);
  shank.add(sock);

  // foot group 原點 = 踝
  const foot = new THREE.Group();
  foot.name = `foot_${side}`;
  foot.position.set(0, -LEG.shank, 0);
  shank.add(foot);
  const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.075, LEG.foot), m.shoe);
  shoe.position.set(0, SOLE_CENTER.y + 0.0375, SOLE_CENTER.z);
  foot.add(shoe);

  // 膝蓋朝前（−z），稍微偏外
  const pole = new THREE.Vector3(sx * 0.05, 0, -1).normalize();
  const kneePos = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const inv = new THREE.Quaternion();
  const tmp = new THREE.Quaternion();

  function solve(ankleTarget: THREE.Vector3): void {
    solveKnee(hip.position, ankleTarget, LEG.thigh, LEG.shank, pole, kneePos);
    dir.subVectors(kneePos, hip.position).normalize();
    thigh.quaternion.setFromUnitVectors(DOWN, dir);
    // 小腿方向轉到大腿局部座標
    dir.subVectors(ankleTarget, kneePos).normalize();
    inv.copy(thigh.quaternion).invert();
    shank.quaternion.setFromUnitVectors(DOWN, dir.applyQuaternion(inv));
    // 腳掌固定姿態：local = (thigh·shank)⁻¹ · FOOT_Q
    tmp.multiplyQuaternions(thigh.quaternion, shank.quaternion).invert();
    foot.quaternion.multiplyQuaternions(tmp, FOOT_Q);
  }

  return { hip, thigh, knee, shank, foot, solve };
}
