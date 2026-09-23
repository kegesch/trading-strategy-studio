export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Instrument {
  instId: string;
  instType: string;
  instFamily?: string;
  baseCcy?: string;
  quoteCcy?: string;
  settleCcy?: string;
  state?: string;
  instIdCode?: number;
  tickSz?: string;
  minSz?: string;
  maxLmtSz?: string;
}

export const DEFAULT_OKX_BASE = 'https://www.okx.com/api/v5';

export const OKX_BASE =
  (import.meta.env as { VITE_OKX_BASE_URL?: string }).VITE_OKX_BASE_URL ??
  DEFAULT_OKX_BASE;

const MAX_BAR_LIMIT = 300;
const MAX_INST_LIMIT = 200;

const TF_TO_OKX_BAR: Record<string, string> = {
  '1': '1m',
  '3': '3m',
  '5': '5m',
  '15': '15m',
  '30': '30m',
  '60': '1H',
  '120': '2H',
  '180': '3H',
  '240': '4H',
  '360': '6H',
  '720': '12H',
  '1D': '1D',
  '2D': '2D',
  '3D': '3D',
  '1W': '1W',
  '1M': '1M',
};

export function okxBarFor(timeframe: string): string {
  const bar = TF_TO_OKX_BAR[timeframe];
  if (!bar) throw new Error(`Unsupported timeframe for OKX: ${timeframe}`);
  return bar;
}

interface OkxResponse<T> {
  code: string;
  msg: string;
  data: T;
}

async function okxFetch<T>(
  path: string,
  params: Record<string, string> = {},
  baseUrl: string = OKX_BASE,
  timeoutMs: number = 15000,
): Promise<T> {
  const query = new URLSearchParams(params).toString();
  const base = baseUrl.replace(/\/$/, '');
  const url = query ? `${base}${path}?${query}` : `${base}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`OKX ${res.status} on ${path}: ${text}`);
    }
    let json: OkxResponse<T>;
    try {
      json = JSON.parse(text) as OkxResponse<T>;
    } catch {
      throw new Error(`OKX bad response on ${path}: ${text.slice(0, 200)}`);
    }
    if (json.code !== '0') {
      throw new Error(`OKX code ${json.code} on ${path}: ${json.msg}`);
    }
    return json.data;
  } finally {
    clearTimeout(timer);
  }
}

interface RawBar extends Bar {
  confirm: boolean;
}

function normalizeCandlesRow(row: string[]): RawBar {
  return {
    time: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
    confirm: row.length > 8 && row[8] === '1',
  };
}

function toBar(r: RawBar): Bar {
  return {
    time: r.time,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
  };
}

export function normalizeCandles(raw: string[][]): Bar[] {
  return raw
    .filter((row) => row.length >= 6)
    .map(normalizeCandlesRow)
    .map(toBar);
}

async function fetchCandlesRaw(
  instId: string,
  timeframe: string,
  limit: number,
  after?: number,
  before?: number,
  baseUrl: string = OKX_BASE,
): Promise<RawBar[]> {
  const bar = okxBarFor(timeframe);
  const params: Record<string, string> = {
    instId,
    bar,
    limit: String(Math.max(1, Math.min(limit, MAX_BAR_LIMIT))),
  };
  if (after != null) params.after = String(after);
  if (before != null) params.before = String(before);
  const data = await okxFetch<string[][]>(`/market/candles`, params, baseUrl);
  return data
    .filter((row) => row.length >= 6)
    .map(normalizeCandlesRow);
}

export async function fetchCandles(
  instId: string,
  timeframe: string,
  limit: number,
  after?: number,
  before?: number,
  baseUrl: string = OKX_BASE,
): Promise<Bar[]> {
  const raw = await fetchCandlesRaw(instId, timeframe, limit, after, before, baseUrl);
  return raw.map(toBar);
}

export async function fetchRecentCandles(
  instId: string,
  timeframe: string,
  limit: number,
  closedOnly = false,
  baseUrl: string = OKX_BASE,
): Promise<Bar[]> {
  if (limit <= 0) return [];
  const collected: RawBar[] = [];
  let after: number | undefined;
  let guard = 0;
  while (collected.length < limit && guard < 100) {
    guard += 1;
    const want = Math.min(MAX_BAR_LIMIT, limit - collected.length);
    const page = await fetchCandlesRaw(instId, timeframe, want, after, undefined, baseUrl);
    if (page.length === 0) break;
    after = Math.min(...page.map((b) => b.time));
    for (const b of page) {
      if (closedOnly && !b.confirm) continue;
      collected.push(b);
    }
  }
  const map = new Map<number, RawBar>();
  for (const b of collected) map.set(b.time, b);
  return Array.from(map.values())
    .sort((a, b) => a.time - b.time)
    .map(toBar)
    .slice(0, limit);
}

interface RawInstrument {
  instId: string;
  instType: string;
  state?: string;
  instFamily?: string;
  baseCcy?: string;
  quoteCcy?: string;
  settleCcy?: string;
  instIdCode?: number;
  [key: string]: unknown;
}

export async function fetchInstruments(
  instType: string,
  limit = 100,
  after?: number,
  baseUrl: string = OKX_BASE,
): Promise<Instrument[]> {
  const params: Record<string, string> = {
    instType,
    limit: String(Math.max(1, Math.min(limit, MAX_INST_LIMIT))),
  };
  if (after != null) params.after = String(after);
  const data = await okxFetch<RawInstrument[]>(
    `/public/instruments`,
    params,
    baseUrl,
  );
    return data.map((i) => ({
      instId: i.instId,
      instType: i.instType,
      instFamily: i.instFamily,
      baseCcy: i.baseCcy,
      quoteCcy: i.quoteCcy,
      settleCcy: i.settleCcy,
      state: i.state,
      instIdCode: i.instIdCode,
      tickSz: i.tickSz as string | undefined,
      minSz: i.minSz as string | undefined,
      maxLmtSz: i.maxLmtSz as string | undefined,
    }));
}

export async function fetchSymbols(
  instType: string,
  liveOnly = true,
  limit = 100,
  after?: number,
  baseUrl: string = OKX_BASE,
): Promise<string[]> {
  const instruments = await fetchInstruments(instType, limit, after, baseUrl);
  return instruments
    .filter((i) => (liveOnly ? i.state === 'live' : true))
    .map((i) => i.instId);
}
