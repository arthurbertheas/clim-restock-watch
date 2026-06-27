export type StockStatus = "en_stock" | "rupture" | "inconnu";
export type FetchMethod = "auto" | "fetch" | "firecrawl";

export interface WatchEntry {
  nom: string;
  url: string;
  method?: FetchMethod;            // default "auto"
  intervalMin?: number;            // default 15
  firecrawlIntervalMin?: number;   // default 60
  match?: string | null;           // optional in-stock text marker
}

export interface UrlState {
  url: string;
  status: StockStatus;
  lastCheck: string | null;        // ISO timestamp of last check (any method)
  lastFirecrawl: string | null;    // ISO timestamp of last Firecrawl call
  lastAlert: string | null;        // ISO timestamp of last alert sent
}

export interface FirecrawlBudget {
  month: string;                   // "YYYY-MM" (UTC)
  count: number;
}

export interface State {
  urls: Record<string, UrlState>;  // keyed by url
  firecrawl: FirecrawlBudget;
}

export const FIRECRAWL_CAP = 950;
export const DEFAULT_INTERVAL_MIN = 15;
export const DEFAULT_FIRECRAWL_INTERVAL_MIN = 60;
