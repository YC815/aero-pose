import { describe, expect, it } from 'vitest';
import { UPRIGHT_POSE } from '../src/poses';
import { retarget } from '../src/retarget';
import { PoseTracker, TORSO_HOLD_S, VisibilityGate } from '../src/tracker';
import { standingSkeleton } from './fixtures';

const occluded = (leanDeg: number) => {
  const sk = standingSkeleton({ leanDeg });
  sk.visibility.left_hip = 0.2;
  return sk;
};

describe('PoseTracker', () => {
  it('軀幹可見的幀進 recent，最多 maxFrames 幀', () => {
    const t = new PoseTracker(3);
    for (let i = 0; i < 5; i++) t.push(standingSkeleton({ leanDeg: 10 * i }), i, 1);
    expect(t.recent).toHaveLength(3);
    expect(t.recent[2].torsoPitch).toBeCloseTo(retarget(standingSkeleton({ leanDeg: 40 })).torsoPitch, 9);
  });

  it('軀幹被擋：不進 recent，hold 期間保留上一個有效姿勢，過後回坐直', () => {
    const t = new PoseTracker(10);
    const lean = retarget(standingSkeleton({ leanDeg: 50 }));
    t.push(standingSkeleton({ leanDeg: 50 }), 1, 1);
    t.push(occluded(50), 1.1, 1);
    t.push(occluded(50), 1.2, 1);
    expect(t.recent).toHaveLength(1);
    expect(t.target(1.2).torsoPitch).toBeCloseTo(lean.torsoPitch, 9);
    expect(t.target(1 + TORSO_HOLD_S - 0.01)).not.toBe(UPRIGHT_POSE);
    expect(t.target(1 + TORSO_HOLD_S + 0.01)).toBe(UPRIGHT_POSE);
  });

  it('沒有玩家 → 立刻回坐直；clear 清掉 recent', () => {
    const t = new PoseTracker(10);
    t.push(standingSkeleton({ leanDeg: 50 }), 1, 1);
    t.push(null, 1.05, 1);
    expect(t.target(1.05)).toBe(UPRIGHT_POSE);
    t.clear();
    expect(t.recent).toEqual([]);
  });

  it('從來沒有有效姿勢 → target 坐直、recent 空', () => {
    const t = new PoseTracker(10);
    t.push(occluded(50), 1, 1);
    expect(t.recent).toEqual([]);
    expect(t.target(1)).toBe(UPRIGHT_POSE);
  });
});

describe('VisibilityGate', () => {
  it('≥ 0.5 才變可見、< 0.3 才變不可見，中間維持原狀', () => {
    const g = new VisibilityGate();
    const at = (v: number) => {
      const sk = standingSkeleton();
      sk.visibility.left_wrist = v;
      return g.apply(sk).visibility.left_wrist;
    };
    expect(at(0.4)).toBe(0); // 一開始沒看過
    expect(at(0.55)).toBe(1);
    expect(at(0.35)).toBe(1); // 掉到門檻下但沒低於 0.3：維持
    expect(at(0.29)).toBe(0);
    expect(at(0.45)).toBe(0); // 沒回到 0.5：維持看不到
    expect(at(Number.NaN)).toBe(0);
  });
});

describe('PoseTracker 局部遮擋', () => {
  const armsForward = () => standingSkeleton({ leanDeg: 40, armsForwardDeg: 80 });

  it('visibility 在 0.5 上下晃：手臂不在量測值和坐直之間跳', () => {
    const t = new PoseTracker(1, Infinity);
    t.push(armsForward(), 0, 1);
    const want = t.target(0).leftForearm;
    for (const v of [0.45, 0.52, 0.41, 0.48]) {
      const sk = armsForward();
      sk.visibility.left_wrist = v;
      sk.visibility.left_elbow = v;
      t.push(sk, 1, 1);
      expect(t.target(1).leftForearm).toEqual(want);
    }
  });

  it('手臂看不到：沿用上一個有效姿勢的手臂，不是坐直的手臂', () => {
    const t = new PoseTracker(1, Infinity);
    t.push(armsForward(), 0, 1);
    const prev = t.target(0);
    const sk = standingSkeleton({ leanDeg: 60 }); // 手臂下垂，但看不到
    sk.visibility.left_elbow = 0.1;
    sk.visibility.left_wrist = 0.1;
    t.push(sk, 1, 1);
    const p = t.target(1);
    expect(p.leftUpperArm).toEqual(prev.leftUpperArm);
    expect(p.leftForearm).toEqual(prev.leftForearm);
    expect(p.leftUpperArm).not.toEqual(UPRIGHT_POSE.leftUpperArm);
    expect(p.torsoPitch).toBeCloseTo(retarget(standingSkeleton({ leanDeg: 60 })).torsoPitch, 9); // 軀幹照常更新
  });

  it('頭看不到：沿用上一個有效的頭部角度', () => {
    const t = new PoseTracker(1, Infinity);
    t.push(armsForward(), 0, 1);
    const prev = t.target(0);
    const sk = armsForward();
    sk.visibility.nose = 0.1;
    t.push(sk, 1, 1);
    expect(t.target(1).headPitch).toBe(prev.headPitch);
  });

  it('clear 之後不沿用上一位玩家', () => {
    const t = new PoseTracker(1, Infinity);
    t.push(armsForward(), 0, 1);
    t.clear();
    const sk = standingSkeleton();
    sk.visibility.left_elbow = 0.1;
    t.push(sk, 1, 1);
    expect(t.target(1).leftUpperArm).toEqual(UPRIGHT_POSE.leftUpperArm);
  });
});
