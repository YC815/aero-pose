import { COLOR_SAVED, FONT_NUM, FONT_TEXT, drawWattsChart } from './chart';
import type { ResultView } from './result';

// 結果卡（1080×1350 PNG）與結果畫面共用的文案、繪圖工具。
//
// mask 約定：ImageData 第 0 列在上，「覆蓋」= 不透明（alpha ≥ 128）且夠亮（max(r,g,b) ≥ 128），
// 所以白底透明、白底黑都可以。mask（frontalArea）原樣就是鏡像方向（玩家本人的左邊在圖的左邊，
// 和相機畫面、3D 重播一致），直接畫，不要再翻。

const WIND = '#38bdf8';
const INK = '#e6f1ff';
const DIM = '#7f93b3';
const PLAYER_RGB: [number, number, number] = [56, 189, 248];

export const DISCLAIMER = '姿勢比較用，不是風洞量測';
export const EXPLAIN = '身體越低越窄，迎面要推開的空氣越少';

export interface ResultTexts {
  seconds: string; // "10"
  speedKmh: number; // 40
  saved: boolean; // 平均瓦數 ≥ 0
  wattsVerb: string; // "省" / "多花"
  wattsNum: string; // "37"（絕對值）
  pctBetter: boolean; // 平均面積比坐直小（四捨五入後的 % ≥ 0）；百分比的動詞和顏色都看它
  pctVerb: string; // "少" / "多"
  pct: string; // "18%"（絕對值）
}

export function resultTexts(v: ResultView): ResultTexts {
  const s = v.summary;
  const watts = Math.round(Number.isFinite(s.meanWatts) ? s.meanWatts : 0);
  const pct = Math.round(Number.isFinite(s.pct) ? s.pct : 0);
  return {
    seconds: String(Number((s.durationS > 0 ? s.durationS : 10).toFixed(1))),
    speedKmh: Math.round(v.speedKmh),
    saved: watts >= 0,
    wattsVerb: watts >= 0 ? '省' : '多花',
    wattsNum: String(Math.abs(watts)),
    pctBetter: pct >= 0,
    pctVerb: pct >= 0 ? '少' : '多',
    pct: `${Math.abs(pct)}%`,
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

/** 輪廓在 box 內的位置：等比縮放、水平置中、底部對齊。 */
export function silhouetteRect(box: Box, imgW: number, imgH: number): Box {
  const s = Math.min(box.w / imgW, box.h / imgH);
  const w = imgW * s;
  const h = imgH * s;
  return { x: box.x + (box.w - w) / 2, y: box.y + box.h - h, w, h };
}

/** 在 box 內原樣畫輪廓（img = 染色後的 mask，已是鏡像方向，不翻轉），帶藍色光暈。 */
export function drawSilhouette(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, box: Box): void {
  const r = silhouetteRect(box, img.width, img.height);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.shadowColor = 'rgba(56, 189, 248, 0.75)';
  ctx.shadowBlur = 36;
  ctx.globalAlpha = 0.92;
  ctx.drawImage(img, r.x, r.y, r.w, r.h);
  ctx.restore();
}

interface Run {
  text: string;
  weight: number;
  size: number;
  family: string;
  color: string;
  gap?: number; // 這段之前的間距（px，跟著縮放）
}

/** 依序畫一串文字片段；總寬超過 maxW 時整串等比縮小（瓦數破百、「多花」都不會爆版）。 */
function drawRuns(ctx: CanvasRenderingContext2D, x: number, y: number, runs: Run[], maxW: number): void {
  const font = (r: Run, k: number) => `${r.weight} ${Math.round(r.size * k)}px ${r.family}`;
  let total = 0;
  for (const r of runs) {
    ctx.font = font(r, 1);
    total += (r.gap ?? 0) + ctx.measureText(r.text).width;
  }
  const k = total > maxW ? maxW / total : 1;
  for (const r of runs) {
    x += (r.gap ?? 0) * k;
    ctx.font = font(r, k);
    ctx.fillStyle = r.color;
    ctx.fillText(r.text, x, y);
    x += ctx.measureText(r.text).width;
  }
}

function today(): string {
  const t = new Date();
  const mm = String(t.getMonth() + 1).padStart(2, '0');
  const dd = String(t.getDate()).padStart(2, '0');
  return `${t.getFullYear()}-${mm}-${dd}`;
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

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size = 30, color = DIM): void {
  ctx.font = `600 ${size}px ${FONT_TEXT}`;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/** 產生 1080×1350 結果卡，回傳 PNG base64（不含 data: 前綴）。 */
export async function renderResultCard(v: ResultView): Promise<string> {
  const W = 1080;
  const H = 1350;
  const PAD = 84;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('無法建立 2D canvas');
  await document.fonts?.ready;

  const t = resultTexts(v);
  const s = v.summary;
  drawBackground(ctx, W, H);
  ctx.textBaseline = 'alphabetic';

  // 標頭
  label(ctx, '公路車空氣力學實驗', PAD, 104, 30, WIND);
  ctx.font = `800 78px ${FONT_TEXT}`;
  ctx.fillStyle = INK;
  ctx.fillText('風阻姿勢大挑戰', PAD, 192);
  ctx.font = `500 30px ${FONT_NUM}`;
  ctx.fillStyle = DIM;
  ctx.textAlign = 'right';
  ctx.fillText(today(), W - PAD, 104);
  ctx.textAlign = 'left';

  // 數字：平均省 X 瓦（左）、比坐直平均少 X%（右）
  const RX = 650;
  const ny = 440;
  const wattsColor = t.saved ? COLOR_SAVED : INK;
  label(ctx, `${t.seconds} 秒平均 · 時速 ${t.speedKmh} km 估算`, PAD, 290);
  drawRuns(
    ctx,
    PAD,
    ny,
    [
      { text: t.wattsVerb, weight: 800, size: 76, family: FONT_TEXT, color: wattsColor },
      { text: t.wattsNum, weight: 800, size: 170, family: FONT_NUM, color: wattsColor, gap: 12 },
      { text: '瓦', weight: 700, size: 64, family: FONT_TEXT, color: DIM, gap: 10 },
    ],
    RX - PAD - 40,
  );
  label(ctx, '比坐直平均', RX, 290);
  drawRuns(
    ctx,
    RX,
    ny,
    [
      { text: t.pctVerb, weight: 800, size: 64, family: FONT_TEXT, color: INK },
      { text: t.pct, weight: 800, size: 128, family: FONT_NUM, color: t.pctBetter ? WIND : INK, gap: 10 },
    ],
    W - PAD - RX,
  );

  // 左：最趴低瞬間的輪廓
  const box: Box = { x: PAD, y: 560, w: 360, h: 460 };
  const halo = ctx.createRadialGradient(box.x + box.w / 2, box.y + box.h * 0.6, 30, box.x + box.w / 2, box.y + box.h * 0.6, box.w * 0.7);
  halo.addColorStop(0, 'rgba(56,189,248,0.12)');
  halo.addColorStop(1, 'rgba(56,189,248,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  drawSilhouette(ctx, tintMask(v.bestMask, PLAYER_RGB, 1), box);
  ctx.strokeStyle = 'rgba(125,211,252,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(box.x, box.y + box.h + 1);
  ctx.lineTo(box.x + box.w, box.y + box.h + 1);
  ctx.stroke();
  label(ctx, '最趴低的瞬間', PAD, box.y + box.h + 52, 28, INK);

  // 右：瓦數曲線，遊標標出最趴低的瞬間
  const cx = PAD + box.w + 48;
  const cw = W - PAD - cx;
  label(ctx, '每一刻省下的瓦數', cx, 540, 28, INK);
  ctx.save();
  ctx.translate(cx, 570);
  ctx.fillStyle = 'rgba(6, 15, 33, 0.6)';
  ctx.fillRect(0, 0, cw, 450);
  const best = s.samples[s.bestIndex];
  drawWattsChart(ctx, s.samples, { width: cw, height: 450, durationS: s.durationS, showAxis: true }, best?.t);
  ctx.restore();

  // 說明、免責
  ctx.font = `600 36px ${FONT_TEXT}`;
  ctx.fillStyle = 'rgba(230,241,255,0.9)';
  ctx.fillText(EXPLAIN, PAD, 1180);
  ctx.font = `400 24px ${FONT_TEXT}`;
  ctx.fillStyle = DIM;
  ctx.fillText(DISCLAIMER, PAD, H - 56);

  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
}
