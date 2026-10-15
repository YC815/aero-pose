import { JOINTS, type PlayerSkeleton } from './types';

const VIS = 0.5;
const MIN_SPAN_S = 0.2;
const EPS = 1e-6; // 吸收浮點時間誤差

/** 開始手勢：雙手腕都比鼻子高 margin 以上，且兩手腕與鼻都可見。 */
export function handsUp(sk: PlayerSkeleton, margin = 0.05): boolean {
  const v = sk.visibility;
  if (v.nose < VIS || v.left_wrist < VIS || v.right_wrist < VIS) return false;
  const limit = sk.joints.nose[1] + margin;
  return sk.joints.left_wrist[1] > limit && sk.joints.right_wrist[1] > limit;
}

interface Sample {
  t: number;
  sk: PlayerSkeleton;
}

/** 視窗內最舊與最新樣本間，可見關節的平均速度。 */
export class StillnessDetector {
  private readonly windowS: number;
  private samples: Sample[] = [];

  constructor(windowS = 0.5) {
    this.windowS = windowS;
  }

  push(sk: PlayerSkeleton, t: number): void {
    this.samples.push({ t, sk });
    const cutoff = t - this.windowS - EPS;
    while (this.samples.length > 0 && this.samples[0].t < cutoff) this.samples.shift();
  }

  /** m/s；樣本 < 2、時間跨度 < 0.2 s、或沒有兩端都可見的關節時回 Infinity。 */
  meanSpeed(): number {
    if (this.samples.length < 2) return Infinity;
    const a = this.samples[0];
    const b = this.samples[this.samples.length - 1];
    const dt = b.t - a.t;
    if (dt < MIN_SPAN_S - EPS) return Infinity;

    let sum = 0;
    let n = 0;
    for (const j of JOINTS) {
      if (a.sk.visibility[j] < VIS || b.sk.visibility[j] < VIS) continue;
      const p = a.sk.joints[j];
      const q = b.sk.joints[j];
      sum += Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
      n++;
    }
    return n === 0 ? Infinity : sum / n / dt;
  }

  reset(): void {
    this.samples = [];
  }
}
