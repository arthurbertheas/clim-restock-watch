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
