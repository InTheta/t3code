import "~/index.css";
import { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import type { FleetOverview, SidecarStatus } from "~/lib/sidecarApi";
import { decideRequest, saveRetentionPolicy } from "~/lib/sidecarApi";
import type { FleetTask } from "~/lib/fleetFlow";
import type { ManagedRun } from "~/lib/managedRunDelivery";
import { FleetBoard } from "./FleetBoard";
import { ManagedRunEvidence } from "./ManagedRunEvidence";
import { SidecarSettings } from "./SidecarSettings";

vi.mock(import("~/state/environments"), async (original) => ({
  ...(await original()),
  usePrimaryEnvironmentId: () => EnvironmentId.make("windows-fixture"),
}));
vi.mock(import("~/state/entities"), async (original) => ({
  ...(await original()),
  useQuietThreadShell: () => null,
}));
vi.mock(import("~/lib/sidecarApi"), async (original) => ({
  ...(await original()),
  saveRetentionPolicy: vi.fn(async () => ({ ok: true as const, policy: null })),
  decideRequest: vi.fn(async () => ({ ok: true as const })),
}));

const sha = "a".repeat(40);
const run: ManagedRun = {
  version: 1,
  runId: "00000000-0000-0000-0000-000000000000",
  ticket: "LAB-9",
  revision: "a".repeat(64),
  status: "approved",
  brief: {
    workspaceId: "w",
    repository: "lab/fixture",
    baseSha: sha,
    scope: "Fixture",
    tokens: 100,
  },
  budget: { reserved: 1000, used: 300, remaining: 700 },
  stages: [
    {
      stageId: "lead-1",
      role: "lead",
      status: "completed",
      threadId: null,
      providerInstanceId: "codex",
    },
    {
      stageId: "impl-1",
      role: "implementation",
      status: "paused_provider_quota",
      threadId: null,
      providerInstanceId: "codex",
    },
  ],
  stageAttempts: [
    {
      stageId: "impl-1",
      attemptId: "attempt-1",
      providerInstanceId: "codex",
      status: "paused",
      actualModel: "gpt-fixture",
      usageStatus: "metered",
      tokens: {
        inputTokens: 11,
        cachedInputTokens: null,
        cacheCreationTokens: null,
        outputTokens: 4,
        reasoningTokens: null,
      },
    },
  ],
};

it("draws the run as a flow with a quota decision and opens the stage details from it", async () => {
  await using screen = await render(<ManagedRunEvidence run={run} />);
  await expect
    .element(screen.getByRole("group", { name: "Flow of managed run LAB-9" }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: /Quota reached, blocked/ }))
    .toBeVisible();
  const implementation = screen.getByRole("button", { name: /^Implementation, blocked/ });
  await expect.element(implementation).toHaveAttribute("aria-pressed", "false");
  await implementation.click();
  await expect.element(implementation).toHaveAttribute("aria-pressed", "true");
  await expect.element(screen.getByText("Input tokens")).toBeVisible();
});

it("selects a stage from the keyboard", async () => {
  await using screen = await render(<ManagedRunEvidence run={run} />);
  const lead = screen.getByRole("button", { name: /^Lead, done/ });
  await lead.element().focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(lead).toHaveAttribute("aria-pressed", "true");
});

const task = (name: string, extra: Partial<FleetTask>): FleetTask => ({
  task: name,
  title: `Title ${name}`,
  repository: "InTheta/demo",
  state: "new",
  stale: [],
  claimHeld: false,
  validated: null,
  publication: null,
  workspace: { exists: false, idleDays: null, stale: false },
  snapshots: 0,
  idleDays: 1,
  lastActivity: null,
  ...extra,
});
const publication = (state: string, number: number) => ({
  pr: number,
  url: `https://github.com/InTheta/demo/pull/${number}`,
  branch: `symphony/GH-${number}`,
  sha,
  repository: "InTheta/demo",
  state,
  draft: false,
  headSha: sha,
});
const overview: FleetOverview = {
  generatedAt: "2026-11-20T10:00:00+00:00",
  idleDays: 14,
  ageSeconds: 120,
  summary: {
    tasks: 3,
    byState: { merged: 1, "in-review": 1, new: 1 },
    staleByFlag: { leftovers: 1 },
    pipeline: { planned: 3, validated: 2, published: 2, inReview: 1, merged: 1, closed: 0 },
    pullRequestStateKnown: true,
  },
  scope: null,
  tasks: [
    task("GH-1", {
      state: "merged",
      stale: ["leftovers"],
      publication: publication("merged", 11),
      validated: { sha, at: null, count: 1 },
      snapshots: 3,
      workspace: { exists: true, idleDays: 30, stale: true },
    }),
    task("GH-2", {
      state: "in-review",
      publication: publication("open", 12),
      validated: { sha, at: null, count: 1 },
    }),
    task("GH-3", {}),
  ],
};

it("shows the fleet as a pipeline and filters the tasks by state, attention and search", async () => {
  const refresh = vi.fn();
  await using screen = await render(<FleetBoard overview={overview} onRefresh={refresh} />);
  await expect
    .element(screen.getByRole("group", { name: "Where tasks are in the pipeline" }))
    .toBeVisible();
  await expect.element(screen.getByText("Showing 3 of 3")).toBeVisible();

  await screen.getByRole("button", { name: "Merged · 1" }).click();
  await expect.element(screen.getByText("Showing 1 of 1")).toBeVisible();
  await expect.element(screen.getByText("GH-1")).toBeVisible();
  await screen.getByRole("button", { name: "Merged · 1" }).click();

  await screen.getByLabelText("Needs attention").selectOptions("leftovers");
  await expect.element(screen.getByText("Showing 1 of 1")).toBeVisible();
  await screen.getByLabelText("Needs attention").selectOptions("");

  await screen.getByLabelText("Search").fill("GH-2");
  await expect.element(screen.getByText("Showing 1 of 1")).toBeVisible();
  await screen.getByLabelText("Search").fill("nothing like it");
  await expect.element(screen.getByText("No tasks match.")).toBeVisible();

  await screen.getByRole("button", { name: "Refresh" }).click();
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("opens a task to show its journey, pull request and leftovers", async () => {
  await using screen = await render(<FleetBoard overview={overview} onRefresh={() => {}} />);
  await screen.getByText("GH-1").click();
  await expect.element(screen.getByRole("group", { name: "GH-1 journey" })).toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: "#11 merged" }))
    .toHaveAttribute("href", "https://github.com/InTheta/demo/pull/11");
  await expect.element(screen.getByText("Present, idle 30 days (stale)")).toBeVisible();
});

const requestId = "c".repeat(16);
const trackTask: FleetTask = {
  task: "GH-327",
  title: "Kafka-free DEV continuation",
  repository: null,
  state: "running",
  stale: [],
  claimHeld: false,
  validated: null,
  publication: null,
  workspace: { exists: false, idleDays: null, stale: false },
  snapshots: 0,
  idleDays: 0,
  lastActivity: null,
  track: {
    phase: "waiting-human",
    doing: "Reviewing the sealed manifest",
    statusLine: "Reviewing the sealed manifest. Waiting on human Will: Approve activation",
    waitingOn: { kind: "human", who: "Will", action: "Approve activation", requestId },
    openRequests: [
      {
        id: requestId,
        action: "Approve activation",
        grantor: "Will",
        deadline: "2026-11-22T18:20:00+00:00",
      },
    ],
    links: ["https://github.com/InTheta/omni-symphony-canary/issues/327"],
    threadIds: ["mcp:f15c6851-abd3-41f6-9f90-1ae34ceabb4f"],
    owner: null,
  },
};

it("shows a track's status line and, when opened, why it is stopped and how to unblock it", async () => {
  const refresh = vi.fn();
  await using screen = await render(
    <FleetBoard overview={{ ...overview, tasks: [trackTask] }} onRefresh={refresh} />,
  );
  await expect.element(screen.getByText("Waiting on a person")).toBeVisible();
  await expect.element(screen.getByText(/Waiting on human Will: Approve activation/)).toBeVisible();
  await screen.getByText("GH-327").click();
  await expect.element(screen.getByRole("group", { name: "GH-327 status" })).toBeVisible();
  await expect.element(screen.getByText("What it is doing")).toBeVisible();
  await expect.element(screen.getByText("Why it is stopped")).toBeVisible();
  await expect.element(screen.getByText("How to unblock")).toBeVisible();
  await expect.element(screen.getByText("Deadline 2026-11-22T18:20:00+00:00")).toBeVisible();
  await screen.getByRole("button", { name: "I did this or granted it" }).click();
  expect(decideRequest).toHaveBeenCalledWith(requestId, "resolve", expect.anything());
  expect(refresh).toHaveBeenCalledTimes(1);
});

const scopedOverview: FleetOverview = {
  ...overview,
  scope: {
    repositories: [
      { repository: "InTheta/demo", tasks: 2, withPullRequest: 1, pullRequestUnknown: 0 },
      { repository: "InTheta/other", tasks: 1, withPullRequest: 0, pullRequestUnknown: 0 },
    ],
    tasksShown: 3,
    tasksOnDisk: 3,
    tasksTruncated: false,
    github: {
      queriedThisRun: true,
      lastCheckedAt: "2026-11-20T09:50:00+00:00",
      oldestOpenCheckAt: "2026-11-20T09:50:00+00:00",
      openRefreshSeconds: 3600,
      cachedPullRequests: 2,
    },
    sources: { deployment: "not recorded by this report" },
  },
  tasks: [
    task("GH-2", {
      state: "in-review",
      publication: publication("open", 12),
      statuses: {
        task: "in-review",
        pullRequest: {
          state: "open",
          draft: false,
          number: 12,
          headSha: sha,
          checkedAt: "2026-11-20T09:50:00+00:00",
        },
        ci: { state: "success", head: "b".repeat(40), exactHead: false },
        deployment: { state: "not-recorded", sha: null, environment: null },
      },
    }),
  ],
};

it("shows which repositories the snapshot covers and when GitHub was last checked", async () => {
  await using screen = await render(<FleetBoard overview={scopedOverview} onRefresh={() => {}} />);
  await expect.element(screen.getByText(/Scope and freshness · 2 repositories/)).toBeVisible();
  await expect.element(screen.getByText("InTheta/other")).toBeVisible();
  await expect
    .element(screen.getByText("Never; pull request states are unknown"))
    .not.toBeInTheDocument();
});

it("keeps task, pull request, exact-head CI and deployment status separate", async () => {
  await using screen = await render(<FleetBoard overview={scopedOverview} onRefresh={() => {}} />);
  await screen.getByText("GH-2").click();
  await expect.element(screen.getByText("Task status")).toBeVisible();
  await expect.element(screen.getByText("PR status")).toBeVisible();
  await expect.element(screen.getByText(/NOT the PR head, so it does not count/)).toBeVisible();
  await expect.element(screen.getByText("Not recorded for this task")).toBeVisible();
});

it("says plainly when the snapshot has no scope information", async () => {
  await using screen = await render(<FleetBoard overview={overview} onRefresh={() => {}} />);
  await expect.element(screen.getByText(/does not say which repositories it covers/)).toBeVisible();
});

it("explains when there is no overview yet", async () => {
  await using screen = await render(<FleetBoard overview={null} onRefresh={() => {}} />);
  await expect.element(screen.getByText(/No fleet overview yet/)).toBeVisible();
});

const field = (
  min: number | null,
  max: number | null,
  nullable = false,
  fallback: number | boolean | null = 7,
) => ({
  default: fallback,
  min,
  max,
  type: typeof fallback === "boolean" ? ("boolean" as const) : ("number" as const),
  nullable,
});
const status: SidecarStatus = {
  retention: {
    policy: {
      snapshot_days: 7,
      keep_per_task: 1,
      idle_days: 14,
      workspace_idle_days: 14,
      max_snapshots_gb: null,
      max_workspaces_gb: null,
      workspaces: false,
      min_age_hours: 48,
      max_delete_gb: 25,
    },
    sources: { snapshot_days: "file" },
    schema: {
      snapshot_days: field(0, 3650),
      keep_per_task: field(0, 50, false, 1),
      idle_days: field(0, 3650, false, 14),
      workspace_idle_days: field(0, 3650, false, 14),
      max_snapshots_gb: field(0.001, 1000000, true, null),
      max_workspaces_gb: field(0.001, 1000000, true, null),
      workspaces: field(null, null, false, false),
      min_age_hours: field(0, 8760, false, 48),
      max_delete_gb: field(0.001, 1000000, false, 25),
    },
    statusAgeSeconds: 600,
    status: {
      generatedAt: "2026-11-20T09:00:00+00:00",
      usage: { snapshotsBytes: 16 * 1024 ** 3, workspacesBytes: 41 * 1024 ** 3 },
      projected: {
        freedBytes: 59 * 1024 ** 3,
        removeByKind: { snapshot: { count: 120, bytes: 16 * 1024 ** 3 } },
        keptByReason: { "claim-held": 2 },
      },
      lastRun: null,
    },
  },
  filesystem: { freeBytes: 400 * 1024 ** 3, totalBytes: 1000 * 1024 ** 3 },
};

it("shows usage and what a cleanup would free, and says it never deletes from here", async () => {
  await using screen = await render(<SidecarSettings status={status} onChanged={() => {}} />);
  await expect.element(screen.getByText("400 GiB free of 1000 GiB (60% used)")).toBeVisible();
  await expect.element(screen.getByText("59.0 GiB", { exact: false }).first()).toBeVisible();
  await expect.element(screen.getByText(/never started from here/)).toBeVisible();
  await expect.element(screen.getByText("Never run")).toBeVisible();
});

it("saves only what changed, rejects out-of-range values and clears a cap", async () => {
  const saved = vi.mocked(saveRetentionPolicy);
  saved.mockClear();
  const changed = vi.fn();
  await using screen = await render(<SidecarSettings status={status} onChanged={changed} />);
  const save = screen.getByRole("button", { name: "Save policy" });
  await expect.element(save).toBeDisabled();

  const days = screen.getByLabelText("Keep snapshots for");
  await days.fill("-3");
  await expect.element(screen.getByRole("alert")).toHaveTextContent("At least 0.");
  await expect.element(save).toBeDisabled();

  await days.fill("3");
  await screen.getByLabelText("No cap").first().click();
  await screen.getByLabelText("Snapshot size cap").fill("12");
  await expect.element(save).toBeEnabled();
  await save.click();
  await vi.waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  expect(saved.mock.calls[0]?.[0]).toEqual({ snapshot_days: 3, max_snapshots_gb: 12 });
  await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  await expect.element(screen.getByText(/Nothing was deleted/)).toBeVisible();
});

it("shows a refusal from the sidecar without losing the edit", async () => {
  const saved = vi.mocked(saveRetentionPolicy);
  saved.mockResolvedValueOnce({
    ok: false,
    message: "Changing the sidecar needs operator access.",
  });
  await using screen = await render(<SidecarSettings status={status} onChanged={() => {}} />);
  await screen.getByLabelText("Keep snapshots for").fill("2");
  await screen.getByRole("button", { name: "Save policy" }).click();
  await expect
    .element(screen.getByText("Changing the sidecar needs operator access."))
    .toBeVisible();
  await expect.element(screen.getByLabelText("Keep snapshots for")).toHaveValue(2);
});

it("explains when the sidecar is not connected", async () => {
  await using screen = await render(<SidecarSettings status={null} onChanged={() => {}} />);
  await expect.element(screen.getByText(/The sidecar is not connected/)).toBeVisible();
});
