/* oxlint-disable t3code/no-untranslated-copy -- fork-only operator screen, English only */
import * as Schema from "effect/Schema";
import { useState } from "react";

import { postApproval } from "~/lib/isolatedApprovalClient";
import type { ManagedRun } from "~/lib/managedRunDelivery";
import { Button } from "./ui/button";
import { Dialog, DialogDescription, DialogPopup, DialogTitle, DialogTrigger } from "./ui/dialog";

const Decision = Schema.Literals(["approve", "decline"]);
const Tokens = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
const Model = Schema.Struct({
  instanceId: Schema.String,
  model: Schema.String,
  options: Schema.optionalKey(Schema.Unknown),
});
const Receipt = Schema.Struct({
  runId: Schema.String,
  stageId: Schema.String,
  revision: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  decision: Decision,
  replacementTurnId: Schema.optionalKey(Schema.String),
});
const Proposal = Schema.Struct({
  ...Receipt.fields,
  decision: Schema.optionalKey(Decision),
  approvedRevision: Schema.String,
  repository: Schema.String,
  baseSha: Schema.String,
  candidateSha: Schema.NullOr(Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/))),
  scope: Schema.String,
  original: Schema.Struct({
    threadId: Schema.String,
    modelSelection: Model,
    reservedTokens: Tokens,
  }),
  replacement: Schema.Struct({ modelSelection: Model, tokens: Tokens }),
  availableTokens: Tokens,
});

const isProposal = Schema.is(Proposal);
const isReceipt = Schema.is(Receipt);

type HandoffProps = { run: ManagedRun; stage: ManagedRun["stages"][number] };

type Identity = { runId: string; stageId: string };

// React Compiler cannot compile a `throw` inside try/catch, so the checks live here and the
// components only call these functions inside their try blocks.
async function requestProposal(
  run: ManagedRun,
  stage: HandoffProps["stage"],
  identity: Identity,
): Promise<typeof Proposal.Type> {
  const value = await postApproval("handoff/review", identity);
  if (
    !isProposal(value) ||
    value.runId !== run.runId ||
    value.stageId !== stage.stageId ||
    value.approvedRevision !== run.revision ||
    value.repository !== run.brief.repository ||
    value.baseSha !== run.brief.baseSha ||
    value.scope !== run.brief.scope ||
    value.original.threadId !== stage.threadId ||
    value.original.modelSelection.instanceId !== stage.providerInstanceId
  ) {
    throw new Error("The proposal does not match the paused stage.");
  }
  return value;
}

async function requestReceipt(
  run: ManagedRun,
  stage: HandoffProps["stage"],
  identity: Identity,
  proposal: typeof Proposal.Type,
  choice: typeof Decision.Type,
): Promise<typeof Receipt.Type> {
  const value = await postApproval("handoff/decide", {
    ...identity,
    revision: proposal.revision,
    decision: choice,
  });
  if (
    !isReceipt(value) ||
    value.runId !== run.runId ||
    value.stageId !== stage.stageId ||
    value.revision !== proposal.revision ||
    value.decision !== choice
  ) {
    throw new Error("Decision receipt unavailable. Retry the same decision to recover it.");
  }
  return value;
}

function HandoffReview({ run, stage }: HandoffProps) {
  const [proposal, setProposal] = useState<typeof Proposal.Type>();
  const [decision, setDecision] = useState<typeof Decision.Type>();
  const [replacementTurnId, setReplacementTurnId] = useState<string>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const identity = { runId: run.runId, stageId: stage.stageId };

  async function review() {
    setPending(true);
    setError(undefined);
    try {
      const value = await requestProposal(run, stage, identity);
      setProposal(value);
      setDecision(value.decision);
      setReplacementTurnId(value.replacementTurnId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Replacement review failed.");
    }
    setPending(false);
  }

  async function decide(choice: typeof Decision.Type) {
    if (!proposal || pending || decision === "decline" || replacementTurnId) return;
    setPending(true);
    setError(undefined);
    try {
      const value = await requestReceipt(run, stage, identity, proposal, choice);
      setDecision(value.decision);
      setReplacementTurnId(value.replacementTurnId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Replacement decision failed.");
    }
    setPending(false);
  }

  return (
    <div className="mt-3 space-y-3 text-sm">
      {proposal ? (
        <>
          <p className="whitespace-pre-wrap">{proposal.scope}</p>
          <p>Base commit {proposal.baseSha}</p>
          {proposal.candidateSha && <p>Candidate commit {proposal.candidateSha}</p>}
          <p>
            Original provider {proposal.original.modelSelection.instanceId} ·{" "}
            {proposal.original.modelSelection.model}
          </p>
          <p>
            Replacement {proposal.replacement.modelSelection.instanceId} ·{" "}
            {proposal.replacement.modelSelection.model}
          </p>
          {proposal.replacement.modelSelection.options !== undefined && (
            <p>{JSON.stringify(proposal.replacement.modelSelection.options)}</p>
          )}
          <p>
            {proposal.original.reservedTokens.toLocaleString()} tokens held for the original attempt
          </p>
          <p>
            {proposal.replacement.tokens.toLocaleString()} replacement tokens ·{" "}
            {proposal.availableTokens.toLocaleString()} available
          </p>
          {decision ? (
            <>
              <p role="status">
                {decision === "decline"
                  ? "Replacement declined. The stage remains paused."
                  : replacementTurnId
                    ? "Replacement turn recorded."
                    : "Replacement approved. Resume pending."}
              </p>
              {decision === "approve" && !replacementTurnId && (
                <Button type="button" disabled={pending} onClick={() => void decide("approve")}>
                  Retry approved replacement
                </Button>
              )}
            </>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={pending || proposal.replacement.tokens > proposal.availableTokens}
                onClick={() => void decide("approve")}
              >
                Approve replacement
              </Button>
              <Button
                type="button"
                disabled={pending}
                variant="outline"
                onClick={() => void decide("decline")}
              >
                Decline replacement
              </Button>
            </div>
          )}
        </>
      ) : (
        <Button type="button" disabled={pending} onClick={() => void review()}>
          Load proposal
        </Button>
      )}
      {pending && <p role="status">Waiting for the isolated sidecar…</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

export function QuotaHandoffDialog(props: HandoffProps) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        Review replacement
      </DialogTrigger>
      <DialogPopup className="max-h-[80vh] overflow-auto break-words">
        <DialogTitle>Review quota replacement</DialogTitle>
        <DialogDescription>
          Review the provider and token reservation for this paused stage.
        </DialogDescription>
        {open && <HandoffReview {...props} />}
      </DialogPopup>
    </Dialog>
  );
}
