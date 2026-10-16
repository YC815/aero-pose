import type { SessionSample } from '../types';

// 瓦數曲線（Canvas2D）：結果頁、錄製 HUD 小曲線、結果卡共用。
// y = 這一刻比坐直省幾瓦（0 = 坐直騎，往上 = 省、往下 = 多花），x = 錄製開始後的秒數。
// 純繪圖，不碰 DOM（fitCanvas / paintChart 例外，只在瀏覽器用）。

export const FONT_TEXT = '"PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif';
export const FONT_NUM = '-apple-system, "SF Pro Display", "Helvetica Neue", "PingFang TC", sans-serif';

export const COLOR_SAVED = '#facc15'; // 省：螢光黃
export const COLOR_WORSE = '#f87171'; // 多花：紅
const COLOR_INK = '#e6f1ff';
const COLOR_DIM = '#8296b6';
const COLOR_GRID = 'rgba(125, 211, 252, 0.14)';
const COLOR_ZERO = 'rgba(230, 241, 255, 0.6)';

/** y 範圍至少上下各留這麼多瓦，避免全 0 或單點時範圍為零寬。 */
const MIN_PAD_W = 5;
const PAD_RATIO = 0.12;

export interface ChartOptions {
  width: number;
  height: number;
  durationS: number;
  showAxis: boolean;
}

/** 含 0 的 y 範圍（瓦），上下都留邊距，所以「坐直」那條 0 線永遠在圖內、不貼邊。 */
export function wattsRange(samples: readonly SessionSample[]): [number, number] {
  let lo = 0;
  let hi = 0;
  for (const s of samples) {
    if (!Number.isFinite(s.watts)) continue;
    lo = Math.min(lo, s.watts);
    hi = Math.max(hi, s.watts);
  }
  const pad = Math.max((hi - lo) * PAD_RATIO, MIN_PAD_W);
  return [lo - pad, hi + pad];
}

/** 時間 t 的瓦數（相鄰樣本線性內插，超出兩端夾住）；沒有樣本回傳 null。samples 須依 t 遞增。 */
export function wattsAt(samples: readonly SessionSample[], t: number): number | null {
  if (samples.length === 0) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!(t > first.t)) return first.watts; // 也吃掉 NaN
  if (t >= last.t) return last.watts;
  let i = 1;
  while (samples[i].t < t) i++;
  const a = samples[i - 1];
  const b = samples[i];
  const k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
  return a.watts + (b.watts - a.watts) * k;
}

/** 1、2、5 × 10ⁿ 裡第一個 ≥ raw 的刻度間距。 */
function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const base = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * base >= raw - 1e-9) return m * base;
  return 10 * base;
}

function fmt(v: number): string {
  return String(Number(v.toFixed(2)));
}

/** 只在矩形內畫（用來把 0 線上下分成「省」和「多花」兩種顏色）。 */
function clipped(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, draw: () => void): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  draw();
  ctx.restore();
}

/**
 * 在 (0,0)–(width,height) 畫瓦數曲線；不清畫布（呼叫端自己 clearRect 或先畫背景）。
 * 要畫在別的位置就先 ctx.translate。
 * - 0 線（坐直）一律畫；showAxis 時再畫刻度、秒數和「坐直」字樣。
 * - 0 線以上填黃（省），以下填紅（多花）。
 * - playheadT 有限時畫遊標直線；有樣本才畫遊標圓點。
 */
export function drawWattsChart(
  ctx: CanvasRenderingContext2D,
  samples: readonly SessionSample[],
  o: ChartOptions,
  playheadT?: number,
): void {
  const W = o.width;
  const H = o.height;
  const lw = Math.max(2, H * 0.014, W * 0.003); // 扁長的 HUD 小曲線也要夠粗，3 公尺外看得到
  const fs = Math.max(12, Math.round(Math.min(H * 0.075, W * 0.045)));
  const left = o.showAxis ? fs * 2.8 : lw * 2.5;
  const right = W - (o.showAxis ? fs * 1.8 : lw * 2.5);
  const top = o.showAxis ? fs * 0.9 : lw * 2.5;
  const bottom = H - (o.showAxis ? fs * 1.9 : lw * 2.5);

  const data = samples.filter((s) => Number.isFinite(s.t) && Number.isFinite(s.watts));
  const lastT = data.length > 0 ? data[data.length - 1].t : 0;
  const dur = Math.max(Number.isFinite(o.durationS) ? o.durationS : 0, lastT, 1e-3);
  const [lo, hi] = wattsRange(data);
  const X = (t: number) => left + (Math.min(Math.max(t, 0), dur) / dur) * (right - left);
  const Y = (w: number) => top + ((hi - w) / (hi - lo)) * (bottom - top);
  const y0 = Y(0);

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (o.showAxis) {
    ctx.font = `600 ${fs}px ${FONT_NUM}`;
    ctx.fillStyle = COLOR_DIM;
    ctx.strokeStyle = COLOR_GRID;
    ctx.lineWidth = 1;

    // y：橫格線 + 瓦數
    const ys = niceStep((hi - lo) / 4);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let k = Math.ceil(lo / ys); k * ys <= hi; k++) {
      const v = k * ys;
      const y = Y(v);
      if (v !== 0) {
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();
      }
      ctx.fillText(fmt(v), left - fs * 0.45, y);
    }

    // x：秒數
    const xs = niceStep(dur / 5);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let k = 0; k * xs <= dur + 1e-9; k++) {
      ctx.fillText(`${fmt(k * xs)} 秒`, X(k * xs), bottom + fs * 0.5);
    }
  }

  // 0 線 = 坐直騎
  ctx.save();
  ctx.strokeStyle = COLOR_ZERO;
  ctx.lineWidth = Math.max(1, lw * 0.6);
  ctx.setLineDash([lw * 3, lw * 2]);
  ctx.beginPath();
  ctx.moveTo(left, y0);
  ctx.lineTo(right, y0);
  ctx.stroke();
  ctx.restore();
  if (o.showAxis) {
    ctx.font = `700 ${fs}px ${FONT_TEXT}`;
    ctx.fillStyle = COLOR_ZERO;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('坐直', right, y0 - lw);
  }

  if (data.length > 0) {
    const trace = (close: boolean) => {
      ctx.beginPath();
      if (close) ctx.moveTo(X(data[0].t), y0);
      ctx.lineTo(X(data[0].t), Y(data[0].watts));
      for (const s of data) ctx.lineTo(X(s.t), Y(s.watts));
      if (close) {
        ctx.lineTo(X(lastT), y0);
        ctx.closePath();
      }
    };
    const halves: [number, number, string, string][] = [
      [0, y0, COLOR_SAVED, 'rgba(250, 204, 21, 0.24)'],
      [y0, H - y0, COLOR_WORSE, 'rgba(248, 113, 113, 0.26)'],
    ];
    for (const [y, h, line, area] of halves) {
      clipped(ctx, 0, y, W, h, () => {
        trace(true);
        ctx.fillStyle = area;
        ctx.fill();
        trace(false);
        ctx.strokeStyle = line;
        ctx.lineWidth = lw;
        ctx.stroke();
      });
    }
  }

  if (playheadT !== undefined && Number.isFinite(playheadT)) {
    const x = X(playheadT);
    ctx.strokeStyle = 'rgba(230, 241, 255, 0.85)';
    ctx.lineWidth = Math.max(1, lw * 0.7);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    const w = wattsAt(data, playheadT);
    if (w !== null) {
      ctx.beginPath();
      ctx.arc(x, Y(w), lw * 2.4, 0, Math.PI * 2);
      ctx.fillStyle = w >= 0 ? COLOR_SAVED : COLOR_WORSE;
      ctx.fill();
      ctx.strokeStyle = COLOR_INK;
      ctx.lineWidth = Math.max(1, lw * 0.6);
      ctx.stroke();
    }
  }

  ctx.restore();
}

/** 讓 canvas 的像素尺寸跟上它的 CSS 尺寸（× devicePixelRatio，上限 2）。尺寸為 0（未排版）時保持原樣。 */
export function fitCanvas(c: HTMLCanvasElement): { width: number; height: number } {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(c.clientWidth * dpr);
  const h = Math.round(c.clientHeight * dpr);
  if (w > 0 && h > 0 && (c.width !== w || c.height !== h)) {
    c.width = w;
    c.height = h;
  }
  return { width: c.width, height: c.height };
}

/** 對齊尺寸、清空、重畫。HUD 和結果頁用。 */
export function paintChart(
  c: HTMLCanvasElement,
  samples: readonly SessionSample[],
  durationS: number,
  showAxis: boolean,
  playheadT?: number,
): void {
  const ctx = c.getContext('2d');
  if (!ctx) return;
  const { width, height } = fitCanvas(c);
  ctx.clearRect(0, 0, width, height);
  drawWattsChart(ctx, samples, { width, height, durationS, showAxis }, playheadT);
}
