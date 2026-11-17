import { Link } from "@tanstack/react-router";

import type { ManagedRun } from "~/lib/managedRunDelivery";

function formatTokens(value: number | null): string {
  return value === null ? "Unknown" : value.toLocaleString();
}

export function ManagedRunEvidence({ run }: { run: ManagedRun }) {
  const { brief, budget } = run;
  const fields = [
    ["Run ID", run.runId],
    ["Status", run.status],
    ["Brief revision", run.revision],
    ["Workspace", brief.workspaceId],
    ["Repository", brief.repository],
    ["Base commit", brief.baseSha],
    ["Scope", brief.scope],
    ["Brief tokens", formatTokens(brief.tokens)],
    ["Reserved tokens", formatTokens(budget.reserved)],
    ["Used tokens", formatTokens(budget.used)],
    ["Remaining tokens", formatTokens(budget.remaining)],
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
      <h3 className="mt-4 text-sm font-medium">Stages</h3>
      {run.stages.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No stages recorded.</p>
      ) : (
        <ul className="mt-2 space-y-2 text-sm">
          {run.stages.map((stage) => (
            <li className="rounded-md border p-2 break-words" key={stage.stageId}>
              <p className="font-medium">
                {stage.role} · {stage.status}
              </p>
              <p>Stage ID {stage.stageId}</p>
              <p>Provider instance {stage.providerInstanceId ?? "Unknown"}</p>
              <p>Thread {stage.threadId ?? "Unknown"}</p>
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
