import { maskToImageData, type AreaResult } from '../area';
import { lerpPose } from '../retarget';
import type { RiderPose, Settings } from '../types';
import { wattsSaved } from '../watts';

// 待機輪播：沒人站上來時循環播玩法與目的。時間由呼叫端傳入（秒），動畫只在換張時重啟，
// 第 1 張的騎士輪廓是事先量好的逐格 mask（坐直 → 趴低），數字和計分用的是同一個量測騎士。

export const SLIDE_S = 5;
export const SLIDES = 4;
/** 第 1 張：坐直停 MORPH_START_S 秒，花 MORPH_S 秒趴低，之後停在趴低。 */
export const MORPH_START_S = 0.8;
export const MORPH_S = 2.2;
/** 坐直 → 趴低的格數（含頭尾）。 */
export const DEMO_FRAMES = 10;

/** 開始播放後 elapsed 秒：第幾張、這張播了幾秒。 */
export function slideAt(elapsed: number): { index: number; local: number } {
  const e = Math.max(0, elapsed);
  return { index: Math.floor(e / SLIDE_S) % SLIDES, local: e % SLIDE_S };
}

/** 第 1 張播到 local 秒時該顯示第幾格（0 = 坐直、frames − 1 = 趴低），中間用 smoothstep。 */
export function morphFrame(local: number, frames: number): number {
  const t = Math.min(1, Math.max(0, (local - MORPH_START_S) / MORPH_S));
  return Math.round(t * t * (3 - 2 * t) * (frames - 1));
}

/** from → to 量 n 格（n ≥ 2）。measure 每次都要回傳新的 AreaResult。 */
export function demoFrames(measure: (p: RiderPose) => AreaResult, from: RiderPose, to: RiderPose, n = DEMO_FRAMES): AreaResult[] {
  return Array.from({ length: n }, (_, i) => measure(lerpPose(from, to, i / (n - 1))));
}

/** 所有格子共用的畫布範圍（以格為單位）：每格依自己的 minX / maxY 貼上去，輪廓才不會亂跳。 */
export function unionRect(frames: readonly AreaResult[]): { minX: number; maxY: number; w: number; h: number; cell: number } {
  const cell = frames[0]?.cell ?? 1;
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let minY = Infinity;
  for (const f of frames) {
    if (f.width === 0) continue;
    minX = Math.min(minX, f.minX);
    maxX = Math.max(maxX, f.minX + f.width * cell);
    maxY = Math.max(maxY, f.maxY);
    minY = Math.min(minY, f.maxY - f.height * cell);
  }
  if (!Number.isFinite(minX)) return { minX: 0, maxY: 0, w: 1, h: 1, cell };
  return { minX, maxY, w: Math.round((maxX - minX) / cell), h: Math.round((maxY - minY) / cell), cell };
}

const RED: [number, number, number, number] = [248, 113, 113, 255];
const GHOST: [number, number, number, number] = [230, 241, 255, 255];

const SLIDE_HTML = [
  `<div class="ap-tour__art"><canvas class="ap-tour__morph"></canvas></div>
   <div class="ap-tour__text">
     <p class="ap-tour__kicker">為什麼要趴低？</p>
     <p class="ap-tour__title">騎車最大的阻力是風</p>
     <p class="ap-tour__cap">身體縮越小，迎風面積越小<br>
       <span class="ap-tour__nums">面積 <b data-k="area">—</b> m²・省 <b data-k="watts">0</b> 瓦</span></p>
   </div>`,
  `<div class="ap-tour__art">
     <svg class="ap-tour__svg ap-tour__raise" viewBox="0 0 100 100" aria-hidden="true">
       <circle class="ring-track" cx="50" cy="48" r="44" />
       <circle class="ring-bar" cx="50" cy="48" r="44" pathLength="100" />
       <rect class="tape" x="28" y="86" width="44" height="3.5" rx="1.5" />
       <circle class="fig-fill" cx="50" cy="22" r="6" />
       <path class="fig" d="M50 30v26M50 56l-8 28M50 56l8 28" />
       <path class="fig arm-l" d="M50 33v22" />
       <path class="fig arm-r" d="M50 33v22" />
     </svg>
   </div>
   <div class="ap-tour__text">
     <p class="ap-tour__kicker">怎麼開始</p>
     <p class="ap-tour__title">站上膠帶，雙手舉高</p>
     <p class="ap-tour__cap">停住 <b data-k="hold">1</b> 秒，倒數就開始</p>
   </div>`,
  `<div class="ap-tour__art">
     <svg class="ap-tour__svg ap-tour__lean" viewBox="0 0 100 100" aria-hidden="true">
       <path class="wind w1" d="M96 34h-22" />
       <path class="wind w2" d="M96 48h-16" />
       <path class="wind w3" d="M96 24h-14" />
       <path class="fig" d="M40 60l4 26M40 60l-4 26" />
       <g class="upper">
         <circle class="fig-fill" cx="40" cy="25" r="6" />
         <path class="fig" d="M40 33v27M40 37l14 14" />
       </g>
       <rect class="bar-track" x="14" y="92" width="72" height="3" rx="1.5" />
       <rect class="bar" x="14" y="92" width="72" height="3" rx="1.5" />
     </svg>
   </div>
   <div class="ap-tour__text">
     <p class="ap-tour__kicker">錄 <b data-k="record">10</b> 秒</p>
     <p class="ap-tour__title">倒數後趴低，撐住</p>
     <p class="ap-tour__cap">風打到你的地方會變紅<br>紅色越少，越省力</p>
   </div>`,
  `<div class="ap-tour__art">
     <svg class="ap-tour__svg ap-tour__podium" viewBox="0 0 100 100" aria-hidden="true">
       <rect class="p2" x="14" y="56" width="22" height="30" rx="2" />
       <rect class="p1" x="39" y="42" width="22" height="44" rx="2" />
       <rect class="p3" x="64" y="64" width="22" height="22" rx="2" />
       <path class="star" d="M50 14l4.1 8.3 9.1 1.3-6.6 6.4 1.6 9.1L50 34.8l-8.2 4.3 1.6-9.1-6.6-6.4 9.1-1.3z" />
     </svg>
   </div>
   <div class="ap-tour__text">
     <p class="ap-tour__kicker">看成績</p>
     <p class="ap-tour__title">算你省了幾瓦</p>
     <p class="ap-tour__cap">上今日排行榜<br>掃 QR 帶走成績卡</p>
   </div>`,
];

interface Demo {
  frames: AreaResult[];
  red: HTMLCanvasElement[];
  ghost: HTMLCanvasElement;
  rect: ReturnType<typeof unionRect>;
}

function toCanvas(r: AreaResult, rgba: [number, number, number, number]): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, r.width);
  c.height = Math.max(1, r.height);
  c.getContext('2d')?.putImageData(maskToImageData(r, rgba), 0, 0);
  return c;
}

export class Tour {
  readonly el: HTMLElement;
  private readonly slides: HTMLElement[];
  private readonly dots: HTMLElement[];
  private readonly morph: HTMLCanvasElement;
  private readonly fields: Record<string, HTMLElement>;
  private readonly getSettings: () => Settings;
  private demo: Demo | null = null;
  private t0: number | null = null;
  private shown = -1;
  private shownFrame = -1;

  constructor(container: HTMLElement, getSettings: () => Settings) {
    this.getSettings = getSettings;
    this.el = document.createElement('div');
    this.el.className = 'ap-tour';
    this.el.innerHTML =
      SLIDE_HTML.map((h) => `<div class="ap-tour__slide">${h}</div>`).join('') +
      `<div class="ap-tour__dots">${'<span class="ap-tour__dot"><i></i></span>'.repeat(SLIDES)}</div>`;
    this.el.style.setProperty('--ap-slide-s', `${SLIDE_S}s`);
    this.slides = [...this.el.querySelectorAll<HTMLElement>('.ap-tour__slide')];
    this.dots = [...this.el.querySelectorAll<HTMLElement>('.ap-tour__dot')];
    this.morph = this.el.querySelector('.ap-tour__morph') as HTMLCanvasElement;
    this.fields = {};
    for (const b of this.el.querySelectorAll<HTMLElement>('[data-k]')) this.fields[b.dataset.k!] = b;
    container.appendChild(this.el);
  }

  /** frames[0] = 坐直（基準）… frames[n − 1] = 趴低。 */
  setDemo(frames: AreaResult[]): void {
    if (frames.length < 2) return;
    const rect = unionRect(frames);
    this.morph.width = rect.w;
    this.morph.height = rect.h;
    this.demo = { frames, red: frames.map((f) => toCanvas(f, RED)), ghost: toCanvas(frames[0], GHOST), rect };
    this.shownFrame = -1;
  }

  /** 下一次 tick 從第 1 張重新開始（新路人先看到目的）。 */
  restart(): void {
    this.t0 = null;
  }

  tick(now: number): void {
    this.t0 ??= now;
    const { index, local } = slideAt(now - this.t0);
    if (index !== this.shown) this.showSlide(index);
    if (index === 0) this.drawMorph(local);
  }

  private showSlide(index: number): void {
    this.shown = index;
    this.slides.forEach((s, i) => s.classList.toggle('is-active', i === index));
    this.dots.forEach((d, i) => {
      d.classList.toggle('is-done', i < index);
      d.classList.toggle('is-active', i === index);
    });
    const s = this.getSettings();
    this.setText('hold', String(s.start_hold_s));
    this.setText('record', String(s.record_s));
    this.shownFrame = -1;
  }

  private setText(k: string, v: string): void {
    const el = this.fields[k];
    if (el && el.textContent !== v) el.textContent = v;
  }

  private drawMorph(local: number): void {
    const d = this.demo;
    if (!d) return;
    const i = morphFrame(local, d.frames.length);
    if (i === this.shownFrame) return;
    this.shownFrame = i;
    const ctx = this.morph.getContext('2d');
    if (!ctx) return;
    const { rect } = d;
    const at = (f: AreaResult): [number, number] => [
      Math.round((f.minX - rect.minX) / rect.cell),
      Math.round((rect.maxY - f.maxY) / rect.cell),
    ];
    ctx.clearRect(0, 0, rect.w, rect.h);
    ctx.globalAlpha = 0.22; // 坐直的輪廓當底，看得出縮了多少
    ctx.drawImage(d.ghost, ...at(d.frames[0]));
    ctx.globalAlpha = 0.9;
    ctx.drawImage(d.red[i], ...at(d.frames[i]));
    ctx.globalAlpha = 1;

    const base = d.frames[0].areaM2;
    const area = d.frames[i].areaM2;
    this.setText('area', area.toFixed(2));
    this.setText('watts', String(Math.max(0, Math.round(wattsSaved(base, area, this.getSettings())))));
  }
}
