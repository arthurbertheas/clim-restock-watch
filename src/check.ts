import { getUrlState, isDue, firecrawlDue, decideAlert } from "./state";
import { ensureMonth, canSpend, recordSpend, projectMonthlyMax } from "./budget";
import { detectStock } from "./detectStock";
import type { FetchResult } from "./fetchPage";
import type { Alert } from "./notify";
import type { State, WatchEntry, StockStatus } from "./types";
import { DEFAULT_INTERVAL_MIN, DEFAULT_FIRECRAWL_INTERVAL_MIN } from "./types";

export interface RunDeps {
  now: Date;
  http: (url: string) => Promise<FetchResult>;
  firecrawl: (url: string) => Promise<FetchResult>;
  firecrawlApiKey: string | null;
  log: (msg: string) => void;
}

export async function runCheck(
  watchlist: WatchEntry[],
  state: State,
  deps: RunDeps,
): Promise<Alert[]> {
  const { now, log } = deps;
  ensureMonth(state, now);

  const projected = projectMonthlyMax(watchlist);
  if (projected > 1000) {
    log(`WARN: projection Firecrawl pire-cas = ${projected}/mois > 1000. Augmente firecrawlIntervalMin.`);
  }

  const alerts: Alert[] = [];

  for (const entry of watchlist) {
    const method = entry.method ?? "auto";
    const intervalMin = entry.intervalMin ?? DEFAULT_INTERVAL_MIN;
    const fcIntervalMin = entry.firecrawlIntervalMin ?? DEFAULT_FIRECRAWL_INTERVAL_MIN;
    const s = getUrlState(state, entry.url);

    if (!isDue(s, intervalMin, now)) continue;

    const canUseFirecrawl = (): boolean =>
      deps.firecrawlApiKey != null && canSpend(state, now) && firecrawlDue(s, fcIntervalMin, now);

    let result: FetchResult = { html: "", blocked: true };
    let usedFirecrawl = false;

    if (method === "fetch") {
      result = await deps.http(entry.url);
    } else if (method === "firecrawl") {
      if (canUseFirecrawl()) {
        result = await deps.firecrawl(entry.url);
        usedFirecrawl = true;
      }
    } else {
      // auto
      result = await deps.http(entry.url);
      if (result.blocked && canUseFirecrawl()) {
        result = await deps.firecrawl(entry.url);
        usedFirecrawl = true;
      }
    }

    const newStatus: StockStatus = result.blocked ? "inconnu" : detectStock(result.html, entry.match);
    const prevStatus = s.status;

    s.lastCheck = now.toISOString();
    if (usedFirecrawl) {
      s.lastFirecrawl = now.toISOString();
      recordSpend(state, now);
    }
    s.status = newStatus;

    if (decideAlert(prevStatus, newStatus)) {
      s.lastAlert = now.toISOString();
      alerts.push({ nom: entry.nom, url: entry.url });
      log(`ALERTE: ${entry.nom} -> en_stock`);
    } else {
      log(`${entry.nom}: ${newStatus}${usedFirecrawl ? " (firecrawl)" : ""}`);
    }

    state.urls[entry.url] = s;
  }

  return alerts;
}
