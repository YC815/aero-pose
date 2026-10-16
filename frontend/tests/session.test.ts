import { describe, expect, it } from 'vitest';
import { RecordingSession } from '../src/session';
import { wattsSaved } from '../src/watts';
import type { RiderPose } from '../src/types';

const S = { cd: 0.8, speed_kmh: 40, air_density: 1.225 };
const BASE = 0.5;
const pose = (torsoPitch: number): RiderPose => ({
  torsoPitch,
  torsoRoll: 0,
  torsoYaw: 0,
  headPitch: 0,
  headYaw: 0,
  leftUpperArm: [0, -1, 0],
  leftForearm: [0, -1, 0],
  rightUpperArm: [0, -1, 0],
  rightForearm: [0, -1, 0],
});
const fakeMeasure = (p: RiderPose) => 0.5 - p.torsoPitch * 0.1;
const make = () => {
  const calls: number[] = [];
  const session = new RecordingSession({
    baselineM2: BASE,
    measure: (p) => {
      calls.push(p.torsoPitch);
      return fakeMeasure(p);
    },
    settings: () => S,
  });
  return { session, calls };
};

describe('RecordingSession', () => {
  it('10 秒、每 1/30 秒 push → 101 個樣本，t = 0..10', () => {
    const { session } = make();
    for (let i = 0; i <= 300; i++) session.push(pose(0.1), i / 30);
    expect(session.samples.length).toBe(101);
    session.samples.forEach((s, k) => expect(s.t).toBeCloseTo(k * 0.1, 9));
    expect(session.samples[100].t).toBeCloseTo(10, 9);
  });

  it('第一次 push 就取樣 t=0；同一個時間點之間不重複 measure', () => {
    const { session, calls } = make();
    session.push(pose(0), 0);
    expect(session.samples.length).toBe(1);
    session.push(pose(0), 0.03);
    session.push(pose(0), 0.06);
    expect(calls.length).toBe(1);
    session.push(pose(0), 0.1);
    expect(calls.length).toBe(2);
  });

  it('平均、bestIndex、latestWatts、poses', () => {
    const { session } = make();
    // t=0 pitch 0；t=0.1 pitch 1（面積 0.4，最小）；t=0.2 pitch 0.5
    session.push(pose(0), 0);
    session.push(pose(0.3), 0.05); // 不取樣，但要存
    session.push(pose(1), 0.1);
    session.push(pose(0.5), 0.2);

    expect(session.samples.map((s) => s.areaM2)).toEqual([0.5, 0.4, 0.45].map((v) => expect.closeTo(v, 9)));
    expect(session.latestWatts()).toBeCloseTo(wattsSaved(BASE, 0.45, S), 9);

    const sum = session.summary(10);
    expect(sum.poses.length).toBe(4);
    expect(sum.poses[1]).toEqual({ t: 0.05, pose: pose(0.3) });
    expect(sum.meanAreaM2).toBeCloseTo(0.45, 9);
    expect(sum.meanWatts).toBeCloseTo(
      (wattsSaved(BASE, 0.5, S) + wattsSaved(BASE, 0.4, S) + wattsSaved(BASE, 0.45, S)) / 3,
      9,
    );
    expect(sum.pct).toBeCloseTo(((BASE - 0.45) / BASE) * 100, 9);
    expect(sum.bestIndex).toBe(1);
    expect(sum.baselineM2).toBe(BASE);
    expect(sum.durationS).toBe(10);
    expect(sum.samples).toEqual(session.samples);
  });

  it('大跳躍只對最新 pose 取一次樣，t 為最後跨過的時間點', () => {
    const { session, calls } = make();
    session.push(pose(0), 0);
    session.push(pose(2), 0.57);
    expect(calls).toEqual([0, 2]);
    expect(session.samples.length).toBe(2);
    expect(session.samples[1].t).toBeCloseTo(0.5, 9);
    expect(session.samples[1].areaM2).toBeCloseTo(0.3, 9);
    // 下一個取樣點是 0.6
    session.push(pose(0), 0.59);
    expect(session.samples.length).toBe(2);
    session.push(pose(0), 0.6);
    expect(session.samples.length).toBe(3);
  });

  it('settings 每次取樣都讀最新值', () => {
    let speed = 40;
    const session = new RecordingSession({
      baselineM2: BASE,
      measure: () => 0.4,
      settings: () => ({ ...S, speed_kmh: speed }),
    });
    session.push(pose(0), 0);
    speed = 50;
    session.push(pose(0), 0.1);
    expect(session.samples[1].watts).toBeGreaterThan(session.samples[0].watts);
  });

  it('自訂 sampleIntervalS', () => {
    const session = new RecordingSession({
      baselineM2: BASE,
      measure: fakeMeasure,
      settings: () => S,
      sampleIntervalS: 0.5,
    });
    for (let i = 0; i <= 20; i++) session.push(pose(0), i * 0.1);
    expect(session.samples.length).toBe(5);
  });

  it('沒樣本時 latestWatts 為 null，summary throw', () => {
    const { session } = make();
    expect(session.latestWatts()).toBeNull();
    expect(() => session.summary(10)).toThrow();
  });
});
