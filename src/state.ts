import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { State, UrlState, StockStatus } from "./types";

export function loadState(path: string): State {
  if (!existsSync(path)) {
    return { urls: {}, firecrawl: { month: "", count: 0 } };
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<State>;
  return {
    urls: parsed.urls ?? {},
    firecrawl: parsed.firecrawl ?? { month: "", count: 0 },
  };
}

export function saveState(path: string, state: State): void {
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n", "utf8");
}

export function getUrlState(state: State, url: string): UrlState {
  return state.urls[url] ?? {
    url, status: "inconnu", lastCheck: null, lastFirecrawl: null, lastAlert: null,
  };
}

function minutesSince(iso: string | null, now: Date): number {
  if (!iso) return Infinity;
  return (now.getTime() - new Date(iso).getTime()) / 60000;
}

export function isDue(s: UrlState, intervalMin: number, now: Date): boolean {
  return minutesSince(s.lastCheck, now) >= intervalMin;
}

export function firecrawlDue(s: UrlState, firecrawlIntervalMin: number, now: Date): boolean {
  return minutesSince(s.lastFirecrawl, now) >= firecrawlIntervalMin;
}

export function decideAlert(prev: StockStatus, next: StockStatus): boolean {
  return next === "en_stock" && prev !== "en_stock";
}
