// 騎士上半身：pelvis → spine → neck → head；spine → shoulder → upperArm → elbow → forearm → hand。
// Three.js 騎士座標（spec §3）：右手系、面向 −z；本人左 = −x、上 = +y、背後 = +z。
import * as THREE from 'three';
import type { RiderPose, Vec3 } from '../types';

export interface RiderMaterials {
  jersey: THREE.MeshStandardMaterial; // setBodyColor 改這個
  shorts: THREE.MeshStandardMaterial;
  skin: THREE.MeshStandardMaterial;
  glove: THREE.MeshStandardMaterial;
  helmet: THREE.MeshStandardMaterial;
  shoe: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
}

export function createRiderMaterials(): RiderMaterials {
  const mat = (color: number, roughness: number, metalness = 0) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness });
  return {
    jersey: mat(0x1f6fe0, 0.55),
    shorts: mat(0x14213d, 0.7),
    skin: mat(0xd9a988, 0.75),
    glove: mat(0x1b2a4a, 0.8),
    helmet: mat(0xeef3fb, 0.35),
    shoe: mat(0xf4f6f8, 0.45),
    dark: mat(0x15171a, 0.3, 0.2),
  };
}

type Triple = [number, number, number];

/** 單位球縮放成橢球。 */
export function ellipsoid(mat: THREE.Material, semi: Triple, pos: Triple, w = 20, h = 14): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, w, h), mat);
  m.scale.set(...semi);
  m.position.set(...pos);
  return m;
}

/** 沿 y 軸的膠囊，length = 中段長度（兩端關節間距）。 */
export function capsule(mat: THREE.Material, r: number, length: number, pos: Triple): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, length, 4, 12), mat);
  m.position.set(...pos);
  return m;
}

/** 節段尺寸（spec §5.1，H = 1.75 m）。 */
export const BODY = {
  spineLen: 0.5, // 骨盆（髖關節中點）→ 肩中點
  shoulderHalf: 0.2, // 肩寬 0.40
  hipHalf: 0.09,
  upperArm: 0.31,
  upperArmR: 0.045,
  forearm: 0.26,
  forearmR: 0.038,
  hand: 0.1,
  neckLen: 0.13, // 肩中點 → 頭部轉軸
  headCenter: 0.12, // 頭部轉軸 → 頭中心（合計 0.25）
} as const;

const DOWN = new THREE.Vector3(0, -1, 0);

/** 軀幹局部向量（X = 本人左、Y = 上、Z = 背後）→ Three.js 騎士軀幹 group 內的向量：x 取負。 */
export function torsoLocalToThree(v: Vec3, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(-v[0], v[1], v[2]);
}

/**
 * 軀幹相對骨盆的旋轉。先繞脊椎扭轉（yaw），再側彎（roll），最後前傾（pitch）。
 * - pitch + ：脊椎上端往 −z → 繞 +x 轉 −pitch
 * - roll  + ：往本人左（−x）倒 → 繞 +z 轉 +roll
 * - yaw   + ：本人左肩（−x）往前（−z）→ 繞 +y 轉 −yaw
 */
export function torsoQuaternion(pitch: number, roll: number, yaw: number, out = new THREE.Quaternion()): THREE.Quaternion {
  return out.setFromEuler(new THREE.Euler(-pitch, -yaw, roll, 'XZY'));
}

type Side = 'L' | 'R';

interface Arm {
  shoulder: THREE.Group;
  upperArm: THREE.Group;
  elbow: THREE.Group;
  forearm: THREE.Group;
  hand: THREE.Group;
}

export interface Body {
  pelvis: THREE.Group;
  spine: THREE.Group;
  neck: THREE.Group;
  head: THREE.Group;
  setPose(p: RiderPose): void;
}

function named<T extends THREE.Object3D>(o: T, name: string): T {
  o.name = name;
  return o;
}

function createArm(side: Side, m: RiderMaterials): Arm {
  const sx = side === 'L' ? -1 : 1; // 本人左 = −x
  const shoulder = named(new THREE.Group(), `shoulder_${side}`);
  shoulder.position.set(sx * BODY.shoulderHalf, BODY.spineLen, 0);
  shoulder.add(ellipsoid(m.jersey, [0.055, 0.06, 0.055], [sx * 0.008, -0.012, 0])); // 三角肌

  const upperArm = named(new THREE.Group(), `upperArm_${side}`);
  shoulder.add(upperArm);
  upperArm.add(capsule(m.skin, BODY.upperArmR, BODY.upperArm, [0, -BODY.upperArm / 2, 0]));
  // 短袖
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.05, 0.15, 12), m.jersey);
  sleeve.position.set(0, -0.075, 0);
  upperArm.add(sleeve);

  const elbow = named(new THREE.Group(), `elbow_${side}`);
  elbow.position.set(0, -BODY.upperArm, 0);
  upperArm.add(elbow);

  const forearm = named(new THREE.Group(), `forearm_${side}`);
  elbow.add(forearm);
  forearm.add(capsule(m.skin, BODY.forearmR, BODY.forearm, [0, -BODY.forearm / 2, 0]));

  // hand group 原點 = 手腕
  const hand = named(new THREE.Group(), `hand_${side}`);
  hand.position.set(0, -BODY.forearm, 0);
  forearm.add(hand);
  const glove = new THREE.Mesh(new THREE.BoxGeometry(0.075, BODY.hand, 0.05), m.glove);
  glove.position.set(0, -BODY.hand / 2, 0);
  hand.add(glove);

  return { shoulder, upperArm, elbow, forearm, hand };
}

const FORWARD = new THREE.Vector3(0, 0, -1);
const BONE_TO_FORWARD = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);

/**
 * 上臂 group 的旋轉：骨軸 (0,−1,0) 對到 d（Three.js 軀幹座標、單位向量）。
 * 直接 setFromUnitVectors(骨軸, d) 在 d 接近正上方（舉手）時旋轉軸不穩定，扭轉會突然翻 180°。
 * 改成先把骨軸固定轉到正前方（繞 x 轉 90°），再從正前方擺到 d：
 * 唯一的奇異點變成「手臂直直往背後」，retarget 的錐形限制不會出現。手臂自然下垂時結果 = 單位旋轉。
 */
export function upperArmQuaternion(d: THREE.Vector3, out = new THREE.Quaternion()): THREE.Quaternion {
  return out.setFromUnitVectors(FORWARD, d).multiply(BONE_TO_FORWARD);
}

const tmpUpper = new THREE.Vector3();
const tmpFore = new THREE.Vector3();
const tmpInv = new THREE.Quaternion();

function poseArm(arm: Arm, upper: Vec3, fore: Vec3): void {
  torsoLocalToThree(upper, tmpUpper).normalize();
  upperArmQuaternion(tmpUpper, arm.upperArm.quaternion);
  // 前臂向量是軀幹局部座標，先轉到上臂局部座標。
  // 奇異點是肘完全對折（前臂指回肩膀），retarget 限制屈曲 ≤ 150°，不會碰到。
  torsoLocalToThree(fore, tmpFore).normalize();
  tmpInv.copy(arm.upperArm.quaternion).invert();
  tmpFore.applyQuaternion(tmpInv);
  arm.forearm.quaternion.setFromUnitVectors(DOWN, tmpFore);
}

export function createBody(m: RiderMaterials): Body {
  // 骨盆不旋轉（腿 IK 依賴這點），原點 = 髖關節中點
  const pelvis = named(new THREE.Group(), 'pelvis');
  pelvis.add(ellipsoid(m.shorts, [0.155, 0.1, 0.12], [0, 0.02, 0.015]));

  const spine = named(new THREE.Group(), 'spine');
  pelvis.add(spine);
  spine.add(ellipsoid(m.jersey, [0.145, 0.17, 0.1], [0, 0.15, 0.008])); // 腹
  const chest = ellipsoid(m.jersey, [0.18, 0.2, 0.11], [0, 0.32, 0]);
  chest.name = 'chest';
  spine.add(chest);
  spine.add(ellipsoid(m.jersey, [0.16, 0.06, 0.085], [0, 0.465, 0.012])); // 斜方肌

  const neck = named(new THREE.Group(), 'neck');
  neck.position.set(0, BODY.spineLen, 0.01);
  spine.add(neck);
  neck.add(capsule(m.skin, 0.055, 0.07, [0, 0.05, 0]));

  const head = named(new THREE.Group(), 'head');
  head.position.set(0, BODY.neckLen, 0);
  neck.add(head);
  const c = BODY.headCenter;
  head.add(ellipsoid(m.skin, [0.085, 0.11, 0.1], [0, c, -0.01]));
  // 安全帽：上半橢球，往後拉長
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), m.helmet);
  helmet.scale.set(0.1, 0.12, 0.13);
  helmet.position.set(0, c + 0.025, 0.01);
  head.add(helmet);
  const glasses = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.02), m.dark);
  glasses.position.set(0, c + 0.015, -0.103);
  head.add(glasses);

  const arms: Record<Side, Arm> = { L: createArm('L', m), R: createArm('R', m) };
  spine.add(arms.L.shoulder, arms.R.shoulder);

  const neckEuler = new THREE.Euler(0, 0, 0, 'YXZ');

  function setPose(p: RiderPose): void {
    torsoQuaternion(p.torsoPitch, p.torsoRoll, p.torsoYaw, spine.quaternion);
    // 頭部相對軀幹：headPitch + = 下巴抬起（繞 +x 正轉，臉朝 +y）；headYaw + = 臉轉向本人左（−x）。
    // 脖子和頭各分一半，趴低時頭不會整顆翹在背上。
    neckEuler.set(p.headPitch / 2, p.headYaw / 2, 0);
    neck.quaternion.setFromEuler(neckEuler);
    head.quaternion.setFromEuler(neckEuler);
    poseArm(arms.L, p.leftUpperArm, p.leftForearm);
    poseArm(arms.R, p.rightUpperArm, p.rightForearm);
  }

  return { pelvis, spine, neck, head, setPose };
}
