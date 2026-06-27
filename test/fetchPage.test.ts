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
