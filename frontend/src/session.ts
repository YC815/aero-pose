// RECORDING 期間的計分：每 0.1 s 對最新 pose 取樣一次，面積換算成省下的瓦數。

import type { RiderPose, SessionSample, SessionSummary, Settings } from './types';
import { wattsSaved } from './watts';

export interface SessionOptions {
  baselineM2: number;
  /** 由 main 注入：標準騎士＋曲柄固定 → 迎風面積（m²）。 */
  measure: (pose: RiderPose) => number;
  settings: () => Pick<Settings, 'cd' | 'speed_kmh' | 'air_density'>;
  sampleIntervalS?: number; // 預設 0.1
}

const EPS = 1e-6; // 吸收浮點時間誤差，讓 3/30 s 準時算跨過 0.1 s

export class RecordingSession {
  private readonly opts: SessionOptions;
  private readonly interval: number;
  private readonly _samples: SessionSample[] = [];
  private readonly poses: { t: number; pose: RiderPose }[] = [];
  private nextIndex = 0; // 下一個取樣時間點 = nextIndex * interval

  constructor(opts: SessionOptions) {
    this.opts = opts;
    this.interval = opts.sampleIntervalS ?? 0.1;
  }

  get samples(): readonly SessionSample[] {
    return this._samples;
  }

  /** t = RECORDING 開始後的秒數，非遞減。每次都存 pose；跨過下一個取樣點才 measure。 */
  push(pose: RiderPose, t: number): void {
    this.poses.push({ t, pose });
    const crossed = Math.floor((t + EPS) / this.interval); // 最後一個已跨過的時間點編號
    if (crossed < this.nextIndex) return;

    const areaM2 = this.opts.measure(pose);
    this._samples.push({
      t: crossed * this.interval,
      areaM2,
      watts: wattsSaved(this.opts.baselineM2, areaM2, this.opts.settings()),
    });
    this.nextIndex = crossed + 1;
  }

  latestWatts(): number | null {
    return this._samples.length === 0 ? null : this._samples[this._samples.length - 1].watts;
  }

  summary(durationS: number): SessionSummary {
    const n = this._samples.length;
    if (n === 0) throw new Error('RecordingSession: 沒有任何樣本');

    let sumArea = 0;
    let sumWatts = 0;
    let bestIndex = 0;
    this._samples.forEach((s, i) => {
      sumArea += s.areaM2;
      sumWatts += s.watts;
      if (s.areaM2 < this._samples[bestIndex].areaM2) bestIndex = i;
    });
    const meanAreaM2 = sumArea / n;
    const { baselineM2 } = this.opts;
    return {
      samples: [...this._samples],
      poses: [...this.poses],
      baselineM2,
      meanAreaM2,
      meanWatts: sumWatts / n,
      pct: ((baselineM2 - meanAreaM2) / baselineM2) * 100,
      bestIndex,
      durationS,
    };
  }
}
