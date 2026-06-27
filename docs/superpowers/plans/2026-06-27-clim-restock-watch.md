# clim-restock-watch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a free, self-hosted tool that emails the user when a watched air-conditioner product page goes back in stock on French e-commerce sites.

**Architecture:** A GitHub Actions cron (every 15 min) runs a Node/TS script. For each due URL it fetches the page (free HTTP first, Firecrawl as fallback when blocked), detects stock status from schema.org JSON-LD (with text-matching fallbacks), and emails on the `rupture/inconnu → en_stock` transition. State and a monthly Firecrawl budget counter live in a committed `state.json`. The stock detector is pure and source-agnostic, so it's fully unit-tested.

**Tech Stack:** Node 20, TypeScript (ESM), `cheerio` (HTML/JSON-LD parsing), `nodemailer` (Gmail SMTP), `tsx` (run TS), `vitest` (tests). Firecrawl called over HTTP via native `fetch`.

## Global Constraints

- **Runtime:** Node 20, TypeScript ESM (`"type": "module"`), `moduleResolution: Bundler` (extensionless relative imports).
- **Firecrawl budget:** 1000 scrapes/month hard ceiling. Internal safety cap `FIRECRAWL_CAP = 950`. Never call Firecrawl when `count >= cap`.
- **Default cadences:** `DEFAULT_INTERVAL_MIN = 15` (free check), `DEFAULT_FIRECRAWL_INTERVAL_MIN = 60` (Firecrawl escalation per URL).
- **Stock statuses (exact strings):** `"en_stock"`, `"rupture"`, `"inconnu"`. A blocked/ambiguous page is ALWAYS `"inconnu"` and NEVER triggers an alert.
- **Alert rule:** alert iff `next === "en_stock" && prev !== "en_stock"`.
- **No secrets in code:** `FIRECRAWL_API_KEY`, `SMTP_USER`, `SMTP_PASS`, `ALERT_TO` come from env (GitHub Secrets).
- **Time injection:** all time-dependent logic takes an explicit `now: Date` parameter (no internal `new Date()` except in the `src/main.ts` entrypoint) so logic is deterministically testable.
- **Commit messages** end with the Co-Authored-By trailer for Claude.

---

## File Structure

- `package.json` — deps, scripts (`test`, `check`).
- `tsconfig.json` — TS config (ESM, Bundler resolution).
- `src/types.ts` — shared types + constants. (Produces types for every other file.)
- `src/detectStock.ts` — pure: HTML → `StockStatus`. JSON-LD cascade. **Core, TDD.**
- `src/budget.ts` — monthly Firecrawl counter, cap, projection. Pure.
- `src/state.ts` — load/save `state.json`, due checks, alert decision. Mostly pure.
- `src/fetchPage.ts` — `httpFetch`, `firecrawlFetch`, pure `classifyResponse` (blocked detection).
- `src/notify.ts` — pure `buildAlertEmail` + `sendAlertEmail` (nodemailer).
- `src/check.ts` — `runCheck(watchlist, state, deps)` orchestrator (deps injected → testable).
- `src/main.ts` — entrypoint: reads files/env, wires real deps, runs, saves, emails.
- `watchlist.json` — user config (starts with one commented example entry).
- `state.json` — initial empty state.
- `test/*.test.ts` — vitest unit/integration tests.
- `.github/workflows/check.yml` — cron + commit state.
- `README.md` — setup (secrets, adding URLs, 60-day reactivation).

---

## Task 1: Project scaffold + shared types

**Files:**
- Create: `package.json`, `tsconfig.json`, `src/types.ts`
- Test: `test/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `StockStatus`, `FetchMethod`, `WatchEntry`, `UrlState`, `FirecrawlBudget`, `State` types; constants `FIRECRAWL_CAP=950`, `DEFAULT_INTERVAL_MIN=15`, `DEFAULT_FIRECRAWL_INTERVAL_MIN=60`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "clim-restock-watch",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "check": "tsx src/main.ts"
  },
  "dependencies": {
    "cheerio": "^1.0.0",
    "nodemailer": "^6.9.14"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/nodemailer": "^6.4.15",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `src/types.ts`**

```typescript
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
```

- [ ] **Step 4: Write the smoke test**

```typescript
// test/smoke.test.ts
import { describe, it, expect } from "vitest";
import { FIRECRAWL_CAP, DEFAULT_INTERVAL_MIN, DEFAULT_FIRECRAWL_INTERVAL_MIN } from "../src/types";

describe("scaffold", () => {
  it("exposes budget constants", () => {
    expect(FIRECRAWL_CAP).toBe(950);
    expect(DEFAULT_INTERVAL_MIN).toBe(15);
    expect(DEFAULT_FIRECRAWL_INTERVAL_MIN).toBe(60);
  });
});
```

- [ ] **Step 5: Install deps and run the test**

Run: `npm install && npm test`
Expected: install succeeds; 1 test file, 1 test passing.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json src/types.ts test/smoke.test.ts
git commit -m "chore: scaffold project + shared types

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `detectStock` — JSON-LD cascade (core)

**Files:**
- Create: `src/detectStock.ts`
- Test: `test/detectStock.test.ts`

**Interfaces:**
- Consumes: `StockStatus` from `src/types`.
- Produces: `detectStock(html: string, match?: string | null): StockStatus` and `parseJsonLdAvailability(html: string): StockStatus | null`.

- [ ] **Step 1: Write failing tests (JSON-LD primary path)**

```typescript
// test/detectStock.test.ts
import { describe, it, expect } from "vitest";
import { detectStock, parseJsonLdAvailability } from "../src/detectStock";

const jsonLdPage = (availability: string) => `
<!doctype html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product","name":"Clim",
 "offers":{"@type":"Offer","price":"299","availability":"${availability}"}}
</script></head><body>contenu</body></html>`;

describe("parseJsonLdAvailability", () => {
  it("maps InStock URL to en_stock", () => {
    expect(parseJsonLdAvailability(jsonLdPage("https://schema.org/InStock"))).toBe("en_stock");
  });
  it("maps OutOfStock URL to rupture", () => {
    expect(parseJsonLdAvailability(jsonLdPage("https://schema.org/OutOfStock"))).toBe("rupture");
  });
  it("maps bare InStock token to en_stock", () => {
    expect(parseJsonLdAvailability(jsonLdPage("InStock"))).toBe("en_stock");
  });
  it("finds availability nested in an offers array", () => {
    const html = `<script type="application/ld+json">
      {"@type":"Product","offers":[{"@type":"Offer","availability":"https://schema.org/OutOfStock"}]}
      </script>`;
    expect(parseJsonLdAvailability(html)).toBe("rupture");
  });
  it("returns null when no JSON-LD availability present", () => {
    expect(parseJsonLdAvailability("<html><body>rien</body></html>")).toBeNull();
  });
  it("ignores malformed JSON-LD without throwing", () => {
    const html = `<script type="application/ld+json">{ broken json </script>`;
    expect(parseJsonLdAvailability(html)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- detectStock`
Expected: FAIL — `detectStock`/`parseJsonLdAvailability` not exported (module not found).

- [ ] **Step 3: Implement `src/detectStock.ts`**

```typescript
import * as cheerio from "cheerio";
import type { StockStatus } from "./types";

const IN_STOCK_TERMS = [
  "instock", "limitedavailability", "preorder", "backorder",
  "onlineonly", "instoreonly", "presale",
];
const OUT_OF_STOCK_TERMS = ["outofstock", "soldout", "discontinued"];

function collectAvailability(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectAvailability(item, out);
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key.toLowerCase() === "availability" && typeof value === "string") {
        out.push(value);
      } else {
        collectAvailability(value, out);
      }
    }
  }
}

export function parseJsonLdAvailability(html: string): StockStatus | null {
  const $ = cheerio.load(html);
  const found: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw.trim()) return;
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return; // ignore malformed JSON-LD
    }
    collectAvailability(data, found);
  });
  if (found.length === 0) return null;
  const norm = found.map((a) => a.toLowerCase().split("/").pop() ?? "");
  if (norm.some((a) => IN_STOCK_TERMS.includes(a))) return "en_stock";
  if (norm.some((a) => OUT_OF_STOCK_TERMS.includes(a))) return "rupture";
  return null;
}

export function detectStock(html: string, match?: string | null): StockStatus {
  const jsonLd = parseJsonLdAvailability(html);
  if (jsonLd) return jsonLd;

  if (match && match.trim()) {
    return html.toLowerCase().includes(match.toLowerCase()) ? "en_stock" : "rupture";
  }

  const text = html.toLowerCase();
  const hasOOS = /indisponible|rupture|épuisé|epuise|out of stock|sold out/.test(text);
  const hasCart = /ajouter au panier|add to cart|en stock|disponible/.test(text);
  if (hasOOS && !hasCart) return "rupture";
  if (hasCart && !hasOOS) return "en_stock";
  return "inconnu";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- detectStock`
Expected: PASS (6 tests).

- [ ] **Step 5: Write failing tests (fallback cascade)**

Append to `test/detectStock.test.ts`:

```typescript
describe("detectStock fallback cascade", () => {
  it("uses match marker when JSON-LD absent (present -> en_stock)", () => {
    const html = "<html><body><button>Ajouter au panier</button></body></html>";
    expect(detectStock(html, "ajouter au panier")).toBe("en_stock");
  });
  it("uses match marker when JSON-LD absent (absent -> rupture)", () => {
    const html = "<html><body><span>Produit indisponible</span></body></html>";
    expect(detectStock(html, "ajouter au panier")).toBe("rupture");
  });
  it("heuristic: OOS terms without cart -> rupture", () => {
    const html = "<html><body>Ce produit est en rupture de stock</body></html>";
    expect(detectStock(html)).toBe("rupture");
  });
  it("heuristic: cart term without OOS -> en_stock", () => {
    const html = "<html><body><button>Ajouter au panier</button></body></html>";
    expect(detectStock(html)).toBe("en_stock");
  });
  it("ambiguous content -> inconnu", () => {
    const html = "<html><body>Bienvenue sur la boutique</body></html>";
    expect(detectStock(html)).toBe("inconnu");
  });
  it("JSON-LD wins over conflicting body text", () => {
    const html = jsonLdPage("https://schema.org/InStock") + "<div>indisponible</div>";
    expect(detectStock(html)).toBe("en_stock");
  });
});
```

- [ ] **Step 6: Run all detectStock tests**

Run: `npm test -- detectStock`
Expected: PASS (12 tests). The implementation from Step 3 already satisfies these — if any fail, fix `detectStock`, not the tests.

- [ ] **Step 7: Commit**

```bash
git add src/detectStock.ts test/detectStock.test.ts
git commit -m "feat: stock detection via JSON-LD cascade with text fallbacks

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `budget` — monthly Firecrawl counter

**Files:**
- Create: `src/budget.ts`
- Test: `test/budget.test.ts`

**Interfaces:**
- Consumes: `State`, `WatchEntry`, `FIRECRAWL_CAP`, `DEFAULT_FIRECRAWL_INTERVAL_MIN` from `src/types`.
- Produces: `currentMonth(now)`, `ensureMonth(state, now)`, `canSpend(state, now, cap?)`, `recordSpend(state, now)`, `projectMonthlyMax(watchlist)`.

- [ ] **Step 1: Write failing tests**

```typescript
// test/budget.test.ts
import { describe, it, expect } from "vitest";
import { currentMonth, ensureMonth, canSpend, recordSpend, projectMonthlyMax } from "../src/budget";
import type { State, WatchEntry } from "../src/types";

const blankState = (): State => ({ urls: {}, firecrawl: { month: "2026-06", count: 0 } });

describe("budget", () => {
  it("currentMonth formats YYYY-MM in UTC", () => {
    expect(currentMonth(new Date("2026-06-27T10:00:00Z"))).toBe("2026-06");
    expect(currentMonth(new Date("2026-01-03T23:00:00Z"))).toBe("2026-01");
  });
  it("ensureMonth resets count when month changes", () => {
    const s = blankState(); s.firecrawl.count = 500;
    ensureMonth(s, new Date("2026-07-01T00:00:00Z"));
    expect(s.firecrawl).toEqual({ month: "2026-07", count: 0 });
  });
  it("ensureMonth keeps count within same month", () => {
    const s = blankState(); s.firecrawl.count = 42;
    ensureMonth(s, new Date("2026-06-28T00:00:00Z"));
    expect(s.firecrawl.count).toBe(42);
  });
  it("canSpend false at cap", () => {
    const s = blankState(); s.firecrawl.count = 950;
    expect(canSpend(s, new Date("2026-06-28T00:00:00Z"))).toBe(false);
  });
  it("canSpend true below cap", () => {
    const s = blankState(); s.firecrawl.count = 949;
    expect(canSpend(s, new Date("2026-06-28T00:00:00Z"))).toBe(true);
  });
  it("recordSpend increments within month", () => {
    const s = blankState();
    recordSpend(s, new Date("2026-06-28T00:00:00Z"));
    expect(s.firecrawl.count).toBe(1);
  });
  it("projectMonthlyMax sums 43200/firecrawlIntervalMin for auto+firecrawl, skips fetch", () => {
    const wl: WatchEntry[] = [
      { nom: "a", url: "u1", method: "auto", firecrawlIntervalMin: 60 },   // 720
      { nom: "b", url: "u2", method: "firecrawl", firecrawlIntervalMin: 120 }, // 360
      { nom: "c", url: "u3", method: "fetch" },                            // 0
      { nom: "d", url: "u4" },                                             // default auto/60 => 720
    ];
    expect(projectMonthlyMax(wl)).toBe(720 + 360 + 0 + 720);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- budget`
Expected: FAIL — module `src/budget` not found.

- [ ] **Step 3: Implement `src/budget.ts`**

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- budget`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/budget.ts test/budget.test.ts
git commit -m "feat: monthly Firecrawl budget counter, cap, and projection

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `state` — load/save, due checks, alert decision

**Files:**
- Create: `src/state.ts`
- Test: `test/state.test.ts`

**Interfaces:**
- Consumes: `State`, `UrlState`, `StockStatus` from `src/types`.
- Produces: `loadState(path)`, `saveState(path, state)`, `getUrlState(state, url): UrlState`, `isDue(s, intervalMin, now): boolean`, `firecrawlDue(s, firecrawlIntervalMin, now): boolean`, `decideAlert(prev, next): boolean`.

- [ ] **Step 1: Write failing tests**

```typescript
// test/state.test.ts
import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync, existsSync } from "node:fs";
import { loadState, saveState, getUrlState, isDue, firecrawlDue, decideAlert } from "../src/state";
import type { UrlState } from "../src/types";

const NOW = new Date("2026-06-27T12:00:00Z");
const urlState = (over: Partial<UrlState> = {}): UrlState => ({
  url: "u", status: "rupture", lastCheck: null, lastFirecrawl: null, lastAlert: null, ...over,
});

describe("state persistence", () => {
  it("loadState returns empty state when file missing", () => {
    const p = join(tmpdir(), `crw-missing-${Math.floor(NOW.getTime())}.json`);
    if (existsSync(p)) rmSync(p);
    const s = loadState(p);
    expect(s).toEqual({ urls: {}, firecrawl: { month: "", count: 0 } });
  });
  it("saveState then loadState round-trips", () => {
    const p = join(tmpdir(), `crw-rt-${Math.floor(NOW.getTime())}.json`);
    const s = { urls: { u: urlState() }, firecrawl: { month: "2026-06", count: 3 } };
    saveState(p, s);
    expect(loadState(p)).toEqual(s);
    rmSync(p);
  });
  it("getUrlState returns a default for unknown url", () => {
    const s = { urls: {}, firecrawl: { month: "2026-06", count: 0 } };
    expect(getUrlState(s, "x")).toEqual({
      url: "x", status: "inconnu", lastCheck: null, lastFirecrawl: null, lastAlert: null,
    });
  });
});

describe("due checks", () => {
  it("isDue true when never checked", () => {
    expect(isDue(urlState({ lastCheck: null }), 15, NOW)).toBe(true);
  });
  it("isDue false when checked 5 min ago with 15 min interval", () => {
    const s = urlState({ lastCheck: new Date("2026-06-27T11:55:00Z").toISOString() });
    expect(isDue(s, 15, NOW)).toBe(false);
  });
  it("isDue true when checked 20 min ago with 15 min interval", () => {
    const s = urlState({ lastCheck: new Date("2026-06-27T11:40:00Z").toISOString() });
    expect(isDue(s, 15, NOW)).toBe(true);
  });
  it("firecrawlDue respects its own interval", () => {
    const s = urlState({ lastFirecrawl: new Date("2026-06-27T11:30:00Z").toISOString() });
    expect(firecrawlDue(s, 60, NOW)).toBe(false);   // only 30 min elapsed
    expect(firecrawlDue(s, 15, NOW)).toBe(true);
  });
});

describe("decideAlert", () => {
  it("alerts on rupture -> en_stock", () => {
    expect(decideAlert("rupture", "en_stock")).toBe(true);
  });
  it("alerts on inconnu -> en_stock", () => {
    expect(decideAlert("inconnu", "en_stock")).toBe(true);
  });
  it("no alert when already en_stock", () => {
    expect(decideAlert("en_stock", "en_stock")).toBe(false);
  });
  it("no alert on en_stock -> rupture", () => {
    expect(decideAlert("en_stock", "rupture")).toBe(false);
  });
  it("no alert on -> inconnu", () => {
    expect(decideAlert("rupture", "inconnu")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- state`
Expected: FAIL — module `src/state` not found.

- [ ] **Step 3: Implement `src/state.ts`**

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- state`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/state.ts test/state.test.ts
git commit -m "feat: state persistence, due checks, alert decision

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `fetchPage` — HTTP + Firecrawl fetchers + blocked detection

**Files:**
- Create: `src/fetchPage.ts`
- Test: `test/fetchPage.test.ts`

**Interfaces:**
- Consumes: nothing from project (uses global `fetch`).
- Produces: `FetchResult { html: string; blocked: boolean }`, `classifyResponse(status: number, html: string): boolean`, `httpFetch(url): Promise<FetchResult>`, `firecrawlFetch(url, apiKey): Promise<FetchResult>`.

- [ ] **Step 1: Write failing tests (pure `classifyResponse`)**

```typescript
// test/fetchPage.test.ts
import { describe, it, expect } from "vitest";
import { classifyResponse } from "../src/fetchPage";

const big = "<html>" + "x".repeat(1000) + "</html>";

describe("classifyResponse", () => {
  it("blocked on HTTP error status", () => {
    expect(classifyResponse(403, big)).toBe(true);
    expect(classifyResponse(429, big)).toBe(true);
  });
  it("blocked on tiny body", () => {
    expect(classifyResponse(200, "<html></html>")).toBe(true);
  });
  it("blocked on anti-bot markers", () => {
    expect(classifyResponse(200, "<html>" + "x".repeat(1000) + " please enable JavaScript and cookies </html>")).toBe(true);
    expect(classifyResponse(200, "<html>" + "y".repeat(1000) + " DataDome </html>")).toBe(true);
  });
  it("not blocked on a normal large page", () => {
    expect(classifyResponse(200, big)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- fetchPage`
Expected: FAIL — module `src/fetchPage` not found.

- [ ] **Step 3: Implement `src/fetchPage.ts`**

```typescript
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const BLOCK_MARKERS =
  /captcha|datadome|are you a human|access denied|pardon our interruption|request unsuccessful|cf-browser-verification|enable javascript and cookies/i;

export interface FetchResult {
  html: string;
  blocked: boolean;
}

export function classifyResponse(status: number, html: string): boolean {
  if (status >= 400) return true;
  if (html.trim().length < 500) return true;
  if (BLOCK_MARKERS.test(html)) return true;
  return false;
}

export async function httpFetch(url: string): Promise<FetchResult> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });
    const html = await res.text();
    return { html, blocked: classifyResponse(res.status, html) };
  } catch {
    return { html: "", blocked: true };
  }
}

export async function firecrawlFetch(url: string, apiKey: string): Promise<FetchResult> {
  try {
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["rawHtml"] }),
    });
    if (!res.ok) return { html: "", blocked: true };
    const json = (await res.json()) as { success?: boolean; data?: { rawHtml?: string } };
    const html = json.data?.rawHtml ?? "";
    return { html, blocked: classifyResponse(200, html) };
  } catch {
    return { html: "", blocked: true };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- fetchPage`
Expected: PASS (4 tests).

> Note: `httpFetch`/`firecrawlFetch` perform real network I/O and are not unit-tested here; they are exercised end-to-end in Task 7's integration test (via injected fakes) and manually in Task 8.

- [ ] **Step 5: Commit**

```bash
git add src/fetchPage.ts test/fetchPage.test.ts
git commit -m "feat: HTTP + Firecrawl fetchers with blocked-page detection

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `notify` — email builder + sender

**Files:**
- Create: `src/notify.ts`
- Test: `test/notify.test.ts`

**Interfaces:**
- Consumes: nothing from project (uses `nodemailer`).
- Produces: `Alert { nom: string; url: string }`, `buildAlertEmail(alerts): { subject: string; text: string }`, `sendAlertEmail(alerts, cfg): Promise<void>`.

- [ ] **Step 1: Write failing tests (pure `buildAlertEmail`)**

```typescript
// test/notify.test.ts
import { describe, it, expect } from "vitest";
import { buildAlertEmail } from "../src/notify";

describe("buildAlertEmail", () => {
  it("single alert: name in subject, url in body", () => {
    const { subject, text } = buildAlertEmail([{ nom: "Clim X", url: "https://ex.fr/x" }]);
    expect(subject).toContain("Clim X");
    expect(text).toContain("https://ex.fr/x");
  });
  it("multiple alerts: count in subject, all urls in body", () => {
    const { subject, text } = buildAlertEmail([
      { nom: "A", url: "https://ex.fr/a" },
      { nom: "B", url: "https://ex.fr/b" },
    ]);
    expect(subject).toContain("2");
    expect(text).toContain("https://ex.fr/a");
    expect(text).toContain("https://ex.fr/b");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- notify`
Expected: FAIL — module `src/notify` not found.

- [ ] **Step 3: Implement `src/notify.ts`**

```typescript
import nodemailer from "nodemailer";

export interface Alert {
  nom: string;
  url: string;
}

export function buildAlertEmail(alerts: Alert[]): { subject: string; text: string } {
  const n = alerts.length;
  const subject =
    n === 1
      ? `Clim de nouveau en stock : ${alerts[0].nom}`
      : `${n} clims de nouveau en stock`;
  const body = alerts.map((a) => `- ${a.nom}\n  ${a.url}`).join("\n\n");
  const text = `Retour en stock detecte :\n\n${body}\n`;
  return { subject, text };
}

export async function sendAlertEmail(
  alerts: Alert[],
  cfg: { user: string; pass: string; to: string },
): Promise<void> {
  if (alerts.length === 0) return;
  const { subject, text } = buildAlertEmail(alerts);
  const transport = nodemailer.createTransport({
    service: "gmail",
    auth: { user: cfg.user, pass: cfg.pass },
  });
  await transport.sendMail({ from: cfg.user, to: cfg.to, subject, text });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- notify`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notify.ts test/notify.test.ts
git commit -m "feat: alert email builder and Gmail sender

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `check` — orchestrator with injected deps

**Files:**
- Create: `src/check.ts`
- Test: `test/check.test.ts`

**Interfaces:**
- Consumes: `loadState`-adjacent helpers (`getUrlState`, `isDue`, `firecrawlDue`, `decideAlert`) from `src/state`; `ensureMonth`, `canSpend`, `recordSpend`, `projectMonthlyMax` from `src/budget`; `detectStock` from `src/detectStock`; `FetchResult` from `src/fetchPage`; `Alert` from `src/notify`; types + `DEFAULT_INTERVAL_MIN`, `DEFAULT_FIRECRAWL_INTERVAL_MIN` from `src/types`.
- Produces: `RunDeps` interface and `runCheck(watchlist, state, deps): Promise<Alert[]>`. `runCheck` mutates `state` in place (updates `urls` + `firecrawl.count`).

- [ ] **Step 1: Write failing integration tests (fake fetchers + fixed clock)**

```typescript
// test/check.test.ts
import { describe, it, expect, vi } from "vitest";
import { runCheck, type RunDeps } from "../src/check";
import type { State, WatchEntry } from "../src/types";

const NOW = new Date("2026-06-27T12:00:00Z");
const PAGE_IN = `<script type="application/ld+json">{"@type":"Product","offers":{"availability":"https://schema.org/InStock"}}</script>` + "x".repeat(600);
const PAGE_OUT = `<script type="application/ld+json">{"@type":"Product","offers":{"availability":"https://schema.org/OutOfStock"}}</script>` + "x".repeat(600);

const blankState = (): State => ({ urls: {}, firecrawl: { month: "2026-06", count: 0 } });

const deps = (over: Partial<RunDeps> = {}): RunDeps => ({
  now: NOW,
  http: vi.fn(async () => ({ html: PAGE_OUT, blocked: false })),
  firecrawl: vi.fn(async () => ({ html: PAGE_IN, blocked: false })),
  firecrawlApiKey: "key",
  log: () => {},
  ...over,
});

describe("runCheck", () => {
  it("alerts when a watched url transitions rupture -> en_stock", async () => {
    const wl: WatchEntry[] = [{ nom: "Clim", url: "u1", method: "fetch" }];
    const state = blankState();
    state.urls["u1"] = { url: "u1", status: "rupture", lastCheck: null, lastFirecrawl: null, lastAlert: null };
    const d = deps({ http: vi.fn(async () => ({ html: PAGE_IN, blocked: false })) });
    const alerts = await runCheck(wl, state, d);
    expect(alerts).toEqual([{ nom: "Clim", url: "u1" }]);
    expect(state.urls["u1"].status).toBe("en_stock");
  });

  it("no alert when status stays en_stock", async () => {
    const wl: WatchEntry[] = [{ nom: "Clim", url: "u1", method: "fetch" }];
    const state = blankState();
    state.urls["u1"] = { url: "u1", status: "en_stock", lastCheck: null, lastFirecrawl: null, lastAlert: null };
    const d = deps({ http: vi.fn(async () => ({ html: PAGE_IN, blocked: false })) });
    const alerts = await runCheck(wl, state, d);
    expect(alerts).toEqual([]);
  });

  it("skips urls that are not due", async () => {
    const wl: WatchEntry[] = [{ nom: "Clim", url: "u1", method: "fetch", intervalMin: 15 }];
    const state = blankState();
    state.urls["u1"] = {
      url: "u1", status: "rupture",
      lastCheck: new Date("2026-06-27T11:55:00Z").toISOString(),
      lastFirecrawl: null, lastAlert: null,
    };
    const http = vi.fn(async () => ({ html: PAGE_IN, blocked: false }));
    await runCheck(wl, state, deps({ http }));
    expect(http).not.toHaveBeenCalled();
  });

  it("auto: escalates to firecrawl when http blocked, and records a spend", async () => {
    const wl: WatchEntry[] = [{ nom: "Clim", url: "u1", method: "auto" }];
    const state = blankState();
    const http = vi.fn(async () => ({ html: "", blocked: true }));
    const firecrawl = vi.fn(async () => ({ html: PAGE_IN, blocked: false }));
    const alerts = await runCheck(wl, state, deps({ http, firecrawl }));
    expect(firecrawl).toHaveBeenCalledOnce();
    expect(state.firecrawl.count).toBe(1);
    expect(alerts).toEqual([{ nom: "Clim", url: "u1" }]);
  });

  it("auto: does NOT escalate to firecrawl when budget cap reached", async () => {
    const wl: WatchEntry[] = [{ nom: "Clim", url: "u1", method: "auto" }];
    const state = blankState();
    state.firecrawl.count = 950;
    const http = vi.fn(async () => ({ html: "", blocked: true }));
    const firecrawl = vi.fn(async () => ({ html: PAGE_IN, blocked: false }));
    await runCheck(wl, state, deps({ http, firecrawl }));
    expect(firecrawl).not.toHaveBeenCalled();
    expect(state.urls["u1"].status).toBe("inconnu"); // blocked -> inconnu, no alert
  });

  it("auto: does NOT escalate when firecrawl interval not elapsed", async () => {
    const wl: WatchEntry[] = [{ nom: "Clim", url: "u1", method: "auto", firecrawlIntervalMin: 60 }];
    const state = blankState();
    state.urls["u1"] = {
      url: "u1", status: "rupture",
      lastCheck: new Date("2026-06-27T11:40:00Z").toISOString(),  // due (20m ago)
      lastFirecrawl: new Date("2026-06-27T11:30:00Z").toISOString(), // only 30m ago
      lastAlert: null,
    };
    const http = vi.fn(async () => ({ html: "", blocked: true }));
    const firecrawl = vi.fn(async () => ({ html: PAGE_IN, blocked: false }));
    await runCheck(wl, state, deps({ http, firecrawl }));
    expect(firecrawl).not.toHaveBeenCalled();
  });

  it("no firecrawl when apiKey is null", async () => {
    const wl: WatchEntry[] = [{ nom: "Clim", url: "u1", method: "auto" }];
    const state = blankState();
    const http = vi.fn(async () => ({ html: "", blocked: true }));
    const firecrawl = vi.fn(async () => ({ html: PAGE_IN, blocked: false }));
    await runCheck(wl, state, deps({ http, firecrawl, firecrawlApiKey: null }));
    expect(firecrawl).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- check`
Expected: FAIL — module `src/check` not found.

- [ ] **Step 3: Implement `src/check.ts`**

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- check`
Expected: PASS (7 tests).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — all test files green (smoke, detectStock, budget, state, fetchPage, notify, check).

- [ ] **Step 6: Commit**

```bash
git add src/check.ts test/check.test.ts
git commit -m "feat: orchestrator runCheck with injected deps + budget/cadence gating

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Entrypoint, config, CI workflow, README

**Files:**
- Create: `src/main.ts`, `watchlist.json`, `state.json`, `.github/workflows/check.yml`, `README.md`

**Interfaces:**
- Consumes: `runCheck`, `RunDeps` from `src/check`; `httpFetch`, `firecrawlFetch` from `src/fetchPage`; `loadState`, `saveState` from `src/state`; `sendAlertEmail` from `src/notify`; `WatchEntry` from `src/types`.
- Produces: runnable `npm run check`.

- [ ] **Step 1: Create `src/main.ts`**

```typescript
import { readFileSync } from "node:fs";
import { runCheck, type RunDeps } from "./check";
import { httpFetch, firecrawlFetch } from "./fetchPage";
import { loadState, saveState } from "./state";
import { sendAlertEmail } from "./notify";
import type { WatchEntry } from "./types";

const WATCHLIST_PATH = "watchlist.json";
const STATE_PATH = "state.json";

async function main(): Promise<void> {
  const watchlist = JSON.parse(readFileSync(WATCHLIST_PATH, "utf8")) as WatchEntry[];
  const state = loadState(STATE_PATH);
  const apiKey = process.env.FIRECRAWL_API_KEY ?? null;

  const deps: RunDeps = {
    now: new Date(),
    http: httpFetch,
    firecrawl: (url) => firecrawlFetch(url, apiKey ?? ""),
    firecrawlApiKey: apiKey,
    log: (m) => console.log(m),
  };

  const alerts = await runCheck(watchlist, state, deps);
  saveState(STATE_PATH, state);

  if (alerts.length > 0) {
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const to = process.env.ALERT_TO;
    if (!user || !pass || !to) {
      console.error("ERREUR: SMTP_USER / SMTP_PASS / ALERT_TO manquants, email non envoye.");
      process.exitCode = 1;
      return;
    }
    await sendAlertEmail(alerts, { user, pass, to });
    console.log(`Email envoye pour ${alerts.length} retour(s) en stock.`);
  } else {
    console.log("Aucun retour en stock.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Create `watchlist.json` (one example entry, replace with real URLs)**

```json
[
  {
    "nom": "EXEMPLE - remplace par ta vraie clim",
    "url": "https://www.example.fr/clim-mobile",
    "method": "auto",
    "intervalMin": 15,
    "firecrawlIntervalMin": 60,
    "match": null
  }
]
```

- [ ] **Step 3: Create `state.json` (initial empty state)**

```json
{
  "urls": {},
  "firecrawl": { "month": "", "count": 0 }
}
```

- [ ] **Step 4: Create `.github/workflows/check.yml`**

```yaml
name: clim restock check

on:
  schedule:
    - cron: "*/15 * * * *"
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: clim-restock-check
  cancel-in-progress: false

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install --no-audit --no-fund
      - run: npx tsx src/main.ts
        env:
          FIRECRAWL_API_KEY: ${{ secrets.FIRECRAWL_API_KEY }}
          SMTP_USER: ${{ secrets.SMTP_USER }}
          SMTP_PASS: ${{ secrets.SMTP_PASS }}
          ALERT_TO: ${{ secrets.ALERT_TO }}
      - name: Commit updated state
        run: |
          git config user.name "clim-bot"
          git config user.email "actions@github.com"
          git add state.json
          git diff --quiet --cached || git commit -m "chore: update state [skip ci]"
          git push
```

- [ ] **Step 5: Create `README.md`**

````markdown
# clim-restock-watch

Alerte email quand une climatisation repasse en stock sur une fiche produit e-commerce FR.
Tourne gratuitement via GitHub Actions (cron toutes les 15 min).

## Comment ca marche
1. `watchlist.json` liste les fiches produit a surveiller.
2. Toutes les 15 min, le workflow recupere chaque page (fetch gratuit, Firecrawl en
   fallback si bloquee), lit le stock via le JSON-LD schema.org, et met a jour `state.json`.
3. Quand un produit passe de `rupture`/`inconnu` a `en_stock`, tu recois un email.

## Installation
1. Pousse ce repo sur GitHub.
2. Renseigne les secrets (Settings > Secrets and variables > Actions) :
   - `SMTP_USER` : ton adresse Gmail.
   - `SMTP_PASS` : un **mot de passe d'application** Gmail (myaccount.google.com > Securite >
     Validation en 2 etapes > Mots de passe des applications). PAS ton mot de passe normal.
   - `ALERT_TO` : l'adresse qui recoit les alertes.
   - `FIRECRAWL_API_KEY` : ta cle Firecrawl (optionnel ; sans elle, seulement le fetch gratuit).
3. Le workflow demarre seul au prochain creneau cron (ou via "Run workflow").

## Ajouter une clim a surveiller
Edite `watchlist.json` :
```json
{
  "nom": "Nom lisible",
  "url": "https://...",
  "method": "auto",            // auto | fetch | firecrawl
  "intervalMin": 15,           // cadence de check (fetch gratuit)
  "firecrawlIntervalMin": 60,  // cadence max des appels Firecrawl
  "match": null                // optionnel : texte present si en stock
}
```

## Budget Firecrawl
Quota free = 1000 scrapes/mois. Le tool ne depasse jamais 950 (plafond de securite) et
n'appelle Firecrawl qu'en fallback (mode `auto`). Au demarrage il avertit si ta config
projette un pire-cas > 1000/mois ; reduis alors les `firecrawlIntervalMin`... pardon,
AUGMENTE les `firecrawlIntervalMin` (moins frequent = moins de scrapes).

## Limite a connaitre
GitHub desactive un workflow planifie apres **60 jours sans commit** sur le repo. Pour le
reactiver : ouvre l'onglet Actions et reactive le workflow, ou fais un commit. En pleine
saison clim, le commit auto de `state.json` suffit a le garder actif.

## Developpement
```bash
npm install
npm test          # suite vitest
npm run check     # lance un cycle en local (variables d'env requises pour l'email)
```
````

- [ ] **Step 6: Verify the entrypoint runs end-to-end locally (no email path)**

Run: `npm run check`
Expected: prints a per-URL status line for the example entry and `Aucun retour en stock.` (the example URL resolves to `inconnu` or `rupture`; no crash, `state.json` updated). No email is sent because there is no transition to `en_stock`.

- [ ] **Step 7: Run the full test suite one final time**

Run: `npm test`
Expected: PASS — all files green.

- [ ] **Step 8: Commit**

```bash
git add src/main.ts watchlist.json state.json .github/workflows/check.yml README.md
git commit -m "feat: entrypoint, config, CI cron workflow, and README

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (completed during planning)

**Spec coverage:**
- §1 objectif (alerte email, URLs précises) → Tasks 6, 7, 8. ✓
- §2 contraintes dures (budget 950, cron 60j, no secrets, time injection) → Task 3 (cap), Task 8 (workflow + README 60j + env secrets), all tasks (now injected). ✓
- §3 architecture mixte (auto fallback, deux cadences) → Task 7 (`runCheck`), Task 5 (fetchers). ✓
- §4 détection cascade (JSON-LD → match → heuristique → inconnu) → Task 2. ✓
- §5 état & anti-spam (transition) → Task 4 (`decideAlert`), Task 7 (applied). ✓
- §6 budget (compteur mensuel, garde-fou, projection) → Task 3. ✓
- §7 email (Gmail SMTP, récap) → Task 6. ✓
- §8 stack & structure → Tasks 1 + 8. ✓
- §9 tests (TDD detectStock, garde-fous a/b/c) → Task 2, plus Task 7 covers (a) blocked→inconnu, (b) stable en_stock no re-alert, (c) cap→no firecrawl. ✓
- §10 risques/extensibilité → `fetchPage` pluggable, `detectStock` source-agnostic. ✓

**Placeholder scan:** No TBD/TODO; the `watchlist.json` example entry is an intentional, replaceable starter (documented as such), not a plan placeholder.

**Type consistency:** `StockStatus`/`FetchMethod`/`WatchEntry`/`UrlState`/`State` defined in Task 1 and used identically across Tasks 2–8. `FetchResult` defined in Task 5, consumed in Task 7. `Alert` defined in Task 6, produced by `runCheck` in Task 7, consumed in Task 8. `runCheck` / `RunDeps` signatures match between Task 7 definition and Task 8 usage. Helper names (`isDue`, `firecrawlDue`, `decideAlert`, `canSpend`, `recordSpend`, `ensureMonth`, `projectMonthlyMax`, `detectStock`) are consistent between definition and consumption.
