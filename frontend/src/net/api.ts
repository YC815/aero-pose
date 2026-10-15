import type { LeaderboardEntry, ResultRequest, ResultResponse, Settings } from '../types';

/** REST 客戶端。fetchImpl 可注入，方便測試。非 2xx 一律 throw。 */
export function createApi(fetchImpl: typeof fetch = (...args) => fetch(...args)) {
  async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetchImpl(url, init);
    if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${url} 失敗：HTTP ${res.status}`);
    return (await res.json()) as T;
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
