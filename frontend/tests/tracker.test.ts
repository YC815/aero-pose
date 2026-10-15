import { describe, expect, it } from 'vitest';
import { UPRIGHT_POSE } from '../src/poses';
import { retarget } from '../src/retarget';
import { PoseTracker, TORSO_HOLD_S } from '../src/tracker';
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
