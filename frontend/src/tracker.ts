// 骨架 → 跟隨目標 + 定格緩衝。軀幹被擋的幀（例如深度前傾時髖部被身體遮住）
// 不能當成坐直：不進定格緩衝，跟隨目標暫時保留上一個有效姿勢。
import { UPRIGHT_POSE } from './poses';
import { retargetVisible } from './retarget';
import type { PlayerSkeleton, RiderPose } from './types';

/** 軀幹不可見時保留上一個有效姿勢多久，之後回坐直（spec §5.2：0.3 秒）。 */
export const TORSO_HOLD_S = 0.3;

export class PoseTracker {
  /** 最近 maxFrames 幀「軀幹可見」的 retarget 結果，定格用。 */
  recent: RiderPose[] = [];
  private last: RiderPose | null = null;
  private lastAt = -Infinity;
  private readonly maxFrames: number;
  private readonly holdS: number;

  constructor(maxFrames: number, holdS = TORSO_HOLD_S) {
    this.maxFrames = maxFrames;
    this.holdS = holdS;
  }

  /** 每收到一幀骨架呼叫；p = null 表示沒有玩家。 */
  push(p: PlayerSkeleton | null, now: number, torsoGain: number): void {
    if (!p) {
      this.last = null;
      return;
    }
    const pose = retargetVisible(p, torsoGain);
    if (!pose) return;
    this.last = pose;
    this.lastAt = now;
    this.recent.push(pose);
    if (this.recent.length > this.maxFrames) this.recent.shift();
  }

  /** 騎士該跟隨的姿勢：上一個有效姿勢（hold 期間內），否則坐直。 */
  target(now: number): RiderPose {
    return this.last && now - this.lastAt <= this.holdS ? this.last : UPRIGHT_POSE;
  }

  /** 換玩家時清掉定格緩衝，不讓上一位玩家的幀混進來。 */
  clear(): void {
    this.recent = [];
  }
}
