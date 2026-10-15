import type { LeaderboardEntry } from '../types';
import { LeaderboardPanel } from './leaderboard';

/** 面積儀表的範圍（m²）：趴到底約 0.30，坐直約 0.50。 */
const GAUGE_MIN = 0.3;
const GAUGE_MAX = 0.6;

export const ARMS_UP_SVG = `
  <svg class="ap-armsup" viewBox="0 0 64 64" aria-hidden="true">
    <circle cx="32" cy="22" r="6" />
    <path d="M32 30v18M32 48l-8 12M32 48l8 12M32 32 18 18l-2-12M32 32l14-14 2-12" />
  </svg>`;

/** 待機畫面：吸引路人、教玩法、秀今日排行榜。騎士示範動畫在底下的 3D 場景。 */
export class AttractScreen {
  private readonly el: HTMLElement;
  private readonly areaValue: HTMLElement;
  private readonly gauge: HTMLElement;
  private readonly board: LeaderboardPanel;

  constructor(root: HTMLElement) {
    this.el = document.createElement('section');
    this.el.className = 'ap-screen ap-attract';
    this.el.innerHTML = `
      <div class="ap-attract__hero">
        <p class="ap-eyebrow">公路車空氣力學實驗</p>
        <h1 class="ap-title"><span>風阻</span>姿勢大挑戰</h1>
        <p class="ap-attract__cta">${ARMS_UP_SVG}<span>站到膠帶上，雙手舉高開始</span></p>
        <ol class="ap-steps">
          <li><b>1</b><span>站到地上的膠帶</span></li>
          <li><b>2</b><span>雙手舉過頭 1 秒</span></li>
          <li><b>3</b><span>壓低身體，停住不動</span></li>
        </ol>
      </div>
      <div class="ap-attract__board"></div>
      <div class="ap-attract__live">
        <p class="ap-label">示範騎士 · 正面面積</p>
        <p class="ap-live"><span class="ap-num ap-live__value">0.000</span><span class="ap-unit">m²</span></p>
        <div class="ap-gauge" aria-hidden="true">
          <div class="ap-gauge__fill"></div>
          <span class="ap-gauge__lo">趴低</span><span class="ap-gauge__hi">坐直</span>
        </div>
        <p class="ap-attract__hint">車手趴低騎，就是為了少推一點空氣</p>
      </div>
      <p class="ap-disclaimer">姿勢比較用，不是風洞量測</p>`;
    this.areaValue = this.el.querySelector('.ap-live__value') as HTMLElement;
    this.gauge = this.el.querySelector('.ap-gauge__fill') as HTMLElement;
    this.board = new LeaderboardPanel(this.el.querySelector('.ap-attract__board') as HTMLElement);
    root.appendChild(this.el);
  }

  show(): void {
    this.el.classList.add('is-visible');
  }

  hide(): void {
    this.el.classList.remove('is-visible');
  }

  setLiveArea(m2: number): void {
    this.areaValue.textContent = m2.toFixed(3);
    const t = Math.min(1, Math.max(0, (m2 - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN)));
    this.gauge.style.transform = `scaleX(${t.toFixed(4)})`;
  }

  setLeaderboard(e: LeaderboardEntry[]): void {
    this.board.set(e);
  }
}
