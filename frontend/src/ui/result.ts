import QRCode from 'qrcode';
import { DISCLAIMER, EXPLAIN, drawSilhouettes, resultTexts } from './card';

export interface ResultView {
  playerMask: ImageData;
  baselineMask: ImageData;
  areaM2: number;
  baselineM2: number;
  /** (base − area) / base · 100 */
  pct: number;
  watts: number;
  /** 瓦數換算用的時速（settings.speed_kmh），沒給就當 40。 */
  speedKmh?: number;
}

const CANVAS_W = 1200;
const CANVAS_H = 1000;

/** 結果畫面：左邊正面輪廓疊圖，右邊面積、百分比、瓦數、名次、QR。 */
export class ResultScreen {
  private readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly area: HTMLElement;
  private readonly pctLabel: HTMLElement;
  private readonly pct: HTMLElement;
  private readonly wattsLabel: HTMLElement;
  private readonly watts: HTMLElement;
  private readonly server: HTMLElement;
  private readonly rank: HTMLElement;
  private readonly rider: HTMLElement;
  private readonly qrBox: HTMLElement;
  private readonly qrCanvas: HTMLCanvasElement;
  /** 每次 show / hide 加一；舊一輪的名次回應或 QR 非同步結果不會寫進新的一輪。 */
  private session = 0;

  constructor(root: HTMLElement) {
    this.el = document.createElement('section');
    this.el.className = 'ap-screen ap-result';
    this.el.innerHTML = `
      <div class="ap-result__art">
        <canvas class="ap-result__canvas" width="${CANVAS_W}" height="${CANVAS_H}"></canvas>
        <ul class="ap-legend">
          <li class="ap-legend__you">你的姿勢</li>
          <li class="ap-legend__base">一般坐直騎</li>
        </ul>
      </div>
      <div class="ap-result__data">
        <p class="ap-label">你的正面面積</p>
        <p class="ap-result__area"><span class="ap-num ap-result__area-n"></span><span class="ap-unit">m²</span></p>
        <div class="ap-result__stats">
          <div class="ap-stat">
            <p class="ap-stat__label ap-result__pct-label"></p>
            <p class="ap-stat__value"><span class="ap-num ap-result__pct-n"></span></p>
          </div>
          <div class="ap-stat">
            <p class="ap-stat__label ap-result__watts-label"></p>
            <p class="ap-stat__value"><span class="ap-num ap-result__watts-n"></span><span class="ap-unit">瓦</span><small>（估算）</small></p>
          </div>
        </div>
        <div class="ap-result__server">
          <p class="ap-result__pending">登錄今日排行榜中…</p>
          <p class="ap-result__rank">
            <span>今日第 <b class="ap-num ap-result__rank-n"></b> 名</span>
            <span class="ap-result__rider"></span>
          </p>
          <figure class="ap-qr">
            <canvas class="ap-qr__canvas"></canvas>
            <figcaption>掃描下載你的騎士</figcaption>
          </figure>
        </div>
        <p class="ap-result__explain">${EXPLAIN}</p>
        <p class="ap-disclaimer">${DISCLAIMER}</p>
      </div>`;
    this.canvas = this.el.querySelector('.ap-result__canvas') as HTMLCanvasElement;
    this.area = this.el.querySelector('.ap-result__area-n') as HTMLElement;
    this.pctLabel = this.el.querySelector('.ap-result__pct-label') as HTMLElement;
    this.pct = this.el.querySelector('.ap-result__pct-n') as HTMLElement;
    this.wattsLabel = this.el.querySelector('.ap-result__watts-label') as HTMLElement;
    this.watts = this.el.querySelector('.ap-result__watts-n') as HTMLElement;
    this.server = this.el.querySelector('.ap-result__server') as HTMLElement;
    this.rank = this.el.querySelector('.ap-result__rank-n') as HTMLElement;
    this.rider = this.el.querySelector('.ap-result__rider') as HTMLElement;
    this.qrBox = this.el.querySelector('.ap-qr') as HTMLElement;
    this.qrCanvas = this.el.querySelector('.ap-qr__canvas') as HTMLCanvasElement;
    this.qrBox.hidden = true;
    root.appendChild(this.el);
  }

  /**
   * 顯示結果，回傳這一輪的 session 編號。
   * 呼叫端把它傳回 setServerInfo，舊一輪遲到的回應就會被丟掉。
   */
  show(d: ResultView): number {
    this.session++;
    const t = resultTexts(d);
    this.area.textContent = t.area;
    this.pctLabel.textContent = t.pctLabel;
    this.pct.textContent = t.pct;
    this.pct.classList.toggle('is-worse', !t.saved);

    this.wattsLabel.textContent = `時速 ${t.speedKmh} km 約${t.wattsVerb}`;
    this.watts.textContent = t.wattsNum;
    this.watts.classList.toggle('is-saved', t.saved);

    const ctx = this.canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      drawSilhouettes(ctx, d, { x: 40, y: 40, w: CANVAS_W - 80, h: CANVAS_H - 40 }, 40);
    }

    // 等 setServerInfo；先顯示「登錄中」
    this.server.dataset.state = 'pending';
    this.qrBox.hidden = true;
    this.el.classList.remove('is-visible');
    void this.el.offsetWidth; // 重播進場動畫
    this.el.classList.add('is-visible');
    return this.session;
  }

  /**
   * null = 上傳失敗或沒連上後端：不顯示名次與 QR。
   * 有給 session 時必須等於目前這一輪 show() 的回傳值，否則丟掉；
   * 不論有沒有給，畫面已 hide 或這一輪已經收過結果都會丟掉。
   */
  setServerInfo(info: { number: number; rank: number; qrUrl: string | null } | null, session?: number): void {
    if (session !== undefined && session !== this.session) return;
    if (!this.el.classList.contains('is-visible')) return;
    if (this.server.dataset.state !== 'pending') return;
    if (info === null) {
      this.server.dataset.state = 'none';
      return;
    }
    this.rank.textContent = String(info.rank);
    this.rider.textContent = `騎士 #${info.number}`;
    this.server.dataset.state = 'ready';
    this.qrBox.hidden = true;
    if (!info.qrUrl) return;

    const current = this.session;
    QRCode.toCanvas(this.qrCanvas, info.qrUrl, {
      margin: 1,
      width: 320,
      errorCorrectionLevel: 'M',
      color: { dark: '#030812ff', light: '#ffffffff' },
    })
      .then(() => {
        if (current === this.session) this.qrBox.hidden = false;
      })
      .catch(() => {
        // QR 產生失敗就不顯示，名次照樣顯示
      });
  }

  hide(): void {
    this.session++;
    this.el.classList.remove('is-visible');
  }
}
