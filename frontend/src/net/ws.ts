import type { FrameMsg, ServerMsg } from '../types';

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
    ws.binaryType = 'arraybuffer'; // frame 是二進位訊息
    armStale(ws);
    ws.onopen = () => {
      armStale(ws);
      handlers.onOpen?.();
    };
    ws.onmessage = (ev: MessageEvent) => {
      armStale(ws);
      let msg: ServerMsg;
      try {
        msg = ev.data instanceof ArrayBuffer ? parseFrame(ev.data) : (JSON.parse(String(ev.data)) as ServerMsg);
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

const utf8 = new TextDecoder();

/**
 * frame 二進位訊息（後端 preview.pack_frame）：[u32 LE header 長度][header JSON][JPEG][mask，mask_w×mask_h bytes，可無]。
 * jpeg / mask 是 buf 上的 view，不複製。長度對不上就 throw（呼叫端當壞封包丟掉）。
 */
export function parseFrame(buf: ArrayBuffer): FrameMsg {
  const n = new DataView(buf).getUint32(0, true);
  const h = JSON.parse(utf8.decode(new Uint8Array(buf, 4, n)));
  const jpegAt = 4 + n;
  const maskAt = jpegAt + h.jpeg_len;
  const maskLen = h.has_mask ? h.mask_w * h.mask_h : 0;
  if (h.type !== 'frame' || maskAt + maskLen !== buf.byteLength) {
    throw new Error(`frame 長度不符：${buf.byteLength} bytes`);
  }
  return {
    type: 'frame',
    ts: h.ts,
    width: h.width,
    height: h.height,
    mask_w: h.mask_w,
    mask_h: h.mask_h,
    jpeg: new Uint8Array(buf, jpegAt, h.jpeg_len),
    mask: h.has_mask ? new Uint8Array(buf, maskAt, maskLen) : null,
  };
}

/** 依目前頁面位置推出 ws(s)://host/ws。 */
export function defaultWsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}
