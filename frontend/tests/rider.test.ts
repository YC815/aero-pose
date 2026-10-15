import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { frontalArea } from '../src/area';
import { AERO_DEMO_POSE, UPRIGHT_POSE } from '../src/poses';
import { torsoLocalToThree, torsoQuaternion } from '../src/rider/body';
import { ANKLE_FROM_PEDAL } from '../src/rider/legs';
import { createRider, FREEZE_CRANK_ANGLE, type Rider } from '../src/rider';
import type { RiderPose } from '../src/types';

function world(r: Rider, name: string): THREE.Vector3 {
  const o = r.root.getObjectByName(name);
  if (!o) throw new Error(`找不到 ${name}`);
  r.root.updateMatrixWorld(true);
  return o.getWorldPosition(new THREE.Vector3());
}

function mid(a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3 {
  return a.clone().add(b).multiplyScalar(0.5);
}

function distToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  return new THREE.Line3(a, b).closestPointToPoint(p, true, new THREE.Vector3()).distanceTo(p);
}

function areaOf(pose: RiderPose): number {
  const r = createRider();
  r.setPose(pose);
  r.setCrankAngle(FREEZE_CRANK_ANGLE);
  return frontalArea(r.triangles()).areaM2;
}

describe('座標轉換（spec §3 手性）', () => {
  it('軀幹局部向量 x 取負', () => {
    const v = torsoLocalToThree([1, 2, 3]);
    expect([v.x, v.y, v.z]).toEqual([-1, 2, 3]);
  });

  it('torsoPitch 正值 = 脊椎上端往 −z', () => {
    const top = new THREE.Vector3(0, 1, 0).applyQuaternion(torsoQuaternion(0.5, 0, 0));
    expect(top.z).toBeLessThan(0);
    expect(top.x).toBeCloseTo(0, 9);
  });

  it('torsoRoll 正值 = 往本人左（−x）倒', () => {
    const top = new THREE.Vector3(0, 1, 0).applyQuaternion(torsoQuaternion(0, 0.3, 0));
    expect(top.x).toBeLessThan(0);
  });

  it('torsoYaw 正值 = 本人左肩往前（−z）', () => {
    const leftShoulder = torsoLocalToThree([1, 0, 0]).applyQuaternion(torsoQuaternion(0, 0, 0.3));
    expect(leftShoulder.z).toBeLessThan(0);
  });
});

describe('Rider', () => {
  it('UPRIGHT_POSE 面積在 0.45–0.55 m²', () => {
    const a = areaOf(UPRIGHT_POSE);
    console.log(`UPRIGHT area = ${a.toFixed(4)} m²`);
    expect(a).toBeGreaterThanOrEqual(0.45);
    expect(a).toBeLessThanOrEqual(0.55);
  });

  it('AERO_DEMO_POSE 面積 ≤ 0.38 m²', () => {
    const a = areaOf(AERO_DEMO_POSE);
    console.log(`AERO area = ${a.toFixed(4)} m²`);
    expect(a).toBeLessThanOrEqual(0.38);
  });

  it('torsoPitch 90° 時肩中點在髖前方、高度相近', () => {
    const r = createRider();
    r.setPose({ ...UPRIGHT_POSE, torsoPitch: Math.PI / 2 });
    const shoulder = mid(world(r, 'shoulder_L'), world(r, 'shoulder_R'));
    const hip = mid(world(r, 'hip_L'), world(r, 'hip_R'));
    expect(shoulder.z).toBeLessThan(hip.z);
    expect(Math.abs(shoulder.y - hip.y)).toBeLessThan(0.1);
  });

  it('leftUpperArm = (1,0,0) 時左手肘在左肩的 −x 側', () => {
    const r = createRider();
    r.setPose({ ...UPRIGHT_POSE, leftUpperArm: [1, 0, 0] });
    expect(world(r, 'elbow_L').x).toBeLessThan(world(r, 'shoulder_L').x);
  });

  it('headPitch 正值 = 下巴抬起；headYaw 正值 = 臉轉向本人左（−x）', () => {
    const face = (p: RiderPose) => {
      const r = createRider();
      r.setPose(p);
      r.root.updateMatrixWorld(true);
      const q = r.root.getObjectByName('head')!.getWorldQuaternion(new THREE.Quaternion());
      return new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    };
    const base = { ...UPRIGHT_POSE, torsoPitch: 0, headPitch: 0 };
    expect(face({ ...base, headPitch: 0.5 }).y).toBeGreaterThan(0.3);
    expect(face({ ...base, headYaw: 0.5 }).x).toBeLessThan(-0.3);
    // 坐直基準：軀幹 30° + 頭 30° → 臉朝正前方
    expect(face(UPRIGHT_POSE).y).toBeCloseTo(0, 6);
  });

  it('本人左側在 Three.js −x', () => {
    const r = createRider();
    r.setPose(UPRIGHT_POSE);
    expect(world(r, 'shoulder_L').x).toBeLessThan(0);
    expect(world(r, 'hand_L').x).toBeLessThan(0);
    expect(world(r, 'hip_L').x).toBeLessThan(0);
  });

  it('前臂向量是軀幹局部座標（不受上臂方向影響）', () => {
    const r = createRider();
    r.setPose({ ...UPRIGHT_POSE, torsoPitch: 0, leftUpperArm: [0, 0, -1], leftForearm: [0, 1, 0] });
    const d = world(r, 'hand_L').sub(world(r, 'elbow_L')).normalize();
    expect(d.y).toBeCloseTo(1, 5);
  });

  it('UPRIGHT_POSE 手腕落在把手上段附近（< 8 cm）', () => {
    const r = createRider();
    r.setPose(UPRIGHT_POSE);
    const a = world(r, 'barTop_L');
    const b = world(r, 'barTop_R');
    const dl = distToSegment(world(r, 'hand_L'), a, b);
    const dr = distToSegment(world(r, 'hand_R'), a, b);
    console.log(`wrist→bar: L ${dl.toFixed(3)} m, R ${dr.toFixed(3)} m`);
    expect(dl).toBeLessThan(0.08);
    expect(dr).toBeLessThan(0.08);
  });

  it('曲柄 0 = 右曲柄朝正前方', () => {
    const r = createRider();
    r.setCrankAngle(0);
    const bb = world(r, 'bb');
    const p = world(r, 'pedal_R');
    expect(p.z).toBeLessThan(bb.z - 0.15);
    expect(Math.abs(p.y - bb.y)).toBeLessThan(1e-6);
    expect(p.x).toBeGreaterThan(0); // 本人右 = +x
  });

  it('腿 IK：各曲柄角度下腳都在踏板上、骨長不變、膝蓋朝前', () => {
    const r = createRider();
    r.setPose(UPRIGHT_POSE);
    for (const a of [0, 0.7, Math.PI / 2, 2, Math.PI, 4, (3 * Math.PI) / 2, 5.5]) {
      r.setCrankAngle(a);
      for (const s of ['L', 'R']) {
        const hip = world(r, `hip_${s}`);
        const knee = world(r, `knee_${s}`);
        const ankle = world(r, `foot_${s}`);
        const target = world(r, `pedal_${s}`).add(ANKLE_FROM_PEDAL);
        expect(knee.distanceTo(hip)).toBeCloseTo(0.43, 4);
        expect(ankle.distanceTo(knee)).toBeCloseTo(0.43, 4);
        expect(ankle.distanceTo(target)).toBeLessThan(0.002);
        expect(knee.z).toBeLessThan(Math.max(hip.z, ankle.z));
      }
    }
  });

  it('三角形數 < 30000，且重複呼叫結果一致', () => {
    const r = createRider();
    r.setPose(UPRIGHT_POSE);
    const t = r.triangles();
    console.log(`triangles = ${t.length / 9}`);
    expect(t.length % 9).toBe(0);
    expect(t.length / 9).toBeLessThan(30000);
    expect(r.triangles()).toEqual(t);
  });

  it('setPose 後換姿勢再換回來，面積一致', () => {
    const r = createRider();
    r.setPose(UPRIGHT_POSE);
    r.setCrankAngle(FREEZE_CRANK_ANGLE);
    const a = frontalArea(r.triangles()).areaM2;
    r.setPose(AERO_DEMO_POSE);
    r.setCrankAngle(1.3);
    r.setPose(UPRIGHT_POSE);
    r.setCrankAngle(FREEZE_CRANK_ANGLE);
    expect(frontalArea(r.triangles()).areaM2).toBeCloseTo(a, 9);
  });

  it('setBodyColor 改騎士衣服顏色', () => {
    const r = createRider();
    r.setBodyColor(0xff0000);
    const chest = r.root.getObjectByName('chest') as THREE.Mesh;
    const mat = chest.material as THREE.MeshStandardMaterial;
    expect(mat.color.getHex()).toBe(0xff0000);
  });
});
