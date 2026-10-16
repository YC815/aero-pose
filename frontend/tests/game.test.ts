import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { DEFAULT_SETTINGS, type GameState, type PlayerSkeleton, type Settings } from '../src/types';
import { standingSkeleton } from './fixtures';

const DT = 0.1;
const standing = standingSkeleton();
const armsUp = standingSkeleton({ armsForwardDeg: 180 });

type PlayerFeed = PlayerSkeleton | null | ((i: number) => PlayerSkeleton | null);

/** 用整數步數算時間，避免浮點累加誤差。 */
class Harness {
  game: Game;
  step = 0;
  transitions: [GameState, GameState][] = [];
  constructor(settings: Settings = DEFAULT_SETTINGS) {
    this.game = new Game(() => settings);
    this.game.onTransition = (from, to) => this.transitions.push([from, to]);
  }
  get now() {
    return this.step * DT;
  }
  tick(player: PlayerSkeleton | null, cameraOk = true): GameState {
    this.step++;
    return this.game.update({ now: this.now, player, cameraOk });
  }
  run(s: number, feed: PlayerFeed, cameraOk = true): GameState {
    const n = Math.round(s / DT);
    for (let i = 0; i < n; i++) this.tick(typeof feed === 'function' ? feed(i) : feed, cameraOk);
    return this.game.state;
  }
  /** 一直送到進入 target 為止，回傳經過秒數；超過 maxS 就失敗。 */
  runUntil(target: GameState, feed: PlayerFeed, maxS: number): number {
    const n = Math.round(maxS / DT);
    for (let i = 1; i <= n; i++) {
      if (this.tick(typeof feed === 'function' ? feed(i) : feed) === target) return i * DT;
    }
    throw new Error(`${maxS} 秒內沒有進入 ${target}，目前 ${this.game.state}`);
  }
  toCountdown() {
    this.runUntil('COUNTDOWN', armsUp, 2);
  }
  toRecording() {
    this.toCountdown();
    this.runUntil('RECORDING', standing, 4);
  }
}

describe('Game', () => {
  it('初始為 ATTRACT，沒人時保持，startProgress 為 0', () => {
    const h = new Harness();
    expect(h.game.state).toBe('ATTRACT');
    h.run(2, null);
    expect(h.game.state).toBe('ATTRACT');
    expect(h.game.startProgress).toBe(0);
    expect(h.transitions).toEqual([]);
  });

  it('站著不舉手不會開始', () => {
    const h = new Harness();
    h.run(5, standing);
    expect(h.game.state).toBe('ATTRACT');
    expect(h.game.startProgress).toBe(0);
  });

  it('完整走一輪 ATTRACT → COUNTDOWN → RECORDING → RESULT → ATTRACT', () => {
    const h = new Harness();
    h.run(0.5, armsUp);
    expect(h.game.startProgress).toBeGreaterThan(0.3);
    expect(h.game.startProgress).toBeLessThan(0.7);
    const tStart = 0.5 + h.runUntil('COUNTDOWN', armsUp, 2);
    expect(tStart).toBeGreaterThan(0.95);
    expect(tStart).toBeLessThan(1.25);
    expect(h.game.countdownLeft).toBeCloseTo(3, 6);

    h.run(1.5, standing);
    expect(h.game.countdownLeft).toBeCloseTo(1.5, 6);
    expect(1.5 + h.runUntil('RECORDING', standing, 3)).toBeCloseTo(3, 6);
    expect(h.game.recordElapsed).toBeCloseTo(0, 6);
    expect(h.game.recordLeft).toBeCloseTo(10, 6);

    h.run(4, standing);
    expect(h.game.state).toBe('RECORDING');
    expect(h.game.recordElapsed).toBeCloseTo(4, 6);
    expect(h.game.recordLeft).toBeCloseTo(6, 6);
    expect(4 + h.runUntil('RESULT', standing, 10)).toBeCloseTo(10, 6);
    expect(h.game.resultLeft).toBeCloseTo(12, 6);

    expect(h.runUntil('ATTRACT', standing, 15)).toBeCloseTo(12, 6);
    expect(h.transitions).toEqual([
      ['ATTRACT', 'COUNTDOWN'],
      ['COUNTDOWN', 'RECORDING'],
      ['RECORDING', 'RESULT'],
      ['RESULT', 'ATTRACT'],
    ]);
  });

  it('RESULT 結束一律回 ATTRACT，即使玩家還在', () => {
    const h = new Harness();
    h.toRecording();
    h.runUntil('RESULT', standing, 11);
    h.runUntil('ATTRACT', armsUp, 13);
    expect(h.game.startProgress).toBe(0);
  });

  it('舉手中斷要歸零', () => {
    const h = new Harness();
    h.run(0.8, armsUp);
    expect(h.game.startProgress).toBeGreaterThan(0.6);
    h.tick(standing);
    expect(h.game.state).toBe('ATTRACT');
    expect(h.game.startProgress).toBe(0);
    h.run(0.8, armsUp);
    expect(h.game.state).toBe('ATTRACT');
    h.run(0.4, armsUp);
    expect(h.game.state).toBe('COUNTDOWN');
  });

  it('舉手到一半玩家消失 → startProgress 歸零', () => {
    const h = new Harness();
    h.run(0.5, armsUp);
    h.tick(null);
    expect(h.game.startProgress).toBe(0);
  });

  it('RECORDING 中 settings.record_s 決定長度', () => {
    const h = new Harness({ ...DEFAULT_SETTINGS, record_s: 4 });
    h.toRecording();
    expect(h.runUntil('RESULT', standing, 6)).toBeCloseTo(4, 6);
  });

  it('短暫 null 不會回 ATTRACT，連續滿 3 秒才會（COUNTDOWN / RECORDING）', () => {
    const settings = { ...DEFAULT_SETTINGS, countdown_s: 10, record_s: 30 };
    for (const enter of ['COUNTDOWN', 'RECORDING'] as const) {
      const h = new Harness(settings);
      h.toCountdown();
      if (enter === 'RECORDING') h.runUntil('RECORDING', standing, 11);
      expect(h.game.state).toBe(enter);

      h.run(2.0, null);
      h.tick(standing);
      expect(h.game.state).toBe(enter);
      h.run(2.8, null);
      expect(h.game.state).toBe(enter);
      h.run(0.4, null);
      expect(h.game.state).toBe('ATTRACT');
      expect(h.transitions.at(-1)).toEqual([enter, 'ATTRACT']);
    }
  });

  it('RESULT 中玩家消失不影響', () => {
    const h = new Harness();
    h.toRecording();
    h.runUntil('RESULT', standing, 11);
    h.run(5, null);
    expect(h.game.state).toBe('RESULT');
  });

  it('cameraOk=false → MAINTENANCE；恢復 → ATTRACT', () => {
    const h = new Harness();
    h.toRecording();
    h.tick(standing, false);
    expect(h.game.state).toBe('MAINTENANCE');
    h.run(1, standing, false);
    expect(h.game.state).toBe('MAINTENANCE');
    h.tick(standing, true);
    expect(h.game.state).toBe('ATTRACT');
    expect(h.transitions.slice(-2)).toEqual([
      ['RECORDING', 'MAINTENANCE'],
      ['MAINTENANCE', 'ATTRACT'],
    ]);
  });

  it('任何狀態斷線都進 MAINTENANCE（ATTRACT / COUNTDOWN / RESULT）', () => {
    const a = new Harness();
    a.tick(null, false);
    expect(a.game.state).toBe('MAINTENANCE');

    const c = new Harness();
    c.toCountdown();
    c.tick(standing, false);
    expect(c.game.state).toBe('MAINTENANCE');

    const r = new Harness();
    r.toRecording();
    r.runUntil('RESULT', standing, 11);
    r.tick(standing, false);
    expect(r.game.state).toBe('MAINTENANCE');
  });

  it('dt 很大（分頁休眠）也能轉移，且一次 update 最多轉一個狀態', () => {
    const h = new Harness();
    h.game.update({ now: 0, player: armsUp, cameraOk: true });
    expect(h.game.update({ now: 100, player: armsUp, cameraOk: true })).toBe('COUNTDOWN');
    expect(h.game.update({ now: 200, player: standing, cameraOk: true })).toBe('RECORDING');
    expect(h.game.update({ now: 300, player: standing, cameraOk: true })).toBe('RESULT');
    expect(h.game.update({ now: 400, player: standing, cameraOk: true })).toBe('ATTRACT');
    expect(h.transitions.length).toBe(4);
  });

  it('forceStart 只在 ATTRACT 生效', () => {
    const h = new Harness();
    h.game.forceStart(h.now);
    expect(h.game.state).toBe('COUNTDOWN');
    expect(h.transitions.at(-1)).toEqual(['ATTRACT', 'COUNTDOWN']);
    h.game.forceStart(h.now);
    expect(h.transitions.length).toBe(1);
  });

  it('每次 update 讀最新設定', () => {
    const settings = { ...DEFAULT_SETTINGS };
    const h = new Harness(settings);
    h.tick(armsUp);
    settings.start_hold_s = 0.3;
    h.run(0.4, armsUp);
    expect(h.game.state).toBe('COUNTDOWN');
  });

  it('沒有玩家時 forceStart，下一個 update 仍在 COUNTDOWN', () => {
    const h = new Harness();
    h.run(5, null); // 舊的 lostSince 已累積
    h.game.forceStart(h.now);
    expect(h.tick(null)).toBe('COUNTDOWN');
    h.run(2, null);
    expect(h.game.state).toBe('COUNTDOWN');
  });

  it('COUNTDOWN → RECORDING 不重設遺失計時（連續消失）', () => {
    const settings = { ...DEFAULT_SETTINGS, countdown_s: 2, lost_timeout_s: 3 };
    const h = new Harness(settings);
    h.toCountdown();
    h.run(1.5, null);
    expect(h.game.state).toBe('COUNTDOWN');
    h.runUntil('RECORDING', null, 1);
    expect(h.game.state).toBe('RECORDING');
    expect(h.runUntil('ATTRACT', null, 3)).toBeCloseTo(1.1, 6); // 第一個 null 在進入後 0.1 s，連續消失 3 s
  });

  it('錄滿與遺失同時成立 → 錄滿優先，進 RESULT', () => {
    const settings = { ...DEFAULT_SETTINGS, record_s: 5, lost_timeout_s: 3 };
    const h = new Harness(settings);
    h.toRecording();
    h.run(1.9, standing);
    // 第一個 null 在 2.0 s，連續消失 3 s 與錄滿 5 s 在同一個 update（5.0 s）同時成立
    h.run(3.0, null);
    expect(h.game.state).toBe('RECORDING'); // 4.9 s：兩個條件都還沒成立
    h.tick(null);
    expect(h.game.state).toBe('RESULT');
    expect(h.transitions.at(-1)).toEqual(['RECORDING', 'RESULT']);
  });

  it('進入 RESULT 時保留 recordElapsed = record_s、recordLeft = 0；回 ATTRACT 後歸零', () => {
    const h = new Harness();
    h.toRecording();
    h.runUntil('RESULT', standing, 11);
    expect(h.game.recordElapsed).toBe(DEFAULT_SETTINGS.record_s);
    expect(h.game.recordLeft).toBe(0);
    h.run(1, standing);
    expect(h.game.recordElapsed).toBe(DEFAULT_SETTINGS.record_s);
    h.runUntil('ATTRACT', standing, 12);
    expect(h.game.recordElapsed).toBe(0);
  });
});
