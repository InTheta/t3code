import "~/index.css";
import { expect, it } from "vite-plus/test";

import { render } from "../../test/render";
import type { Observed, Provenance, Quality } from "~/lib/sidecarApi";
import { QualityPanel } from "./QualityPanel";

const run = "11111111-1111-1111-1111-111111111111";
const quality: Quality = {
  generatedAt: "2026-11-20T10:00:00+00:00",
  runs: 4,
  decisions: 20,
  traceable: 18,
  coverage: 0.9,
  counts: { fail: 1, warn: 1, info: 0 },
  passed: false,
  findingsTruncated: false,
  findings: [
    {
      severity: "fail",
      code: "qa-not-independent",
      message: "QA ran on the same provider instance as the implementation.",
      runId: run,
      ticket: "LAB-7",
    },
  ],
  rows: [
    {
      instance: "codex",
      model: "gpt-fixture",
      role: "implementation",
      stages: 2,
      executed: 2,
      quotaPaused: 1,
      qaPassed: 1,
      qaFailed: 1,
      avgTokens: 1234,
      comparable: false,
    },
  ],
  suggestions: [
    { subject: "all routes", note: "No route has 5 stages yet.", requiresHuman: false },
  ],
};
const trace: Provenance = {
  runId: run,
  ticket: "LAB-7",
  status: "approved",
  traceId: "1".repeat(32),
  owner: {
    humanOwner: "alex-dev",
    requestedBy: "alex-dev",
    approvedBy: "alex@example.test",
    prAuthor: "alex-dev",
    mergedBy: "sam-reviewer",
    commitAuthors: ["alex-dev", "claude-agent[bot]"],
    prNumber: 7,
    prUrl: "https://github.com/lab/fixture/pull/7",
    prState: "merged",
  },
  traceable: 1,
  total: 2,
  decisions: [
    {
      id: "approval",
      title: "Approved LAB-7",
      byType: "person",
      byName: "alex@example.test",
      at: "2026-11-20T09:00:00Z",
      launch: null,
      modelApproved: null,
      modelActual: null,
      tokens: 30,
      gaps: [],
    },
    {
      id: "stage:lead",
      title: "Lead stage (executed)",
      byType: "rule",
      byName: "approved recipe",
      at: null,
      launch: { providerInstanceId: "codex", threadId: "thread-1", turnId: "turn-1" },
      modelApproved: "gpt-fixture",
      modelActual: "other-model",
      tokens: 8,
      gaps: [
        {
          severity: "warn",
          code: "model-differs",
          message: "Approved gpt-fixture, provider reported other-model.",
        },
      ],
    },
  ],
};

it("shows a failed record check with the finding, the route table and the suggestion", async () => {
  await using screen = await render(
    <QualityPanel quality={quality} trace={null} onRefresh={() => {}} />,
  );
  await expect.element(screen.getByText("Record check failed")).toBeVisible();
  await expect.element(screen.getByText("90% traceable", { exact: false })).toBeVisible();
  await expect.element(screen.getByText(/QA ran on the same provider instance/)).toBeVisible();
  await expect.element(screen.getByRole("link", { name: "Trace" })).toBeVisible();
  await expect.element(screen.getByText("2 (too few to compare)")).toBeVisible();
  await expect.element(screen.getByText(/No route has 5 stages yet/)).toBeVisible();
});

it("follows a decision back to who made it, the worker and the model", async () => {
  await using screen = await render(
    <QualityPanel quality={quality} trace={trace} onRefresh={() => {}} />,
  );
  await expect
    .element(screen.getByText("1 of 2 decisions trace fully", { exact: false }))
    .toBeVisible();
  await expect.element(screen.getByText("alex@example.test (person)")).toBeVisible();
  await expect.element(screen.getByText(/thread thread-1/)).toBeVisible();
  await expect
    .element(screen.getByText("approved gpt-fixture · reported other-model"))
    .toBeVisible();
  await expect
    .element(screen.getByText(/Approved gpt-fixture, provider reported other-model\./))
    .toBeVisible();
});

it("explains when no ledger is connected", async () => {
  await using screen = await render(
    <QualityPanel quality={null} trace={null} onRefresh={() => {}} />,
  );
  await expect.element(screen.getByText(/No managed-run ledger is connected/)).toBeVisible();
});

const observed: Observed = {
  windowHours: 24,
  threads: 33,
  runs: 102,
  failedRuns: 0,
  turns: 111,
  inputTokens: 430_370_582,
  outputTokens: 1_067_612,
  cacheHitRate: 0.986,
  modelRecordedRate: 0.523,
  models: [
    {
      provider: "codex",
      model: "gpt-fixture",
      turns: 63,
      inputTokens: 337_556_735,
      outputTokens: 900_000,
      cacheHitRate: 0.989,
    },
  ],
  running: [
    {
      provider: "codex",
      model: "gpt-fixture",
      effort: "high",
      runtimeMode: "full-access",
      ageHours: 7.9,
      title: null,
    },
  ],
  runtimeModes: [{ mode: "full-access", threads: 33 }],
  subagentsDifferentVendor: 22,
  subagentsSameVendor: 10,
  pullRequests: [
    {
      repository: "lab/fixture",
      number: 7,
      url: "https://github.com/lab/fixture/pull/7",
      threads: 1,
    },
  ],
  findings: [
    {
      severity: "warn",
      id: "full-access-running",
      message: "1 run(s) in progress with full access (no approval prompts).",
    },
  ],
};

it("shows observed activity even when no managed-run ledger is connected", async () => {
  await using screen = await render(
    <QualityPanel quality={null} observed={observed} trace={null} onRefresh={() => {}} />,
  );
  await expect.element(screen.getByText(/No managed-run ledger is connected/)).toBeVisible();
  await expect.element(screen.getByText("What your agents actually did")).toBeVisible();
  await expect.element(screen.getByText(/430\.4M input tokens/)).toBeVisible();
  await expect.element(screen.getByText(/99% from cache/, { exact: false })).toBeVisible();
  await expect.element(screen.getByText(/in progress with full access/)).toBeVisible();
  await expect.element(screen.getByText(/22 on a different vendor/)).toBeVisible();
  await expect.element(screen.getByRole("link", { name: "lab/fixture#7" })).toBeVisible();
});

it("shows observed activity beneath the record check", async () => {
  await using screen = await render(
    <QualityPanel quality={quality} observed={observed} trace={null} onRefresh={() => {}} />,
  );
  await expect.element(screen.getByText("Record check failed")).toBeVisible();
  await expect.element(screen.getByText("Running now")).toBeVisible();
});
