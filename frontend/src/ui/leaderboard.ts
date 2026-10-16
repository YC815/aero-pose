import { DEFAULT_SETTINGS, type LeaderboardEntry, type Settings } from '../types';
import { wattsSaved } from '../watts';

type WattsSettings = Pick<Settings, 'cd' | 'speed_kmh' | 'air_density'>;

/**
 * 排行榜顯示的瓦數：用目前設定從面積重算，不用上傳時的 watts_saved。
 * 後端依面積升冪排名；同一個坐直基準下，重算的瓦數和名次一定單調一致（當天改過時速、Cd 也一樣）。
 */
export function boardWatts(e: Pick<LeaderboardEntry, 'area_m2' | 'baseline_m2'>, s: WattsSettings): string {
  const w = Math.round(wattsSaved(e.baseline_m2, e.area_m2, s));
  return w >= 0 ? String(w) : `−${-w}`;
}

const MAX_ROWS = 10;

/** 今日排行榜：只顯示平均省幾瓦（後端依面積排序，等同依瓦數由大到小），前 3 名用螢光黃。 */
export class LeaderboardPanel {
  private readonly el: HTMLElement;
  private readonly list: HTMLOListElement;

  constructor(root: HTMLElement) {
    this.el = document.createElement('section');
    this.el.className = 'ap-board';
    this.el.innerHTML = `
      <header class="ap-board__head">
        <h2 class="ap-board__title">今日排行榜</h2>
        <p class="ap-board__sub">平均省越多瓦，名次越前面</p>
      </header>
      <div class="ap-board__cols" aria-hidden="true">
        <span>名次</span><span>騎士</span><span>平均省</span>
      </div>
      <ol class="ap-board__list"></ol>`;
    this.list = this.el.querySelector('ol') as HTMLOListElement;
    root.appendChild(this.el);
    this.set([], DEFAULT_SETTINGS);
  }

  set(entries: LeaderboardEntry[], s: WattsSettings, highlightId?: string): void {
    this.list.replaceChildren();
    if (entries.length === 0) {
      const li = document.createElement('li');
      li.className = 'ap-board__empty';
      li.textContent = '今天還沒有人挑戰，第一名等你來拿';
      this.list.appendChild(li);
      return;
    }
    entries.slice(0, MAX_ROWS).forEach((e, i) => {
      const li = document.createElement('li');
      li.className = 'ap-board__row';
      if (i < 3) li.classList.add('is-podium');
      if (i === 0) li.classList.add('is-first');
      if (highlightId !== undefined && e.id === highlightId) li.classList.add('is-you');
      li.style.setProperty('--i', String(i));
      li.append(
        cell('ap-board__rank', String(i + 1)),
        cell('ap-board__who', `騎士 #${e.number}`),
        cell('ap-board__watts', boardWatts(e, s), '瓦'),
      );
      this.list.appendChild(li);
    });
  }
}

function cell(cls: string, text: string, unit?: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  if (unit) {
    const u = document.createElement('small');
    u.textContent = unit;
    s.appendChild(u);
  }
  return s;
}
