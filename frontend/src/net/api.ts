import type { LeaderboardEntry, ResultRequest, ResultResponse, Settings } from '../types';

/**
 * REST 客戶端。fetchImpl 可注入，方便測試。
 * 非 2xx 一律 throw；每個請求（含讀 body）超過 timeoutMs（預設 8 秒）就 abort 並 throw「逾時」。
 */
export function createApi(
  fetchImpl: typeof fetch = (...args) => fetch(...args),
  opts: { timeoutMs?: number } = {},
) {
  const timeoutMs = opts.timeoutMs ?? 8000;

  async function request<T>(url: string, init: RequestInit): Promise<T> {
    const method = init.method ?? 'GET';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { ...init, signal: ctrl.signal });
      if (!res.ok) throw new Error(`${method} ${url} 失敗：HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      if (ctrl.signal.aborted) throw new Error(`${method} ${url} 逾時（${timeoutMs} ms）`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  function sendJson(method: 'PUT' | 'POST', body: unknown): RequestInit {
    return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  }

  return {
    getSettings(): Promise<Settings> {
      return request<Settings>('/api/settings', { method: 'GET' });
    },
    async putSettings(s: Settings): Promise<void> {
      await request<unknown>('/api/settings', sendJson('PUT', s));
    },
    getLeaderboard(date?: string): Promise<LeaderboardEntry[]> {
      const q = date ? `?date=${encodeURIComponent(date)}` : '';
      return request<LeaderboardEntry[]>(`/api/leaderboard${q}`, { method: 'GET' });
    },
    postResult(r: ResultRequest): Promise<ResultResponse> {
      return request<ResultResponse>('/api/results', sendJson('POST', r));
    },
  };
}

export type Api = ReturnType<typeof createApi>;
