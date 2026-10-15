import { describe, expect, it } from 'vitest';
import { createApi } from '../src/net/api';
import { DEFAULT_SETTINGS, type LeaderboardEntry, type ResultResponse } from '../src/types';

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function fakeFetch(status: number, body: unknown) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const text = body === undefined ? null : JSON.stringify(body);
    return new Response(text, { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { impl, calls };
}

const entry: LeaderboardEntry = {
  id: 'abc',
  number: 3,
  area_m2: 0.41,
  baseline_m2: 0.5,
  watts_saved: 37,
  ts: 1728999999,
};

describe('createApi', () => {
  it('getSettings: GET /api/settings 並解析 JSON', async () => {
    const f = fakeFetch(200, DEFAULT_SETTINGS);
    const api = createApi(f.impl);
    const s = await api.getSettings();
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toBe('/api/settings');
    expect(f.calls[0].init?.method ?? 'GET').toBe('GET');
  });

  it('putSettings: PUT /api/settings，body 為整份 JSON', async () => {
    const f = fakeFetch(200, DEFAULT_SETTINGS);
    const api = createApi(f.impl);
    const s = { ...DEFAULT_SETTINGS, cd: 0.7 };
    await api.putSettings(s);
    expect(f.calls[0].url).toBe('/api/settings');
    expect(f.calls[0].init?.method).toBe('PUT');
    expect(JSON.parse(String(f.calls[0].init?.body))).toEqual(s);
    const headers = new Headers(f.calls[0].init?.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('getLeaderboard: 沒給日期打 /api/leaderboard', async () => {
    const f = fakeFetch(200, [entry]);
    const api = createApi(f.impl);
    const list = await api.getLeaderboard();
    expect(list).toEqual([entry]);
    expect(f.calls[0].url).toBe('/api/leaderboard');
  });

  it('getLeaderboard: 給日期帶 ?date=', async () => {
    const f = fakeFetch(200, []);
    const api = createApi(f.impl);
    await api.getLeaderboard('2026-10-15');
    expect(f.calls[0].url).toBe('/api/leaderboard?date=2026-10-15');
  });

  it('postResult: POST /api/results，回傳解析', async () => {
    const res: ResultResponse = { id: 'x1', number: 27, rank: 3, qr_url: null };
    const f = fakeFetch(200, res);
    const api = createApi(f.impl);
    const req = { area_m2: 0.412, baseline_m2: 0.5, watts_saved: 37, png_b64: 'iVBOR' };
    const out = await api.postResult(req);
    expect(out).toEqual(res);
    expect(f.calls[0].url).toBe('/api/results');
    expect(f.calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(f.calls[0].init?.body))).toEqual(req);
  });

  it.each([
    ['getSettings', (api: ReturnType<typeof createApi>) => api.getSettings()],
    ['putSettings', (api: ReturnType<typeof createApi>) => api.putSettings(DEFAULT_SETTINGS)],
    ['getLeaderboard', (api: ReturnType<typeof createApi>) => api.getLeaderboard()],
    [
      'postResult',
      (api: ReturnType<typeof createApi>) =>
        api.postResult({ area_m2: 1, baseline_m2: 1, watts_saved: 0, png_b64: '' }),
    ],
  ])('%s: 非 2xx 要 throw', async (_name, call) => {
    const f = fakeFetch(500, { detail: 'boom' });
    await expect(call(createApi(f.impl))).rejects.toThrow(/500/);
  });

  it('非 2xx（4xx）也要 throw', async () => {
    const f = fakeFetch(422, { detail: 'bad' });
    await expect(createApi(f.impl).putSettings(DEFAULT_SETTINGS)).rejects.toThrow(/422/);
  });
});
