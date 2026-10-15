/** 全螢幕維護畫面：相機斷線或 WebSocket 斷線時顯示。 */
export class MaintenanceScreen {
  private readonly el: HTMLElement;
  private readonly msg: HTMLElement;

  constructor(root: HTMLElement) {
    this.el = document.createElement('section');
    this.el.className = 'ap-screen ap-maint';
    this.el.innerHTML = `
      <div class="ap-maint__streaks" aria-hidden="true">${streaks(16)}</div>
      <div class="ap-maint__body">
        <div class="ap-maint__icon" aria-hidden="true">
          <svg viewBox="0 0 64 64"><path d="M8 24h30a8 8 0 1 0-8-8M8 34h44a8 8 0 1 1-8 8M8 44h22" /></svg>
        </div>
        <h1 class="ap-maint__title">設備調整中，請稍候</h1>
        <p class="ap-maint__msg"></p>
      </div>`;
    this.msg = this.el.querySelector('.ap-maint__msg') as HTMLElement;
    root.appendChild(this.el);
  }

  show(msg?: string): void {
    this.msg.textContent = msg ?? '';
    this.msg.hidden = !msg;
    this.el.classList.add('is-visible');
  }

  hide(): void {
    this.el.classList.remove('is-visible');
  }
}

/** 背景慢慢飄過的風線；位置與速度固定（不需要每次重算）。 */
function streaks(n: number): string {
  let out = '';
  for (let i = 0; i < n; i++) {
    const top = ((i * 37) % 97) + 1.5;
    const dur = 5 + ((i * 7) % 6);
    const delay = -((i * 13) % 10);
    const w = 12 + ((i * 11) % 22);
    out += `<i style="top:${top}%;width:${w}vw;animation-duration:${dur}s;animation-delay:${delay}s"></i>`;
  }
  return out;
}
