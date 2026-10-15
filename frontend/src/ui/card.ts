import type { ResultView } from './result';

// 結果卡（1080×1350 PNG）與結果畫面共用的繪圖、文案工具。
//
// mask 約定：ImageData 第 0 列在上（正面看過去的影像方向），
// 「覆蓋」= 不透明（alpha ≥ 128）且夠亮（max(r,g,b) ≥ 128），
// 所以白底透明、白底黑都可以；兩張 mask 必須同一個比例尺（每像素同樣公尺數）。

export const FONT_TEXT = '"PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif';
export const FONT_NUM = '-apple-system, "SF Pro Display", "Helvetica Neue", "PingFang TC", sans-serif';

const WIND = '#38bdf8';
const HIGHLIGHT = '#facc15';
const INK = '#e6f1ff';
const DIM = '#7f93b3';
const PLAYER_RGB: [number, number, number] = [56, 189, 248];
const BASE_RGB: [number, number, number] = [148, 163, 184];

export const DISCLAIMER = '姿勢比較用，不是風洞量測';
export const EXPLAIN = '身體越低越窄，迎面要推開的空氣越少';

export interface ResultTexts {
  area: string; // "0.412"
  pctLabel: string; // "比坐直少" / "比坐直多"
  pct: string; // "18.3%"
  speedKmh: number;
  wattsVerb: string; // "省" / "多花"
  watts: string; // "37 瓦"
  saved: boolean;
}

export function resultTexts(d: ResultView): ResultTexts {
  const pct = Math.round(d.pct * 10) / 10;
  const saved = Math.round(d.watts) >= 0;
  return {
    area: d.areaM2.toFixed(3),
    pctLabel: pct >= 0 ? '比坐直少' : '比坐直多',
    pct: `${Math.abs(pct).toFixed(1)}%`,
    speedKmh: Math.round(d.speedKmh ?? 40),
    wattsVerb: saved ? '省' : '多花',
    watts: `${Math.abs(Math.round(d.watts))} 瓦`,
    saved,
  };
}

/** 把 mask 染成單色，回傳同尺寸 canvas（未覆蓋處透明）。 */
export function tintMask(mask: ImageData, rgb: [number, number, number], alpha: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, mask.width);
  c.height = Math.max(1, mask.height);
  const ctx = c.getContext('2d');
  if (!ctx || mask.width === 0 || mask.height === 0) return c;
  const out = ctx.createImageData(mask.width, mask.height);
  const src = mask.data;
  const dst = out.data;
  const a = Math.round(alpha * 255);
  for (let i = 0; i < src.length; i += 4) {
    const covered = src[i + 3] >= 128 && Math.max(src[i], src[i + 1], src[i + 2]) >= 128;
    if (!covered) continue;
    dst[i] = rgb[0];
    dst[i + 1] = rgb[1];
    dst[i + 2] = rgb[2];
    dst[i + 3] = a;
  }
  ctx.putImageData(out, 0, 0);
  return c;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 在 box 內畫兩個正面輪廓：坐直基準灰在下、玩家藍在上。
 * 兩者同一個縮放、水平置中、底部對齊（輪子都踩在同一條地面線）。
 */
export function drawSilhouettes(
  ctx: CanvasRenderingContext2D,
  d: Pick<ResultView, 'playerMask' | 'baselineMask'>,
  box: Box,
  glow = 28,
): void {
  const pm = d.playerMask;
  const bm = d.baselineMask;
  const srcW = Math.max(pm.width, bm.width, 1);
  const srcH = Math.max(pm.height, bm.height, 1);
  const s = Math.min(box.w / srcW, box.h / srcH);
  const bottom = box.y + box.h;
  const cx = box.x + box.w / 2;

  const place = (m: ImageData) => {
    const w = m.width * s;
    const h = m.height * s;
    return { x: cx - w / 2, y: bottom - h, w, h };
  };

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const b = place(bm);
  ctx.drawImage(tintMask(bm, BASE_RGB, 0.5), b.x, b.y, b.w, b.h);

  const p = place(pm);
  const player = tintMask(pm, PLAYER_RGB, 1);
  ctx.shadowColor = 'rgba(56, 189, 248, 0.75)';
  ctx.shadowBlur = glow;
  ctx.globalAlpha = 0.92;
  ctx.drawImage(player, p.x, p.y, p.w, p.h);
  ctx.restore();
}

function today(): string {
  const t = new Date();
  const mm = String(t.getMonth() + 1).padStart(2, '0');
  const dd = String(t.getDate()).padStart(2, '0');
  return `${t.getFullYear()}-${mm}-${dd}`;
}

/** 依序畫一串不同顏色、字型的文字片段，回傳結束的 x。 */
function drawRuns(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  runs: { text: string; font: string; color: string }[],
): number {
  for (const r of runs) {
    ctx.font = r.font;
    ctx.fillStyle = r.color;
    ctx.fillText(r.text, x, y);
    x += ctx.measureText(r.text).width;
  }
  return x;
}

/** 決定性的偽亂數，讓每張卡的背景風線一樣。 */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function drawBackground(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#071226');
  g.addColorStop(1, '#030812');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const rnd = seeded(27);
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    const y = rnd() * H;
    const x = rnd() * W * 1.2 - W * 0.1;
    const len = 80 + rnd() * 260;
    const lg = ctx.createLinearGradient(x, y, x + len, y);
    lg.addColorStop(0, 'rgba(56,189,248,0)');
    lg.addColorStop(1, `rgba(56,189,248,${(0.05 + rnd() * 0.12).toFixed(3)})`);
    ctx.strokeStyle = lg;
    ctx.lineWidth = 1 + rnd() * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y);
    ctx.stroke();
  }
  ctx.restore();
}

/** 產生 1080×1350 結果卡，回傳 PNG base64（不含 data: 前綴）。 */
export async function renderResultCard(d: ResultView): Promise<string> {
  const W = 1080;
  const H = 1350;
  const PAD = 84;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('無法建立 2D canvas');
  await document.fonts?.ready;

  const t = resultTexts(d);
  drawBackground(ctx, W, H);
  ctx.textBaseline = 'alphabetic';

  // 標頭
  ctx.font = `600 30px ${FONT_TEXT}`;
  ctx.fillStyle = WIND;
  ctx.fillText('公路車空氣力學實驗', PAD, 104);
  ctx.font = `800 78px ${FONT_TEXT}`;
  ctx.fillStyle = INK;
  ctx.fillText('風阻姿勢大挑戰', PAD, 192);
  ctx.font = `500 30px ${FONT_NUM}`;
  ctx.fillStyle = DIM;
  ctx.textAlign = 'right';
  ctx.fillText(today(), W - PAD, 104);
  ctx.textAlign = 'left';

  // 輪廓
  const box: Box = { x: PAD, y: 240, w: W - PAD * 2, h: 540 };
  const halo = ctx.createRadialGradient(W / 2, box.y + box.h * 0.6, 40, W / 2, box.y + box.h * 0.6, box.w * 0.6);
  halo.addColorStop(0, 'rgba(56,189,248,0.10)');
  halo.addColorStop(1, 'rgba(56,189,248,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  drawSilhouettes(ctx, d, box, 36);
  ctx.strokeStyle = 'rgba(125,211,252,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PAD, box.y + box.h + 1);
  ctx.lineTo(W - PAD, box.y + box.h + 1);
  ctx.stroke();

  // 圖例
  const ly = box.y + box.h + 52;
  ctx.font = `500 28px ${FONT_TEXT}`;
  ctx.fillStyle = WIND;
  ctx.fillRect(PAD, ly - 22, 26, 26);
  ctx.fillStyle = INK;
  ctx.fillText('你的姿勢', PAD + 40, ly);
  ctx.fillStyle = 'rgba(148,163,184,0.6)';
  ctx.fillRect(PAD + 210, ly - 22, 26, 26);
  ctx.fillStyle = INK;
  ctx.fillText('一般坐直騎', PAD + 250, ly);

  // 數字
  const ny = 1040;
  ctx.font = `600 32px ${FONT_TEXT}`;
  ctx.fillStyle = DIM;
  ctx.fillText('正面面積', PAD, ny - 140);
  const ax = drawRuns(ctx, PAD, ny, [{ text: t.area, font: `800 150px ${FONT_NUM}`, color: INK }]);
  drawRuns(ctx, ax + 12, ny, [{ text: 'm²', font: `600 56px ${FONT_NUM}`, color: DIM }]);

  const rx = 640;
  ctx.font = `600 32px ${FONT_TEXT}`;
  ctx.fillStyle = DIM;
  ctx.fillText(t.pctLabel, rx, ny - 140);
  drawRuns(ctx, rx, ny, [{ text: t.pct, font: `800 120px ${FONT_NUM}`, color: t.saved ? WIND : INK }]);

  drawRuns(ctx, PAD, ny + 100, [
    { text: `時速 ${t.speedKmh} km 約${t.wattsVerb} `, font: `600 44px ${FONT_TEXT}`, color: INK },
    { text: t.watts, font: `800 52px ${FONT_TEXT}`, color: t.saved ? HIGHLIGHT : INK },
    { text: '（估算）', font: `500 34px ${FONT_TEXT}`, color: DIM },
  ]);

  ctx.font = `500 34px ${FONT_TEXT}`;
  ctx.fillStyle = 'rgba(230,241,255,0.82)';
  ctx.fillText(EXPLAIN, PAD, ny + 178);

  ctx.font = `400 24px ${FONT_TEXT}`;
  ctx.fillStyle = DIM;
  ctx.fillText(DISCLAIMER, PAD, H - 56);

  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
}
