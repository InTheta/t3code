import { describe, expect, it } from "vite-plus/test";

import { inboxSearch, parseProvenance, parseQuality } from "./sidecarApi";

describe("quality parsing", () => {
  it("rejects anything that is not the expected shape", () => {
    expect(parseQuality(null)).toBeNull();
    expect(parseQuality({ version: 2, findings: [] })).toBeNull();
    expect(parseProvenance({ version: 1, decisions: [] })).toBeNull();
  });

  it("keeps valid findings and drops malformed ones", () => {
    const quality = parseQuality({
      version: 1,
      passed: true,
      runs: 1,
      decisions: 2,
      traceable: 2,
      coverage: 1,
      counts: { fail: 0, warn: 1 },
      findings: [
        { severity: "warn", code: "x", message: "ok", runId: "r", ticket: "T" },
        { severity: "loud", message: "bad level" },
        { severity: "fail" },
      ],
      scorecard: {
        rows: [{ role: "qa", instance: "claude", model: "m", stages: 3, comparable: false }],
      },
    });
    expect(quality?.findings).toHaveLength(1);
    expect(quality?.counts).toEqual({ fail: 0, warn: 1, info: 0 });
    expect(quality?.rows[0]?.stages).toBe(3);
    expect(quality?.suggestions).toEqual([]);
  });

  it("reads a traced decision with unknown parts left empty", () => {
    const trace = parseProvenance({
      version: 1,
      runId: "r",
      decisions: [
        {
          id: "d",
          title: "t",
          by: { type: "person", name: null },
          gaps: [{ severity: "info", message: "m" }],
        },
      ],
    });
    expect(trace?.decisions[0]).toMatchObject({ byName: null, launch: null, tokens: null });
    expect(trace?.decisions[0]?.gaps).toHaveLength(1);
  });

  it("opens the quality view from an inbox link", () => {
    expect(inboxSearch("/delivery?view=quality")).toEqual({ view: "quality" });
  });
});
