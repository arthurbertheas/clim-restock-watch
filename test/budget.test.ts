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
