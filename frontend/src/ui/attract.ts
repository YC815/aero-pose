import type { LeaderboardEntry, Settings } from '../types';
import { LeaderboardPanel } from './leaderboard';

const RING_R = 44;
const RING_C = 2 * Math.PI * RING_R;

export const ARMS_UP_SVG = `
  <svg class="ap-armsup" viewBox="0 0 64 64" aria-hidden="true">
    <circle cx="32" cy="22" r="6" />
    <path d="M32 30v18M32 48l-8 12M32 48l8 12M32 32 18 18l-2-12M32 32l14-14 2-12" />
  </svg>`;

function clamp01(p: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(p) ? p : 0));
}

/**
 * 待機畫面：疊在全螢幕相機畫面上（背景透明），吸引路人、教玩法、秀今日排行榜。
 * 有玩家站上來時，舉手圖示外面出現進度圈。
 */
export class AttractScreen {
  private readonly el: HTMLElement;
  private readonly ring: SVGCircleElement;
  private readonly board: LeaderboardPanel;

  constructor(root: HTMLElement) {
    this.el = document.createElement('section');
    this.el.className = 'ap-screen ap-attract';
    this.el.innerHTML = `
      <div class="ap-attract__hero">
        <p class="ap-eyebrow">公路車空氣力學實驗</p>
        <h1 class="ap-title"><span>風阻</span>姿勢大挑戰</h1>
        <div class="ap-start">
          <div class="ap-ring">
            <svg viewBox="0 0 100 100" aria-hidden="true">
              <circle class="ap-ring__track" cx="50" cy="50" r="${RING_R}" />
              <circle class="ap-ring__bar" cx="50" cy="50" r="${RING_R}"
                stroke-dasharray="${RING_C.toFixed(2)}" stroke-dashoffset="${RING_C.toFixed(2)}" />
            </svg>
            ${ARMS_UP_SVG}
          </div>
          <div class="ap-start__text">
            <p class="ap-start__cta">雙手舉高開始</p>
            <p class="ap-start__sub ap-start__sub--idle">站到地上的膠帶，面向螢幕</p>
            <p class="ap-start__sub ap-start__sub--present">看到你了！手舉高，停住不動</p>
          </div>
        </div>
        <ol class="ap-steps">
          <li><b>1</b><span>站到膠帶上，雙手舉高</span></li>
          <li><b>2</b><span>倒數後，身體趴低、縮小</span></li>
          <li><b>3</b><span>風打到你的地方會變紅，紅色越少越省力</span></li>
        </ol>
      </div>
      <div class="ap-attract__board"></div>
      <p class="ap-disclaimer">姿勢比較用，不是風洞量測</p>`;
    this.ring = this.el.querySelector('.ap-ring__bar') as SVGCircleElement;
    this.board = new LeaderboardPanel(this.el.querySelector('.ap-attract__board') as HTMLElement);
    root.appendChild(this.el);
  }

  show(): void {
    this.el.classList.add('is-visible');
  }

  hide(): void {
    this.el.classList.remove('is-visible');
  }

  /** 有人站在可玩區：顯示進度圈和「看到你了」；沒人時進度歸零、回到呼吸動畫。 */
  setPlayerPresent(b: boolean): void {
    this.el.classList.toggle('is-present', b);
    if (!b) this.setStartProgress(0);
  }

  /** 舉手進度 0–1（滿了就要進倒數）。 */
  setStartProgress(p: number): void {
    const t = clamp01(p);
    this.ring.style.strokeDashoffset = (RING_C * (1 - t)).toFixed(2);
    this.el.classList.toggle('is-start-full', t >= 1);
  }

  /** s：目前的瓦數換算設定，排行榜用它從面積重算瓦數。 */
  setLeaderboard(e: LeaderboardEntry[], s: Pick<Settings, 'cd' | 'speed_kmh' | 'air_density'>): void {
    this.board.set(e, s);
  }
}
