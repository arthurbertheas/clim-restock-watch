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
