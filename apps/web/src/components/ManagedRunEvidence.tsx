import { ThreadId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";

import type { ManagedRun } from "~/lib/managedRunDelivery";
import { useQuietThreadShell } from "~/state/entities";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { QuotaHandoffDialog } from "./QuotaHandoffDialog";

function WorkerThread({ id }: { id: string | null }) {
  const environmentId = usePrimaryEnvironmentId();
  const ref = environmentId && id ? { environmentId, threadId: ThreadId.make(id) } : null;
  const thread = useQuietThreadShell(ref);
  return (
    <p>
      Thread {id ?? "Unknown"}
      {ref && thread && (
        <>
          {" · "}
          <Link className="underline" to="/$environmentId/$threadId" params={ref}>
            Open worker thread
          </Link>
        </>
      )}
    </p>
  );
}

function formatCount(value: number | null): string {
  return value === null ? "Unknown" : value.toLocaleString();
}

const stageStatusLabels = new Map([
  ["waiting_for_operator", "Waiting for operator"],
  ["paused_provider_quota", "Paused on provider quota"],
  ["cancelling_quota", "Cancelling provider replacement"],
]);

export function ManagedRunEvidence({
  run,
  allowQuotaDecisions = false,
}: {
  run: ManagedRun;
  allowQuotaDecisions?: boolean;
}) {
  const { brief, budget, qa } = run;
  const fields = [
    ["Run ID", run.runId],
    ...(run.traceId ? [["Langfuse correlation ID", run.traceId]] : []),
    ["Status", run.status],
    ["Brief revision", run.revision],
    ["Workspace", brief.workspaceId],
    ["Repository", brief.repository],
    ["Base commit", brief.baseSha],
    ["Scope", brief.scope],
    ["Brief tokens", formatCount(brief.tokens)],
    ["Reserved tokens", formatCount(budget.reserved)],
    ["Used tokens", formatCount(budget.used)],
    ["Remaining tokens", formatCount(budget.remaining)],
  ];
  return (
    <article className="mt-4 max-w-2xl rounded-lg border p-4">
      <h2 className="font-medium">Managed run · {run.ticket}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Read only. Approval and dispatch controls are unavailable here.
      </p>
      <h3 className="mt-4 text-sm font-medium">Brief and budget</h3>
      <dl className="mt-2 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
        {fields.map(([label, value]) => (
          <div className="contents" key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="whitespace-pre-wrap break-words">{value}</dd>
          </div>
        ))}
      </dl>
      {qa && (
        <section className="mt-4 text-sm" aria-label="Independent QA">
          <h3 className="font-medium">Independent QA</h3>
          <dl className="mt-2 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-2">
            <dt className="text-muted-foreground">Verdict</dt>
            <dd>{qa.verdict === "pass" ? "Passed" : "Failed"}</dd>
            <dt className="text-muted-foreground">Reviewed commit</dt>
            <dd className="break-all font-mono">{qa.reviewedSha}</dd>
            <dt className="text-muted-foreground">Recorded by</dt>
            <dd>{qa.source === "operator" ? "Operator" : "Provider"}</dd>
          </dl>
          {qa.budgetExceeded && <p className="mt-2 font-medium">Token budget exceeded</p>}
        </section>
      )}
      <h3 className="mt-4 text-sm font-medium">Stages</h3>
      {run.stages.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No stages recorded.</p>
      ) : (
        <ul className="mt-2 space-y-2 text-sm">
          {run.stages.map((stage) => (
            <li className="rounded-md border p-2 break-words" key={stage.stageId}>
              <p className="font-medium">
                {stage.role} · {stageStatusLabels.get(stage.status) ?? stage.status}
              </p>
              <p>Stage ID {stage.stageId}</p>
              <p>Provider instance {stage.providerInstanceId ?? "Unknown"}</p>
              <WorkerThread id={stage.threadId} />
              <p>Tool calls {formatCount(stage.toolCalls ?? null)}</p>
              {stage.status === "paused_provider_quota" && (
                <p className="mt-1 text-muted-foreground">
                  Open the worker thread to inspect the usage limit.
                </p>
              )}
              {allowQuotaDecisions &&
                run.status === "approved" &&
                stage.status === "paused_provider_quota" && (
                  <div className="mt-2">
                    <QuotaHandoffDialog run={run} stage={stage} />
                  </div>
                )}
              {stage.status === "waiting_for_operator" && (
                <p className="mt-1 text-muted-foreground">
                  Review the pending request in the worker thread to continue.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap gap-4 text-sm">
        <Link className="underline" to="/settings/providers" search={{}}>
          Provider Settings
        </Link>
        <Link className="underline" to="/usage">
          Usage
        </Link>
      </div>
    </article>
  );
}
