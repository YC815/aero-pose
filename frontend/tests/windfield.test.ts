import { afterEach, describe, expect, it, vi } from 'vitest';
import { type CameraView, coverMap } from '../src/camera';
import { HeatField, hitMask, maskBounds, WindField, WindSim, type WindEnv } from '../src/windfield';

function sum(a: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return s;
}

/** 可重現的亂數（mulberry32）。 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('hitMask', () => {
  const w = 4;
  const h = 3;
  // 只有 (1,1)、(2,1) 是身體
  const mask = new Uint8Array([0, 0, 0, 0, 0, 255, 255, 0, 0, 0, 0, 0]);

  it('mask 內回 true（含小數座標）', () => {
    expect(hitMask(mask, w, h, 1, 1)).toBe(true);
    expect(hitMask(mask, w, h, 2.9, 1.5)).toBe(true);
  });

  it('mask 外回 false', () => {
    expect(hitMask(mask, w, h, 0, 0)).toBe(false);
    expect(hitMask(mask, w, h, 3.2, 1.2)).toBe(false);
  });

  it('座標越界回 false', () => {
    expect(hitMask(mask, w, h, -0.1, 1)).toBe(false);
    expect(hitMask(mask, w, h, 4, 1)).toBe(false);
    expect(hitMask(mask, w, h, 1, 3)).toBe(false);
    expect(hitMask(mask, w, h, 1, -5)).toBe(false);
    expect(hitMask(mask, w, h, NaN, 1)).toBe(false);
  });
});

describe('maskBounds', () => {
  it('回傳身體像素的包圍盒（右、下為開區間）', () => {
    const mask = new Uint8Array([0, 0, 0, 0, 0, 255, 255, 0, 0, 0, 255, 0]);
    const out = [0, 0, 0, 0];
    expect(maskBounds(mask, 4, 3, out)).toBe(true);
    expect(out).toEqual([1, 1, 3, 3]);
  });

  it('空 mask 回 false', () => {
    expect(maskBounds(new Uint8Array(12), 4, 3, [0, 0, 0, 0])).toBe(false);
  });
});

describe('HeatField', () => {
  it('deposit 後命中點的值增加，越界不炸', () => {
    const f = new HeatField(20, 10);
    f.deposit(5, 5, 1);
    expect(f.data[5 * 20 + 5]).toBeGreaterThan(0);
    expect(f.data[5 * 20 + 5]).toBeGreaterThanOrEqual(f.data[5 * 20 + 7]);
    const before = sum(f.data);
    f.deposit(-50, -50, 1);
    f.deposit(999, 5, 1);
    expect(sum(f.data)).toBe(before);
  });

  it('靠邊 deposit 只寫進範圍內', () => {
    const f = new HeatField(8, 8);
    f.deposit(0, 0, 1);
    expect(f.data[0]).toBeGreaterThan(0);
    expect(f.data.length).toBe(64);
  });

  it('decay 1 秒後約剩 13%（±3%），分 60 幀也一樣', () => {
    const a = new HeatField(10, 10);
    a.deposit(5, 5, 1);
    const v0 = a.data[55];
    a.decay(1);
    expect(a.data[55] / v0).toBeGreaterThan(0.1);
    expect(a.data[55] / v0).toBeLessThan(0.16);

    const b = new HeatField(10, 10);
    b.deposit(5, 5, 1);
    for (let i = 0; i < 60; i++) b.decay(1 / 60);
    expect(b.data[55] / v0).toBeCloseTo(a.data[55] / v0, 5);
  });

  it('resize 會清空並改變尺寸；同尺寸 resize 也清空', () => {
    const f = new HeatField(10, 10);
    f.deposit(5, 5, 1);
    f.resize(20, 5);
    expect(f.w).toBe(20);
    expect(f.h).toBe(5);
    expect(f.data.length).toBe(100);
    expect(sum(f.data)).toBe(0);
    f.deposit(3, 3, 1);
    f.resize(20, 5);
    expect(sum(f.data)).toBe(0);
  });
});

describe('WindSim', () => {
  const vw = 1920;
  const vh = 1080;
  const mw = 192;
  const mh = 108;

  function env(fill: number | null): WindEnv {
    return {
      vw,
      vh,
      map: coverMap(960, 540, vw, vh),
      mask: fill === null ? null : { data: new Uint8Array(mw * mh).fill(fill), w: mw, h: mh },
    };
  }

  function run(sim: WindSim, e: WindEnv, seconds: number): void {
    for (let t = 0; t < seconds; t += 1 / 60) sim.step(1 / 60, e);
  }

  it('整張都是身體：風打到後累積熱度、產生濺射', () => {
    const sim = new WindSim(300, rng(1));
    const e = env(255);
    run(sim, e, 1);
    expect(sum(sim.heat.data)).toBeGreaterThan(0);
    expect(sim.splashCount()).toBeGreaterThan(0);
  });

  it('沒有身體（mask 全 0 或 null）：不累積熱度、沒有濺射', () => {
    for (const fill of [0, null]) {
      const sim = new WindSim(300, rng(2));
      const e = env(fill);
      run(sim, e, 1);
      expect(sum(sim.heat.data)).toBe(0);
      expect(sim.splashCount()).toBe(0);
    }
  });

  it('只有左半邊來源影像是身體：熱度只落在 mask 內附近', () => {
    const sim = new WindSim(400, rng(3));
    const e = env(0);
    const data = e.mask!.data;
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw / 2; x++) data[y * mw + x] = 255;
    run(sim, e, 1.5);
    let inside = 0;
    let outside = 0;
    const heat = sim.heat.data;
    for (let y = 0; y < mh; y++)
      for (let x = 0; x < mw; x++) {
        if (x < mw / 2 + 8) inside += heat[y * mw + x];
        else outside += heat[y * mw + x];
      }
    expect(inside).toBeGreaterThan(0);
    expect(outside).toBe(0);
  });

  it('mask 尺寸改變時熱度場跟著重建', () => {
    const sim = new WindSim(50, rng(4));
    const e: WindEnv = { vw, vh, map: coverMap(960, 540, vw, vh), mask: { data: new Uint8Array(96 * 54), w: 96, h: 54 } };
    sim.step(1 / 60, e);
    expect(sim.heat.w).toBe(96);
    expect(sim.heat.h).toBe(54);
  });

  it('沒有相機映射也能跑（只畫風，不判定命中）', () => {
    const sim = new WindSim(100, rng(5));
    const e: WindEnv = { vw, vh, map: null, mask: null };
    run(sim, e, 0.5);
    expect(sum(sim.heat.data)).toBe(0);
  });
});

/** 什麼都接受的假 2D context：任何方法都是 no-op。 */
function fakeCtx(): CanvasRenderingContext2D {
  const target: Record<string | symbol, unknown> = {
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  };
  return new Proxy(target, {
    get: (t, k) => (k in t ? t[k] : () => {}),
    set: (t, k, v) => {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function fakeCanvas() {
  return { style: {}, width: 0, height: 0, className: '', getContext: () => fakeCtx(), remove: () => {} };
}

function allFinite(a: ArrayLike<number>): boolean {
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false;
  return true;
}

describe('WindField 防呆', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('update(NaN)、update(Infinity) 之後再 update(0.016)：opacity、粒子、熱度都是有限值', () => {
    vi.stubGlobal('document', { createElement: () => fakeCanvas() });
    vi.stubGlobal('window', { innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1 });
    const mw = 192;
    const mh = 108;
    const camera = {
      canvas: { parentNode: null },
      map: coverMap(960, 540, 1920, 1080),
      mask: { data: new Uint8Array(mw * mh).fill(255), w: mw, h: mh },
    } as unknown as CameraView;
    const container = { appendChild: () => {} } as unknown as HTMLElement;
    const wf = new WindField(container, camera, 200);
    const inner = wf as unknown as { opacity: number; sim: WindSim };

    wf.setActive(true);
    for (let i = 0; i < 30; i++) wf.update(0.016);
    for (const bad of [NaN, Infinity, -Infinity, -1, 0]) {
      wf.update(bad);
      wf.update(0.016);
      expect(Number.isFinite(inner.opacity)).toBe(true);
      expect(inner.opacity).toBeGreaterThan(0);
      for (const arr of [inner.sim.z, inner.sim.x, inner.sim.sx, inner.sim.age, inner.sim.heat.data]) {
        expect(allFinite(arr)).toBe(true);
      }
    }
    expect(inner.sim.heat.data.some((v) => v > 0)).toBe(true);
  });

  it('WindSim.step 也擋掉非有限 dt', () => {
    const sim = new WindSim(100, rng(9));
    const e: WindEnv = {
      vw: 1920,
      vh: 1080,
      map: coverMap(960, 540, 1920, 1080),
      mask: { data: new Uint8Array(192 * 108).fill(255), w: 192, h: 108 },
    };
    sim.step(0.016, e);
    sim.step(NaN, e);
    sim.step(Infinity, e);
    sim.step(0.016, e);
    expect(allFinite(sim.z)).toBe(true);
    expect(allFinite(sim.heat.data)).toBe(true);
  });
});
