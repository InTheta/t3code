import "~/index.css";
import { EnvironmentId } from "@t3tools/contracts";
import { page } from "vite-plus/test/browser";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";
import { postApproval } from "~/lib/isolatedApprovalClient";
import type { ManagedRun } from "~/lib/managedRunDelivery";
import { ManagedRunEvidence } from "./ManagedRunEvidence";

vi.mock(import("~/state/environments"), async (original) => ({
  ...(await original()),
  usePrimaryEnvironmentId: () => EnvironmentId.make("windows-fixture"),
}));
vi.mock(import("~/state/entities"), async (original) => ({
  ...(await original()),
  useQuietThreadShell: (ref) =>
    ref?.threadId === "mcp:launch:known" ? ({ threadId: ref.threadId } as never) : null,
}));

vi.mock(import("~/lib/isolatedApprovalClient"), () => ({ postApproval: vi.fn() }));

const run: ManagedRun = {
  version: 1,
  runId: "00000000-0000-0000-0000-000000000000",
  ticket: "fixture",
  revision: "a".repeat(64),
  status: "approved",
  brief: {
    workspaceId: "fixture",
    repository: "lab/fixture",
    baseSha: "b".repeat(40),
    scope: "Fixture",
    tokens: 100,
  },
  budget: { reserved: 100, used: null, remaining: null },
  stages: [
    {
      stageId: "known",
      role: "implementation",
      status: "waiting_for_operator",
      threadId: "mcp:launch:known",
      providerInstanceId: "codex",
      toolCalls: 0,
    },
    {
      stageId: "unknown",
      role: "qa",
      status: "queued",
      threadId: "mcp:launch:unknown",
      providerInstanceId: null,
    },
  ],
};
it("links an operator wait to the locally known worker and preserves unknown evidence", async () => {
  await using screen = await render(<ManagedRunEvidence run={run} />);
  await expect.element(screen.getByText("implementation · Waiting for operator")).toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: "Open worker thread" }))
    .toHaveAttribute("href", "/windows-fixture/mcp%3Alaunch%3Aknown");
  await expect.element(screen.getByText("Thread mcp:launch:unknown")).toBeVisible();
  await expect.element(screen.getByText("Tool calls 0")).toBeVisible();
  await expect.element(screen.getByText("Tool calls Unknown")).toBeVisible();
});

it("shows a provider quota pause and the original worker link", async () => {
  const stages = run.stages.map((stage) =>
    stage.stageId === "known" ? { ...stage, status: "paused_provider_quota" } : stage,
  );
  await using screen = await render(<ManagedRunEvidence run={{ ...run, stages }} />);
  await expect.element(screen.getByText("implementation · Paused on provider quota")).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Review replacement" }))
    .not.toBeInTheDocument();
  await expect
    .element(screen.getByText("Open the worker thread to inspect the usage limit."))
    .toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: "Open worker thread" }))
    .toHaveAttribute("href", "/windows-fixture/mcp%3Alaunch%3Aknown");
});

it("shows the exact reviewed commit and reports a budget overrun separately from the verdict", async () => {
  const reviewedSha = "715f6adc7f373f7e17fb2f41a2dc373e8785caca";
  await using screen = await render(
    <ManagedRunEvidence
      run={{
        ...run,
        budget: { reserved: 340000, used: 344693, remaining: 0 },
        qa: { reviewedSha, verdict: "pass", source: "operator", budgetExceeded: true },
      }}
    />,
  );
  const review = screen.getByRole("region", { name: "Independent QA" });
  await expect.element(review.getByText("Passed")).toBeVisible();
  await expect.element(review.getByText(reviewedSha)).toBeVisible();
  await expect.element(review.getByText("Operator", { exact: true })).toBeVisible();
  await expect.element(review.getByText("Token budget exceeded")).toBeVisible();
});

it("displays the Langfuse correlation ID alongside the managed run", async () => {
  const runId = "aea004a0-2e19-483e-a001-390900df711a";
  const traceId = runId.replaceAll("-", "");
  await using screen = await render(<ManagedRunEvidence run={{ ...run, runId, traceId }} />);
  await expect.element(screen.getByText("Langfuse correlation ID", { exact: true })).toBeVisible();
  await expect.element(screen.getByText(traceId, { exact: true })).toBeVisible();
});

it.each(["approve", "decline"] as const)(
  "records only the explicit %s decision for the reviewed stage",
  async (decision) => {
    const stage = {
      stageId: `${run.runId}:implementation`,
      role: "implementation",
      status: "paused_provider_quota",
      threadId: "mcp:launch:known",
      providerInstanceId: "codex",
      toolCalls: 0,
    };
    const identity = { runId: run.runId, stageId: stage.stageId };
    const revision = "c".repeat(64);
    const post = vi.mocked(postApproval);
    post.mockReset();
    post.mockResolvedValueOnce({
      ...identity,
      revision,
      approvedRevision: run.revision,
      repository: run.brief.repository,
      baseSha: run.brief.baseSha,
      scope: run.brief.scope,
      candidateSha: null,
      original: {
        threadId: stage.threadId,
        modelSelection: { instanceId: "codex", model: "sol" },
        reservedTokens: 40,
      },
      replacement: { tokens: 20, modelSelection: { instanceId: "claude", model: "sonnet" } },
      availableTokens: decision === "decline" ? 10 : 20,
    });
    post.mockResolvedValueOnce({ ...identity, revision, decision });
    await using screen = await render(
      <ManagedRunEvidence run={{ ...run, stages: [stage] }} allowQuotaDecisions />,
    );
    await screen.getByRole("button", { name: "Review replacement" }).click();
    expect(post).not.toHaveBeenCalled();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Load proposal" }).click();
    await expect.element(dialog.getByText("Replacement claude · sonnet")).toBeVisible();
    expect(post.mock.calls).toEqual([["handoff/review", identity]]);
    const approve = dialog.getByRole("button", { name: "Approve replacement" });
    if (decision === "decline") {
      await expect.element(approve).toBeDisabled();
      await dialog.getByRole("button", { name: "Decline replacement" }).click();
    } else {
      await approve.click();
    }
    await expect
      .element(
        dialog.getByText(
          decision === "approve"
            ? "Replacement approved. Resume pending."
            : "Replacement declined. The stage remains paused.",
        ),
      )
      .toBeVisible();
    expect(post.mock.calls[1]).toEqual(["handoff/decide", { ...identity, revision, decision }]);
  },
);
