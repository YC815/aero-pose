import { describe, expect, it } from 'vitest';
import { drawSilhouette, silhouetteRect } from '../src/ui/card';

describe('結果卡輪廓', () => {
  it('silhouetteRect：等比縮放、水平置中、底部對齊', () => {
    expect(silhouetteRect({ x: 10, y: 20, w: 300, h: 400 }, 100, 200)).toEqual({ x: 60, y: 20, w: 200, h: 400 });
    expect(silhouetteRect({ x: 0, y: 0, w: 300, h: 400 }, 300, 100)).toEqual({ x: 0, y: 300, w: 300, h: 100 });
  });

  it('drawSilhouette 原樣畫（mask 已是鏡像方向），不做任何翻轉或座標變換', () => {
    const calls: { name: string; args: unknown[] }[] = [];
    const ctx = new Proxy({} as Record<string | symbol, unknown>, {
      get: (t, k) => (k in t ? t[k] : (...args: unknown[]) => void calls.push({ name: String(k), args })),
      set: (t, k, v) => ((t[k] = v), true),
    }) as unknown as CanvasRenderingContext2D;
    const img = { width: 100, height: 200 } as HTMLCanvasElement;
    drawSilhouette(ctx, img, { x: 10, y: 20, w: 300, h: 400 });
    const names = calls.map((c) => c.name);
    for (const n of ['scale', 'translate', 'transform', 'setTransform', 'rotate']) expect(names).not.toContain(n);
    const draw = calls.find((c) => c.name === 'drawImage')!;
    expect(draw.args).toEqual([img, 60, 20, 200, 400]);
  });
});
