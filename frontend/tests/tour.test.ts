import { describe, expect, it } from 'vitest';
import { AERO_DEMO_POSE, UPRIGHT_POSE } from '../src/poses';
import { createMeasurer } from '../src/scene';
import { DEMO_FRAMES, MORPH_S, MORPH_START_S, SLIDE_S, SLIDES, demoFrames, morphFrame, slideAt, unionRect } from '../src/ui/tour';

describe('待機輪播', () => {
  it('slideAt：每 SLIDE_S 秒換一張，播完繞回第 1 張', () => {
    expect(slideAt(0)).toEqual({ index: 0, local: 0 });
    expect(slideAt(SLIDE_S + 1).index).toBe(1);
    expect(slideAt(SLIDE_S * SLIDES + 0.5)).toEqual({ index: 0, local: 0.5 });
    expect(slideAt(-3).index).toBe(0);
  });

  it('morphFrame：先停在坐直，趴低後停住，中間單調', () => {
    expect(morphFrame(0, 10)).toBe(0);
    expect(morphFrame(MORPH_START_S, 10)).toBe(0);
    expect(morphFrame(MORPH_START_S + MORPH_S, 10)).toBe(9);
    expect(morphFrame(SLIDE_S, 10)).toBe(9);
    let prev = 0;
    for (let t = 0; t <= SLIDE_S; t += 0.05) {
      const f = morphFrame(t, 10);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });

  it('示範騎士：坐直 → 趴低，面積明顯變小；共用畫布包得住每一格', () => {
    const m = createMeasurer();
    const t = performance.now();
    const frames = demoFrames((p) => m.measure(p), UPRIGHT_POSE, AERO_DEMO_POSE);
    console.log(`demoFrames ${DEMO_FRAMES} 格：${(performance.now() - t).toFixed(0)} ms`);
    expect(frames).toHaveLength(DEMO_FRAMES);
    expect(frames[0].areaM2).toBeCloseTo(m.measure(UPRIGHT_POSE).areaM2, 9); // 第 1 格 = 計分基準
    expect(frames.at(-1)!.areaM2).toBeLessThan(frames[0].areaM2 * 0.9);
    const r = unionRect(frames);
    for (const f of frames) {
      const x = Math.round((f.minX - r.minX) / r.cell);
      const y = Math.round((r.maxY - f.maxY) / r.cell);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + f.width).toBeLessThanOrEqual(r.w + 1);
      expect(y + f.height).toBeLessThanOrEqual(r.h + 1);
    }
  });
});
