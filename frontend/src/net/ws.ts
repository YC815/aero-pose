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

/** 連線到後端 /ws；斷線後每 retryMs 重連，直到呼叫 close()。 */
export function connectWS(
  url: string,
  handlers: WSHandlers,
  opts: { retryMs?: number; WebSocketImpl?: typeof WebSocket } = {},
): WSClient {
  const retryMs = opts.retryMs ?? 1000;
  const Impl = opts.WebSocketImpl ?? WebSocket;
  let socket: WebSocket | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  function scheduleRetry(): void {
    if (!stopped && retryTimer === null) retryTimer = setTimeout(open, retryMs);
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
    ws.onopen = () => handlers.onOpen?.();
    ws.onmessage = (ev: MessageEvent) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMsg;
      } catch {
        return; // 壞封包直接丟
      }
      handlers.onMessage(msg);
    };
    ws.onclose = () => {
      if (socket === ws) socket = null;
      handlers.onClose?.();
      scheduleRetry();
    };
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
      socket?.close();
      socket = null;
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
