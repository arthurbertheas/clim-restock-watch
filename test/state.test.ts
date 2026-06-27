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
