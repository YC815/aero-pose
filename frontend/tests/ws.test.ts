import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectWS, parseFrame } from '../src/net/ws';
import type { ServerMsg } from '../src/types';

class FakeWS {
  static instances: FakeWS[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  url: string;
  readyState = 0;
  sent: string[] = [];
  closeCalls = 0;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeWS.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closeCalls++;
    this.fireClose();
  }
  // 測試用的手動觸發
  fireOpen() {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }
  fireMessage(data: string | ArrayBuffer) {
    this.onmessage?.({ data } as MessageEvent);
  }
  fireClose() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({} as CloseEvent);
  }
}

const Impl = FakeWS as unknown as typeof WebSocket;

beforeEach(() => {
  FakeWS.instances = [];
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('connectWS', () => {
  it('建立連線並在 open 時呼叫 onOpen、connected 變 true', () => {
    const onOpen = vi.fn();
    const c = connectWS('ws://h/ws', { onMessage: () => {}, onOpen }, { WebSocketImpl: Impl });
    expect(FakeWS.instances).toHaveLength(1);
    expect(FakeWS.instances[0].url).toBe('ws://h/ws');
    expect(c.connected).toBe(false);
    FakeWS.instances[0].fireOpen();
    expect(onOpen).toHaveBeenCalledOnce();
    expect(c.connected).toBe(true);
  });

  it('收到 JSON 會解析後呼叫 onMessage', () => {
    const got: ServerMsg[] = [];
    connectWS('ws://h/ws', { onMessage: (m) => got.push(m) }, { WebSocketImpl: Impl });
    const ws = FakeWS.instances[0];
    ws.fireOpen();
    ws.fireMessage(JSON.stringify({ type: 'status', camera: 'ok', fps: 30 }));
    expect(got).toEqual([{ type: 'status', camera: 'ok', fps: 30 }]);
  });

  it('壞掉的 JSON 不會炸，也不呼叫 onMessage', () => {
    const onMessage = vi.fn();
    connectWS('ws://h/ws', { onMessage }, { WebSocketImpl: Impl });
    FakeWS.instances[0].fireMessage('{not json');
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('send 會 JSON 序列化；未連線時丟棄', () => {
    const c = connectWS('ws://h/ws', { onMessage: () => {} }, { WebSocketImpl: Impl });
    const ws = FakeWS.instances[0];
    c.send({ type: 'preview', on: true });
    expect(ws.sent).toEqual([]);
    ws.fireOpen();
    c.send({ type: 'preview', on: true });
    expect(ws.sent).toEqual([JSON.stringify({ type: 'preview', on: true })]);
  });

  it('斷線後 retryMs 內重連，並呼叫 onClose', () => {
    const onClose = vi.fn();
    const c = connectWS('ws://h/ws', { onMessage: () => {}, onClose }, { WebSocketImpl: Impl, retryMs: 1000 });
    FakeWS.instances[0].fireOpen();
    FakeWS.instances[0].fireClose();
    expect(onClose).toHaveBeenCalledOnce();
    expect(c.connected).toBe(false);
    expect(FakeWS.instances).toHaveLength(1);
    vi.advanceTimersByTime(999);
    expect(FakeWS.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWS.instances).toHaveLength(2);
  });

  it('重連後的新連線訊息照樣送到 onMessage', () => {
    const onMessage = vi.fn();
    connectWS('ws://h/ws', { onMessage }, { WebSocketImpl: Impl, retryMs: 1000 });
    FakeWS.instances[0].fireClose();
    vi.advanceTimersByTime(1000);
    const ws2 = FakeWS.instances[1];
    ws2.fireOpen();
    ws2.fireMessage(JSON.stringify({ type: 'status', camera: 'disconnected', fps: 0 }));
    expect(onMessage).toHaveBeenCalledWith({ type: 'status', camera: 'disconnected', fps: 0 });
  });

  it('預設 retryMs 為 1000', () => {
    connectWS('ws://h/ws', { onMessage: () => {} }, { WebSocketImpl: Impl });
    FakeWS.instances[0].fireClose();
    vi.advanceTimersByTime(1000);
    expect(FakeWS.instances).toHaveLength(2);
  });

  it('連續失敗會一直重連', () => {
    connectWS('ws://h/ws', { onMessage: () => {} }, { WebSocketImpl: Impl, retryMs: 500 });
    for (let i = 0; i < 3; i++) {
      FakeWS.instances[i].fireClose();
      vi.advanceTimersByTime(500);
    }
    expect(FakeWS.instances).toHaveLength(4);
  });

  it('close() 後不再重連', () => {
    const onClose = vi.fn();
    const c = connectWS('ws://h/ws', { onMessage: () => {}, onClose }, { WebSocketImpl: Impl, retryMs: 1000 });
    FakeWS.instances[0].fireOpen();
    c.close();
    expect(FakeWS.instances[0].closeCalls).toBe(1);
    vi.advanceTimersByTime(10_000);
    expect(FakeWS.instances).toHaveLength(1);
    expect(c.connected).toBe(false);
  });

  it('等待重連期間呼叫 close() 也會取消重連', () => {
    const c = connectWS('ws://h/ws', { onMessage: () => {} }, { WebSocketImpl: Impl, retryMs: 1000 });
    FakeWS.instances[0].fireClose();
    vi.advanceTimersByTime(500);
    c.close();
    vi.advanceTimersByTime(10_000);
    expect(FakeWS.instances).toHaveLength(1);
  });

  describe('半開連線 watchdog', () => {
    it('已連線但 staleMs（預設 3000）沒收到訊息：主動 close、呼叫 onClose、retryMs 後重連', () => {
      const onClose = vi.fn();
      const c = connectWS('ws://h/ws', { onMessage: () => {}, onClose }, { WebSocketImpl: Impl, retryMs: 1000 });
      const ws = FakeWS.instances[0];
      ws.fireOpen();
      vi.advanceTimersByTime(2999);
      expect(ws.closeCalls).toBe(0);
      expect(onClose).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(ws.closeCalls).toBe(1);
      expect(onClose).toHaveBeenCalledOnce();
      expect(c.connected).toBe(false);
      vi.advanceTimersByTime(1000);
      expect(FakeWS.instances).toHaveLength(2);
    });

    it('持續有訊息就不會被斷', () => {
      const onClose = vi.fn();
      connectWS('ws://h/ws', { onMessage: () => {}, onClose }, { WebSocketImpl: Impl });
      const ws = FakeWS.instances[0];
      ws.fireOpen();
      for (let i = 0; i < 10; i++) {
        vi.advanceTimersByTime(2500);
        ws.fireMessage(JSON.stringify({ type: 'status', camera: 'ok', fps: 30 }));
      }
      expect(ws.closeCalls).toBe(0);
      expect(onClose).not.toHaveBeenCalled();
      expect(FakeWS.instances).toHaveLength(1);
    });

    it('壞 JSON 也算有收到資料（連線是活的）', () => {
      connectWS('ws://h/ws', { onMessage: () => {} }, { WebSocketImpl: Impl });
      const ws = FakeWS.instances[0];
      ws.fireOpen();
      vi.advanceTimersByTime(2500);
      ws.fireMessage('{bad');
      vi.advanceTimersByTime(2500);
      expect(ws.closeCalls).toBe(0);
    });

    it('可自訂 staleMs', () => {
      connectWS('ws://h/ws', { onMessage: () => {} }, { WebSocketImpl: Impl, staleMs: 500 });
      const ws = FakeWS.instances[0];
      ws.fireOpen();
      vi.advanceTimersByTime(500);
      expect(ws.closeCalls).toBe(1);
    });

    it('一直卡在連線中（沒 open）也會在 staleMs 後放棄重來', () => {
      connectWS('ws://h/ws', { onMessage: () => {} }, { WebSocketImpl: Impl, retryMs: 1000 });
      vi.advanceTimersByTime(3000);
      expect(FakeWS.instances[0].closeCalls).toBe(1);
      vi.advanceTimersByTime(1000);
      expect(FakeWS.instances).toHaveLength(2);
    });

    it('被 watchdog 斷掉的舊連線，之後才到的 close 事件不會重複觸發 onClose 或多開連線', () => {
      const onClose = vi.fn();
      // close() 不同步觸發 onclose，模擬瀏覽器在半開連線上 close 很久才回來
      class SlowCloseWS extends FakeWS {
        override close() {
          this.closeCalls++;
        }
      }
      connectWS('ws://h/ws', { onMessage: () => {}, onClose }, {
        WebSocketImpl: SlowCloseWS as unknown as typeof WebSocket,
        retryMs: 1000,
      });
      const ws = FakeWS.instances[0];
      ws.fireOpen();
      vi.advanceTimersByTime(3000);
      expect(onClose).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(1000);
      expect(FakeWS.instances).toHaveLength(2);
      ws.fireClose(); // 遲到的 close
      expect(onClose).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(5000);
      // 第 3 條只來自第 2 條自己的 watchdog（4000 建立 → 7000 逾時 → 8000 重連），遲到的 close 沒多開
      expect(FakeWS.instances).toHaveLength(3);
    });

    it('close() 後 watchdog 也停止', () => {
      const c = connectWS('ws://h/ws', { onMessage: () => {} }, { WebSocketImpl: Impl });
      FakeWS.instances[0].fireOpen();
      c.close();
      vi.advanceTimersByTime(10_000);
      expect(FakeWS.instances[0].closeCalls).toBe(1);
      expect(FakeWS.instances).toHaveLength(1);
    });
  });
});

/** 照後端 preview.pack_frame 組一個 frame 訊息。 */
function packFrame(header: Record<string, unknown>, jpeg: number[], mask: number[] | null): ArrayBuffer {
  const h = new TextEncoder().encode(
    JSON.stringify({ ...header, jpeg_len: jpeg.length, has_mask: mask !== null }),
  );
  const out = new Uint8Array(4 + h.length + jpeg.length + (mask?.length ?? 0));
  new DataView(out.buffer).setUint32(0, h.length, true);
  out.set(h, 4);
  out.set(jpeg, 4 + h.length);
  if (mask) out.set(mask, 4 + h.length + jpeg.length);
  return out.buffer;
}

const HEADER = { type: 'frame', ts: 1.5, width: 960, height: 540, mask_w: 3, mask_h: 2 };

describe('parseFrame', () => {
  it('解出 header、JPEG 與 mask', () => {
    const f = parseFrame(packFrame(HEADER, [0xff, 0xd8, 1, 2], [0, 255, 255, 0, 0, 255]));
    expect(f).toMatchObject({ type: 'frame', ts: 1.5, width: 960, height: 540, mask_w: 3, mask_h: 2 });
    expect(Array.from(f.jpeg)).toEqual([0xff, 0xd8, 1, 2]);
    expect(Array.from(f.mask!)).toEqual([0, 255, 255, 0, 0, 255]);
  });

  it('沒有 mask 時為 null', () => {
    expect(parseFrame(packFrame(HEADER, [0xff, 0xd8], null)).mask).toBeNull();
  });

  it('mask 長度不符 mask_w×mask_h 時 throw', () => {
    expect(() => parseFrame(packFrame(HEADER, [0xff, 0xd8], [0, 255, 255]))).toThrow();
    expect(() => parseFrame(packFrame(HEADER, [0xff, 0xd8], [0, 255, 255, 0, 0, 255, 0]))).toThrow();
  });

  it('connectWS 把二進位訊息當 frame 交給 onMessage，壞的丟掉', () => {
    const got: ServerMsg[] = [];
    connectWS('ws://h/ws', { onMessage: (m) => got.push(m) }, { WebSocketImpl: Impl });
    const ws = FakeWS.instances[0];
    ws.fireOpen();
    ws.fireMessage(packFrame(HEADER, [0xff, 0xd8], null));
    ws.fireMessage(new Uint8Array([1, 2, 3]).buffer);
    ws.fireMessage('{"type":"status","camera":"ok","fps":30}');
    expect(got.map((m) => m.type)).toEqual(['frame', 'status']);
  });
});
