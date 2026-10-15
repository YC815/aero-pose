// 正面投影面積：把世界座標三角形正交投影到 x-y 平面（忽略 z），在格子上以格中心判斷覆蓋。
// 純函式，不依賴 WebGL（maskToImageData 例外，只在瀏覽器用）。

export interface AreaResult {
  areaM2: number;
  mask: Uint8Array; // width*height，1 = 覆蓋；row 0 = 最大 y（上方），column 0 = 最小 x
  width: number;
  height: number;
  minX: number; // 左上角格子的世界座標邊界
  maxY: number;
  cell: number;
}

const DEFAULT_CELL = 0.004;

export function frontalArea(tris: Float32Array, cell: number = DEFAULT_CELL): AreaResult {
  const n = Math.floor(tris.length / 9);
  let bx0 = Infinity;
  let by0 = Infinity;
  let bx1 = -Infinity;
  let by1 = -Infinity;
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) {
      const x = tris[t * 9 + k * 3];
      const y = tris[t * 9 + k * 3 + 1];
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (y < by0) by0 = y;
      if (y > by1) by1 = y;
    }
  }
  if (!(bx1 >= bx0 && by1 >= by0) || !Number.isFinite(bx1 - bx0 + by1 - by0)) {
    return { areaM2: 0, mask: new Uint8Array(0), width: 0, height: 0, minX: 0, maxY: 0, cell };
  }

  // 外擴 1 格
  const minX = bx0 - cell;
  const maxY = by1 + cell;
  const width = Math.ceil((bx1 + cell - minX) / cell);
  const height = Math.ceil((maxY - (by0 - cell)) / cell);
  const mask = new Uint8Array(width * height);

  for (let t = 0; t < n; t++) {
    rasterTriangle(tris, t * 9, mask, width, height, minX, maxY, cell);
  }

  let covered = 0;
  for (let i = 0; i < mask.length; i++) covered += mask[i];
  return { areaM2: covered * cell * cell, mask, width, height, minX, maxY, cell };
}

function rasterTriangle(
  tris: Float32Array,
  o: number,
  mask: Uint8Array,
  width: number,
  height: number,
  minX: number,
  maxY: number,
  cell: number,
): void {
  const x0 = tris[o];
  const y0 = tris[o + 1];
  const x1 = tris[o + 3];
  const y1 = tris[o + 4];
  const x2 = tris[o + 6];
  const y2 = tris[o + 7];
  const area2 = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (!(Math.abs(area2) > 1e-12)) return; // 退化（或 NaN）跳過
  const s = area2 > 0 ? 1 : -1; // 統一方向，不分正反面

  // 格中心 x = minX + (i + 0.5)·cell，y = maxY − (j + 0.5)·cell
  const i0 = Math.max(0, Math.ceil((Math.min(x0, x1, x2) - minX) / cell - 0.5));
  const i1 = Math.min(width - 1, Math.floor((Math.max(x0, x1, x2) - minX) / cell - 0.5));
  const j0 = Math.max(0, Math.ceil((maxY - Math.max(y0, y1, y2)) / cell - 0.5));
  const j1 = Math.min(height - 1, Math.floor((maxY - Math.min(y0, y1, y2)) / cell - 0.5));

  for (let j = j0; j <= j1; j++) {
    const py = maxY - (j + 0.5) * cell;
    const row = j * width;
    for (let i = i0; i <= i1; i++) {
      const px = minX + (i + 0.5) * cell;
      const w0 = s * ((x1 - x0) * (py - y0) - (y1 - y0) * (px - x0));
      const w1 = s * ((x2 - x1) * (py - y1) - (y2 - y1) * (px - x1));
      const w2 = s * ((x0 - x2) * (py - y2) - (y0 - y2) * (px - x2));
      if (w0 >= 0 && w1 >= 0 && w2 >= 0) mask[row + i] = 1;
    }
  }
}

/** mask → ImageData（覆蓋格塗 rgba，其餘透明）。只在瀏覽器用。 */
export function maskToImageData(r: AreaResult, rgba: [number, number, number, number]): ImageData {
  const w = Math.max(1, r.width);
  const h = Math.max(1, r.height);
  const img = new ImageData(w, h);
  const d = img.data;
  for (let k = 0; k < r.mask.length; k++) {
    if (!r.mask[k]) continue;
    d[k * 4] = rgba[0];
    d[k * 4 + 1] = rgba[1];
    d[k * 4 + 2] = rgba[2];
    d[k * 4 + 3] = rgba[3];
  }
  return img;
}
