import { describe, expect, it } from 'vitest';
import { drawWattsChart, wattsAt, wattsRange, type ChartOptions } from '../src/ui/chart';
import type { SessionSample } from '../src/types';

function samples(watts: number[], dt = 0.1): SessionSample[] {
  return watts.map((w, i) => ({ t: i * dt, areaM2: 0.4, watts: w }));
}

/** 假 2D context：記錄所有方法呼叫，屬性照存；gradient / measureText 回傳可用的假物件。 */
function fakeCtx() {
  const calls: { name: string; args: unknown[] }[] = [];
  const props: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(props, {
    get(target, key) {
      if (key in target) return target[key];
      return (...args: unknown[]) => {
        calls.push({ name: String(key), args });
        if (key === 'measureText') return { width: 10 * String(args[0]).length };
        if (key === 'createLinearGradient' || key === 'createRadialGradient') return { addColorStop() {} };
        return undefined;
      };
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  const count = (name: string) => calls.filter((c) => c.name === name).length;
  return { ctx, calls, count };
}

const OPTS: ChartOptions = { width: 800, height: 300, durationS: 10, showAxis: true };

describe('wattsRange', () => {
  it('全正：範圍含 0，且上方留邊距', () => {
    const [lo, hi] = wattsRange(samples([10, 30, 50]));
    expect(lo).toBeLessThan(0);
    expect(hi).toBeGreaterThan(50);
  });

  it('全負：範圍含 0，且下方留邊距', () => {
    const [lo, hi] = wattsRange(samples([-40, -25, -5]));
    expect(lo).toBeLessThan(-40);
    expect(hi).toBeGreaterThan(0);
  });

  it('有正有負：兩端都留邊距', () => {
    const [lo, hi] = wattsRange(samples([-20, 0, 120]));
    expect(lo).toBeLessThan(-20);
    expect(hi).toBeGreaterThan(120);
  });

  it('單點：範圍含 0 和該點，且不為零寬', () => {
    const [lo, hi] = wattsRange(samples([25]));
    expect(lo).toBeLessThan(0);
    expect(hi).toBeGreaterThan(25);
  });

  it('全 0 或空：仍是含 0、非零寬的範圍', () => {
    for (const s of [samples([0, 0, 0]), samples([])]) {
      const [lo, hi] = wattsRange(s);
      expect(lo).toBeLessThan(0);
      expect(hi).toBeGreaterThan(0);
    }
  });

  it('忽略非有限值', () => {
    const [lo, hi] = wattsRange(samples([NaN, 30, Infinity]));
    expect(Number.isFinite(lo)).toBe(true);
    expect(Number.isFinite(hi)).toBe(true);
    expect(hi).toBeGreaterThan(30);
    expect(hi).toBeLessThan(100);
  });
});

describe('wattsAt', () => {
  it('在兩個樣本之間線性內插，超出兩端夾住', () => {
    const s = samples([0, 10, 30], 1);
    expect(wattsAt(s, 0.5)).toBeCloseTo(5);
    expect(wattsAt(s, 1.5)).toBeCloseTo(20);
    expect(wattsAt(s, -3)).toBe(0);
    expect(wattsAt(s, 99)).toBe(30);
  });

  it('沒有樣本回傳 null', () => {
    expect(wattsAt([], 1)).toBeNull();
  });
});

describe('drawWattsChart', () => {
  it('一般資料：不 throw，有填色、有畫線', () => {
    const f = fakeCtx();
    expect(() => drawWattsChart(f.ctx, samples([-10, 5, 20, 40, 35]), OPTS)).not.toThrow();
    expect(f.count('fill')).toBeGreaterThan(0);
    expect(f.count('stroke')).toBeGreaterThan(0);
  });

  it('單點、playhead、不畫軸：都不 throw', () => {
    const f = fakeCtx();
    expect(() => drawWattsChart(f.ctx, samples([25]), { ...OPTS, showAxis: false }, 0)).not.toThrow();
    expect(() => drawWattsChart(f.ctx, samples([1, 2, 3]), OPTS, 0.15)).not.toThrow();
    expect(() => drawWattsChart(f.ctx, samples([1, 2, 3]), { ...OPTS, durationS: 0 }, NaN)).not.toThrow();
  });

  it('samples 空：只畫軸（有刻度字、沒有填色、沒有遊標圓點）', () => {
    const f = fakeCtx();
    expect(() => drawWattsChart(f.ctx, [], OPTS, 3)).not.toThrow();
    expect(f.count('fillText')).toBeGreaterThan(0);
    expect(f.count('fill')).toBe(0);
    expect(f.count('arc')).toBe(0);
  });

  it('save / restore 成對，不污染呼叫端的 context 狀態', () => {
    const f = fakeCtx();
    drawWattsChart(f.ctx, samples([-10, 5, 20]), OPTS, 0.1);
    expect(f.count('save')).toBe(f.count('restore'));
  });

  it('不清畫布（由呼叫端決定）', () => {
    const f = fakeCtx();
    drawWattsChart(f.ctx, samples([10, 20]), OPTS);
    expect(f.count('clearRect')).toBe(0);
  });
});
