import { describe, expect, it } from 'vitest';
import { validateSettings } from '../src/ui/settings';
import { DEFAULT_SETTINGS, type Settings } from '../src/types';

const ok = (patch: Partial<Settings>) => validateSettings({ ...DEFAULT_SETTINGS, ...patch });

describe('validateSettings', () => {
  it('預設值合法', () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS })).toBeNull();
  });

  it('最近距離 ≥ 最遠距離 → 錯誤', () => {
    expect(ok({ depth_near_m: 2.5, depth_far_m: 2.5 })).toMatch(/最近距離/);
    expect(ok({ depth_near_m: 3, depth_far_m: 2 })).toMatch(/最近距離/);
    expect(ok({ depth_near_m: 1.5, depth_far_m: 3 })).toBeNull();
  });

  it('record_s：3–30 合法，越界或非有限值 → 錯誤', () => {
    expect(ok({ record_s: 3 })).toBeNull();
    expect(ok({ record_s: 30 })).toBeNull();
    expect(ok({ record_s: 2 })).toMatch(/錄製/);
    expect(ok({ record_s: 31 })).toMatch(/錄製/);
    expect(ok({ record_s: NaN })).toMatch(/錄製/);
  });

  it('其他時間欄位越界 → 錯誤', () => {
    expect(ok({ start_hold_s: 0 })).not.toBeNull();
    expect(ok({ countdown_s: 0 })).not.toBeNull();
    expect(ok({ countdown_s: 11 })).not.toBeNull();
    expect(ok({ result_s: 2 })).not.toBeNull();
    expect(ok({ lost_timeout_s: 0 })).not.toBeNull();
    expect(ok({ lost_timeout_s: 11 })).not.toBeNull();
  });

  it('每個 Settings 欄位都有檢查（設成 NaN 一定報錯）', () => {
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      expect(ok({ [key]: NaN }), key).not.toBeNull();
    }
  });

  it('舊版欄位（stillness_* / posing_max_s）不影響驗證', () => {
    const legacy = { ...DEFAULT_SETTINGS, stillness_speed_mps: -1, posing_max_s: 999 } as Settings;
    expect(validateSettings(legacy)).toBeNull();
  });
});
