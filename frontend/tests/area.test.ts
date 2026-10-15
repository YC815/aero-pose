import { describe, expect, it } from 'vitest';
import { frontalArea } from '../src/area';

type P = [number, number, number];

function tris(...list: [P, P, P][]): Float32Array {
  return new Float32Array(list.flat(2));
}

function square(x0: number, y0: number, size: number, z = 0): [P, P, P][] {
  const a: P = [x0, y0, z];
  const b: P = [x0 + size, y0, z];
  const c: P = [x0 + size, y0 + size, z];
  const d: P = [x0, y0 + size, z];
  return [
    [a, b, c],
    [a, c, d],
  ];
}

describe('frontalArea', () => {
  it('1 m × 1 m 正方形 ≈ 1 m²', () => {
    const r = frontalArea(tris(...square(0, 0, 1)));
    expect(r.areaM2).toBeGreaterThanOrEqual(0.99);
    expect(r.areaM2).toBeLessThanOrEqual(1.01);
    expect(r.cell).toBe(0.004);
    expect(r.mask.length).toBe(r.width * r.height);
  });

  it('半徑 0.3 的圓（64 扇形）誤差 < 1%', () => {
    const list: [P, P, P][] = [];
    const n = 64;
    const R = 0.3;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * 2 * Math.PI;
      const a1 = ((i + 1) / n) * 2 * Math.PI;
      // 一半順時針一半逆時針，確認不分正反面
      const p0: P = [R * Math.cos(a0), R * Math.sin(a0), 0];
      const p1: P = [R * Math.cos(a1), R * Math.sin(a1), 0];
      list.push(i % 2 === 0 ? [[0, 0, 0], p0, p1] : [[0, 0, 0], p1, p0]);
    }
    const r = frontalArea(tris(...list));
    const expected = Math.PI * R * R;
    expect(Math.abs(r.areaM2 - expected) / expected).toBeLessThan(0.01);
  });

  it('重疊的兩個正方形不重複計算', () => {
    // 0.5×0.5 與往右平移 0.25 的 0.5×0.5 → 聯集 0.75×0.5 = 0.375
    const r = frontalArea(tris(...square(0, 0, 0.5), ...square(0.25, 0, 0.5)));
    expect(r.areaM2).toBeGreaterThan(0.37);
    expect(r.areaM2).toBeLessThan(0.38);
  });

  it('z 不同不影響結果', () => {
    const a = frontalArea(tris(...square(0, 0, 0.5, 0)));
    const b = frontalArea(tris(...square(0, 0, 0.5, 3.7)));
    const tilted = frontalArea(
      tris(
        [
          [0, 0, -1],
          [0.5, 0, 2],
          [0.5, 0.5, 0.3],
        ],
        [
          [0, 0, -1],
          [0.5, 0.5, 0.3],
          [0, 0.5, 5],
        ],
      ),
    );
    expect(b.areaM2).toBe(a.areaM2);
    expect(tilted.areaM2).toBe(a.areaM2);
  });

  it('退化三角形跳過', () => {
    const r = frontalArea(
      tris(...square(0, 0, 0.5), [
        [0, 0, 0],
        [2, 2, 0],
        [1, 1, 0],
      ]),
    );
    expect(r.areaM2).toBeCloseTo(0.25, 2);
  });

  it('mask row 0 對應最大 y，column 0 對應最小 x', () => {
    // 上方：寬 0.2 的橫條（y 0.9–1.0）；下方空白；左側一個方塊在 y 0–0.1
    const r = frontalArea(tris(...square(0, 0.9, 0.1), ...square(0.5, 0, 0.1)), 0.01);
    expect(r.maxY).toBeGreaterThanOrEqual(1.0);
    expect(r.minX).toBeLessThanOrEqual(0);
    // 第一個有覆蓋的列應該是上方方塊所在的左側
    const firstRow = Math.round((r.maxY - 0.95) / r.cell - 0.5);
    const leftCol = Math.round((0.05 - r.minX) / r.cell - 0.5);
    const rightCol = Math.round((0.55 - r.minX) / r.cell - 0.5);
    expect(r.mask[firstRow * r.width + leftCol]).toBe(1);
    expect(r.mask[firstRow * r.width + rightCol]).toBe(0);
    const lastRow = Math.round((r.maxY - 0.05) / r.cell - 0.5);
    expect(r.mask[lastRow * r.width + rightCol]).toBe(1);
    expect(r.mask[lastRow * r.width + leftCol]).toBe(0);
    // 外擴一格：最上、最下列與最左、最右欄全為 0
    for (let i = 0; i < r.width; i++) {
      expect(r.mask[i]).toBe(0);
      expect(r.mask[(r.height - 1) * r.width + i]).toBe(0);
    }
    for (let j = 0; j < r.height; j++) {
      expect(r.mask[j * r.width]).toBe(0);
      expect(r.mask[j * r.width + r.width - 1]).toBe(0);
    }
  });

  it('空輸入回傳 0', () => {
    const r = frontalArea(new Float32Array(0));
    expect(r.areaM2).toBe(0);
    expect(r.mask.length).toBe(r.width * r.height);
  });
});
