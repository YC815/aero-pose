// 無人看管的遊戲狀態機（v1.1 spec 流程章節）。純邏輯，時間由呼叫端傳入（秒）。

import { handsUp } from './motion';
import type { GameState, PlayerSkeleton, Settings } from './types';

export interface GameInput {
  now: number;
  player: PlayerSkeleton | null;
  cameraOk: boolean;
}

const EPS = 1e-6; // 吸收浮點時間誤差，讓「滿 N 秒」準時觸發
const TRACKED: readonly GameState[] = ['COUNTDOWN', 'RECORDING'];

const elapsed = (now: number, since: number | null): number => (since === null ? 0 : now - since);
const progress = (t: number, hold: number): number => (hold <= 0 ? 1 : Math.min(1, t / hold));

export class Game {
  state: GameState = 'ATTRACT';
  startProgress = 0;
  countdownLeft = 0;
  recordElapsed = 0;
  recordLeft = 0;
  resultLeft = 0;
  onTransition: ((from: GameState, to: GameState) => void) | null = null;

  private readonly getSettings: () => Settings;
  private enteredAt = 0;
  private handsUpSince: number | null = null;
  private lostSince: number | null = null;

  constructor(getSettings: () => Settings) {
    this.getSettings = getSettings;
  }

  update(input: GameInput): GameState {
    const { now, player, cameraOk } = input;
    const s = this.getSettings();

    if (!cameraOk) {
      if (this.state !== 'MAINTENANCE') this.enter('MAINTENANCE', now);
      return this.state;
    }

    // 失去玩家：連續計時，有玩家就歸零
    if (player) this.lostSince = null;
    else this.lostSince ??= now;
    if (TRACKED.includes(this.state) && elapsed(now, this.lostSince) >= s.lost_timeout_s - EPS) {
      this.enter('ATTRACT', now);
      return this.state;
    }

    const inState = now - this.enteredAt;
    switch (this.state) {
      case 'MAINTENANCE':
        this.enter('ATTRACT', now);
        break;

      case 'ATTRACT': {
        if (player && handsUp(player)) this.handsUpSince ??= now;
        else this.handsUpSince = null;
        const held = elapsed(now, this.handsUpSince);
        this.startProgress = this.handsUpSince === null ? 0 : progress(held, s.start_hold_s);
        if (this.handsUpSince !== null && held >= s.start_hold_s - EPS) this.enter('COUNTDOWN', now);
        break;
      }

      case 'COUNTDOWN':
        this.countdownLeft = Math.max(0, s.countdown_s - inState);
        if (inState >= s.countdown_s - EPS) this.enter('RECORDING', now);
        break;

      case 'RECORDING':
        this.recordElapsed = Math.min(s.record_s, inState);
        this.recordLeft = Math.max(0, s.record_s - inState);
        if (inState >= s.record_s - EPS) this.enter('RESULT', now);
        break;

      case 'RESULT':
        this.resultLeft = Math.max(0, s.result_s - inState);
        if (inState >= s.result_s - EPS) this.enter('ATTRACT', now);
        break;
    }
    return this.state;
  }

  /** 開發用（空白鍵）：ATTRACT 時直接進倒數。 */
  forceStart(now: number): void {
    if (this.state === 'ATTRACT') this.enter('COUNTDOWN', now);
  }

  private enter(to: GameState, now: number): void {
    const from = this.state;
    const s = this.getSettings();
    this.state = to;
    this.enteredAt = now;

    this.handsUpSince = null;
    this.startProgress = 0;
    this.countdownLeft = s.countdown_s;
    this.recordElapsed = 0;
    this.recordLeft = s.record_s;
    this.resultLeft = s.result_s;

    this.onTransition?.(from, to);
  }
}
