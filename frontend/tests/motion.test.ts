import { describe, expect, it } from 'vitest';
import { StillnessDetector, handsUp } from '../src/motion';
import { standingSkeleton, translated } from './fixtures';

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

describe('StillnessDetector', () => {
  it('靜止 → 速度 ≈ 0', () => {
    const d = new StillnessDetector();
    const sk = standingSkeleton();
    for (let i = 0; i <= 10; i++) d.push(sk, i * 0.1);
    expect(d.meanSpeed()).toBeCloseTo(0, 6);
  });
  it('每 0.1 秒移 0.05 m → 速度 ≈ 0.5 m/s', () => {
    const d = new StillnessDetector();
    const sk = standingSkeleton();
    for (let i = 0; i <= 10; i++) d.push(translated(sk, [0.05 * i, 0, 0]), i * 0.1);
    expect(d.meanSpeed()).toBeCloseTo(0.5, 3);
  });
  it('樣本不足或時間跨度 < 0.2 s → Infinity', () => {
    const d = new StillnessDetector();
    const sk = standingSkeleton();
    expect(d.meanSpeed()).toBe(Infinity);
    d.push(sk, 0);
    expect(d.meanSpeed()).toBe(Infinity);
    d.push(sk, 0.1);
    expect(d.meanSpeed()).toBe(Infinity);
    d.push(sk, 0.25);
    expect(d.meanSpeed()).toBeCloseTo(0, 6);
  });
  it('只看視窗內的樣本（早期的移動不影響）', () => {
    const d = new StillnessDetector(0.5);
    const sk = standingSkeleton();
    d.push(translated(sk, [1, 0, 0]), 0);
    for (let i = 1; i <= 20; i++) d.push(sk, i * 0.1);
    expect(d.meanSpeed()).toBeCloseTo(0, 6);
  });
  it('visibility < 0.5 的關節不計', () => {
    const d = new StillnessDetector();
    for (let i = 0; i <= 5; i++) {
      const s = standingSkeleton();
      s.joints.left_wrist = [5 * i, 0, 0]; // 亂跳
      s.visibility.left_wrist = 0.1;
      d.push(s, i * 0.1);
    }
    expect(d.meanSpeed()).toBeCloseTo(0, 6);
  });
  it('reset 清空樣本', () => {
    const d = new StillnessDetector();
    const sk = standingSkeleton();
    for (let i = 0; i <= 5; i++) d.push(sk, i * 0.1);
    d.reset();
    expect(d.meanSpeed()).toBe(Infinity);
  });
});
