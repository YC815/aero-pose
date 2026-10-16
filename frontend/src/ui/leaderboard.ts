import type { LeaderboardEntry } from '../types';

const MAX_ROWS = 10;

/** 今日排行榜：主要數字是平均省幾瓦（後端依面積排序，等同依瓦數由大到小），前 3 名用螢光黃。 */
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
    this.set([]);
  }

  set(entries: LeaderboardEntry[], highlightId?: string): void {
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
      const watts = Math.round(e.watts_saved);
      const who = cell('ap-board__who', `騎士 #${e.number}`);
      who.appendChild(cell('ap-board__area', `${e.area_m2.toFixed(3)} m²`));
      li.append(
        cell('ap-board__rank', String(i + 1)),
        who,
        cell('ap-board__watts', watts >= 0 ? String(watts) : `−${-watts}`, '瓦'),
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
