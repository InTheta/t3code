/* oxlint-disable t3code/no-untranslated-copy -- fork: Plan only and Delivery copy, English only */
// Fork-owned UI for the composer's "Plan only" and "Open Delivery" features. ChatComposer.tsx is upstream's file, so it only
// calls into this one; keeping the logic here keeps upstream merges free of conflicts in that file.
import type { ModelSelection, ServerProvider } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { parseDeliveryPullRequestUrl } from "~/lib/deliveryPullRequest";
import { Button } from "../ui/button";
import { planOnlyProposal, type PlanOnlyDispatch, type PlanOnlyProposal } from "./planOnlyPreset";

type PlanDecision = {
  owner: string;
  prompt: string;
  proposal: PlanOnlyProposal;
  declined?: boolean;
};

export interface PlanOnlyInput {
  readonly canOperateThread: unknown;
  readonly selectedProvider: unknown;
  readonly phase: unknown;
  readonly isSendBusy: unknown;
  readonly isPreparingWorktree: unknown;
  readonly environmentUnavailable: unknown;
  readonly noPendingUserInputs: boolean;
  readonly noPendingApprovals: boolean;
  readonly multipleModelSelections: unknown;
  readonly editingQueuedAttachments: unknown;
  readonly getPrompt: () => string;
  readonly speechIdle: () => boolean;
  readonly draftOwner: string;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly instanceEntries: ReadonlyArray<{
    readonly instanceId: ModelSelection["instanceId"];
    readonly enabled: boolean;
    readonly isAvailable: boolean;
  }>;
  readonly selectedModelSelection: ModelSelection;
  readonly allowAccountSwitch: boolean;
  readonly getModelDisabledReason: (
    instanceId: ModelSelection["instanceId"],
    model: string,
  ) => string | null;
  readonly submit: (dispatch: PlanOnlyDispatch) => void;
}

export interface PlanOnlyControls {
  readonly canPlanOnly: boolean;
  readonly decision: PlanDecision | null;
  readonly propose: (approved?: boolean) => void;
  readonly decline: () => void;
}

export function usePlanOnly(input: PlanOnlyInput): PlanOnlyControls {
  const [decision, setDecision] = useState<PlanDecision | null>(null);
  const canPlanOnly =
    Boolean(input.canOperateThread) &&
    (input.selectedProvider === "codex" || input.selectedProvider === "claudeAgent") &&
    input.phase !== "running" &&
    input.phase !== "connecting" &&
    !input.isSendBusy &&
    !input.isPreparingWorktree &&
    input.environmentUnavailable === null &&
    input.noPendingUserInputs &&
    input.noPendingApprovals &&
    input.multipleModelSelections === null &&
    input.editingQueuedAttachments === null;

  const propose = (approved = false) => {
    const prompt = input.getPrompt();
    if (!canPlanOnly || !prompt.trim() || !input.speechIdle()) return;
    const proposal = planOnlyProposal(
      input.providers.filter((provider) =>
        input.instanceEntries.some(
          (entry) => entry.instanceId === provider.instanceId && entry.enabled && entry.isAvailable,
        ),
      ),
      input.selectedModelSelection,
      input.allowAccountSwitch,
      input.getModelDisabledReason,
      Date.now(),
    );
    const reviewed =
      decision?.owner === input.draftOwner &&
      decision.prompt === prompt &&
      !decision.declined &&
      JSON.stringify(decision.proposal.warning) === JSON.stringify(proposal.warning) &&
      JSON.stringify(decision.proposal.dispatch?.planner) ===
        JSON.stringify(proposal.dispatch?.planner) &&
      JSON.stringify(decision.proposal.dispatch?.inventoryTarget) ===
        JSON.stringify(proposal.dispatch?.inventoryTarget);
    if (approved && !reviewed) {
      setDecision(proposal.warning ? { owner: input.draftOwner, prompt, proposal } : null);
      return;
    }
    if (proposal.warning && !approved) {
      setDecision({ owner: input.draftOwner, prompt, proposal });
      return;
    }
    if (!proposal.dispatch) return;
    setDecision(null);
    const replacement = proposal.warning?.replacement;
    input.submit({
      ...proposal.dispatch,
      ...(replacement && proposal.warning
        ? { confirmedSwitch: { from: proposal.warning.current, to: replacement } }
        : {}),
    });
  };

  return {
    canPlanOnly,
    decision,
    propose,
    decline: () => setDecision((current) => (current ? { ...current, declined: true } : current)),
  };
}

export function PlanOnlyButton(props: { readonly plan: PlanOnlyControls }) {
  if (!props.plan.canPlanOnly) return null;
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={() => props.plan.propose()}
      title="Use a stronger planner when available and delegate read-only inventory to a lighter model"
    >
      Plan only
    </Button>
  );
}

export function PlanOnlyWarning(props: {
  readonly plan: PlanOnlyControls;
  readonly draftOwner: string;
}) {
  const decision = props.plan.decision;
  if (decision?.owner !== props.draftOwner || !decision.proposal.warning) return null;
  const warning = decision.proposal.warning;
  return (
    <div role="status" className="mx-3 mb-2 space-y-2 rounded-md border p-2 text-sm">
      <p>
        {warning.current} · {warning.quota.label}
        {warning.quota.usedPercent !== null ? ` · ${warning.quota.usedPercent}% used` : ""}
        {warning.quota.resetsAt
          ? ` · resets ${new Date(warning.quota.resetsAt).toLocaleString()}`
          : ""}
      </p>
      {decision.declined ? (
        <p>Switch declined. Draft kept.</p>
      ) : warning.replacement ? (
        <>
          <p>Use {warning.replacement} for this plan?</p>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={() => props.plan.propose(true)}>
              Approve switch and plan
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={props.plan.decline}>
              Decline switch
            </Button>
          </div>
        </>
      ) : (
        <p>
          No eligible replacement with current quota data. Choose another model or wait for reset.
        </p>
      )}
    </div>
  );
}

export function DeliveryLinkButton(props: { readonly prompt: string; readonly enabled: boolean }) {
  const navigate = useNavigate();
  if (
    !props.enabled ||
    !props.prompt.trim().startsWith("https://github.com/") ||
    !parseDeliveryPullRequestUrl(props.prompt)
  ) {
    return null;
  }
  return (
    <button
      className="mx-2 rounded-md border px-3 py-1 text-sm"
      type="button"
      onClick={() => void navigate({ to: "/delivery", search: { pr: props.prompt.trim() } })}
    >
      Open Delivery
    </button>
  );
}
