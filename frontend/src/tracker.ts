// 骨架 → 跟隨目標 + 定格緩衝。軀幹被擋的幀（例如深度前傾時髖部被身體遮住）
// 不能當成坐直：不進定格緩衝，跟隨目標暫時保留上一個有效姿勢。
import { UPRIGHT_POSE } from './poses';
import { retargetVisible } from './retarget';
import { JOINTS, type JointName, type PlayerSkeleton, type RiderPose } from './types';

/** 軀幹不可見時保留上一個有效姿勢多久，之後回坐直（spec §5.2：0.3 秒）。 */
export const TORSO_HOLD_S = 0.3;

/** visibility 遲滯：≥ VIS_ON 才變「看得到」，< VIS_OFF 才變「看不到」。 */
export const VIS_ON = 0.5;
export const VIS_OFF = 0.3;

/**
 * 每個關節的可見狀態加遲滯。趴低時手肘、手腕、臉的 visibility 常在 0.5 上下晃，
 * 單一門檻會讓那段肢體在「量到的姿勢」和「沿用值」之間每幀切換，面積跟著跳。
 */
export class VisibilityGate {
  private readonly seen = new Set<JointName>();

  /** 回傳 visibility 換成 0 / 1 的骨架（joints 共用，不複製）。 */
  apply(sk: PlayerSkeleton): PlayerSkeleton {
    const visibility = {} as Record<JointName, number>;
    for (const j of JOINTS) {
      const v = sk.visibility[j];
      if (v >= VIS_ON) this.seen.add(j);
      else if (!(v >= VIS_OFF)) this.seen.delete(j); // NaN 也算看不到
      visibility[j] = this.seen.has(j) ? 1 : 0;
    }
    return { ...sk, visibility };
  }

  reset(): void {
    this.seen.clear();
  }
}

export class PoseTracker {
  /** 最近 maxFrames 幀「軀幹可見」的 retarget 結果，定格用。 */
  recent: RiderPose[] = [];
  private last: RiderPose | null = null;
  private lastAt = -Infinity;
  /** 最後一個有效姿勢；看不到的頭、手臂沿用它（player = null 不清掉）。 */
  private lastValid: RiderPose | null = null;
  private readonly gate = new VisibilityGate();
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
    const pose = retargetVisible(this.gate.apply(p), torsoGain, this.lastValid ?? UPRIGHT_POSE);
    if (!pose) return;
    this.last = pose;
    this.lastValid = pose;
    this.lastAt = now;
    this.recent.push(pose);
    if (this.recent.length > this.maxFrames) this.recent.shift();
  }

  /** 騎士該跟隨的姿勢：上一個有效姿勢（hold 期間內），否則坐直。 */
  target(now: number): RiderPose {
    return this.last && now - this.lastAt <= this.holdS ? this.last : UPRIGHT_POSE;
  }

  /** 換玩家時清掉定格緩衝與沿用狀態，不讓上一位玩家的幀混進來。 */
  clear(): void {
    this.recent = [];
    this.lastValid = null;
    this.gate.reset();
  }
}
