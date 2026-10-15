import { describe, expect, it } from 'vitest';
import { UPRIGHT_POSE } from '../src/poses';
import { approachPose, averagePoses, lerpPose, retarget } from '../src/retarget';
import type { RiderPose, Vec3 } from '../src/types';
import { standingSkeleton } from './fixtures';

const deg = Math.PI / 180;

function expectVec(v: Vec3, e: Vec3, digits = 3) {
  for (let i = 0; i < 3; i++) expect(v[i]).toBeCloseTo(e[i], digits);
}
function dot(a: Vec3, b: Vec3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function expectPose(p: RiderPose, e: RiderPose, digits = 6) {
  expect(p.torsoPitch).toBeCloseTo(e.torsoPitch, digits);
  expect(p.torsoRoll).toBeCloseTo(e.torsoRoll, digits);
  expect(p.torsoYaw).toBeCloseTo(e.torsoYaw, digits);
  expect(p.headPitch).toBeCloseTo(e.headPitch, digits);
  expect(p.headYaw).toBeCloseTo(e.headYaw, digits);
  expectVec(p.leftUpperArm, e.leftUpperArm, digits);
  expectVec(p.leftForearm, e.leftForearm, digits);
  expectVec(p.rightUpperArm, e.rightUpperArm, digits);
  expectVec(p.rightForearm, e.rightForearm, digits);
}

describe('retarget 軀幹', () => {
  it('標準站姿 → 30°、無側彎、無扭轉、上臂下垂', () => {
    const p = retarget(standingSkeleton());
    expect(Math.abs(p.torsoPitch / deg - 30)).toBeLessThan(1);
    expect(p.torsoRoll).toBeCloseTo(0, 6);
    expect(p.torsoYaw).toBeCloseTo(0, 6);
    expectVec(p.leftUpperArm, [0, -1, 0]);
    expectVec(p.rightUpperArm, [0, -1, 0]);
    expectVec(p.leftForearm, [0, -1, 0]);
  });
  it('前傾 45° → 75°', () => {
    const p = retarget(standingSkeleton({ leanDeg: 45 }));
    expect(p.torsoPitch / deg).toBeCloseTo(75, 3);
    // 手臂跟著上半身一起轉，局部仍然下垂
    expectVec(p.leftUpperArm, [0, -1, 0]);
  });
  it('前傾 80° → 限制在 88°；後仰 30° → 20°', () => {
    expect(retarget(standingSkeleton({ leanDeg: 80 })).torsoPitch / deg).toBeCloseTo(88, 6);
    expect(retarget(standingSkeleton({ leanDeg: -30 })).torsoPitch / deg).toBeCloseTo(20, 6);
  });
  it('torsoGain 放大前傾', () => {
    const p = retarget(standingSkeleton({ leanDeg: 20 }), 1.5);
    expect(p.torsoPitch / deg).toBeCloseTo(60, 3);
  });
  it('側彎：肩往本人左 → roll 為正，限制 ±15°', () => {
    const sk = standingSkeleton();
    sk.joints.left_shoulder[0] += 0.1;
    sk.joints.right_shoulder[0] += 0.1;
    expect(retarget(sk).torsoRoll / deg).toBeCloseTo(Math.asin(0.1 / Math.hypot(0.1, 0.5)) / deg, 3);
    sk.joints.left_shoulder[0] += 0.3;
    sk.joints.right_shoulder[0] += 0.3;
    expect(retarget(sk).torsoRoll / deg).toBeCloseTo(15, 6);
  });
  it('扭轉：左肩往前 → yaw 為正，限制 ±20°', () => {
    const sk = standingSkeleton();
    sk.joints.left_shoulder[2] -= 0.05;
    sk.joints.right_shoulder[2] += 0.05;
    expect(retarget(sk).torsoYaw / deg).toBeCloseTo(Math.atan2(0.1, 0.4) / deg, 3);
    sk.joints.left_shoulder[2] -= 0.1;
    sk.joints.right_shoulder[2] += 0.1;
    expect(retarget(sk).torsoYaw / deg).toBeCloseTo(20, 6);
  });
  it('軀幹不可見 → 整個回傳 UPRIGHT_POSE', () => {
    const sk = standingSkeleton({ leanDeg: 45 });
    sk.visibility.left_hip = 0.2;
    expectPose(retarget(sk), UPRIGHT_POSE);
  });
});

describe('retarget 頭', () => {
  it('頭往本人左轉 → headYaw 為正，限制 ±30°', () => {
    const sk = standingSkeleton();
    sk.joints.nose[0] = 0.03;
    expect(retarget(sk).headYaw / deg).toBeCloseTo(Math.atan2(0.03, 0.08) / deg, 3);
    sk.joints.nose[0] = 0.2;
    expect(retarget(sk).headYaw / deg).toBeCloseTo(30, 6);
  });
  it('headPitch = 相對俯仰 + 30°', () => {
    const p = retarget(standingSkeleton());
    expect(p.headPitch / deg).toBeCloseTo(Math.atan2(-0.02, 0.08) / deg + 30, 3);
  });
  it('鼻子不可見 → 頭回 UPRIGHT 值', () => {
    const sk = standingSkeleton();
    sk.joints.nose[0] = 0.2;
    sk.visibility.nose = 0;
    const p = retarget(sk);
    expect(p.headPitch).toBeCloseTo(UPRIGHT_POSE.headPitch, 6);
    expect(p.headYaw).toBeCloseTo(UPRIGHT_POSE.headYaw, 6);
  });
});

describe('retarget 手臂', () => {
  it('手臂前平舉 → 上臂 ≈ (0, 0, −1)', () => {
    const p = retarget(standingSkeleton({ armsForwardDeg: 90 }));
    expectVec(p.leftUpperArm, [0, 0, -1]);
    expectVec(p.rightUpperArm, [0, 0, -1]);
  });
  it('前傾時前平舉仍是局部 (0, 0, −1)', () => {
    const p = retarget(standingSkeleton({ leanDeg: 40, armsForwardDeg: 90 }));
    expectVec(p.leftUpperArm, [0, 0, -1]);
  });
  it('舉過頭稍微往後 → flex 限制在 170°，不會跳回下垂', () => {
    const sk = standingSkeleton({ armsForwardDeg: 185 });
    const u = retarget(sk).leftUpperArm;
    expect(u[1]).toBeGreaterThan(0.9);
    expect(u[2]).toBeCloseTo(-Math.sin(170 * deg), 3);
  });
  it('側平舉 → 外展限制在 80°，左右對稱', () => {
    const sk = standingSkeleton();
    const ls = sk.joints.left_shoulder;
    const rs = sk.joints.right_shoulder;
    sk.joints.left_elbow = [ls[0] + 0.3, ls[1], ls[2]];
    sk.joints.right_elbow = [rs[0] - 0.3, rs[1], rs[2]];
    const p = retarget(sk);
    expectVec(p.leftUpperArm, [Math.sin(80 * deg), -Math.cos(80 * deg), 0]);
    expectVec(p.rightUpperArm, [-Math.sin(80 * deg), -Math.cos(80 * deg), 0]);
  });
  it('肘夾角超過 150° 被限制在 150°', () => {
    const sk = standingSkeleton();
    const el = sk.joints.left_elbow;
    sk.joints.left_wrist = [el[0], el[1] + 0.25 * Math.cos(10 * deg), el[2] - 0.25 * Math.sin(10 * deg)];
    const p = retarget(sk);
    const angle = Math.acos(dot(p.leftUpperArm, p.leftForearm)) / deg;
    expect(angle).toBeCloseTo(150, 3);
    expectVec(p.leftForearm, [0, Math.cos(30 * deg), -Math.sin(30 * deg)]);
  });
  it('前臂完全反折（180°）也不會 NaN', () => {
    const sk = standingSkeleton();
    const el = sk.joints.left_elbow;
    sk.joints.left_wrist = [el[0], el[1] + 0.25, el[2]];
    const f = retarget(sk).leftForearm;
    expect(f.every(Number.isFinite)).toBe(true);
    expect(Math.acos(dot(retarget(sk).leftUpperArm, f)) / deg).toBeCloseTo(150, 3);
  });
  it('左手腕 visibility 0 → leftForearm 等於 UPRIGHT_POSE.leftForearm', () => {
    const sk = standingSkeleton();
    sk.visibility.left_wrist = 0;
    const p = retarget(sk);
    expectVec(p.leftForearm, UPRIGHT_POSE.leftForearm, 6);
    expectVec(p.rightForearm, [0, -1, 0]);
  });
  it('左肘不可見 → 左上臂、左前臂都回 UPRIGHT', () => {
    const sk = standingSkeleton();
    sk.visibility.left_elbow = 0.1;
    const p = retarget(sk);
    expectVec(p.leftUpperArm, UPRIGHT_POSE.leftUpperArm, 6);
    expectVec(p.leftForearm, UPRIGHT_POSE.leftForearm, 6);
  });
  it('輸出向量都是單位向量', () => {
    const p = retarget(standingSkeleton({ leanDeg: 30, armsForwardDeg: 60 }));
    for (const v of [p.leftUpperArm, p.leftForearm, p.rightUpperArm, p.rightForearm]) {
      expect(Math.hypot(...v)).toBeCloseTo(1, 9);
    }
  });
});

describe('lerpPose / averagePoses / approachPose', () => {
  const a = retarget(standingSkeleton());
  const b = retarget(standingSkeleton({ leanDeg: 45, armsForwardDeg: 90 }));

  it('lerpPose 端點', () => {
    expectPose(lerpPose(a, b, 0), a);
    expectPose(lerpPose(a, b, 1), b);
  });
  it('lerpPose 中點：角度平均、向量是單位向量', () => {
    const m = lerpPose(a, b, 0.5);
    expect(m.torsoPitch).toBeCloseTo((a.torsoPitch + b.torsoPitch) / 2, 9);
    expect(Math.hypot(...m.leftUpperArm)).toBeCloseTo(1, 9);
    expectVec(m.leftUpperArm, [0, -Math.SQRT1_2, -Math.SQRT1_2]);
  });
  it('averagePoses([p, p]) ≈ p', () => {
    expectPose(averagePoses([b, b]), b);
  });
  it('averagePoses 角度取平均', () => {
    const m = averagePoses([a, b]);
    expect(m.torsoPitch).toBeCloseTo((a.torsoPitch + b.torsoPitch) / 2, 9);
    expect(Math.hypot(...m.rightUpperArm)).toBeCloseTo(1, 9);
  });
  it('approachPose：dt=0 不動、dt 很大到目標、tau 時約走 63%', () => {
    expectPose(approachPose(a, b, 0), a);
    expectPose(approachPose(a, b, 10), b);
    const p = approachPose(a, b, 0.1);
    const frac = (p.torsoPitch - a.torsoPitch) / (b.torsoPitch - a.torsoPitch);
    expect(frac).toBeCloseTo(1 - Math.exp(-1), 6);
  });
});
