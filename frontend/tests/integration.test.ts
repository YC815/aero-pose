// 端到端（不含 WebGL / DOM）：合成骨架 → Recorder → Game → summary。
// Recorder 就是 main.ts 用的那一份接線：skeleton → recorder.onSkeleton，Game 轉移 → recorder.onTransition，
// RECORDING 每幀 recorder.step；這裡只模擬 main 的呼叫時序（rAF 60 fps、骨架 30 fps）。

import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { UPRIGHT_POSE } from '../src/poses';
import { retarget } from '../src/retarget';
import { createMeasurer, poseForSample, replayPose, type TimedPose } from '../src/scene';
import { Recorder } from '../src/recorder';
import { DEFAULT_SETTINGS, type PlayerSkeleton, type SessionSummary, type Settings } from '../src/types';
import { wattsSaved } from '../src/watts';
import { standingSkeleton } from './fixtures';

const measurer = createMeasurer();
const baseline = measurer.measure(UPRIGHT_POSE);
const areaOf = (sk: PlayerSkeleton): number => measurer.measure(retarget(sk, DEFAULT_SETTINGS.torso_gain)).areaM2;

/**
 * 模擬一整輪：t = 0 forceStart → 倒數 → 錄製 → RESULT。rAF 60 fps、骨架 30 fps。
 * feed(tRec) 給「錄製開始後 tRec 秒」的骨架（倒數期間 tRec < 0），null = 沒人。
 */
function playRound(
  feed: (tRec: number) => PlayerSkeleton | null,
  s: Settings = DEFAULT_SETTINGS,
): { summary: SessionSummary | null; states: string[] } {
  const game = new Game(() => s);
  const recorder = new Recorder({
    baselineM2: baseline.areaM2,
    measure: (p) => measurer.measure(p).areaM2,
    settings: () => s,
  });
  let summary: SessionSummary | null = null;
  let now = 0;
  const states: string[] = [];
  game.onTransition = (from, to) => {
    states.push(to);
    summary = recorder.onTransition(from, to, game.recordElapsed, now) ?? summary;
  };
  game.forceStart(0);

  const end = s.countdown_s + s.record_s + 1;
  for (let i = 1; now < end && game.state !== 'ATTRACT' && game.state !== 'RESULT'; i++) {
    now = i / 60;
    const sk = feed(now - s.countdown_s);
    if (i % 2 === 0) recorder.onSkeleton(sk, now);
    const state = game.update({ now, player: sk, cameraOk: true });
    if (state === 'RECORDING') recorder.step(now, game.recordElapsed);
  }
  return { summary, states };
}

describe('整合：坐直基準與單一姿勢', () => {
  it('坐直基準落在 spec 範圍', () => {
    expect(baseline.areaM2).toBeGreaterThan(0.45);
    expect(baseline.areaM2).toBeLessThan(0.55);
  });

  it('站直的玩家 ≈ 坐直基準（±5%）；前傾 50° 明顯更小', () => {
    expect(Math.abs(areaOf(standingSkeleton()) - baseline.areaM2) / baseline.areaM2).toBeLessThan(0.05);
    expect(areaOf(standingSkeleton({ leanDeg: 50 }))).toBeLessThan(baseline.areaM2 * 0.85);
  });
});

describe('整合：10 秒錄製（站直 5 秒 + 前傾 50° 5 秒）', () => {
  const stand = standingSkeleton();
  const lean = standingSkeleton({ leanDeg: 50 });
  const { summary, states } = playRound((t) => (t < 5 ? stand : lean));
  const wStand = wattsSaved(baseline.areaM2, areaOf(stand), DEFAULT_SETTINGS);
  const wLean = wattsSaved(baseline.areaM2, areaOf(lean), DEFAULT_SETTINGS);

  it('走完 COUNTDOWN → RECORDING → RESULT', () => {
    expect(states).toEqual(['COUNTDOWN', 'RECORDING', 'RESULT']);
    expect(summary).not.toBeNull();
  });

  it('101 個樣本：t = 0, 0.1, …, 10', () => {
    const s = summary!;
    expect(s.samples).toHaveLength(101);
    s.samples.forEach((x, i) => expect(x.t).toBeCloseTo(i * 0.1, 9));
    expect(s.durationS).toBe(10);
  });

  it('meanWatts 介於兩段之間，pct 和 meanArea 一致', () => {
    const s = summary!;
    expect(wLean).toBeGreaterThan(wStand + 10);
    expect(s.meanWatts).toBeGreaterThan(wStand);
    expect(s.meanWatts).toBeLessThan(wLean);
    expect(s.baselineM2).toBe(baseline.areaM2);
    expect(s.pct).toBeCloseTo(((baseline.areaM2 - s.meanAreaM2) / baseline.areaM2) * 100, 9);
  });

  it('bestIndex 落在前傾段，且那一刻的 pose 重新量測面積相同（結果卡 bestMask 的來源）', () => {
    const s = summary!;
    const best = s.samples[s.bestIndex];
    expect(best.t).toBeGreaterThanOrEqual(5);
    const pose = poseForSample(s.poses, best.t)!;
    expect(measurer.measure(pose).areaM2).toBeCloseTo(best.areaM2, 12);
  });

  it('每個樣本的面積都等於 poseForSample 那個 pose 的面積', () => {
    const s = summary!;
    for (const x of [s.samples[0], s.samples[49], s.samples[50], s.samples[100]]) {
      expect(measurer.measure(poseForSample(s.poses, x.t)!).areaM2).toBeCloseTo(x.areaM2, 12);
    }
  });

  it('poses 涵蓋整段錄製，重播在 t = 2、t = 8 分別是站直、前傾', () => {
    const s = summary!;
    expect(s.poses[0].t).toBe(0);
    expect(s.poses[s.poses.length - 1].t).toBe(10);
    expect(replayPose(s.poses, 2)!.torsoPitch).toBeCloseTo(retarget(stand).torsoPitch, 9);
    expect(replayPose(s.poses, 8)!.torsoPitch).toBeCloseTo(retarget(lean).torsoPitch, 9);
  });
});

describe('整合：錄製中的遮擋與中止', () => {
  it('前傾段髖部短暫被擋（0.2 s）：沿用上一個有效姿勢，不會掉回坐直', () => {
    const lean = standingSkeleton({ leanDeg: 50 });
    const hidden = standingSkeleton({ leanDeg: 50 });
    hidden.visibility.left_hip = 0.2;
    hidden.visibility.right_hip = 0.1;
    const { summary } = playRound((t) => (t >= 6 && t < 6.2 ? hidden : lean));
    const area = areaOf(lean);
    expect(summary!.samples).toHaveLength(101);
    for (const x of summary!.samples) expect(x.areaM2).toBeCloseTo(area, 9);
  });

  it('前傾段髖部被擋 2 s（遠超過 0.3 s）：101 個樣本都沿用前傾的面積，不會算成坐直 0 W', () => {
    const lean = standingSkeleton({ leanDeg: 50 });
    const hidden = standingSkeleton({ leanDeg: 50 });
    hidden.visibility.left_hip = 0.2;
    hidden.visibility.right_hip = 0.1;
    const { summary, states } = playRound((t) => (t >= 4 && t < 6 ? hidden : lean));
    const area = areaOf(lean);
    expect(states).toEqual(['COUNTDOWN', 'RECORDING', 'RESULT']);
    expect(summary!.samples).toHaveLength(101);
    for (const x of summary!.samples) expect(x.areaM2).toBeCloseTo(area, 9);
  });

  it('錄製中單一 player: null 骨架：不產生坐直（0 W）的樣本', () => {
    const lean = standingSkeleton({ leanDeg: 50 });
    // 骨架 30 fps（偶數 rAF 幀）；t ∈ [3.0, 3.03) 只涵蓋一則骨架 → 恰好一則 null
    const { summary, states } = playRound((t) => (t >= 3 && t < 3.03 ? null : lean));
    const area = areaOf(lean);
    expect(states).toEqual(['COUNTDOWN', 'RECORDING', 'RESULT']);
    expect(summary!.samples).toHaveLength(101);
    for (const x of summary!.samples) {
      expect(x.areaM2).toBeCloseTo(area, 9);
      expect(x.watts).toBeGreaterThan(10);
    }
  });

  it('錄製中 player: null 連續 0.5 s：照樣沿用前傾的面積，Game 不中止', () => {
    const lean = standingSkeleton({ leanDeg: 50 });
    const { summary, states } = playRound((t) => (t >= 3 && t < 3.5 ? null : lean));
    const area = areaOf(lean);
    expect(states).toEqual(['COUNTDOWN', 'RECORDING', 'RESULT']);
    expect(summary!.samples).toHaveLength(101);
    for (const x of summary!.samples) expect(x.areaM2).toBeCloseTo(area, 9);
  });

  it('錄製中玩家消失 3 秒 → 回 ATTRACT，沒有成績', () => {
    const stand = standingSkeleton();
    const { summary, states } = playRound((t) => (t > 2 ? null : stand));
    expect(states).toEqual(['COUNTDOWN', 'RECORDING', 'ATTRACT']);
    expect(summary).toBeNull();
  });

  it('瓦數跟著 settings.speed_kmh 走（40 km/h 是 20 km/h 的 8 倍）', () => {
    const lean = standingSkeleton({ leanDeg: 50 });
    const slow = playRound(() => lean, { ...DEFAULT_SETTINGS, speed_kmh: 20 }).summary!;
    const fast = playRound(() => lean, { ...DEFAULT_SETTINGS, speed_kmh: 40 }).summary!;
    expect(fast.meanWatts / slow.meanWatts).toBeCloseTo(8, 6);
  });
});

describe('replayPose / poseForSample', () => {
  const a = retarget(standingSkeleton());
  const b = retarget(standingSkeleton({ leanDeg: 60 }));
  const poses: TimedPose[] = [
    { t: 0, pose: a },
    { t: 1, pose: b },
    { t: 1, pose: b },
    { t: 2, pose: a },
  ];

  it('前後兩筆線性內插，超出範圍夾到頭尾', () => {
    expect(replayPose(poses, 0.5)!.torsoPitch).toBeCloseTo((a.torsoPitch + b.torsoPitch) / 2, 9);
    expect(replayPose(poses, -1)).toBe(a);
    expect(replayPose(poses, 5)).toBe(a);
    expect(replayPose(poses, 1)!.torsoPitch).toBeCloseTo(b.torsoPitch, 9);
    expect(replayPose([], 1)).toBeNull();
  });

  it('poseForSample 取第一個 t ≥ 取樣時間的 pose（吸收浮點誤差）', () => {
    expect(poseForSample(poses, 0.3)).toBe(b);
    expect(poseForSample(poses, 1 + 1e-9)).toBe(b);
    expect(poseForSample(poses, 9)).toBe(a);
    expect(poseForSample([], 0)).toBeNull();
  });
});

describe('整合：結果卡 mask 的左右方向', () => {
  /** 覆蓋面積分成世界 x < 0（mask 低欄號、圖的左邊）和 x ≥ 0 兩半，單位 m²。 */
  function halves(sk: PlayerSkeleton): [number, number] {
    const r = measurer.measure(retarget(sk));
    const out: [number, number] = [0, 0];
    for (let j = 0; j < r.height; j++) {
      for (let i = 0; i < r.width; i++) {
        if (r.mask[j * r.width + i]) out[r.minX + (i + 0.5) * r.cell < 0 ? 0 : 1] += r.cell ** 2;
      }
    }
    return out;
  }

  it('玩家舉左手 → 多出來的覆蓋在 mask 的左半：mask 原樣就是鏡像方向（和螢幕一致）', () => {
    const sk = standingSkeleton();
    const sh = sk.joints.left_shoulder;
    sk.joints.left_elbow = [sh[0] + 0.3, sh[1], sh[2]];
    sk.joints.left_wrist = [sh[0] + 0.55, sh[1], sh[2]];
    const [l0, r0] = halves(standingSkeleton());
    const [l1, r1] = halves(sk);
    expect(l1 - l0).toBeGreaterThan(0.01);
    expect(Math.abs(r1 - r0)).toBeLessThan((l1 - l0) / 3);
  });
});
