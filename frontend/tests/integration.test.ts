// 端到端（不含 WebGL / DOM）：合成骨架 → retarget → 騎士 → 定格 → frontalArea → wattsSaved。
// 走的是 main.ts 實際用的同一組函式（scene.ts 的量測區段）。

import { describe, expect, it } from 'vitest';
import { retarget } from '../src/retarget';
import { PoseTracker } from '../src/tracker';
import { UPRIGHT_POSE } from '../src/poses';
import { alignMasks, createMeasurer, FREEZE_FRAMES, freezeResult } from '../src/scene';
import { DEFAULT_SETTINGS, type PlayerSkeleton, type RiderPose } from '../src/types';
import { standingSkeleton } from './fixtures';

const measurer = createMeasurer();
const baseline = measurer.measure(UPRIGHT_POSE);

/** 模擬 WS 連續送來 n 幀同一個骨架（每幀都 retarget）。 */
function frames(sk: PlayerSkeleton, n = 15): RiderPose[] {
  return Array.from({ length: n }, () => retarget(sk, DEFAULT_SETTINGS.torso_gain));
}

/** 左手側平舉：上臂、前臂都往本人左（+x）伸直。 */
function leftArmOut(): PlayerSkeleton {
  const sk = standingSkeleton();
  const sh = sk.joints.left_shoulder;
  sk.joints.left_elbow = [sh[0] + 0.3, sh[1], sh[2]];
  sk.joints.left_wrist = [sh[0] + 0.55, sh[1], sh[2]];
  return sk;
}

describe('整合：骨架 → 面積 → 瓦數', () => {
  it('坐直基準落在 spec 範圍', () => {
    expect(baseline.areaM2).toBeGreaterThan(0.45);
    expect(baseline.areaM2).toBeLessThan(0.55);
  });

  it('站直的玩家 ≈ 坐直基準（±5%），瓦數接近 0', () => {
    const r = freezeResult(frames(standingSkeleton()), UPRIGHT_POSE, measurer, baseline, DEFAULT_SETTINGS);
    expect(Math.abs(r.areaM2 - baseline.areaM2) / baseline.areaM2).toBeLessThan(0.05);
    expect(Math.abs(r.pct)).toBeLessThan(5);
    expect(r.baselineM2).toBe(baseline.areaM2);
  });

  it('前傾 50° 面積明顯小於基準，瓦數為正', () => {
    const r = freezeResult(
      frames(standingSkeleton({ leanDeg: 50 })),
      UPRIGHT_POSE,
      measurer,
      baseline,
      DEFAULT_SETTINGS,
    );
    expect(r.areaM2).toBeLessThan(baseline.areaM2 * 0.85);
    expect(r.pct).toBeGreaterThan(15);
    expect(r.watts).toBeGreaterThan(0);
  });

  it('定格只取最後 FREEZE_FRAMES 幀', () => {
    const upright = frames(standingSkeleton(), 20);
    const lean = frames(standingSkeleton({ leanDeg: 50 }), FREEZE_FRAMES);
    const r = freezeResult([...upright, ...lean], UPRIGHT_POSE, measurer, baseline, DEFAULT_SETTINGS);
    expect(r.pose.torsoPitch).toBeCloseTo(lean[0].torsoPitch, 6);
  });

  it('沒有任何幀時用 fallback 姿勢', () => {
    const r = freezeResult([], UPRIGHT_POSE, measurer, baseline, DEFAULT_SETTINGS);
    expect(r.areaM2).toBeCloseTo(baseline.areaM2, 6);
  });

  it('瓦數跟著 settings.speed_kmh 走', () => {
    const fr = frames(standingSkeleton({ leanDeg: 50 }));
    const slow = freezeResult(fr, UPRIGHT_POSE, measurer, baseline, { ...DEFAULT_SETTINGS, speed_kmh: 20 });
    const fast = freezeResult(fr, UPRIGHT_POSE, measurer, baseline, { ...DEFAULT_SETTINGS, speed_kmh: 40 });
    expect(fast.watts / slow.watts).toBeCloseTo(8, 3);
  });
});

describe('整合：軀幹被擋的幀（I3）', () => {
  const gain = DEFAULT_SETTINGS.torso_gain;
  const hipsHidden = (leanDeg: number): PlayerSkeleton => {
    const sk = standingSkeleton({ leanDeg });
    sk.visibility.left_hip = 0.3; // 深度前傾時髖部被身體擋住
    sk.visibility.right_hip = 0.1;
    return sk;
  };

  /** 模擬 COUNTDOWN 期間 30 fps 收骨架，倒數結束時定格（main.ts 的同一條路）。 */
  function freezeAfterCountdown(feed: PlayerSkeleton[]) {
    const tracker = new PoseTracker(FREEZE_FRAMES);
    feed.forEach((sk, i) => tracker.push(sk, i / 30, gain));
    return freezeResult(tracker.recent, UPRIGHT_POSE, measurer, baseline, DEFAULT_SETTINGS);
  }

  it('COUNTDOWN 中夾雜（甚至結尾連續）髖部被擋的幀，定格面積不變', () => {
    const lean = standingSkeleton({ leanDeg: 50 });
    const clean = freezeAfterCountdown(Array.from({ length: 30 }, () => lean));
    const mixed = freezeAfterCountdown([
      ...Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? hipsHidden(50) : lean)),
      ...Array.from({ length: 8 }, () => hipsHidden(50)),
    ]);
    expect(mixed.areaM2).toBeCloseTo(clean.areaM2, 9);
    expect(mixed.pose.torsoPitch).toBeCloseTo(clean.pose.torsoPitch, 9);

    // 對照：舊做法（被擋 = 坐直、照樣進平均）面積會明顯變大
    const legacy = Array.from({ length: FREEZE_FRAMES }, (_, i) =>
      retarget(i % 3 === 0 ? hipsHidden(50) : lean, gain),
    );
    const old = freezeResult(legacy, UPRIGHT_POSE, measurer, baseline, DEFAULT_SETTINGS);
    expect(old.areaM2).toBeGreaterThan(clean.areaM2 + 0.01);
  });

  it('整段軀幹都被擋 → 用 fallback（畫面上的姿勢）定格', () => {
    const r = freezeAfterCountdown(Array.from({ length: 20 }, () => hipsHidden(50)));
    expect(r.areaM2).toBeCloseTo(baseline.areaM2, 6);
  });
});

describe('整合：結果畫面的兩張 mask', () => {
  it('對齊到同一個 bounds：同尺寸、覆蓋格數不變', () => {
    const r = freezeResult(
      frames(standingSkeleton({ leanDeg: 50 })),
      UPRIGHT_POSE,
      measurer,
      baseline,
      DEFAULT_SETTINGS,
    );
    const m = alignMasks(r.player, baseline);
    expect(m.a.length).toBe(m.width * m.height * 4);
    expect(m.b.length).toBe(m.width * m.height * 4);
    const covered = (rgba: Uint8ClampedArray) => {
      let n = 0;
      for (let i = 3; i < rgba.length; i += 4) n += rgba[i] === 255 ? 1 : 0;
      return n;
    };
    const sum = (u: Uint8Array) => u.reduce((s, v) => s + v, 0);
    expect(covered(m.a)).toBe(sum(r.player.mask));
    expect(covered(m.b)).toBe(sum(baseline.mask));
  });

  it('同一份 mask 對齊自己：完全一致', () => {
    const m = alignMasks(baseline, baseline);
    expect(m.width).toBe(baseline.width);
    expect(m.height).toBe(baseline.height);
    expect(m.a).toEqual(m.b);
  });

  it('單車在兩張圖的同一位置（底部只有輪胎的區域，重心差 < 1 格）', () => {
    const r = freezeResult(
      frames(standingSkeleton({ leanDeg: 50 })),
      UPRIGHT_POSE,
      measurer,
      baseline,
      DEFAULT_SETTINGS,
    );
    const m = alignMasks(r.player, baseline);
    // 兩張 mask 各自的格點有次格位移，對齊誤差最多半格；最下面 10 cm 只有輪胎
    const rows = Math.round(0.1 / baseline.cell);
    const centroid = (rgba: Uint8ClampedArray) => {
      let n = 0;
      let sx = 0;
      let sy = 0;
      for (let row = m.height - rows; row < m.height; row++) {
        for (let col = 0; col < m.width; col++) {
          if (rgba[(row * m.width + col) * 4 + 3] !== 255) continue;
          n++;
          sx += col;
          sy += row;
        }
      }
      return { n, x: sx / n, y: sy / n };
    };
    const a = centroid(m.a);
    const b = centroid(m.b);
    expect(a.n).toBeGreaterThan(100);
    expect(Math.abs(a.x - b.x)).toBeLessThan(1);
    expect(Math.abs(a.y - b.y)).toBeLessThan(1);
  });

  it('鏡像一致：玩家舉左手 → 輪廓圖的左半邊（= 3D 鏡像畫面的左邊）比較多', () => {
    const r = freezeResult(frames(leftArmOut()), UPRIGHT_POSE, measurer, baseline, DEFAULT_SETTINGS);
    const m = alignMasks(r.player, baseline);
    // 世界 x = 0（單車中線）所在的欄；比「玩家 − 基準」多出來的覆蓋在左右哪邊
    const minX = Math.min(r.player.minX, baseline.minX);
    const center = Math.round((0 - minX) / baseline.cell);
    let left = 0;
    let right = 0;
    for (let k = 0; k < m.width * m.height; k++) {
      const d = (m.a[k * 4 + 3] === 255 ? 1 : 0) - (m.b[k * 4 + 3] === 255 ? 1 : 0);
      if (k % m.width < center) left += d;
      else right += d;
    }
    const cellArea = baseline.cell ** 2;
    expect(left * cellArea).toBeGreaterThan(0.02);
    expect(Math.abs(right * cellArea)).toBeLessThan(0.01);
  });
});
