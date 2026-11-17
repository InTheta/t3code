import { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";
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

it("links an operator wait to the locally known worker and preserves unknown evidence", async () => {
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
  await using screen = await render(<ManagedRunEvidence run={run} />);
  await expect.element(screen.getByText("implementation · Waiting for operator")).toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: "Open worker thread" }))
    .toHaveAttribute("href", "/windows-fixture/mcp%3Alaunch%3Aknown");
  await expect.element(screen.getByText("Thread mcp:launch:unknown")).toBeVisible();
  await expect.element(screen.getByText("Tool calls 0")).toBeVisible();
  await expect.element(screen.getByText("Tool calls Unknown")).toBeVisible();
});
