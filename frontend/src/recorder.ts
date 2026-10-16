// 計分接線：skeleton → 計分用 PoseTracker → RecordingSession → summary。main 和整合測試共用這一份，
// 不碰 DOM / WebGL。
//
// 姿勢沿用規則（v1.1 spec 計分章節）：COUNTDOWN、RECORDING 期間無限期沿用上一個有效姿勢，
// 不論是軀幹被擋（髖部看不到）還是 player: null（偵測掉幀、寬限期）。玩家真的不見由 Game 的
// lost_timeout_s 中止、不記成績；沿用的一定是真的看到過的姿勢。進 COUNTDOWN 換一個新的 tracker，
// 不沿用上一位玩家。

import { RecordingSession } from './session';
import { PoseTracker } from './tracker';
import type { GameState, PlayerSkeleton, RiderPose, SessionSummary, Settings } from './types';

export interface RecorderOptions {
  baselineM2: number;
  /** 標準騎士＋曲柄固定 → 迎風面積（m²）。 */
  measure: (pose: RiderPose) => number;
  settings: () => Settings;
}

const newScoreTracker = (): PoseTracker => new PoseTracker(1, Infinity);

export class Recorder {
  private readonly opts: RecorderOptions;
  private tracker = newScoreTracker();
  private _session: RecordingSession | null = null;

  constructor(opts: RecorderOptions) {
    this.opts = opts;
  }

  /** 錄製中的 session；不在 RECORDING 時為 null。 */
  get session(): RecordingSession | null {
    return this._session;
  }

  /** 每收到一則 skeleton 呼叫。null 不清掉姿勢。 */
  onSkeleton(p: PlayerSkeleton | null, now: number): void {
    if (p) this.tracker.push(p, now, this.opts.settings().torso_gain);
  }

  /** 計分用的目前姿勢（還沒看到過有效姿勢時是坐直）。 */
  target(now: number): RiderPose {
    return this.tracker.target(now);
  }

  /**
   * Game 狀態轉移時呼叫（recordElapsed = 轉移當下的 game.recordElapsed）。
   * 離開 RECORDING 一律丟掉 session（中止不記成績）；錄滿進 RESULT 時補上最後一筆並回傳 summary，其他情況回 null。
   */
  onTransition(from: GameState, to: GameState, recordElapsed: number, now: number): SessionSummary | null {
    const done = this._session;
    this._session = null;
    if (to === 'COUNTDOWN') this.tracker = newScoreTracker();
    if (to === 'RECORDING') {
      this._session = new RecordingSession({
        baselineM2: this.opts.baselineM2,
        measure: this.opts.measure,
        settings: this.opts.settings,
      });
    }
    if (to !== 'RESULT' || from !== 'RECORDING' || !done) return null;
    // Game 錄滿進 RESULT 時保留 recordElapsed = record_s：補上 t = record_s 的最後一筆（共 101 筆）
    done.push(this.tracker.target(now), recordElapsed);
    return done.summary(this.opts.settings().record_s);
  }

  /** RECORDING 每幀呼叫；session 每 0.1 s 才 measure 一次。回傳目前的 session。 */
  step(now: number, recordElapsed: number): RecordingSession | null {
    this._session?.push(this.tracker.target(now), recordElapsed);
    return this._session;
  }
}
