import GUI, { type Controller } from 'lil-gui';
import type { Api } from '../net/api';
import type { WSClient } from '../net/ws';
import { DEFAULT_SETTINGS, type PreviewMsg, type Settings } from '../types';

type Key = keyof Settings;
interface Field {
  key: Key;
  label: string;
  min: number;
  max: number;
  step: number;
}

const GROUPS: { title: string; fields: Field[] }[] = [
  {
    title: '偵測',
    fields: [
      { key: 'depth_near_m', label: '最近距離 (m)', min: 0.5, max: 4, step: 0.05 },
      { key: 'depth_far_m', label: '最遠距離 (m)', min: 1, max: 6, step: 0.05 },
      { key: 'zone_center_x_m', label: '站位中心 x (m)', min: -1.5, max: 1.5, step: 0.05 },
      { key: 'zone_half_width_m', label: '站位半寬 (m)', min: 0.1, max: 2, step: 0.05 },
      { key: 'filter_min_cutoff', label: '濾波 min cutoff', min: 0.05, max: 5, step: 0.05 },
      { key: 'filter_beta', label: '濾波 beta', min: 0, max: 1, step: 0.005 },
      { key: 'torso_gain', label: '軀幹前傾倍率', min: 0.5, max: 2, step: 0.05 },
    ],
  },
  {
    title: '相機',
    fields: [
      { key: 'camera_height_m', label: '相機高度 (m)', min: 0.3, max: 2.5, step: 0.01 },
      { key: 'camera_pitch_deg', label: '相機俯仰 (°)', min: -45, max: 45, step: 0.5 },
    ],
  },
  {
    title: '遊戲節奏',
    fields: [
      { key: 'start_hold_s', label: '舉手持續 (s)', min: 0.2, max: 5, step: 0.1 },
      { key: 'stillness_speed_mps', label: '靜止速度門檻 (m/s)', min: 0.02, max: 0.6, step: 0.01 },
      { key: 'stillness_hold_s', label: '靜止持續 (s)', min: 0.3, max: 5, step: 0.1 },
      { key: 'posing_max_s', label: '擺姿勢上限 (s)', min: 5, max: 60, step: 1 },
      { key: 'countdown_s', label: '倒數 (s)', min: 1, max: 10, step: 1 },
      { key: 'result_s', label: '結果顯示 (s)', min: 3, max: 60, step: 1 },
      { key: 'lost_timeout_s', label: '失去玩家逾時 (s)', min: 0.5, max: 10, step: 0.5 },
    ],
  },
  {
    title: '物理',
    fields: [
      { key: 'cd', label: '阻力係數 Cd', min: 0.3, max: 1.5, step: 0.01 },
      { key: 'speed_kmh', label: '換算時速 (km/h)', min: 10, max: 70, step: 1 },
      { key: 'air_density', label: '空氣密度 (kg/m³)', min: 1, max: 1.4, step: 0.005 },
    ],
  },
];

/**
 * 布置用設定面板（路人碰不到；由 main 綁 Ctrl+Shift+S 呼叫 toggle）。
 * 改完放開滑桿 → PUT /api/settings；打開時要求後端推相機預覽。
 */
export class SettingsPanel {
  private readonly el: HTMLElement;
  private readonly gui: GUI;
  private readonly ws: WSClient;
  private readonly api: Api;
  private readonly values: Settings = { ...DEFAULT_SETTINGS };
  private readonly controllers: Controller[] = [];
  private readonly img: HTMLImageElement;
  private readonly persons: HTMLOListElement;
  private readonly status: HTMLElement;
  private isOpen = false;

  constructor(root: HTMLElement, deps: { ws: WSClient; api: Api }) {
    this.ws = deps.ws;
    this.api = deps.api;
    this.el = document.createElement('aside');
    this.el.className = 'ap-settings';
    this.el.innerHTML = `
      <div class="ap-settings__preview">
        <header>相機預覽 <span class="ap-settings__status"></span></header>
        <img alt="相機預覽" />
        <ol class="ap-settings__persons"></ol>
        <p class="ap-settings__keys">Ctrl+Shift+S 關閉</p>
      </div>
      <div class="ap-settings__gui"></div>`;
    this.img = this.el.querySelector('img') as HTMLImageElement;
    this.persons = this.el.querySelector('.ap-settings__persons') as HTMLOListElement;
    this.status = this.el.querySelector('.ap-settings__status') as HTMLElement;

    this.gui = new GUI({
      container: this.el.querySelector('.ap-settings__gui') as HTMLElement,
      title: '設定',
      width: 380,
    });
    for (const g of GROUPS) {
      const folder = this.gui.addFolder(g.title);
      for (const f of g.fields) {
        const c = folder
          .add(this.values, f.key, f.min, f.max, f.step)
          .name(f.label)
          .onFinishChange(() => void this.save());
        this.controllers.push(c);
      }
    }
    this.setPreview({ type: 'preview', jpeg_b64: '', persons: [] });
    root.appendChild(this.el);
  }

  get open(): boolean {
    return this.isOpen;
  }

  toggle(): void {
    this.isOpen = !this.isOpen;
    this.el.classList.toggle('is-open', this.isOpen);
    this.ws.send({ type: 'preview', on: this.isOpen });
    if (this.isOpen) {
      this.api
        .getSettings()
        .then((s) => this.setSettings(s))
        .catch(() => this.setStatus('讀取設定失敗', true));
    } else {
      this.img.removeAttribute('src');
    }
  }

  /** 收到後端廣播的 settings 時同步顯示。 */
  setSettings(s: Settings): void {
    Object.assign(this.values, s);
    for (const c of this.controllers) c.updateDisplay();
  }

  setPreview(m: PreviewMsg): void {
    if (m.jpeg_b64) this.img.src = `data:image/jpeg;base64,${m.jpeg_b64}`;
    this.persons.replaceChildren();
    if (m.persons.length === 0) {
      const li = document.createElement('li');
      li.className = 'is-empty';
      li.textContent = '畫面中沒有偵測到人';
      this.persons.appendChild(li);
      return;
    }
    m.persons.forEach((p, i) => {
      const li = document.createElement('li');
      li.classList.toggle('is-selected', p.selected);
      li.textContent = `#${i + 1}　${p.distance_m.toFixed(2)} m　${p.selected ? '✔ 選中' : '—'}`;
      this.persons.appendChild(li);
    });
  }

  private async save(): Promise<void> {
    try {
      await this.api.putSettings({ ...this.values });
      this.setStatus('已儲存', false);
    } catch {
      this.setStatus('儲存失敗', true);
    }
  }

  private setStatus(text: string, error: boolean): void {
    this.status.textContent = text;
    this.status.classList.toggle('is-error', error);
  }
}
