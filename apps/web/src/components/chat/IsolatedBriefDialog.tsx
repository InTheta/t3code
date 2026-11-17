import { Link } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { type FormEvent, useState } from "react";
import { readDesktopPrimaryBearerToken } from "~/environments/primary/desktopAuth";
import { resolvePrimaryEnvironmentHttpUrl } from "~/environments/primary/target";
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

async function postApproval(
  action: "review" | "approve",
  input: { ticket: string; revision?: string },
): Promise<unknown> {
  const token = await readDesktopPrimaryBearerToken();
  if (!token) throw new Error("Sign in to the local desktop environment.");
  const response = await fetch(
    resolvePrimaryEnvironmentHttpUrl(`/api/isolated-approval/v1/${action}`),
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(input),
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
    },
  );
  if (response.status === 409) {
    const value: unknown = await response.json();
    const error = Schema.is(Schema.Struct({ error: Schema.String }));
    throw new Error(error(value) ? value.error : "Review the latest prepared brief.");
  }
  if (response.status === 404)
    throw new Error("Isolated approval is disabled in this environment.");
  if (response.status === 401 || response.status === 403) {
    throw new Error("This session cannot approve isolated runs.");
  }
  if (!response.ok) throw new Error("The isolated approval service is unavailable.");
  return response.json();
}

function BriefForm() {
  const [draft, setDraft] = useState<typeof Draft.Type | null>(null);
  const [runId, setRunId] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ticket = new FormData(event.currentTarget).get("ticket");
    if (pending || typeof ticket !== "string" || !ticketPattern.test(ticket.trim())) return;
    setPending(true);
    setDraft(null);
    setRunId(undefined);
    setError(undefined);
    try {
      const value = await postApproval("review", { ticket: ticket.trim() });
      if (!isDraft(value) || value.ticket !== ticket.trim())
        throw new Error("Invalid prepared brief.");
      setDraft(value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Review failed.");
    } finally {
      setPending(false);
    }
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
      if (!id)
        throw new Error("Approval receipt is unavailable. Retry the same revision to recover it.");
      setRunId(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Approval failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={(event) => void review(event)} className="flex items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          Prepared ticket
          <input name="ticket" required maxLength={100} className="rounded-md border p-2" />
        </label>
        <Button type="submit" disabled={pending}>
          Review
        </Button>
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
        <DialogDescription>Enter a ticket prepared in the isolated workspace.</DialogDescription>
        {open && <BriefForm />}
      </DialogPopup>
    </Dialog>
  );
}
