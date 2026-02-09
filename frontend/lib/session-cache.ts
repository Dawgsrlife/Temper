import type { Trade } from '@/lib/biasDetector';

const SESSION_KEY = 'temper_current_session';
const DEFAULT_MAX_CACHED_TRADES = 1500;

type SessionCachePayload = {
  version: 1;
  total_trades: number;
  truncated: boolean;
  trades: Trade[];
};

function parseLegacyOrPayload(raw: string): Trade[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed as Trade[];
    }
    if (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as SessionCachePayload).trades)
    ) {
      return (parsed as SessionCachePayload).trades;
    }
  } catch {
    return null;
  }
  return null;
}

export function loadCachedSessionTrades(): Trade[] | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  const trades = parseLegacyOrPayload(raw);
  return trades && trades.length > 0 ? trades : null;
}

export function saveCachedSessionTrades(
  trades: Trade[],
  maxTrades: number = DEFAULT_MAX_CACHED_TRADES,
): void {
  if (typeof window === 'undefined') return;
  if (!Array.isArray(trades) || trades.length === 0) return;

  const boundedMax = Math.max(100, maxTrades);
  const sliced = trades.slice(0, boundedMax);
  const payload: SessionCachePayload = {
    version: 1,
    total_trades: trades.length,
    truncated: trades.length > sliced.length,
    trades: sliced,
  };

  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
  } catch {
    try {
      window.localStorage.removeItem(SESSION_KEY);
    } catch {
      // ignore
    }
  }
}

