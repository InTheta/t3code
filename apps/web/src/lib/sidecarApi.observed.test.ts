import { expect, it } from "vite-plus/test";

import { parseObserved } from "./sidecarApi";

const sample = {
  version: 1,
  available: true,
  windowHours: 24,
  threads: 3,
  runs: { total: 5, byStatus: { completed: 4, failed: 1 } },
  turns: 9,
  tokens: { inputTokens: 1000, cachedInputTokens: 900, outputTokens: 20, cacheHitRate: 0.9 },
  modelCoverage: { turns: 9, recordedOnTurn: 6, rate: 0.667 },
  models: [
    {
      provider: "codex",
      model: "m",
      turns: 9,
      inputTokens: 1000,
      outputTokens: 20,
      cacheHitRate: 0.9,
    },
  ],
  running: [
    { provider: "codex", model: "m", effort: "high", runtimeMode: "full-access", ageHours: 3.5 },
  ],
  runtimeModes: { "full-access": 3 },
  subagents: { sameVendor: 1, differentVendor: 2 },
  pullRequests: [
    { repository: "a/b", number: 4, url: "https://github.com/a/b/pull/4", threads: 1 },
    { repository: "a/b", number: 5, url: "https://evil.example/pull/5", threads: 1 },
  ],
  findings: [
    { severity: "warn", id: "x", message: "careful" },
    { severity: "bogus", id: "y", message: "dropped" },
  ],
};

it("parses an observed payload and keeps only github.com links", () => {
  const parsed = parseObserved(sample);
  expect(parsed?.failedRuns).toBe(1);
  expect(parsed?.cacheHitRate).toBe(0.9);
  expect(parsed?.running[0]?.title).toBeNull();
  expect(parsed?.pullRequests.map((pr) => pr.url)).toEqual(["https://github.com/a/b/pull/4", null]);
  expect(parsed?.findings.map((f) => f.id)).toEqual(["x"]);
});

it("returns null when activity is unavailable or the version is wrong", () => {
  expect(parseObserved({ ...sample, available: false })).toBeNull();
  expect(parseObserved({ ...sample, version: 2 })).toBeNull();
  expect(parseObserved("nope")).toBeNull();
});
