import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  CLAUDE_PROVIDER,
  CODEX_PROVIDER,
  ENVIRONMENT_ID,
  dispatchedCommands,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { render } from "../../test/render";

vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

it.each(["approve", "decline"] as const)(
  "plan only gates a quota switch on %s",
  async (decision) => {
    const thread = threadWithHistory(`plan-quota-${decision}`, 1);
    const checkedAt = "2026-11-18T12:00:00.000Z";
    vi.setSystemTime(new Date(checkedAt));
    using _clock = { [Symbol.dispose]: () => vi.useRealTimers() };
    const usage = (usedPercent: number) => ({
      checkedAt,
      windows: [{ id: "primary", kind: "session", label: "Session limit", usedPercent }],
    });
    using _environment = installFakeEnvironment([thread], {
      acceptCommands: true,
      providers: [
        {
          ...CLAUDE_PROVIDER,
          displayName: "Lab Claude",
          usageLimits: usage(96),
          models: [{ ...CLAUDE_PROVIDER.models[0], slug: "claude-haiku-5-5" }],
        },
        {
          ...CODEX_PROVIDER,
          usageLimits: usage(20),
          models: [
            ...CODEX_PROVIDER.models,
            {
              slug: "gpt-6.2-astra",
              name: "GPT‑6.2 Astra",
              isCustom: false,
              capabilities: {
                optionDescriptors: [
                  {
                    id: "reasoningEffort",
                    label: "Effort",
                    type: "select",
                    options: [{ id: "max", label: "Max" }],
                  },
                ],
              },
            },
            {
              slug: "gpt-mini",
              name: "GPT Mini",
              isCustom: false,
              capabilities: {
                optionDescriptors: [
                  {
                    id: "reasoningEffort",
                    label: "Effort",
                    type: "select",
                    options: [{ id: "low", label: "Low" }],
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    __setClientSettingsForTests({
      ...DEFAULT_CLIENT_SETTINGS,
      onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
    });
    const router = getRouter(
      createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }),
    );
    await router.load();
    await using _app = await render(<AppRoot router={router} />, { router: false });

    await expect.element(page.getByText(`Answer 0 for ${thread.id}.`)).toBeVisible();
    const editor = page.getByTestId("composer-editor");
    await userEvent.click(editor);
    await userEvent.keyboard("Plan the fixture");
    await page.getByRole("button", { name: "Plan only", exact: true }).click();
    await expect.element(page.getByText(/Lab Claude.*96% used/)).toBeVisible();
    await expect.element(page.getByText(/Use codex.*gpt-mini/)).toBeVisible();
    const sends = () =>
      dispatchedCommands().filter((command) => command.type === "message.dispatch");
    expect(sends()).toHaveLength(0);
    if (decision === "decline") {
      await page.getByRole("button", { name: "Decline switch", exact: true }).click();
      await expect.element(page.getByText("Switch declined. Draft kept.")).toBeVisible();
      expect(editor.element().textContent).toContain("Plan the fixture");
      expect(sends()).toHaveLength(0);
      return;
    }
    await page.getByRole("button", { name: "Approve switch and plan", exact: true }).click();
    await vi.waitFor(() => expect(sends()).toHaveLength(1));
    expect(dispatchedCommands()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "thread.interaction-mode.set", interactionMode: "plan" }),
        expect.objectContaining({
          type: "thread.runtime-mode.set",
          runtimeMode: "approval-required",
        }),
      ]),
    );
    const serialized = JSON.stringify(sends()[0]);
    expect(serialized).toContain("gpt-6.2-astra");
    expect(serialized).toContain("gpt-mini");
    expect(serialized).toContain("low");
    expect(serialized).toContain("Quota switch approved for this turn");
  },
);
