import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectWS } from '../src/net/ws';
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
  fireMessage(data: string) {
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
});
