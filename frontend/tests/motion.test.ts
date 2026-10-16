import { describe, expect, it } from 'vitest';
import { handsUp } from '../src/motion';
import { standingSkeleton } from './fixtures';

describe('handsUp', () => {
  it('雙手舉過頭 → true', () => {
    expect(handsUp(standingSkeleton({ armsForwardDeg: 180 }))).toBe(true);
  });
  it('手臂下垂 → false', () => {
    expect(handsUp(standingSkeleton())).toBe(false);
  });
  it('只舉一隻手 → false', () => {
    const sk = standingSkeleton({ armsForwardDeg: 180 });
    sk.joints.right_wrist = [-0.2, 0.9, 2.0];
    expect(handsUp(sk)).toBe(false);
  });
  it('手腕高度不到 nose + margin → false', () => {
    const sk = standingSkeleton({ armsForwardDeg: 180 });
    sk.joints.left_wrist = [0.2, 1.68, 2.0];
    sk.joints.right_wrist = [-0.2, 1.68, 2.0];
    expect(handsUp(sk)).toBe(false);
    expect(handsUp(sk, 0.01)).toBe(true);
  });
  it('手腕或鼻 visibility 不足 → false', () => {
    const sk = standingSkeleton({ armsForwardDeg: 180 });
    sk.visibility.left_wrist = 0.3;
    expect(handsUp(sk)).toBe(false);
    const sk2 = standingSkeleton({ armsForwardDeg: 180 });
    sk2.visibility.nose = 0.2;
    expect(handsUp(sk2)).toBe(false);
  });
});
