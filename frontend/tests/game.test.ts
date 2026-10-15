import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { DEFAULT_SETTINGS, type GameState, type PlayerSkeleton, type Settings } from '../src/types';
import { standingSkeleton, translated } from './fixtures';

const DT = 0.1;
const standing = standingSkeleton();
const armsUp = standingSkeleton({ armsForwardDeg: 180 });
/** 一直在動的玩家：每 0.1 秒往 +x 移 0.05 m（0.5 m/s）。 */
const moving = (i: number) => translated(standing, [0.05 * i, 0, 0]);

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
  /** 持續送 s 秒。 */
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
  /** 從 ATTRACT 一路走到 POSING。 */
  toPosing() {
    this.tick(standing);
    expect(this.game.state).toBe('READY');
    this.runUntil('POSING', armsUp, 2);
  }
}

describe('Game', () => {
  it('初始為 ATTRACT，沒人時保持', () => {
    const h = new Harness();
    expect(h.game.state).toBe('ATTRACT');
    h.run(2, null);
    expect(h.game.state).toBe('ATTRACT');
    expect(h.transitions).toEqual([]);
  });

  it('完整走一輪 ATTRACT → READY → POSING → COUNTDOWN → RESULT → ATTRACT', () => {
    const h = new Harness();
    h.tick(standing);
    expect(h.game.state).toBe('READY');
    expect(h.game.startProgress).toBe(0);

    h.run(0.5, armsUp);
    expect(h.game.startProgress).toBeGreaterThan(0.3);
    expect(h.game.startProgress).toBeLessThan(0.6);
    const tStart = 0.5 + h.runUntil('POSING', armsUp, 2);
    expect(tStart).toBeGreaterThan(0.95);
    expect(tStart).toBeLessThan(1.25);
    expect(h.game.stillProgress).toBe(0);
    expect(h.game.posingLeft).toBeCloseTo(20, 6);

    h.run(1.0, standing);
    expect(h.game.state).toBe('POSING');
    expect(h.game.stillProgress).toBeGreaterThan(0.3);
    expect(h.game.stillProgress).toBeLessThan(1);
    // 靜止 1.5 秒 + 偵測器暖機（至少 0.2 秒的樣本）
    const tStill = 1.0 + h.runUntil('COUNTDOWN', standing, 3);
    expect(tStill).toBeGreaterThan(1.55);
    expect(tStill).toBeLessThan(2.3);
    expect(h.game.countdownLeft).toBeCloseTo(3, 6);

    h.run(1.5, standing);
    expect(h.game.countdownLeft).toBeCloseTo(1.5, 6);
    const tCount = 1.5 + h.runUntil('RESULT', standing, 3);
    expect(tCount).toBeCloseTo(3, 6);
    expect(h.game.resultLeft).toBeCloseTo(12, 6);

    const tResult = h.runUntil('ATTRACT', null, 15);
    expect(tResult).toBeCloseTo(12, 6);

    expect(h.transitions).toEqual([
      ['ATTRACT', 'READY'],
      ['READY', 'POSING'],
      ['POSING', 'COUNTDOWN'],
      ['COUNTDOWN', 'RESULT'],
      ['RESULT', 'ATTRACT'],
    ]);
  });

  it('RESULT 結束時還有玩家 → READY', () => {
    const h = new Harness();
    h.toPosing();
    h.game.forceCountdown(h.now);
    h.runUntil('RESULT', standing, 4);
    expect(h.runUntil('READY', standing, 13)).toBeCloseTo(12, 6);
    expect(h.game.startProgress).toBe(0);
  });

  it('舉手中斷要歸零', () => {
    const h = new Harness();
    h.tick(standing);
    h.run(0.8, armsUp);
    expect(h.game.startProgress).toBeGreaterThan(0.6);
    h.tick(standing);
    expect(h.game.state).toBe('READY');
    expect(h.game.startProgress).toBe(0);
    h.run(0.8, armsUp);
    expect(h.game.state).toBe('READY');
    h.run(0.4, armsUp);
    expect(h.game.state).toBe('POSING');
  });

  it('POSING 一直動 → 滿 20 秒強制倒數', () => {
    const h = new Harness();
    h.toPosing();
    h.run(10, moving);
    expect(h.game.state).toBe('POSING');
    expect(h.game.stillProgress).toBe(0);
    expect(h.game.posingLeft).toBeCloseTo(10, 6);
    const t = 10 + h.runUntil('COUNTDOWN', (i) => moving(100 + i), 11);
    expect(t).toBeCloseTo(20, 6);
  });

  it('靜止被打斷要重新計時', () => {
    const h = new Harness();
    h.toPosing();
    h.run(1.4, standing);
    expect(h.game.state).toBe('POSING');
    expect(h.game.stillProgress).toBeGreaterThan(0.5);
    h.run(0.6, moving);
    expect(h.game.stillProgress).toBe(0);
    h.run(1.2, standing);
    expect(h.game.state).toBe('POSING');
  });

  it('短暫 null 不會回 ATTRACT，連續滿 3 秒才會（READY / POSING / COUNTDOWN）', () => {
    // 倒數拉長，避免倒數先結束
    const settings = { ...DEFAULT_SETTINGS, countdown_s: 10 };
    for (const enter of ['READY', 'POSING', 'COUNTDOWN'] as const) {
      const h = new Harness(settings);
      h.tick(standing);
      if (enter !== 'READY') h.runUntil('POSING', armsUp, 2);
      if (enter === 'COUNTDOWN') h.game.forceCountdown(h.now);
      expect(h.game.state).toBe(enter);

      h.run(2.0, null);
      h.tick(standing);
      expect(h.game.state).toBe(enter);
      h.run(2.8, null);
      expect(h.game.state).toBe(enter);
      h.run(0.4, null);
      expect(h.game.state).toBe('ATTRACT');
    }
  });

  it('cameraOk=false → MAINTENANCE；恢復 → ATTRACT', () => {
    const h = new Harness();
    h.toPosing();
    h.tick(standing, false);
    expect(h.game.state).toBe('MAINTENANCE');
    h.run(1, standing, false);
    expect(h.game.state).toBe('MAINTENANCE');
    h.tick(standing, true);
    expect(h.game.state).toBe('ATTRACT');
    expect(h.transitions.slice(-2)).toEqual([
      ['POSING', 'MAINTENANCE'],
      ['MAINTENANCE', 'ATTRACT'],
    ]);
  });

  it('ATTRACT 時鏡頭斷線也進 MAINTENANCE', () => {
    const h = new Harness();
    h.tick(null, false);
    expect(h.game.state).toBe('MAINTENANCE');
  });

  it('forceCountdown 只在 READY / POSING 生效', () => {
    const h = new Harness();
    h.game.forceCountdown(h.now);
    expect(h.game.state).toBe('ATTRACT');
    h.tick(standing);
    h.game.forceCountdown(h.now);
    expect(h.game.state).toBe('COUNTDOWN');
    expect(h.transitions.at(-1)).toEqual(['READY', 'COUNTDOWN']);
    h.game.forceCountdown(h.now);
    expect(h.transitions.length).toBe(2);
  });

  it('每次 update 讀最新設定', () => {
    const settings = { ...DEFAULT_SETTINGS };
    const h = new Harness(settings);
    h.tick(standing);
    settings.start_hold_s = 0.3;
    h.run(0.6, armsUp);
    expect(h.game.state).toBe('POSING');
  });
});
