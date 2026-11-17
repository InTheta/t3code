import { describe, expect, it, vi } from "vite-plus/test";

import { parseManagedRun, parseManagedRunId, readManagedRun } from "./managedRunDelivery";

const runId = "547c0437-b190-4c3f-a703-ae2c3d839e27";
const otherId = "547c0437-b190-4c3f-a703-ae2c3d839e28";
const run = {
  version: 1,
  runId,
  ticket: "T3-03",
  revision: "a".repeat(64),
  status: "approved",
  brief: {
    workspaceId: "isolated",
    repository: "InTheta/t3code",
    baseSha: "b".repeat(40),
    scope: "Delivery",
    tokens: 1000,
  },
  budget: { reserved: 1000, used: null, remaining: null },
  stages: [
    {
      stageId: `${runId}:lead`,
      role: "lead",
      status: "queued",
      providerInstanceId: null,
      threadId: null,
    },
  ],
};

describe("managed-run Delivery", () => {
  it("normalizes UUIDs and rejects values that could change the endpoint path", () => {
    expect(parseManagedRunId(` ${runId.toUpperCase()} `)).toBe(runId);
    expect(parseManagedRunId(`${runId}/extra`)).toBeUndefined();
  });

  it("preserves unknown metrics and accepts additive sidecar fields", () => {
    expect(parseManagedRun({ ...run, nextVersionField: null }, runId)).toMatchObject(run);
  });

  it("rejects mismatched identity and malformed evidence", () => {
    expect(parseManagedRun(run, otherId)).toBeNull();
    expect(parseManagedRun({ ...run, version: 2 }, runId)).toBeNull();
    expect(parseManagedRun({ ...run, budget: { ...run.budget, used: -1 } }, runId)).toBeNull();
    expect(parseManagedRun({ ...run, stages: [{ status: "queued" }] }, runId)).toBeNull();
  });

  it("reads fresh evidence and treats a disabled sidecar as unavailable", async () => {
    const { signal } = new AbortController();
    using fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json(run))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(readManagedRun(runId, signal)).resolves.toMatchObject(run);
    expect(fetch).toHaveBeenCalledWith(`/delivery-sidecar/v1/managed-runs/${runId}`, {
      cache: "no-store",
      signal,
    });
    await expect(readManagedRun(runId, signal)).resolves.toBeNull();
  });
});
