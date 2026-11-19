import { Link } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { type FormEvent, useState } from "react";
import { postApproval } from "~/lib/isolatedApprovalClient";
import { parseManagedRunId } from "~/lib/managedRunDelivery";
import { Button } from "../ui/button";
import { Dialog, DialogDescription, DialogPopup, DialogTitle, DialogTrigger } from "../ui/dialog";

const ticketPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const Tokens = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }));
const Stage = Schema.Struct({
  projectId: Schema.String,
  message: Schema.String,
  tokens: Tokens,
  modelSelection: Schema.Struct({
    instanceId: Schema.String,
    model: Schema.String,
    options: Schema.optionalKey(Schema.Unknown),
  }),
});
const Draft = Schema.Struct({
  ticket: Schema.String,
  revision: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  brief: Schema.Struct({
    workspaceId: Schema.String,
    repository: Schema.String,
    baseSha: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/)),
    scope: Schema.String,
    tokens: Tokens,
    nativeStages: Schema.optionalKey(
      Schema.Struct({
        lead: Stage,
        implementation: Schema.optionalKey(Stage),
        qa: Schema.optionalKey(Stage),
      }),
    ),
  }),
});
const isDraft = Schema.is(Draft);
const isApproval = Schema.is(Schema.Struct({ runId: Schema.String, revision: Schema.String }));

function BriefForm() {
  const [draft, setDraft] = useState<typeof Draft.Type | null>(null);
  const [runId, setRunId] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function loadDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ticket = String(form.get("ticket") ?? "").trim();
    const scope = String(form.get("scope") ?? "").trim();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const action =
      submitter instanceof HTMLButtonElement && submitter.value === "prepare"
        ? "prepare"
        : "review";
    if (pending) return;
    if (!ticketPattern.test(ticket)) {
      setError("Enter a ticket using letters, digits, hyphens or underscores.");
      return;
    }
    if (action === "prepare" && !scope) {
      setError("Enter a task scope to prepare a draft.");
      return;
    }
    setPending(true);
    setDraft(null);
    setRunId(undefined);
    setError(undefined);
    try {
      const value = await postApproval(
        action,
        action === "prepare" ? { ticket, scope } : { ticket },
      );
      if (isDraft(value) && value.ticket === ticket) {
        setDraft(value);
      } else {
        setError("Invalid prepared brief.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Review failed.");
    }
    setPending(false);
  }

  async function approve() {
    if (!draft || pending || runId) return;
    setPending(true);
    setError(undefined);
    try {
      const value = await postApproval("approve", {
        ticket: draft.ticket,
        revision: draft.revision,
      });
      const id =
        isApproval(value) && value.revision === draft.revision
          ? parseManagedRunId(value.runId)
          : undefined;
      if (id) {
        setRunId(id);
      } else {
        setError("Approval receipt is unavailable. Retry the same revision to recover it.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Approval failed.");
    }
    setPending(false);
  }

  return (
    <div className="space-y-4">
      <form onSubmit={(event) => void loadDraft(event)} className="space-y-3">
        <label className="flex flex-col gap-1 text-sm">
          Ticket
          <input name="ticket" required maxLength={100} className="rounded-md border p-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Task scope
          <textarea name="scope" rows={3} maxLength={4000} className="rounded-md border p-2" />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="outline" disabled={pending}>
            Review existing draft
          </Button>
          <Button type="submit" value="prepare" disabled={pending}>
            Prepare draft
          </Button>
        </div>
      </form>
      {draft && (
        <div className="space-y-3 break-all text-sm">
          <p>
            {draft.brief.repository} · {draft.brief.workspaceId}
          </p>
          <p>Ticket {draft.ticket}</p>
          <p>Base commit {draft.brief.baseSha}</p>
          <p>Revision {draft.revision}</p>
          <p>Budget {draft.brief.tokens.toLocaleString()} tokens</p>
          <p className="whitespace-pre-wrap">{draft.brief.scope}</p>
          {draft.brief.nativeStages && (
            <ul className="space-y-2">
              {Object.entries(draft.brief.nativeStages).map(([role, stage]) => (
                <li key={role} className="rounded-md border p-2">
                  <p>
                    {role} · {stage.modelSelection.instanceId} · {stage.modelSelection.model}
                  </p>
                  <p>
                    {stage.tokens.toLocaleString()} tokens · Project {stage.projectId}
                  </p>
                  {stage.modelSelection.options !== undefined && (
                    <p>{JSON.stringify(stage.modelSelection.options)}</p>
                  )}
                  <p className="whitespace-pre-wrap">{stage.message}</p>
                </li>
              ))}
            </ul>
          )}
          {runId ? (
            <Link to="/delivery" search={{ run: runId }} className="underline">
              Open run in Delivery
            </Link>
          ) : (
            <Button type="button" disabled={pending} onClick={() => void approve()}>
              Approve isolated run
            </Button>
          )}
        </div>
      )}
      {pending && <p role="status">Waiting for the isolated sidecar…</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

export function IsolatedBriefDialog() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        Review isolated brief
      </DialogTrigger>
      <DialogPopup className="max-h-[80vh] overflow-auto">
        <DialogTitle>Review isolated brief</DialogTitle>
        <DialogDescription>
          Prepare a scoped draft or review an existing ticket before approving a run.
        </DialogDescription>
        {open && <BriefForm />}
      </DialogPopup>
    </Dialog>
  );
}
