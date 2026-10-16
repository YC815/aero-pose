import QRCode from 'qrcode';
import type { SessionSummary } from '../types';
import { DISCLAIMER, EXPLAIN, resultTexts } from './card';
import { paintChart } from './chart';

export interface ResultView {
  summary: SessionSummary;
  /** 最趴低那一刻的標準騎士正面 mask（白色不透明 = 覆蓋），給結果卡用。 */
  bestMask: ImageData;
  /** 瓦數換算用的時速（settings.speed_kmh）。 */
  speedKmh: number;
}

/**
 * 結果畫面：左半 replaySlot（main 放騎士重播 canvas），
 * 右半平均瓦數、比坐直少幾 %、瓦數曲線（遊標跟重播同步）、名次、QR、解釋句。
 */
export class ResultScreen {
  /** 左側空容器，main 把騎士重播的 canvas 放進來。 */
  readonly replaySlot: HTMLElement;
  private readonly el: HTMLElement;
  private readonly replayCap: HTMLElement;
  private readonly wattsLabel: HTMLElement;
  private readonly watts: HTMLElement;
  private readonly wattsVerb: HTMLElement;
  private readonly wattsN: HTMLElement;
  private readonly pctVerb: HTMLElement;
  private readonly pctN: HTMLElement;
  private readonly chart: HTMLCanvasElement;
  private readonly server: HTMLElement;
  private readonly rank: HTMLElement;
  private readonly rider: HTMLElement;
  private readonly qrBox: HTMLElement;
  private readonly qrCanvas: HTMLCanvasElement;
  private summary: SessionSummary | null = null;
  /** 每次 show / hide 加一；舊一輪的名次回應或 QR 非同步結果不會寫進新的一輪。 */
  private session = 0;

  constructor(root: HTMLElement) {
    this.el = document.createElement('section');
    this.el.className = 'ap-screen ap-result';
    this.el.innerHTML = `
      <div class="ap-result__replay">
        <div class="ap-result__slot"></div>
        <p class="ap-result__replay-cap"></p>
      </div>
      <div class="ap-result__data">
        <div class="ap-result__head">
          <div class="ap-result__block">
            <p class="ap-label ap-result__watts-label"></p>
            <p class="ap-result__big ap-result__watts">
              <span class="ap-result__verb ap-result__watts-verb"></span><span class="ap-num ap-result__watts-n"></span><span class="ap-result__unit">瓦</span>
            </p>
          </div>
          <div class="ap-result__block">
            <p class="ap-label">比坐直平均</p>
            <p class="ap-result__big ap-result__pct">
              <span class="ap-result__verb ap-result__pct-verb"></span><span class="ap-num ap-result__pct-n"></span>
            </p>
          </div>
        </div>
        <div class="ap-result__chart-box">
          <p class="ap-result__chart-cap">每一刻省下的瓦數 <small>白線＝左邊重播到這裡</small></p>
          <div class="ap-result__chart-wrap"><canvas class="ap-result__chart"></canvas></div>
        </div>
        <div class="ap-result__server">
          <p class="ap-result__pending">登錄今日排行榜中…</p>
          <p class="ap-result__rank">
            <span>今日第 <b class="ap-num ap-result__rank-n"></b> 名</span>
            <span class="ap-result__rider"></span>
          </p>
          <figure class="ap-qr">
            <canvas class="ap-qr__canvas"></canvas>
            <figcaption>掃描下載成績卡</figcaption>
          </figure>
        </div>
        <p class="ap-result__explain">${EXPLAIN}</p>
        <p class="ap-disclaimer">${DISCLAIMER}</p>
      </div>`;
    const q = <T extends Element = HTMLElement>(sel: string) => this.el.querySelector(sel) as T;
    this.replaySlot = q('.ap-result__slot');
    this.replayCap = q('.ap-result__replay-cap');
    this.wattsLabel = q('.ap-result__watts-label');
    this.watts = q('.ap-result__watts');
    this.wattsVerb = q('.ap-result__watts-verb');
    this.wattsN = q('.ap-result__watts-n');
    this.pctVerb = q('.ap-result__pct-verb');
    this.pctN = q('.ap-result__pct-n');
    this.chart = q<HTMLCanvasElement>('.ap-result__chart');
    this.server = q('.ap-result__server');
    this.rank = q('.ap-result__rank-n');
    this.rider = q('.ap-result__rider');
    this.qrBox = q('.ap-qr');
    this.qrCanvas = q<HTMLCanvasElement>('.ap-qr__canvas');
    this.qrBox.hidden = true;
    root.appendChild(this.el);
  }

  /**
   * 顯示結果，回傳這一輪的 session 編號。
   * 呼叫端把它傳回 setServerInfo，舊一輪遲到的回應就會被丟掉。
   */
  show(v: ResultView): number {
    this.session++;
    this.summary = v.summary;
    const t = resultTexts(v);
    this.replayCap.textContent = `你這 ${t.seconds} 秒的動作（標準騎士重播）`;
    this.wattsLabel.textContent = `${t.seconds} 秒平均 · 時速 ${t.speedKmh} km 估算`;
    this.wattsVerb.textContent = t.wattsVerb;
    this.wattsN.textContent = t.wattsNum;
    this.watts.classList.toggle('is-worse', !t.saved);
    this.pctVerb.textContent = t.pctVerb;
    this.pctN.textContent = t.pct;
    this.pctN.classList.toggle('is-worse', t.pctVerb !== '少');

    // 等 setServerInfo；先顯示「登錄中」
    this.server.dataset.state = 'pending';
    this.qrBox.hidden = true;
    this.el.classList.remove('is-visible');
    void this.el.offsetWidth; // 重播進場動畫
    this.el.classList.add('is-visible');
    this.setPlayhead(0);
    return this.session;
  }

  /** 曲線遊標（秒，相對錄製開始）；main 每幀依重播進度呼叫。 */
  setPlayhead(t: number): void {
    if (!this.summary) return;
    paintChart(this.chart, this.summary.samples, this.summary.durationS, true, t);
  }

  /**
   * null = 上傳失敗或沒連上後端：不顯示名次與 QR。
   * session 必須等於目前這一輪 show() 的回傳值，否則丟掉；
   * 畫面已 hide 或這一輪已經收過結果也會丟掉。
   */
  setServerInfo(info: { number: number; rank: number; qrUrl: string | null } | null, session: number): void {
    if (session !== this.session) return;
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
    this.summary = null;
    this.el.classList.remove('is-visible');
  }
}
