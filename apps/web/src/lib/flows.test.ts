import { describe, expect, it } from "vite-plus/test";

import {
  buildPipelineFlow,
  buildTaskFlow,
  buildTrackFlow,
  type FleetTask,
  type FleetWaitingOn,
} from "./fleetFlow";
import type { ManagedRun } from "./managedRunDelivery";
import { buildRunFlow, stageFlowStatus } from "./runFlow";
import {
  formatAge,
  formatBytes,
  inboxSearch,
  parseFleetOverview,
  parseInbox,
  parseProposals,
  parseSidecarStatus,
  policyPatch,
  validateField,
} from "./sidecarApi";

const sha = "a".repeat(40);
const stage = (role: string, status: string, extra: object = {}) => ({
  stageId: `run:${role}`,
  role,
  status,
  providerInstanceId: "codex",
  threadId: null,
  ...extra,
});
const run = (stages: ManagedRun["stages"], extra: Partial<ManagedRun> = {}): ManagedRun => ({
  version: 1,
  runId: "85c0326b-52e0-46dc-899d-d451c5afb228",
  ticket: "LAB-1",
  revision: "b".repeat(64),
  status: "approved",
  brief: { workspaceId: "w", repository: "r", baseSha: sha, scope: "s", tokens: 10 },
  budget: { reserved: 1000, used: 250, remaining: 750 },
  stages,
  ...extra,
});
const node = (flow: ReturnType<typeof buildRunFlow>, id: string) =>
  flow.nodes.find((n) => n.id === id);
const edge = (flow: ReturnType<typeof buildRunFlow>, from: string, to: string) =>
  flow.edges.find((e) => e.from === from && e.to === to);

describe("stageFlowStatus", () => {
  it("maps stage statuses to what the diagram shows", () => {
    expect(stageFlowStatus("waiting_for_operator")).toBe("waiting");
    expect(stageFlowStatus("paused_provider_quota")).toBe("blocked");
    expect(stageFlowStatus("cancelling_quota")).toBe("blocked");
    expect(stageFlowStatus("completed")).toBe("done");
    expect(stageFlowStatus("running")).toBe("active");
    expect(stageFlowStatus("failed")).toBe("failed");
    expect(stageFlowStatus("something_new")).toBe("pending");
  });
});

describe("buildRunFlow", () => {
  it("shows stages not yet started as pending and follows no route past the brief", () => {
    const flow = buildRunFlow(run([]));
    expect(node(flow, "stage:lead")?.status).toBe("pending");
    expect(node(flow, "stage:qa")?.sub).toBe("not started");
    expect(edge(flow, "brief", "stage:lead")?.taken).toBe(false);
    expect(node(flow, "brief")?.sub).toBe("250 of 1,000 tokens");
  });

  it("follows a finished run to the QA verdict and the pull request", () => {
    const flow = buildRunFlow(
      run(
        [
          stage("lead", "completed"),
          stage("implementation", "completed"),
          stage("qa", "completed"),
        ],
        {
          qa: { reviewedSha: sha, verdict: "pass", source: "provider", budgetExceeded: false },
        },
      ),
    );
    expect(edge(flow, "stage:lead", "stage:implementation")?.taken).toBe(true);
    expect(edge(flow, "decision:verdict", "outcome:ready")?.taken).toBe(true);
    expect(node(flow, "outcome:ready")?.status).toBe("done");
    expect(edge(flow, "decision:verdict", "outcome:rework")?.taken).toBe(false);
  });

  it("sends a failed QA verdict back to implementation", () => {
    const flow = buildRunFlow(
      run(
        [
          stage("lead", "completed"),
          stage("implementation", "completed"),
          stage("qa", "completed"),
        ],
        {
          qa: { reviewedSha: sha, verdict: "fail", source: "operator", budgetExceeded: true },
        },
      ),
    );
    expect(node(flow, "decision:verdict")?.status).toBe("failed");
    expect(node(flow, "decision:verdict")?.sub).toContain("over budget");
    expect(edge(flow, "outcome:rework", "stage:implementation")?.taken).toBe(true);
    expect(node(flow, "outcome:ready")?.status).toBe("pending");
  });

  it("adds an approve or decline decision when a stage is paused on provider quota", () => {
    const flow = buildRunFlow(
      run([stage("lead", "completed"), stage("implementation", "paused_provider_quota")]),
    );
    const decision = node(flow, "decision:implementation");
    expect(decision?.kind).toBe("decision");
    expect(decision?.label).toBe("Quota reached");
    expect(decision?.stageId).toBe("run:implementation");
    expect(edge(flow, "decision:implementation", "stage:implementation")?.label).toBe(
      "approve: continue",
    );
    expect(edge(flow, "decision:implementation", "stopped:implementation")?.label).toBe("decline");
    expect(node(flow, "stage:implementation")?.status).toBe("blocked");
  });

  it("asks for the operator when a stage waits on one, without a quota decline route", () => {
    const flow = buildRunFlow(run([stage("lead", "waiting_for_operator")]));
    expect(node(flow, "decision:lead")?.label).toBe("Operator needed");
    expect(node(flow, "stopped:lead")).toBeUndefined();
  });

  it("shows the controller acceptance and tool calls on a stage", () => {
    const flow = buildRunFlow(
      run([stage("lead", "running", { toolCalls: 12 })], {
        workflowEvents: [
          { kind: "symphony-controller-accepted", at: "2026-11-20T00:00:00Z", stageId: "run:lead" },
        ],
      }),
    );
    expect(node(flow, "stage:lead")?.sub).toBe("running · controller accepted · 12 tool calls");
  });

  it("only links edges between nodes that exist", () => {
    const flow = buildRunFlow(run([stage("implementation", "paused_provider_quota")]));
    const ids = new Set(flow.nodes.map((n) => n.id));
    for (const e of flow.edges) {
      expect(ids.has(e.from) && ids.has(e.to), `${e.from}>${e.to}`).toBe(true);
    }
  });
});

const task = (extra: Partial<FleetTask> = {}): FleetTask => ({
  task: "GH-1",
  title: "t",
  repository: "InTheta/demo",
  state: "new",
  stale: [],
  claimHeld: false,
  validated: null,
  publication: null,
  workspace: { exists: false, idleDays: null, stale: false },
  snapshots: 0,
  idleDays: 0,
  lastActivity: null,
  ...extra,
});
const pr = (state: string, draft = false) => ({
  pr: 7,
  url: "https://github.com/InTheta/demo/pull/7",
  branch: "b",
  sha,
  repository: "InTheta/demo",
  state,
  draft,
  headSha: sha,
});

describe("fleet flows", () => {
  it("draws the pipeline with counts and takes only the steps tasks reached", () => {
    const flow = buildPipelineFlow({
      planned: 5,
      validated: 4,
      published: 3,
      inReview: 1,
      merged: 2,
      closed: 0,
    });
    expect(flow.nodes.find((n) => n.id === "merged")?.sub).toBe("2 tasks");
    expect(flow.nodes.find((n) => n.id === "review")?.status).toBe("active");
    expect(flow.edges.find((e) => e.to === "closed")?.taken).toBe(false);
    expect(flow.nodes.find((n) => n.id === "closed")?.status).toBe("pending");
    expect(
      buildPipelineFlow({
        planned: 1,
        validated: 0,
        published: 0,
        inReview: 0,
        merged: 0,
        closed: 1,
      }).nodes.find((n) => n.id === "closed")?.sub,
    ).toBe("1 task");
  });

  it("shows where one task stands", () => {
    const merged = buildTaskFlow(
      task({ state: "merged", validated: { sha, at: null, count: 2 }, publication: pr("merged") }),
    );
    expect(merged.nodes.find((n) => n.id === "result")?.status).toBe("done");
    expect(merged.edges.every((e) => e.taken)).toBe(true);
    const waiting = buildTaskFlow(
      task({ state: "awaiting-publication", validated: { sha, at: null, count: 1 } }),
    );
    expect(waiting.nodes.find((n) => n.id === "publish")?.status).toBe("waiting");
    expect(waiting.edges.find((e) => e.to === "publish")?.taken).toBe(false);
    const closed = buildTaskFlow(
      task({ state: "closed", validated: { sha, at: null, count: 1 }, publication: pr("closed") }),
    );
    expect(closed.nodes.find((n) => n.id === "result")?.status).toBe("failed");
    expect(buildTaskFlow(task({ state: "running", claimHeld: true })).nodes[0]?.status).toBe(
      "active",
    );
  });
});

describe("sidecar API parsing", () => {
  const policy = { snapshot_days: 7, workspaces: false, max_snapshots_gb: null };
  const schema = {
    snapshot_days: { default: 7, min: 0, max: 3650, type: "number", nullable: false },
    workspaces: { default: false, min: null, max: null, type: "boolean", nullable: false },
    max_snapshots_gb: { default: null, min: 0.001, max: 1000000, type: "number", nullable: true },
  };

  it("reads a status document and drops what it does not recognise", () => {
    const parsed = parseSidecarStatus({
      version: 1,
      retention: {
        policy: { ...policy, unknown: 3 },
        sources: { snapshot_days: "file", bad: 1 },
        schema: { ...schema, junk: { type: "string" } },
        status: {
          generatedAt: "x",
          usage: { snapshotsBytes: 5, workspacesBytes: 6 },
          projected: {
            freedBytes: 9,
            removeByKind: { snapshot: { count: 2, bytes: 9 } },
            keptByReason: { "claim-held": 1 },
          },
          lastRun: null,
        },
        statusAgeSeconds: 30,
      },
      filesystem: { freeBytes: 10, totalBytes: 100 },
    });
    expect(parsed?.retention.policy).toEqual(policy);
    expect(Object.keys(parsed?.retention.schema ?? {})).toEqual([
      "snapshot_days",
      "workspaces",
      "max_snapshots_gb",
    ]);
    expect(parsed?.retention.sources).toEqual({ snapshot_days: "file" });
    expect(parsed?.retention.status?.projected?.removeByKind.snapshot).toEqual({
      count: 2,
      bytes: 9,
    });
    expect(parsed?.filesystem).toEqual({ freeBytes: 10, totalBytes: 100 });
    expect(parseSidecarStatus({ version: 2, retention: {} })).toBeNull();
    expect(parseSidecarStatus(null)).toBeNull();
    expect(parseSidecarStatus({ version: 1, retention: { policy, schema: {} } })).toBeNull();
  });

  it("reads an overview and skips malformed tasks and unknown states", () => {
    const parsed = parseFleetOverview(
      {
        version: 1,
        generatedAt: "2026-11-20T10:00:00+00:00",
        idleDays: 14,
        summary: {
          tasks: 3,
          byState: { merged: 1 },
          staleByFlag: { leftovers: 1 },
          pipeline: { planned: 3, validated: 2, published: 1, inReview: 0, merged: 1, closed: 0 },
          pullRequestStateKnown: true,
        },
        tasks: [
          {
            task: "GH-4",
            title: "ok",
            state: "merged",
            stale: ["leftovers", 3],
            publication: { pr: 7, url: "javascript:alert(1)", state: "merged" },
            workspace: { exists: true, idleDays: 20, stale: true },
            snapshots: 2,
            idleDays: 3,
          },
          { task: "../etc", state: "merged" },
          { task: "GH-5", state: "exploded" },
          "nope",
        ],
      },
      42,
    );
    expect(parsed?.tasks.map((t) => t.task)).toEqual(["GH-4"]);
    expect(parsed?.tasks[0]?.stale).toEqual(["leftovers"]);
    expect(parsed?.tasks[0]?.publication?.url).toBeNull(); // only GitHub links are kept
    expect(parsed?.tasks[0]?.workspace).toEqual({ exists: true, idleDays: 20, stale: true });
    expect(parsed?.ageSeconds).toBe(42);
    expect(parseFleetOverview({ version: 1, summary: {}, tasks: [] })).toBeNull();
  });

  it("keeps a track with its status, who it waits on and the request to decide", () => {
    const parsed = parseFleetOverview({
      version: 1,
      summary: { tasks: 1, pipeline: {} },
      tasks: [
        {
          task: "GH-327",
          title: "Kafka-free DEV continuation",
          source: "track",
          state: "running",
          phase: "waiting-human",
          doing: "Reviewing the sealed manifest",
          statusLine: "Reviewing the sealed manifest. Waiting on human Will: Approve activation",
          waitingOn: {
            kind: "human",
            who: "Will",
            action: "Approve activation",
            requestId: "a".repeat(16),
          },
          openRequests: [
            { id: "a".repeat(16), action: "Approve activation", grantor: "Will", deadline: null },
          ],
          links: [
            "https://github.com/InTheta/omni-symphony-canary/issues/327",
            "http://bad.example",
          ],
          threadIds: ["mcp:f15c6851-abd3-41f6-9f90-1ae34ceabb4f"],
          stale: [],
        },
      ],
    });
    const track = parsed?.tasks[0]?.track;
    expect(track?.phase).toBe("waiting-human");
    expect(track?.waitingOn?.who).toBe("Will");
    expect(track?.openRequests[0]?.grantor).toBe("Will");
    expect(track?.links).toEqual(["https://github.com/InTheta/omni-symphony-canary/issues/327"]);
  });

  it("still refuses a non-track task whose id is not GH-<number>", () => {
    const parsed = parseFleetOverview({
      version: 1,
      summary: { tasks: 1, pipeline: {} },
      tasks: [{ task: "my-track", state: "running", stale: [] }],
    });
    expect(parsed?.tasks).toEqual([]);
  });

  it("sends only changed settings and checks values against the sidecar's limits", () => {
    expect(policyPatch({ a: 1, b: null, c: true }, { a: 1, b: 5, c: true })).toEqual({ b: 5 });
    const days = schema.snapshot_days as never;
    expect(validateField(days, 7)).toBeNull();
    expect(validateField(days, -1)).toBe("At least 0.");
    expect(validateField(days, 5000)).toBe("At most 3650.");
    expect(validateField(days, null)).toBe("A value is required.");
    expect(validateField(days, Number.NaN)).toBe("Enter a number.");
    expect(validateField(schema.max_snapshots_gb as never, null)).toBeNull();
    expect(validateField(schema.workspaces as never, true)).toBeNull();
    expect(validateField(schema.workspaces as never, 1)).toBe("Choose on or off.");
  });

  it("formats sizes and ages", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KiB");
    expect(formatBytes(64 * 1024 ** 3)).toBe("64.0 GiB");
    expect(formatBytes(1024 ** 5)).toBe("1024 TiB");
    expect(formatAge(null)).toBe("unknown");
    expect(formatAge(20)).toBe("just now");
    expect(formatAge(600)).toBe("10 min ago");
    expect(formatAge(7200)).toBe("2 h ago");
    expect(formatAge(86400 * 3)).toBe("3 days ago");
  });
});

describe("inbox and proposals parsing", () => {
  it("keeps valid inbox items and drops malformed ones", () => {
    const inbox = parseInbox({
      version: 1,
      generatedAt: "now",
      channels: ["slack", 3],
      configError: null,
      items: [
        {
          id: "a",
          kind: "quota-decision",
          severity: "action",
          title: "T",
          detail: "D",
          link: "/delivery?run=85c0326b-52e0-46dc-899d-d451c5afb228",
        },
        { id: "b", severity: "loud", title: "x" },
        { severity: "info", title: "no id" },
        "junk",
      ],
    });
    expect(inbox?.items.map((item) => item.id)).toEqual(["a"]);
    expect(inbox?.channels).toEqual(["slack"]);
    expect(parseInbox({ version: 2, items: [] })).toBeNull();
  });

  it("only turns known in-app links into navigation", () => {
    expect(inboxSearch("/delivery?run=85c0326b-52e0-46dc-899d-d451c5afb228")).toEqual({
      run: "85c0326b-52e0-46dc-899d-d451c5afb228",
    });
    expect(inboxSearch("/delivery?ticket=LAB-74")).toEqual({ ticket: "LAB-74" });
    expect(inboxSearch("/delivery?view=sidecar")).toEqual({ view: "sidecar" });
    expect(inboxSearch("/delivery?view=nope")).toBeNull();
    expect(inboxSearch("https://evil.example/delivery?view=fleet")).toBeNull();
    expect(inboxSearch("/delivery?run=../x")).toBeNull();
    expect(inboxSearch(null)).toBeNull();
  });

  it("reads proposals and rejects unknown ids and states", () => {
    const parsed = parseProposals({
      version: 1,
      proposals: [
        {
          id: "0123456789abcdef",
          status: "pending",
          createdAt: "c",
          expiresAt: "e",
          totalBytes: 10,
          itemCount: 1,
          byKind: { snapshot: { count: 1, bytes: 10 } },
          keptByReason: { "claim-held": 2 },
          items: [
            {
              kind: "snapshot",
              task: "GH-1",
              sha: "a".repeat(40),
              bytes: 10,
              ageDays: 3,
              reason: "old",
            },
            { nope: 1 },
          ],
          itemsTruncated: false,
        },
        { id: "short", status: "pending" },
        { id: "fedcba9876543210", status: "exploded" },
      ],
    });
    expect(parsed?.map((p) => p.id)).toEqual(["0123456789abcdef"]);
    expect(parsed?.[0]?.items).toHaveLength(1);
    expect(parsed?.[0]?.keptByReason).toEqual({ "claim-held": 2 });
    expect(parseProposals({ version: 1 })).toBeNull();
  });
});

describe("buildTrackFlow", () => {
  const track = (phase: string, waitingOn: FleetWaitingOn | null) =>
    task({
      track: {
        phase,
        doing: "Reviewing the sealed manifest",
        statusLine: "",
        waitingOn,
        openRequests: [],
        links: [],
        threadIds: [],
        owner: null,
      },
    });

  it("shows work, then a person it waits on, and takes that edge", () => {
    const flow = buildTrackFlow(
      track("waiting-human", {
        kind: "human",
        who: "Will",
        action: "Approve activation",
        requestId: null,
      }),
    );
    const wait = flow.nodes.find((node) => node.id === "wait");
    expect(wait?.status).toBe("waiting");
    expect(wait?.kind).toBe("decision");
    expect(wait?.sub).toBe("Will");
    expect(flow.edges.find((edge) => edge.from === "work")?.taken).toBe(true);
    expect(flow.nodes.find((node) => node.id === "work")?.sub).toBe(
      "Reviewing the sealed manifest",
    );
  });

  it("is active and unblocked while it runs, and done when finished", () => {
    const running = buildTrackFlow(track("running", null));
    expect(running.nodes.find((node) => node.id === "work")?.status).toBe("active");
    expect(running.nodes.find((node) => node.id === "wait")?.status).toBe("pending");
    const done = buildTrackFlow(track("done", null));
    expect(done.nodes.find((node) => node.id === "done")?.status).toBe("done");
    expect(done.edges.find((edge) => edge.to === "done")?.taken).toBe(true);
  });
});
