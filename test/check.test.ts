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

  it("no firecrawl (and no spend) when apiKey is an empty string", async () => {
    const wl: WatchEntry[] = [{ nom: "Clim", url: "u1", method: "auto" }];
    const state = blankState();
    const http = vi.fn(async () => ({ html: "", blocked: true }));
    const firecrawl = vi.fn(async () => ({ html: PAGE_IN, blocked: false }));
    await runCheck(wl, state, deps({ http, firecrawl, firecrawlApiKey: "" }));
    expect(firecrawl).not.toHaveBeenCalled();
    expect(state.firecrawl.count).toBe(0);
  });

  it("logs a projection warning when worst-case Firecrawl usage exceeds 1000/month", async () => {
    const wl: WatchEntry[] = [{ nom: "Clim", url: "u1", method: "auto", firecrawlIntervalMin: 30 }];
    const state = blankState();
    const log = vi.fn();
    await runCheck(wl, state, deps({ log }));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("projection"));
  });
});
