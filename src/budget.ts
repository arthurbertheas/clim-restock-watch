import type { State, WatchEntry } from "./types";
import { FIRECRAWL_CAP, DEFAULT_FIRECRAWL_INTERVAL_MIN } from "./types";

const MINUTES_PER_MONTH = 30 * 24 * 60; // 43200

export function currentMonth(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function ensureMonth(state: State, now: Date): void {
  const m = currentMonth(now);
  if (state.firecrawl.month !== m) {
    state.firecrawl.month = m;
    state.firecrawl.count = 0;
  }
}

export function canSpend(state: State, now: Date, cap: number = FIRECRAWL_CAP): boolean {
  ensureMonth(state, now);
  return state.firecrawl.count < cap;
}

export function recordSpend(state: State, now: Date): void {
  ensureMonth(state, now);
  state.firecrawl.count += 1;
}

export function projectMonthlyMax(watchlist: WatchEntry[]): number {
  let total = 0;
  for (const e of watchlist) {
    const method = e.method ?? "auto";
    if (method === "fetch") continue;
    const interval = e.firecrawlIntervalMin ?? DEFAULT_FIRECRAWL_INTERVAL_MIN;
    total += Math.floor(MINUTES_PER_MONTH / interval);
  }
  return total;
}
