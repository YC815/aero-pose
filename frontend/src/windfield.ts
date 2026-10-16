import { type CameraView, type CoverMap, type MaskFrame, mirrorTransform, screenToMask, sourceToScreenInto } from './camera';

// 3D 透視風流＋紅色迎風面（v1.1，取代 v1 的 wind.ts）。
//
// 風帶活在一個簡單的透視空間：粒子有 (x, y, z)，
//   螢幕位置 = 消失點 + (x, y) · vh / z
// z 從觀眾這側 Z_NEAR（大、快）往畫面深處走，z = 1 是「玩家平面」：在這裡 (x, y) 就是以 vh 為單位的螢幕偏移。
// 粒子穿過玩家平面時，把落點換成 mask 座標：打到身體就累積熱度並濺開，沒打到就繼續往深處流走、淡出。
// 紅色層 = 熱度 × 目前的 mask，所以紅色面積就是玩家的迎風面，蹲低時跟著縮小。

// ---------- 風帶 ----------
const DEFAULT_COUNT = 420;
const Z_NEAR = 0.14;
const Z_PLANE = 1;
const Z_FAR = 2.4;
const Z_TAIL_MIN = 0.06;
/** 生成時的 z 抖動，避免粒子成批出現。 */
const Z_SPAWN_JITTER = 0.05;
/** z 方向速度（每秒）；從 Z_NEAR 到玩家平面約 0.45 s。 */
const SPEED = 1.9;
const SPEED_JITTER = 0.2;
const LEN_MIN = 0.05;
const LEN_MAX = 0.11;
/** 消失點的垂直位置（佔 vh 的比例），略高於中央，像平視。 */
const VP_Y = 0.45;
/** 玩家平面上的生成範圍（以 vh 為單位的半寬／半高，x 會再乘上寬高比）。 */
const SPREAD_X = 0.6;
const SPREAD_Y = 0.62;
/** 有身體時，這個比例的風帶瞄準身體包圍盒，紅色層才夠飽滿。 */
const AIM = 0.6;
/** 包圍盒往外擴的比例，讓邊緣也有風擦過。 */
const AIM_PAD = 0.12;

// ---------- 濺射 ----------
const SPLASH_LIFE_MIN = 0.28;
const SPLASH_LIFE_MAX = 0.45;
/** 濺射初速（vh / s）。 */
const SPLASH_SPEED_MIN = 0.35;
const SPLASH_SPEED_MAX = 0.8;
const SPLASH_DRAG = 5;
/** 兩片濺射相對徑向的張角（rad）。 */
const SPLASH_SPREAD_MIN = 0.5;
const SPLASH_SPREAD_MAX = 1.15;
const SPLASH_TRAIL_S = 0.07;

// ---------- 熱度 ----------
/** 每秒衰減到約 13%（半衰期約 0.33 s）。 */
const HEAT_KEEP_PER_S = 0.13;
const HEAT_SIGMA = 3.5;
const HEAT_RADIUS = 8;
/** 每次命中在中心點加的熱度。 */
const DEPOSIT = 1;
/** 顯示強度 = 1 − exp(−熱度 / HEAT_SCALE)：飽和曲線讓身體大致是實心紅、又保有流動感。
 * 依 420 條、瞄準 60% 的模擬，站姿身體內熱度 p10≈0.6、p50≈1.3 → 強度約 0.5～0.8。 */
const HEAT_SCALE = 0.8;
/** mask 外的熱度（例如剛移開的位置）只留這麼多，讓紅色貼著目前的身體。 */
const HEAT_OUTSIDE = 0.25;
/** 紅色最大不透明度：明顯，但看得到底下的人。 */
const HEAT_ALPHA = 0.62;
/** 紅色層再用加法疊一次的強度，讓它在 3 m 外也會發光。 */
const HEAT_GLOW = 0.3;

// ---------- 繪製 ----------
const FADE_S = 0.5;
const MAX_DT = 0.1;
/** 風帶頭部半寬（vh 單位，在 z = 1 時），近處依 1/z 放大，再以 WIDTH_MAX 封頂。 */
const WIDTH_PLANE = 0.0017;
const WIDTH_MAX = 0.012;
const TAIL_WIDTH = 0.25;
const SPLASH_WIDTH = 0.0045;
const BUCKETS = 6;
const GLOW_COLOR = '#38bdf8';
const GLOW_WIDTH = 2.8;
const GLOW_ALPHA = 0.3;
const CORE_COLOR = '#bae6fd';
const CORE_WIDTH = 0.85;
const CORE_ALPHA = 0.9;
const MAX_DPR = 1.5;

const FLOW = 0;
const SPLASH = 1;

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** mask 命中判定：(u, v) 是 mask 座標（可為小數）；越界或 NaN 回 false。 */
export function hitMask(mask: Uint8Array, w: number, h: number, u: number, v: number): boolean {
  if (!(u >= 0 && u < w && v >= 0 && v < h)) return false;
  return mask[Math.floor(v) * w + Math.floor(u)] > 0;
}

/** 身體像素的包圍盒 [x0, y0, x1, y1)（mask 座標），寫進 out；沒有身體回 false。 */
export function maskBounds(mask: Uint8Array, w: number, h: number, out: number[]): boolean {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (mask[row + x] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  if (x1 < 0) return false;
  out[0] = x0;
  out[1] = y0;
  out[2] = x1 + 1;
  out[3] = y1 + 1;
  return true;
}

/** 高斯核（中心 = 1），所有 HeatField 共用。 */
const KERNEL = (() => {
  const n = HEAT_RADIUS * 2 + 1;
  const k = new Float32Array(n * n);
  for (let dy = -HEAT_RADIUS; dy <= HEAT_RADIUS; dy++)
    for (let dx = -HEAT_RADIUS; dx <= HEAT_RADIUS; dx++)
      k[(dy + HEAT_RADIUS) * n + dx + HEAT_RADIUS] = Math.exp(-(dx * dx + dy * dy) / (2 * HEAT_SIGMA * HEAT_SIGMA));
  return k;
})();

/** 與 mask 同解析度的熱度圖（原始方向）。 */
export class HeatField {
  private buf: Float32Array;
  private width: number;
  private height: number;

  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
    this.buf = new Float32Array(w * h);
  }

  get data(): Float32Array {
    return this.buf;
  }
  get w(): number {
    return this.width;
  }
  get h(): number {
    return this.height;
  }

  /** 在 mask 座標 (u, v) 以高斯核累積熱度（中心加 amount），超出邊界的部分丟掉。 */
  deposit(u: number, v: number, amount: number): void {
    const cx = Math.floor(u);
    const cy = Math.floor(v);
    const w = this.width;
    const h = this.height;
    const r = HEAT_RADIUS;
    if (!(cx >= -r && cx < w + r && cy >= -r && cy < h + r)) return;
    const n = r * 2 + 1;
    const x0 = Math.max(0, cx - r);
    const x1 = Math.min(w - 1, cx + r);
    const y0 = Math.max(0, cy - r);
    const y1 = Math.min(h - 1, cy + r);
    const buf = this.buf;
    for (let y = y0; y <= y1; y++) {
      const krow = (y - cy + r) * n - cx + r;
      const row = y * w;
      for (let x = x0; x <= x1; x++) buf[row + x] += amount * KERNEL[krow + x];
    }
  }

  decay(dt: number): void {
    const k = Math.pow(HEAT_KEEP_PER_S, dt);
    const buf = this.buf;
    for (let i = 0; i < buf.length; i++) buf[i] *= k;
  }

  /** 尺寸改變時重建；同尺寸就清空。 */
  resize(w: number, h: number): void {
    if (w === this.width && h === this.height) {
      this.buf.fill(0);
      return;
    }
    this.width = w;
    this.height = h;
    this.buf = new Float32Array(w * h);
  }
}

/** WindSim 每幀需要的外部狀態；WindField 重用同一個物件，不每幀配置。 */
export interface WindEnv {
  vw: number;
  vh: number;
  map: CoverMap | null;
  mask: MaskFrame | null;
}

/** 風帶粒子＋命中＋熱度（純邏輯，不碰 DOM，可測）。 */
export class WindSim {
  readonly count: number;
  readonly heat = new HeatField(192, 108);

  // 風帶：玩家平面上的落點 (x, y)（vh 單位）、深度 z
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly speed: Float32Array;
  readonly len: Float32Array;
  readonly bright: Float32Array;
  readonly state: Uint8Array;
  /** 已經流過玩家平面、而且頭部在身體後面：這幀不畫（被身體擋住）。 */
  readonly hidden: Uint8Array;
  // 濺射（螢幕 CSS 像素）
  readonly sx: Float32Array;
  readonly sy: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  readonly spreadCos: Float32Array;
  readonly spreadSin: Float32Array;

  private readonly rng: () => number;
  private aspect = 16 / 9;
  private needsReset = true;
  // 瞄準用的身體包圍盒（玩家平面座標）
  private aimValid = false;
  private aimX0 = 0;
  private aimY0 = 0;
  private aimX1 = 0;
  private aimY1 = 0;
  private aimMask: MaskFrame | null = null;
  private aimMap: CoverMap | null = null;
  private aimVw = 0;
  private aimVh = 0;
  private readonly tmp = [0, 0];
  private readonly box = [0, 0, 0, 0];

  constructor(count = DEFAULT_COUNT, rng: () => number = Math.random) {
    this.count = count;
    this.rng = rng;
    this.x = new Float32Array(count);
    this.y = new Float32Array(count);
    this.z = new Float32Array(count);
    this.speed = new Float32Array(count);
    this.len = new Float32Array(count);
    this.bright = new Float32Array(count);
    this.state = new Uint8Array(count);
    this.hidden = new Uint8Array(count);
    this.sx = new Float32Array(count);
    this.sy = new Float32Array(count);
    this.vx = new Float32Array(count);
    this.vy = new Float32Array(count);
    this.age = new Float32Array(count);
    this.life = new Float32Array(count);
    this.spreadCos = new Float32Array(count);
    this.spreadSin = new Float32Array(count);
  }

  /** 下一次 step 時把粒子灑滿整段深度、清空熱度（重新啟動時用，畫面不會從空的開始）。 */
  reset(): void {
    this.needsReset = true;
  }

  splashCount(): number {
    let n = 0;
    for (let i = 0; i < this.count; i++) if (this.state[i] === SPLASH) n++;
    return n;
  }

  step(dt: number, env: WindEnv): void {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    dt = Math.min(MAX_DT, dt);
    const { vw, vh, map, mask } = env;
    this.aspect = vw / vh;
    const heat = this.heat;
    if (mask && (mask.w !== heat.w || mask.h !== heat.h)) heat.resize(mask.w, mask.h);
    if (this.needsReset) {
      this.needsReset = false;
      heat.resize(heat.w, heat.h);
      for (let i = 0; i < this.count; i++) this.respawn(i, Z_NEAR + this.rng() * (Z_FAR - Z_NEAR));
    }
    heat.decay(dt);
    this.updateAim(env);

    const cx = vw / 2;
    const cy = vh * VP_Y;
    const tmp = this.tmp;
    const drag = Math.exp(-SPLASH_DRAG * dt);
    for (let i = 0; i < this.count; i++) {
      if (this.state[i] === SPLASH) {
        const a = this.age[i] + dt;
        if (a >= this.life[i]) {
          this.respawn(i, Z_NEAR + this.rng() * Z_SPAWN_JITTER);
          continue;
        }
        this.age[i] = a;
        this.sx[i] += this.vx[i] * dt;
        this.sy[i] += this.vy[i] * dt;
        this.vx[i] *= drag;
        this.vy[i] *= drag;
        continue;
      }

      const z0 = this.z[i];
      const z1 = z0 + this.speed[i] * dt;
      if (z0 < Z_PLANE && z1 >= Z_PLANE && mask && map) {
        const px = cx + this.x[i] * vh;
        const py = cy + this.y[i] * vh;
        screenToMask(map, mask.w, mask.h, px, py, tmp);
        if (hitMask(mask.data, mask.w, mask.h, tmp[0], tmp[1])) {
          heat.deposit(tmp[0], tmp[1], DEPOSIT);
          this.startSplash(i, px, py, cx, cy, vh);
          continue;
        }
      }
      if (z1 >= Z_FAR) {
        this.respawn(i, Z_NEAR + this.rng() * Z_SPAWN_JITTER);
        continue;
      }
      this.z[i] = z1;
      let hide = 0;
      if (z1 > Z_PLANE && mask && map) {
        screenToMask(map, mask.w, mask.h, cx + (this.x[i] * vh) / z1, cy + (this.y[i] * vh) / z1, tmp);
        if (hitMask(mask.data, mask.w, mask.h, tmp[0], tmp[1])) hide = 1;
      }
      this.hidden[i] = hide;
    }
  }

  private respawn(i: number, z: number): void {
    const r = this.rng;
    this.state[i] = FLOW;
    this.hidden[i] = 0;
    this.z[i] = z;
    this.speed[i] = SPEED * (1 - SPEED_JITTER + 2 * SPEED_JITTER * r());
    this.len[i] = LEN_MIN + (LEN_MAX - LEN_MIN) * r();
    this.bright[i] = 0.55 + 0.45 * r();
    if (this.aimValid && r() < AIM) {
      this.x[i] = this.aimX0 + (this.aimX1 - this.aimX0) * r();
      this.y[i] = this.aimY0 + (this.aimY1 - this.aimY0) * r();
    } else {
      const sx = SPREAD_X * this.aspect;
      this.x[i] = (2 * r() - 1) * sx;
      this.y[i] = (2 * r() - 1) * SPREAD_Y;
    }
  }

  private startSplash(i: number, px: number, py: number, cx: number, cy: number, vh: number): void {
    const r = this.rng;
    this.state[i] = SPLASH;
    this.hidden[i] = 0;
    this.sx[i] = px;
    this.sy[i] = py;
    this.age[i] = 0;
    this.life[i] = SPLASH_LIFE_MIN + (SPLASH_LIFE_MAX - SPLASH_LIFE_MIN) * r();
    // 沿著「離開消失點」的方向在身體表面散開；正好打在消失點上就隨機方向
    const dx = px - cx;
    const dy = py - cy;
    const d = Math.hypot(dx, dy);
    let ux: number;
    let uy: number;
    if (d > 1) {
      ux = dx / d;
      uy = dy / d;
    } else {
      const a = r() * Math.PI * 2;
      ux = Math.cos(a);
      uy = Math.sin(a);
    }
    const spd = (SPLASH_SPEED_MIN + (SPLASH_SPEED_MAX - SPLASH_SPEED_MIN) * r()) * vh;
    this.vx[i] = ux * spd;
    this.vy[i] = uy * spd;
    const spread = SPLASH_SPREAD_MIN + (SPLASH_SPREAD_MAX - SPLASH_SPREAD_MIN) * r();
    this.spreadCos[i] = Math.cos(spread);
    this.spreadSin[i] = Math.sin(spread);
  }

  /** mask、映射或視窗變了才重算瞄準用的包圍盒（mask 每秒最多 20 次）。 */
  private updateAim(env: WindEnv): void {
    const { vw, vh, map, mask } = env;
    if (mask === this.aimMask && map === this.aimMap && vw === this.aimVw && vh === this.aimVh) return;
    this.aimMask = mask;
    this.aimMap = map;
    this.aimVw = vw;
    this.aimVh = vh;
    this.aimValid = false;
    if (!mask || !map) return;
    const box = this.box;
    if (!maskBounds(mask.data, mask.w, mask.h, box)) return;
    const ku = map.srcW / mask.w;
    const kv = map.srcH / mask.h;
    const cx = vw / 2;
    const cy = vh * VP_Y;
    const tmp = this.tmp;
    sourceToScreenInto(map, box[0] * ku, box[1] * kv, tmp);
    const ax = tmp[0];
    const ay = tmp[1];
    sourceToScreenInto(map, box[2] * ku, box[3] * kv, tmp);
    // 鏡像後左右對調，取 min / max
    const x0 = (Math.min(ax, tmp[0]) - cx) / vh;
    const x1 = (Math.max(ax, tmp[0]) - cx) / vh;
    const y0 = (Math.min(ay, tmp[1]) - cy) / vh;
    const y1 = (Math.max(ay, tmp[1]) - cy) / vh;
    const px = (x1 - x0) * AIM_PAD;
    const py = (y1 - y0) * AIM_PAD;
    this.aimX0 = x0 - px;
    this.aimX1 = x1 + px;
    this.aimY0 = y0 - py;
    this.aimY1 = y1 + py;
    this.aimValid = true;
  }
}

/** 疊在相機畫面上的風流＋紅色迎風面 overlay。 */
export class WindField {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly camera: CameraView;
  private readonly sim: WindSim;
  private readonly env: WindEnv = { vw: 1, vh: 1, map: null, mask: null };

  private opacity = 0;
  private target = 0;
  private cleared = true;
  private dpr = 1;

  // 紅色層：mask 解析度的離屏 canvas＋重用的 ImageData 與暫存
  private readonly heatCanvas: HTMLCanvasElement;
  private readonly heatCtx: CanvasRenderingContext2D;
  private heatImage: ImageData | null = null;
  private heatA = new Float32Array(0);
  private heatB = new Float32Array(0);

  // 每幀的四邊形（每顆粒子最多 2 片）：尾 (ax, ay)、頭 (bx, by)、頭半寬、透明度分桶
  private readonly qax: Float32Array;
  private readonly qay: Float32Array;
  private readonly qbx: Float32Array;
  private readonly qby: Float32Array;
  private readonly qw: Float32Array;
  private readonly qb: Uint8Array;
  private quadCount = 0;
  private readonly mat = [0, 0, 0, 0, 0, 0];

  constructor(container: HTMLElement, camera: CameraView, count = DEFAULT_COUNT) {
    this.camera = camera;
    this.sim = new WindSim(count);
    const canvas = document.createElement('canvas');
    canvas.className = 'ap-windfield';
    Object.assign(canvas.style, {
      position: 'fixed',
      inset: '0',
      width: '100%',
      height: '100%',
      zIndex: '1',
      pointerEvents: 'none',
      display: 'block',
    });
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('無法建立風流的 2D context');
    this.canvas = canvas;
    this.ctx = ctx;
    if (camera.canvas.parentNode === container) camera.canvas.after(canvas);
    else container.appendChild(canvas);

    this.heatCanvas = document.createElement('canvas');
    const hctx = this.heatCanvas.getContext('2d');
    if (!hctx) throw new Error('無法建立熱度層的 2D context');
    this.heatCtx = hctx;

    const cap = count * 2;
    this.qax = new Float32Array(cap);
    this.qay = new Float32Array(cap);
    this.qbx = new Float32Array(cap);
    this.qby = new Float32Array(cap);
    this.qw = new Float32Array(cap);
    this.qb = new Uint8Array(cap);
  }

  /** 淡入淡出約 0.5 s；從完全隱藏重新開啟時，風帶直接灑滿、熱度歸零。 */
  setActive(on: boolean): void {
    if (on && this.target === 0 && this.opacity === 0) this.sim.reset();
    this.target = on ? 1 : 0;
  }

  update(dt: number): void {
    // 分頁切回來、計時器出錯時 dt 可能是 NaN / Infinity / 負值：直接略過，否則 opacity、粒子、熱度會永久變 NaN
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    dt = Math.min(MAX_DT, dt);
    const step = dt / FADE_S;
    this.opacity =
      this.target > this.opacity ? Math.min(this.target, this.opacity + step) : Math.max(this.target, this.opacity - step);
    if (this.opacity === 0) {
      if (!this.cleared) {
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.cleared = true;
      }
      return;
    }
    this.cleared = false;
    this.fitCanvas();
    const env = this.env;
    env.map = this.camera.map;
    env.mask = this.camera.mask;
    this.sim.step(dt, env);
    this.draw();
  }

  dispose(): void {
    this.canvas.remove();
  }

  private fitCanvas(): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const w = Math.round(vw * dpr);
    const h = Math.round(vh * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.dpr = dpr;
    this.env.vw = vw;
    this.env.vh = vh;
  }

  private draw(): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawHeat();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.collectQuads();
    ctx.globalCompositeOperation = 'lighter';
    this.drawQuads(GLOW_COLOR, GLOW_WIDTH, GLOW_ALPHA);
    this.drawQuads(CORE_COLOR, CORE_WIDTH, CORE_ALPHA);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  /** 熱度 × 目前 mask → 模糊 → 紅色 ImageData → 依 CoverMap（含鏡像）放大疊上去。 */
  private drawHeat(): void {
    const map = this.env.map;
    if (!map) return;
    const heat = this.sim.heat;
    const w = heat.w;
    const h = heat.h;
    const n = w * h;
    if (!this.heatImage || this.heatImage.width !== w || this.heatImage.height !== h) {
      this.heatCanvas.width = w;
      this.heatCanvas.height = h;
      this.heatImage = this.heatCtx.createImageData(w, h);
      this.heatA = new Float32Array(n);
      this.heatB = new Float32Array(n);
    }
    const src = heat.data;
    const mask = this.env.mask;
    const md = mask && mask.w === w && mask.h === h ? mask.data : null;
    const a = this.heatA;
    const b = this.heatB;
    let peak = 0;
    for (let i = 0; i < n; i++) {
      let v = 1 - Math.exp(-src[i] / HEAT_SCALE);
      if (!md || md[i] === 0) v *= HEAT_OUTSIDE;
      a[i] = v;
      if (v > peak) peak = v;
    }
    if (peak < 0.01) return;

    // [1 2 1] / 4 可分離模糊：a → b（水平）→ a（垂直）
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const l = a[row + (x > 0 ? x - 1 : 0)];
        const r = a[row + (x < w - 1 ? x + 1 : w - 1)];
        b[row + x] = (l + 2 * a[row + x] + r) * 0.25;
      }
    }
    for (let y = 0; y < h; y++) {
      const up = (y > 0 ? y - 1 : 0) * w;
      const dn = (y < h - 1 ? y + 1 : h - 1) * w;
      const row = y * w;
      for (let x = 0; x < w; x++) a[row + x] = (b[up + x] + 2 * b[row + x] + b[dn + x]) * 0.25;
    }

    const px = this.heatImage.data;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const v = a[i];
      px[j] = 255;
      px[j + 1] = 36 + 110 * v * v; // 最熱處偏橘
      px[j + 2] = 48;
      px[j + 3] = 255 * HEAT_ALPHA * v;
    }
    this.heatCtx.putImageData(this.heatImage, 0, 0);

    // mask 像素 → 來源像素 → 鏡像 cover → 裝置像素
    const ctx = this.ctx;
    const d = this.dpr;
    const t = mirrorTransform(map, this.mat);
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.transform(t[0], t[1], t[2], t[3], t[4], t[5]);
    ctx.scale(map.srcW / w, map.srcH / h);
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = this.opacity;
    ctx.drawImage(this.heatCanvas, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = this.opacity * HEAT_GLOW;
    ctx.drawImage(this.heatCanvas, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }

  /** 把風帶與濺射投影成螢幕上的四邊形，依透明度分桶（之後每桶一次 fill）。 */
  private collectQuads(): void {
    const sim = this.sim;
    const vw = this.env.vw;
    const vh = this.env.vh;
    const cx = vw / 2;
    const cy = vh * VP_Y;
    const wMax = WIDTH_MAX * vh;
    let q = 0;
    for (let i = 0; i < sim.count; i++) {
      if (sim.state[i] === SPLASH) {
        const t = sim.age[i] / sim.life[i];
        const fade = (1 - t) * Math.sqrt(1 - t);
        const hw = SPLASH_WIDTH * vh * (1 - 0.5 * t);
        const bx = sim.sx[i];
        const by = sim.sy[i];
        const vx = sim.vx[i] * SPLASH_TRAIL_S;
        const vy = sim.vy[i] * SPLASH_TRAIL_S;
        const c = sim.spreadCos[i];
        const sn = sim.spreadSin[i];
        // 兩片：速度分別轉 ±spread
        q = this.pushQuad(q, bx - (vx * c - vy * sn), by - (vx * sn + vy * c), bx, by, hw, fade);
        q = this.pushQuad(q, bx - (vx * c + vy * sn), by - (-vx * sn + vy * c), bx, by, hw, fade);
        continue;
      }
      if (sim.hidden[i]) continue;
      const z = sim.z[i];
      const alpha =
        sim.bright[i] *
        smoothstep(Z_NEAR, Z_NEAR + 0.12, z) *
        (z > Z_PLANE ? 0.7 * (1 - smoothstep(Z_PLANE, Z_FAR, z)) : 1);
      const zt = Math.max(Z_TAIL_MIN, z - sim.len[i]);
      const x = sim.x[i] * vh;
      const y = sim.y[i] * vh;
      const bx = cx + x / z;
      const by = cy + y / z;
      const ax = cx + x / zt;
      const ay = cy + y / zt;
      // 整條都在畫面外就不畫
      if ((ax < 0 && bx < 0) || (ax > vw && bx > vw) || (ay < 0 && by < 0) || (ay > vh && by > vh)) continue;
      const hw = Math.min(wMax, (WIDTH_PLANE * vh) / z);
      q = this.pushQuad(q, ax, ay, bx, by, hw, alpha);
    }
    this.quadCount = q;
  }

  private pushQuad(q: number, ax: number, ay: number, bx: number, by: number, hw: number, alpha: number): number {
    if (alpha < 0.02) return q;
    this.qax[q] = ax;
    this.qay[q] = ay;
    this.qbx[q] = bx;
    this.qby[q] = by;
    this.qw[q] = hw;
    this.qb[q] = Math.min(BUCKETS - 1, Math.floor(alpha * BUCKETS));
    return q + 1;
  }

  /** 錐形光帶：尾細頭粗、頭部圓形；同一透明度桶合成一條 path 一次 fill。 */
  private drawQuads(color: string, widthMul: number, alphaMul: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    for (let bucket = 0; bucket < BUCKETS; bucket++) {
      ctx.beginPath();
      let any = false;
      for (let q = 0; q < this.quadCount; q++) {
        if (this.qb[q] !== bucket) continue;
        any = true;
        const ax = this.qax[q];
        const ay = this.qay[q];
        const bx = this.qbx[q];
        const by = this.qby[q];
        const hw = this.qw[q] * widthMul;
        const tw = hw * TAIL_WIDTH;
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.hypot(dx, dy);
        if (len > 0.5) {
          const nx = -dy / len;
          const ny = dx / len;
          ctx.moveTo(ax + nx * tw, ay + ny * tw);
          ctx.lineTo(bx + nx * hw, by + ny * hw);
          ctx.lineTo(bx - nx * hw, by - ny * hw);
          ctx.lineTo(ax - nx * tw, ay - ny * tw);
          ctx.closePath();
        }
        ctx.moveTo(bx + hw, by);
        ctx.arc(bx, by, hw, 0, Math.PI * 2);
      }
      if (!any) continue;
      ctx.globalAlpha = this.opacity * alphaMul * ((bucket + 0.5) / BUCKETS);
      ctx.fill();
    }
  }
}
