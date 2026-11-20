import "~/index.css";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";
import type { Inbox, Proposal } from "~/lib/sidecarApi";
import { decideProposal, proposeCleanup } from "~/lib/sidecarApi";
import { CleanupProposals } from "./CleanupProposals";
import { InboxPanel } from "./InboxPanel";

vi.mock(import("~/lib/sidecarApi"), async (original) => ({
  ...(await original()),
  proposeCleanup: vi.fn(async () => ({ ok: true as const })),
  decideProposal: vi.fn(async () => ({ ok: true as const })),
}));

const inbox: Inbox = {
  generatedAt: "now",
  truncated: false,
  channels: ["stdout", "slack"],
  configError: null,
  items: [
    {
      id: "quota-decision:s1",
      kind: "quota-decision",
      severity: "action",
      title: "LAB-1: implementation stage paused on provider quota",
      detail: "Approve or decline a handoff.",
      link: "/delivery?run=85c0326b-52e0-46dc-899d-d451c5afb228",
    },
    {
      id: "head-moved:GH-2:bbbbbbbb",
      kind: "head-moved",
      severity: "warning",
      title: "GH-2: PR #4 changed after it was published",
      detail: "Head moved.",
      link: "/delivery?view=fleet",
    },
    {
      id: "ready-for-pr:x",
      kind: "ready-for-pr",
      severity: "info",
      title: "LAB-2: QA passed",
      detail: "Ready.",
      link: null,
    },
  ],
};

it("lists what needs a person first and says where new items are also sent", async () => {
  await using screen = await render(<InboxPanel inbox={inbox} onRefresh={() => {}} />);
  await expect.element(screen.getByText("Needs you · 1")).toBeVisible();
  await expect.element(screen.getByText("Worth a look · 1")).toBeVisible();
  await expect.element(screen.getByText("For your information · 1")).toBeVisible();
  await expect.element(screen.getByText("New items are also sent to slack.")).toBeVisible();
  await expect.element(screen.getByRole("link", { name: "Open" }).first()).toBeVisible();
  await expect.element(screen.getByText(/never from a chat message/)).toBeVisible();
});

it("says when nothing is waiting, when settings are bad and when the sidecar is away", async () => {
  {
    await using screen = await render(
      <InboxPanel
        inbox={{ ...inbox, items: [], configError: "channels must be a list" }}
        onRefresh={() => {}}
      />,
    );
    await expect.element(screen.getByText("Nothing is waiting on you.")).toBeVisible();
    await expect.element(screen.getByRole("alert")).toHaveTextContent(/channels must be a list/);
  }
  await using screen = await render(<InboxPanel inbox={null} onRefresh={() => {}} />);
  await expect.element(screen.getByText(/sidecar is not connected/)).toBeVisible();
});

const proposal = (extra: Partial<Proposal> = {}): Proposal => ({
  id: "0123456789abcdef",
  status: "pending",
  createdAt: "c",
  expiresAt: "2026-11-27T00:00:00+00:00",
  totalBytes: 5 * 1024 ** 3,
  itemCount: 2,
  byKind: { snapshot: { count: 2, bytes: 5 * 1024 ** 3 } },
  keptByReason: {},
  items: [
    {
      kind: "snapshot",
      task: "GH-1",
      sha: "a".repeat(40),
      bytes: 3 * 1024 ** 3,
      ageDays: 30,
      reason: "older than 7 days",
    },
  ],
  itemsTruncated: false,
  decidedBy: null,
  applied: null,
  ...extra,
});

it("shows a pending proposal and records approval without deleting anything itself", async () => {
  vi.mocked(decideProposal).mockClear();
  const changed = vi.fn();
  await using screen = await render(
    <CleanupProposals proposals={[proposal()]} onChanged={changed} />,
  );
  await expect.element(screen.getByText("Waiting for approval")).toBeVisible();
  await expect.element(screen.getByText("5.0 GiB · 2 items")).toBeVisible();
  await expect.element(screen.getByText(/does not\s+delete anything/)).toBeVisible();
  await screen.getByRole("button", { name: "Approve" }).click();
  await vi.waitFor(() => expect(decideProposal).toHaveBeenCalledTimes(1));
  expect(vi.mocked(decideProposal).mock.calls[0]?.slice(0, 2)).toEqual([
    "0123456789abcdef",
    "approve",
  ]);
  await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
});

it("offers decisions only while pending and shows what an applied proposal did", async () => {
  await using screen = await render(
    <CleanupProposals
      proposals={[
        proposal({
          status: "applied",
          decidedBy: "will",
          applied: { removed: 2, skipped: 0, failed: 0, freedBytes: 5 * 1024 ** 3 },
        }),
      ]}
      onChanged={() => {}}
    />,
  );
  await expect.element(screen.getByText("Applied", { exact: true })).toBeVisible();
  await expect
    .element(screen.getByText(/Removed 2, skipped 0, failed 0, freed 5.0 GiB/))
    .toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Approve" })).not.toBeInTheDocument();
});

it("proposes a cleanup on request and reports a refusal", async () => {
  vi.mocked(proposeCleanup).mockClear();
  vi.mocked(proposeCleanup).mockResolvedValueOnce({
    ok: false,
    message: "Changing the sidecar needs operator access.",
  });
  await using screen = await render(<CleanupProposals proposals={[]} onChanged={() => {}} />);
  await expect.element(screen.getByText("No proposals yet.")).toBeVisible();
  await screen.getByRole("button", { name: "Propose a cleanup now" }).click();
  await expect
    .element(screen.getByText("Changing the sidecar needs operator access."))
    .toBeVisible();
  expect(proposeCleanup).toHaveBeenCalledTimes(1);
});
