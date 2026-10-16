import type { SessionSample } from '../types';
import { ChartCanvas } from './chart';

/** 遊戲中的抬頭顯示，疊在相機畫面上：COUNTDOWN 超大 3、2、1；RECORDING 即時省幾瓦、剩幾秒、逐漸長出來的小曲線。 */
export class Hud {
  private readonly el: HTMLElement;
  private readonly count: HTMLElement;
  private readonly watts: HTMLElement;
  private readonly wattsN: HTMLElement;
  private readonly verb: HTMLElement;
  private readonly left: HTMLElement;
  private readonly leftN: HTMLElement;
  private readonly chart: ChartCanvas;
  private durationS = 10;
  private lastCount = -1;
  private lastLeft = -1;

  constructor(root: HTMLElement) {
    this.el = document.createElement('section');
    this.el.className = 'ap-screen ap-hud';
    this.el.innerHTML = `
      <div class="ap-hud__countdown">
        <p class="ap-hud__get-ready">準備！</p>
        <div class="ap-count" aria-live="assertive"></div>
        <p class="ap-hud__count-sub">等一下盡量趴低、縮小身體</p>
      </div>

      <div class="ap-hud__rec">
        <div class="ap-hud__top">
          <p class="ap-hud__watts">
            <span class="ap-hud__verb">省</span><span class="ap-num ap-hud__watts-n">—</span><span class="ap-hud__unit">瓦</span>
          </p>
        </div>
        <div class="ap-hud__side">
          <p class="ap-hud__badge"><i></i>錄製中</p>
          <p class="ap-hud__left">剩 <b class="ap-num ap-hud__left-n"></b> 秒</p>
        </div>
        <div class="ap-hud__bottom">
          <p class="ap-hud__tip">趴低、縮小，讓紅色變少！</p>
          <canvas class="ap-hud__chart"></canvas>
        </div>
      </div>`;
    this.count = this.el.querySelector('.ap-count') as HTMLElement;
    this.watts = this.el.querySelector('.ap-hud__watts') as HTMLElement;
    this.wattsN = this.el.querySelector('.ap-hud__watts-n') as HTMLElement;
    this.verb = this.el.querySelector('.ap-hud__verb') as HTMLElement;
    this.left = this.el.querySelector('.ap-hud__left') as HTMLElement;
    this.leftN = this.el.querySelector('.ap-hud__left-n') as HTMLElement;
    this.chart = new ChartCanvas(this.el.querySelector('.ap-hud__chart') as HTMLCanvasElement);
    root.appendChild(this.el);
  }

  showCountdown(): void {
    this.lastCount = -1;
    this.count.replaceChildren();
    this.setState('COUNTDOWN');
  }

  /** sec 可以是小數（剩餘秒數），顯示無條件進位；每換一個數字重播一次動畫。 */
  setCountdown(sec: number): void {
    const n = Math.max(0, Math.ceil(sec - 1e-6));
    if (n === this.lastCount) return;
    this.lastCount = n;
    const span = document.createElement('span');
    span.className = 'ap-count__n';
    span.textContent = n > 0 ? String(n) : '';
    this.count.replaceChildren(span);
  }

  showRecording(durationS: number): void {
    this.durationS = durationS > 0 ? durationS : 10;
    this.lastLeft = -1;
    this.setWatts(null);
    this.setTimeLeft(this.durationS);
    this.setState('RECORDING');
    this.chart.resize(); // 曲線區剛從 display:none 變可見，量一次尺寸
    this.setSamples([]);
  }

  /** 即時省幾瓦；負值顯示「多花 X 瓦」，null 顯示「—」。 */
  setWatts(w: number | null): void {
    const r = w === null || !Number.isFinite(w) ? null : Math.round(w);
    const worse = r !== null && r < 0;
    this.verb.textContent = worse ? '多花' : '省';
    this.wattsN.textContent = r === null ? '—' : String(Math.abs(r));
    this.watts.classList.toggle('is-worse', worse);
  }

  setTimeLeft(sec: number): void {
    const n = Math.max(0, Math.ceil(sec - 1e-6));
    if (n === this.lastLeft) return;
    this.lastLeft = n;
    this.leftN.textContent = String(n);
    this.left.classList.toggle('is-urgent', n <= 3);
  }

  /** 到目前為止的樣本；曲線 x 軸固定為整段錄製長度，所以會從左往右長。 */
  setSamples(s: readonly SessionSample[]): void {
    if (this.el.dataset.state !== 'RECORDING') return;
    this.chart.draw(s, this.durationS, false);
  }

  hide(): void {
    this.el.classList.remove('is-visible');
    delete this.el.dataset.state;
  }

  private setState(state: 'COUNTDOWN' | 'RECORDING'): void {
    this.el.dataset.state = state;
    this.el.classList.add('is-visible');
  }
}
