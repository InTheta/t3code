import "~/index.css";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render, stubGlobal } from "../../../test/render";
import { IsolatedBriefDialog } from "./IsolatedBriefDialog";

vi.mock(import("~/environments/primary/desktopAuth"), () => ({
  readDesktopPrimaryBearerToken: async () => "fixture-session",
}));
vi.mock(import("~/environments/primary/target"), () => ({
  resolvePrimaryEnvironmentHttpUrl: (pathname: string) => `http://127.0.0.1:3210${pathname}`,
}));

it.each(["review", "prepare"] as const)(
  "requires explicit approval after %s and can recover a missing receipt",
  async (action) => {
    const revision = "a".repeat(64);
    const baseSha = "b".repeat(40);
    const runId = "a16fdb25-00e8-4061-97c2-14cd6e10c27b";
    const fetchApproval = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          ticket: "fixture",
          revision,
          brief: {
            repository: "lab/fixture",
            workspaceId: "isolated",
            scope: "Update the clamp fixture",
            baseSha,
            tokens: 1000,
            nativeStages: {
              lead: {
                projectId: "fixture-project",
                message: "Review the clamp brief",
                tokens: 100,
                modelSelection: { instanceId: "codex-lab", model: "codex-fixture" },
              },
            },
          },
        }),
      )
      .mockRejectedValueOnce(new Error("Reply lost"))
      .mockResolvedValueOnce(Response.json({ runId, revision }));
    using _fetch = stubGlobal("fetch", fetchApproval);
    await using screen = await render(<IsolatedBriefDialog />);
    await screen.getByRole("button", { name: "Review isolated brief" }).click();
    const dialog = page.getByRole("dialog");
    const approve = dialog.getByRole("button", { name: "Approve isolated run" });
    await expect.element(approve).not.toBeInTheDocument();
    await dialog.getByRole("textbox", { name: "Ticket", exact: true }).fill("fixture");
    if (action === "prepare") {
      await dialog.getByRole("textbox", { name: "Task scope" }).fill("Update the clamp fixture");
    }
    await dialog
      .getByRole("button", {
        name: action === "prepare" ? "Prepare draft" : "Review existing draft",
        exact: true,
      })
      .click();
    await expect.element(dialog.getByText(`Base commit ${baseSha}`)).toBeVisible();
    await expect.element(dialog.getByText("lead · codex-lab · codex-fixture")).toBeVisible();
    expect(fetchApproval).toHaveBeenCalledTimes(1);
    expect(fetchApproval.mock.calls[0]?.[0]).toMatch(new RegExp(`/${action}$`));
    await approve.click();
    await expect.element(dialog.getByRole("alert")).toHaveTextContent("Reply lost");
    await approve.click();
    await expect
      .element(dialog.getByRole("link", { name: "Open run in Delivery" }))
      .toHaveAttribute("href", `/delivery?run=${runId}`);
    const approvalCalls = fetchApproval.mock.calls.slice(1);
    expect(approvalCalls).toHaveLength(2);
    expect(approvalCalls[0]).toEqual(approvalCalls[1]);
    expect(approvalCalls[0]?.[0]).toMatch(/\/approve$/);
    expect(approvalCalls[0]?.[1]?.body).toBe(JSON.stringify({ ticket: "fixture", revision }));
    expect(approvalCalls[0]?.[1]?.credentials).toBe("omit");
  },
);
