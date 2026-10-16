import { describe, expect, it } from 'vitest';
import { UPRIGHT_POSE } from '../src/poses';
import { Recorder } from '../src/recorder';
import { retarget } from '../src/retarget';
import { DEFAULT_SETTINGS } from '../src/types';
import { standingSkeleton } from './fixtures';

function make() {
  const measured: number[] = [];
  const r = new Recorder({
    baselineM2: 0.5,
    measure: (p) => {
      measured.push(p.torsoPitch);
      return p === UPRIGHT_POSE ? 0.5 : 0.4;
    },
    settings: () => DEFAULT_SETTINGS,
  });
  return { r, measured };
}

describe('Recorder', () => {
  const lean = standingSkeleton({ leanDeg: 50 });
  const leanPitch = retarget(lean, DEFAULT_SETTINGS.torso_gain).torsoPitch;

  it('player: null 不清掉姿勢；軀幹被擋多久都沿用上一個有效姿勢', () => {
    const { r } = make();
    r.onTransition('ATTRACT', 'COUNTDOWN', 0, 0);
    r.onSkeleton(lean, 1);
    r.onSkeleton(null, 1.05);
    expect(r.target(1.05).torsoPitch).toBeCloseTo(leanPitch, 9);
    const hidden = standingSkeleton({ leanDeg: 50 });
    hidden.visibility.left_hip = 0.1;
    r.onSkeleton(hidden, 2);
    expect(r.target(100).torsoPitch).toBeCloseTo(leanPitch, 9);
  });

  it('進 COUNTDOWN 換新的 tracker：不沿用上一位玩家的姿勢', () => {
    const { r } = make();
    r.onSkeleton(lean, 1);
    expect(r.target(1)).not.toBe(UPRIGHT_POSE);
    r.onTransition('ATTRACT', 'COUNTDOWN', 0, 2);
    expect(r.target(2)).toBe(UPRIGHT_POSE);
  });

  it('只有 RECORDING 有 session；錄滿進 RESULT 回 summary，中止回 null', () => {
    const { r } = make();
    r.onTransition('ATTRACT', 'COUNTDOWN', 0, 0);
    r.onSkeleton(lean, 0.5);
    expect(r.step(1, 0)).toBeNull();
    r.onTransition('COUNTDOWN', 'RECORDING', 0, 3);
    expect(r.step(3, 0)).not.toBeNull();
    r.step(3.1, 0.1);
    const s = r.onTransition('RECORDING', 'RESULT', 0.2, 3.2);
    expect(s!.samples.map((x) => x.t)).toEqual([0, 0.1, 0.2]);
    expect(s!.meanAreaM2).toBeCloseTo(0.4, 12);
    expect(r.session).toBeNull();

    r.onTransition('RESULT', 'COUNTDOWN', 0, 10);
    r.onTransition('COUNTDOWN', 'RECORDING', 0, 13);
    r.step(13, 0);
    expect(r.onTransition('RECORDING', 'ATTRACT', 0, 14)).toBeNull();
  });
});
