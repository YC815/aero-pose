import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/types';
import { boardWatts } from '../src/ui/leaderboard';
import { wattsSaved } from '../src/watts';

describe('排行榜瓦數', () => {
  const entries = [0.3, 0.35, 0.42, 0.5, 0.55].map((area_m2) => ({ area_m2, baseline_m2: 0.5 }));

  it('用目前設定從面積重算，不看上傳時的 watts_saved', () => {
    const s = { ...DEFAULT_SETTINGS, speed_kmh: 30 };
    expect(boardWatts(entries[0], s)).toBe(String(Math.round(wattsSaved(0.5, 0.3, s))));
    expect(boardWatts({ area_m2: 0.55, baseline_m2: 0.5 }, s)).toMatch(/^−\d+$/);
    expect(boardWatts({ area_m2: 0.5, baseline_m2: 0.5 }, s)).toBe('0');
  });

  it('依面積升冪的名次 → 瓦數單調不增', () => {
    const w = entries.map((e) => Number(boardWatts(e, DEFAULT_SETTINGS).replace('−', '-')));
    for (let i = 1; i < w.length; i++) expect(w[i]).toBeLessThanOrEqual(w[i - 1]);
  });
});
