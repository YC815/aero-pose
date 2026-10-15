import { describe, expect, it, vi } from 'vitest';
import { keepScreenAwake, type WakeDoc, type WakeNav } from '../src/wakelock';

function fakeDoc(state = 'visible') {
  const listeners: (() => void)[] = [];
  const doc = {
    visibilityState: state,
    addEventListener: (_t: 'visibilitychange', cb: () => void) => listeners.push(cb),
  };
  const fire = async (s: string) => {
    doc.visibilityState = s;
    for (const cb of listeners) cb();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { doc: doc as WakeDoc, fire };
}

function fakeNav(impl?: () => Promise<{ released: boolean }>) {
  const sentinels: { released: boolean }[] = [];
  const request = vi.fn(
    impl ??
      (async () => {
        const s = { released: false };
        sentinels.push(s);
        return s;
      }),
  );
  return { nav: { wakeLock: { request } } as WakeNav, request, sentinels };
}

const flush = async () => {
  for (let i = 0; i < 3; i++) await Promise.resolve();
};

describe('keepScreenAwake', () => {
  it('啟動時要求 screen wake lock', async () => {
    const { nav, request } = fakeNav();
    keepScreenAwake(nav, fakeDoc().doc);
    await flush();
    expect(request).toHaveBeenCalledWith('screen');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('分頁回到可見且 lock 已被釋放 → 重新要求；仍持有則不重複要求', async () => {
    const { nav, request, sentinels } = fakeNav();
    const { doc, fire } = fakeDoc();
    keepScreenAwake(nav, doc);
    await flush();
    await fire('visible');
    expect(request).toHaveBeenCalledTimes(1); // 還持有
    await fire('hidden');
    sentinels[0].released = true; // 瀏覽器在隱藏時釋放
    expect(request).toHaveBeenCalledTimes(1); // 隱藏時不要求
    await fire('visible');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('不支援 wakeLock → 不 throw', async () => {
    const { doc, fire } = fakeDoc();
    expect(() => keepScreenAwake({} as WakeNav, doc)).not.toThrow();
    await fire('visible');
  });

  it('request 被拒絕（reject 或同步 throw）→ 不 throw，之後可再試', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let n = 0;
    const { nav, request } = fakeNav(() => {
      n++;
      if (n === 1) return Promise.reject(new Error('NotAllowedError'));
      if (n === 2) throw new Error('sync boom');
      return Promise.resolve({ released: false });
    });
    const { doc, fire } = fakeDoc();
    const again = keepScreenAwake(nav, doc);
    await flush();
    await fire('visible');
    await again();
    expect(request).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });
});
