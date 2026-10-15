import type { ServerMsg } from '../types';

export interface WSClient {
  send(msg: object): void;
  close(): void;
  readonly connected: boolean;
}

export interface WSHandlers {
  onMessage: (m: ServerMsg) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

const OPEN = 1;

/**
 * 連線到後端 /ws；斷線後每 retryMs 重連，直到呼叫 close()。
 * watchdog：連線中或已連線，超過 staleMs 沒收到任何資料（含壞封包）就當作半開連線，
 * 主動丟掉、呼叫 onClose、排重連。後端每秒推 status，所以 3 秒沒資料一定是斷了。
 */
export function connectWS(
  url: string,
  handlers: WSHandlers,
  opts: { retryMs?: number; staleMs?: number; WebSocketImpl?: typeof WebSocket } = {},
): WSClient {
  const retryMs = opts.retryMs ?? 1000;
  const staleMs = opts.staleMs ?? 3000;
  const Impl = opts.WebSocketImpl ?? WebSocket;
  let socket: WebSocket | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let staleTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  function clearStale(): void {
    if (staleTimer !== null) clearTimeout(staleTimer);
    staleTimer = null;
  }

  function armStale(ws: WebSocket): void {
    clearStale();
    staleTimer = setTimeout(() => drop(ws), staleMs);
  }

  function scheduleRetry(): void {
    if (!stopped && retryTimer === null) retryTimer = setTimeout(open, retryMs);
  }

  /** 收掉一條連線；只對目前這條有效，所以遲到的 close 事件不會重複觸發。 */
  function drop(ws: WebSocket): void {
    if (socket !== ws) return;
    socket = null;
    clearStale();
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    try {
      ws.close();
    } catch {
      // 已經關了就算了
    }
    handlers.onClose?.();
    scheduleRetry();
  }

  function open(): void {
    retryTimer = null;
    let ws: WebSocket;
    try {
      ws = new Impl(url);
    } catch {
      scheduleRetry(); // URL 錯或環境不支援：照樣每 retryMs 再試
      return;
    }
    socket = ws;
    armStale(ws);
    ws.onopen = () => {
      armStale(ws);
      handlers.onOpen?.();
    };
    ws.onmessage = (ev: MessageEvent) => {
      armStale(ws);
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMsg;
      } catch {
        return; // 壞封包直接丟
      }
      handlers.onMessage(msg);
    };
    ws.onclose = () => drop(ws);
  }

  open();

  return {
    send(msg: object): void {
      if (socket && socket.readyState === OPEN) socket.send(JSON.stringify(msg));
    },
    close(): void {
      stopped = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = null;
      if (socket) drop(socket);
    },
    get connected(): boolean {
      return socket !== null && socket.readyState === OPEN;
    },
  };
}

/** 依目前頁面位置推出 ws(s)://host/ws。 */
export function defaultWsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}
