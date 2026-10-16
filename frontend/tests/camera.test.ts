import { describe, expect, it } from 'vitest';
import { coverMap, mirrorTransform, screenToMask, screenToSource, sourceToScreen } from '../src/camera';

describe('coverMap', () => {
  it('1280×720 進 1920×1080：scale 1.5、無 offset', () => {
    const m = coverMap(1280, 720, 1920, 1080);
    expect(m.scale).toBeCloseTo(1.5);
    expect(m.offsetX).toBeCloseTo(0);
    expect(m.offsetY).toBeCloseTo(0);
    expect(m).toMatchObject({ srcW: 1280, srcH: 720, vw: 1920, vh: 1080 });
  });

  it('鏡像：螢幕左上角對應來源右上角，右下角對應來源左下角', () => {
    const m = coverMap(1280, 720, 1920, 1080);
    const [u0, v0] = screenToSource(m, 0, 0);
    expect(u0).toBeCloseTo(1280);
    expect(v0).toBeCloseTo(0);
    const [u1, v1] = screenToSource(m, 1920, 1080);
    expect(u1).toBeCloseTo(0);
    expect(v1).toBeCloseTo(720);
  });

  it('sourceToScreen 也鏡像：來源左邊緣在螢幕右邊緣', () => {
    const m = coverMap(1280, 720, 1920, 1080);
    const [sx, sy] = sourceToScreen(m, 0, 360);
    expect(sx).toBeCloseTo(1920);
    expect(sy).toBeCloseTo(540);
  });

  it('screenToSource(sourceToScreen(p)) ≈ p（含裁切）', () => {
    for (const [w, h, vw, vh] of [
      [1280, 720, 1920, 1080],
      [960, 540, 1080, 1920],
      [640, 480, 1920, 1080],
    ]) {
      const m = coverMap(w, h, vw, vh);
      for (const [u, v] of [
        [0, 0],
        [123.4, 56.7],
        [w / 2, h / 2],
        [w - 1, h - 1],
      ]) {
        const [sx, sy] = sourceToScreen(m, u, v);
        const [u2, v2] = screenToSource(m, sx, sy);
        expect(u2).toBeCloseTo(u, 6);
        expect(v2).toBeCloseTo(v, 6);
      }
    }
  });

  it('直式 viewport 裁左右，不裁上下', () => {
    const m = coverMap(1280, 720, 1080, 1920);
    expect(m.scale).toBeCloseTo(1920 / 720);
    expect(m.offsetY).toBeCloseTo(0);
    expect(m.offsetX).toBeLessThan(0);
    // 置中裁切：左右各裁一樣多
    expect(m.offsetX).toBeCloseTo((1080 - 1280 * m.scale) / 2);
    // 螢幕正中央 = 來源正中央
    const [u, v] = screenToSource(m, 540, 960);
    expect(u).toBeCloseTo(640);
    expect(v).toBeCloseTo(360);
  });

  it('來源比螢幕更寬高比時（4:3 進 16:9）裁上下', () => {
    const m = coverMap(640, 480, 1920, 1080);
    expect(m.scale).toBeCloseTo(3);
    expect(m.offsetX).toBeCloseTo(0);
    expect(m.offsetY).toBeCloseTo((1080 - 480 * 3) / 2);
  });
});

describe('mirrorTransform', () => {
  it('用矩陣 [a,b,c,d,e,f] 轉換來源點 = sourceToScreen（含裁切、直式）', () => {
    for (const [w, h, vw, vh] of [
      [1280, 720, 1920, 1080],
      [960, 540, 1080, 1920],
      [640, 480, 1920, 1080],
    ]) {
      const m = coverMap(w, h, vw, vh);
      const [a, b, c, d, e, f] = mirrorTransform(m);
      for (const [u, v] of [
        [0, 0],
        [w, h],
        [123.4, 56.7],
        [w / 2, h / 3],
      ]) {
        const [sx, sy] = sourceToScreen(m, u, v);
        expect(a * u + c * v + e).toBeCloseTo(sx, 6);
        expect(b * u + d * v + f).toBeCloseTo(sy, 6);
      }
    }
  });

  it('可寫進重用的 out 陣列（每幀零配置）', () => {
    const out = [0, 0, 0, 0, 0, 0];
    const m = coverMap(1280, 720, 1920, 1080);
    expect(mirrorTransform(m, out)).toBe(out);
    expect(out[0]).toBeCloseTo(-1.5);
    expect(out[4]).toBeCloseTo(1920);
  });
});

describe('screenToMask', () => {
  it('依 mask 解析度按比例換算（含鏡像）', () => {
    const m = coverMap(960, 540, 1920, 1080);
    const out = [0, 0];
    screenToMask(m, 192, 108, 0, 0, out);
    expect(out[0]).toBeCloseTo(192);
    expect(out[1]).toBeCloseTo(0);
    screenToMask(m, 192, 108, 1920, 540, out);
    expect(out[0]).toBeCloseTo(0);
    expect(out[1]).toBeCloseTo(54);
  });
});
