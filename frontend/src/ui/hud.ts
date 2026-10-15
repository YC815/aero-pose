import type { GameState } from '../types';
import { ARMS_UP_SVG } from './attract';

const RING_R = 44;
const RING_C = 2 * Math.PI * RING_R;

function clamp01(p: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(p) ? p : 0));
}

/** 遊戲中的抬頭顯示：READY 進度圈、POSING 靜止條與即時面積、COUNTDOWN 大數字。 */
export class Hud {
  private readonly el: HTMLElement;
  private readonly ring: SVGCircleElement;
  private readonly still: HTMLElement;
  private readonly stillWrap: HTMLElement;
  private readonly area: HTMLElement;
  private readonly left: HTMLElement;
  private readonly leftWrap: HTMLElement;
  private readonly count: HTMLElement;
  private lastCount = -1;
  private lastLeft = -1;

  constructor(root: HTMLElement) {
    this.el = document.createElement('section');
    this.el.className = 'ap-screen ap-hud';
    this.el.innerHTML = `
      <div class="ap-hud__ready">
        <div class="ap-ring">
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <circle class="ap-ring__track" cx="50" cy="50" r="${RING_R}" />
            <circle class="ap-ring__bar" cx="50" cy="50" r="${RING_R}"
              stroke-dasharray="${RING_C.toFixed(2)}" stroke-dashoffset="${RING_C.toFixed(2)}" />
          </svg>
          ${ARMS_UP_SVG}
        </div>
        <div>
          <h1 class="ap-prompt">雙手舉過頭開始</h1>
          <p class="ap-prompt__sub">像歡呼一樣，舉高停 1 秒</p>
        </div>
      </div>

      <div class="ap-hud__posing">
        <h1 class="ap-prompt">擺出最低風阻的姿勢</h1>
        <p class="ap-prompt__sub">停住不動就開始倒數</p>
        <div class="ap-still">
          <div class="ap-still__bar"><div class="ap-still__fill"></div></div>
          <span class="ap-still__label">靜止</span>
        </div>
      </div>

      <aside class="ap-hud__meter">
        <p class="ap-label">你的正面面積</p>
        <p class="ap-live"><span class="ap-num ap-hud__area">—</span><span class="ap-unit">m²</span></p>
        <p class="ap-hud__left"><span class="ap-hud__left-n">20</span> 秒後自動定格</p>
      </aside>

      <div class="ap-hud__countdown">
        <p class="ap-hud__hold">保持住！</p>
        <div class="ap-count" aria-live="assertive"></div>
      </div>`;
    this.ring = this.el.querySelector('.ap-ring__bar') as SVGCircleElement;
    this.still = this.el.querySelector('.ap-still__fill') as HTMLElement;
    this.stillWrap = this.el.querySelector('.ap-still') as HTMLElement;
    this.area = this.el.querySelector('.ap-hud__area') as HTMLElement;
    this.left = this.el.querySelector('.ap-hud__left-n') as HTMLElement;
    this.leftWrap = this.el.querySelector('.ap-hud__left') as HTMLElement;
    this.count = this.el.querySelector('.ap-count') as HTMLElement;
    root.appendChild(this.el);
  }

  /** 依狀態切換要顯示的區塊；READY/POSING/COUNTDOWN 以外的狀態等同 hide()。 */
  show(state: GameState): void {
    if (state !== 'READY' && state !== 'POSING' && state !== 'COUNTDOWN') {
      this.hide();
      return;
    }
    if (state === 'READY') this.setStartProgress(0);
    if (state === 'POSING') {
      this.setStillProgress(0);
      this.lastLeft = -1;
    }
    if (state === 'COUNTDOWN') {
      this.lastCount = -1;
      this.count.textContent = '';
    }
    this.el.dataset.state = state;
    this.el.classList.add('is-visible');
  }

  hide(): void {
    this.el.classList.remove('is-visible');
    delete this.el.dataset.state;
  }

  setStartProgress(p: number): void {
    const t = clamp01(p);
    this.ring.style.strokeDashoffset = (RING_C * (1 - t)).toFixed(2);
    this.el.classList.toggle('is-start-full', t >= 1);
  }

  setStillProgress(p: number): void {
    const t = clamp01(p);
    this.still.style.transform = `scaleX(${t.toFixed(4)})`;
    this.stillWrap.classList.toggle('is-full', t >= 1);
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

  setLiveArea(m2: number | null): void {
    this.area.textContent = m2 === null || !Number.isFinite(m2) ? '—' : m2.toFixed(3);
  }

  setPosingLeft(sec: number): void {
    const n = Math.max(0, Math.ceil(sec - 1e-6));
    if (n === this.lastLeft) return;
    this.lastLeft = n;
    this.left.textContent = String(n);
    this.leftWrap.classList.toggle('is-urgent', n <= 5);
  }
}
