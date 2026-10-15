// 無人攤位：要求螢幕不要休眠。分頁隱藏時瀏覽器會自動釋放 wake lock，回到可見時重新要求。
// 不支援或被拒絕一律靜默（start.sh 的 caffeinate 是另一道保險）。

interface SentinelLike {
  readonly released?: boolean;
}
interface WakeLockLike {
  request(type: 'screen'): Promise<SentinelLike>;
}
export interface WakeNav {
  wakeLock?: WakeLockLike;
}
export interface WakeDoc {
  readonly visibilityState: string;
  addEventListener(type: 'visibilitychange', cb: () => void): void;
}

/** 開始保持螢幕常亮；回傳的函式可手動重新要求（測試用）。永不 throw。 */
export function keepScreenAwake(
  nav: WakeNav = navigator as unknown as WakeNav,
  doc: WakeDoc = document,
): () => Promise<void> {
  let held: SentinelLike | null = null;

  async function request(): Promise<void> {
    try {
      const wl = nav.wakeLock;
      if (!wl || typeof wl.request !== 'function') return;
      if (doc.visibilityState !== 'visible') return;
      if (held && !held.released) return;
      held = await wl.request('screen');
    } catch (e) {
      held = null;
      console.warn('wake lock 要求失敗', e);
    }
  }

  try {
    doc.addEventListener('visibilitychange', () => void request());
  } catch {
    // 沒有 document 事件也照常跑
  }
  void request();
  return request;
}
