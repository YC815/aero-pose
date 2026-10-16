import type { FrameMsg } from './types';

// 全螢幕相機畫面（v1.1）。
// 後端送來的 JPEG 與 mask 都是相機「原始方向」；這裡一律水平鏡像顯示（像自拍），
// 玩家舉左手時，螢幕左邊的手跟著動。

/** 「cover + 水平鏡像」把來源影像（原始方向，srcW×srcH）映射到螢幕 viewport（vw×vh）的轉換。 */
export interface CoverMap {
  scale: number;
  /** 未鏡像時影像左上角在螢幕上的位置（cover 裁切時為負）。 */
  offsetX: number;
  offsetY: number;
  srcW: number;
  srcH: number;
  vw: number;
  vh: number;
}

export function coverMap(srcW: number, srcH: number, vw: number, vh: number): CoverMap {
  const scale = Math.max(vw / srcW, vh / srcH);
  return {
    scale,
    offsetX: (vw - srcW * scale) / 2,
    offsetY: (vh - srcH * scale) / 2,
    srcW,
    srcH,
    vw,
    vh,
  };
}

/** 螢幕 → 來源（已含鏡像），寫進 out，不配置記憶體（給每幀迴圈用）。 */
export function screenToSourceInto(m: CoverMap, sx: number, sy: number, out: number[]): void {
  out[0] = m.srcW - (sx - m.offsetX) / m.scale;
  out[1] = (sy - m.offsetY) / m.scale;
}

/** 來源 → 螢幕（已含鏡像），寫進 out，不配置記憶體。 */
export function sourceToScreenInto(m: CoverMap, u: number, v: number, out: number[]): void {
  out[0] = m.offsetX + (m.srcW - u) * m.scale;
  out[1] = m.offsetY + v * m.scale;
}

export function screenToSource(m: CoverMap, sx: number, sy: number): [number, number] {
  const out = [0, 0];
  screenToSourceInto(m, sx, sy, out);
  return [out[0], out[1]];
}

export function sourceToScreen(m: CoverMap, u: number, v: number): [number, number] {
  const out = [0, 0];
  sourceToScreenInto(m, u, v, out);
  return [out[0], out[1]];
}

/** 螢幕 → mask 座標（mask 與影像同視野，只是解析度較低），已含鏡像，寫進 out。 */
export function screenToMask(m: CoverMap, maskW: number, maskH: number, sx: number, sy: number, out: number[]): void {
  screenToSourceInto(m, sx, sy, out);
  out[0] *= maskW / m.srcW;
  out[1] *= maskH / m.srcH;
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** base64 → 每像素 1 byte 的 mask（原始方向、row-major）。長度不是 w×h 時 throw。 */
export function decodeMask(b64: string, w: number, h: number): Uint8Array {
  const bytes = b64ToBytes(b64);
  if (bytes.length !== w * h) {
    throw new Error(`mask 長度 ${bytes.length} 不等於 ${w}×${h}`);
  }
  return bytes;
}

export interface MaskFrame {
  data: Uint8Array;
  w: number;
  h: number;
}

/** RESULT 時相機畫面壓暗的程度。 */
const DIM_FILTER = 'brightness(0.35) saturate(0.6)';
const FULL_FILTER = 'brightness(1) saturate(1)';

/** 全螢幕、最底層的相機畫面 canvas。畫面只在新影格解碼完成或視窗尺寸改變時重畫。 */
export class CameraView {
  readonly canvas: HTMLCanvasElement;

  private readonly ctx: CanvasRenderingContext2D;
  private bitmap: ImageBitmap | null = null;
  private currentMap: CoverMap | null = null;
  private currentMask: MaskFrame | null = null;
  /** 最後一次 setFrame 的序號，以及目前顯示中的影格序號：解碼完成順序亂掉時丟掉舊的。 */
  private seq = 0;
  private shownSeq = 0;
  private disposed = false;
  private warnedMask = false;
  private readonly onResize = (): void => this.draw();

  constructor(container: HTMLElement) {
    const canvas = document.createElement('canvas');
    canvas.className = 'ap-camera';
    Object.assign(canvas.style, {
      position: 'fixed',
      inset: '0',
      width: '100%',
      height: '100%',
      zIndex: '0',
      pointerEvents: 'none',
      display: 'block',
      filter: FULL_FILTER,
      transition: 'filter 0.6s ease',
    });
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('無法建立相機畫面的 2D context');
    this.canvas = canvas;
    this.ctx = ctx;
    container.prepend(canvas);
    window.addEventListener('resize', this.onResize);
  }

  /** 目前畫面的映射（還沒收到任何影格時為 null）。 */
  get map(): CoverMap | null {
    return this.currentMap;
  }

  /** 與目前顯示影格同步的 mask（原始方向）；沒有選中玩家時為 null。 */
  get mask(): MaskFrame | null {
    return this.currentMask;
  }

  setFrame(msg: FrameMsg): void {
    if (this.disposed) return;
    const seq = ++this.seq;
    const mask = this.decodeFrameMask(msg);
    let blob: Blob;
    try {
      blob = new Blob([b64ToBytes(msg.jpeg_b64)], { type: 'image/jpeg' });
    } catch {
      return; // base64 壞掉：丟掉這格
    }
    createImageBitmap(blob).then(
      (bmp) => {
        if (this.disposed || seq <= this.shownSeq) {
          bmp.close();
          return;
        }
        this.shownSeq = seq;
        this.bitmap?.close();
        this.bitmap = bmp;
        // mask 跟影像一起換，紅色層才會和畫面對齊
        this.currentMask = mask;
        this.draw();
      },
      () => {
        // JPEG 解碼失敗：保留上一格
      },
    );
  }

  setDimmed(on: boolean): void {
    this.canvas.style.filter = on ? DIM_FILTER : FULL_FILTER;
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('resize', this.onResize);
    this.bitmap?.close();
    this.bitmap = null;
    this.currentMask = null;
    this.currentMap = null;
    this.canvas.remove();
  }

  private decodeFrameMask(msg: FrameMsg): MaskFrame | null {
    if (!msg.mask_b64) return null;
    try {
      return { data: decodeMask(msg.mask_b64, msg.mask_w, msg.mask_h), w: msg.mask_w, h: msg.mask_h };
    } catch (err) {
      if (!this.warnedMask) {
        this.warnedMask = true;
        console.warn('[camera] mask 格式不符，略過', err);
      }
      return null;
    }
  }

  private draw(): void {
    const bmp = this.bitmap;
    if (!bmp || this.disposed) return;
    // 相機畫面用 CSS 像素就好：來源只有 960 寬，提高 backing 解析度沒有意義
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (this.canvas.width !== vw || this.canvas.height !== vh) {
      this.canvas.width = vw;
      this.canvas.height = vh;
    }
    const m = this.currentMap;
    if (!m || m.srcW !== bmp.width || m.srcH !== bmp.height || m.vw !== vw || m.vh !== vh) {
      this.currentMap = coverMap(bmp.width, bmp.height, vw, vh);
    }
    const map = this.currentMap!;
    const ctx = this.ctx;
    // 水平鏡像：螢幕 x = offsetX + (srcW − u) · scale
    ctx.setTransform(-map.scale, 0, 0, map.scale, map.offsetX + map.srcW * map.scale, map.offsetY);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(bmp, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}
