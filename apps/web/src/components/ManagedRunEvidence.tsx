/* oxlint-disable t3code/no-untranslated-copy -- fork-only operator screen, English only */
import { ThreadId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";

import { useNowSecond } from "~/hooks/useNowSecond";
import { formatAge } from "~/lib/sidecarApi";
import { buildRunFlow } from "~/lib/runFlow";
import type { ManagedRun } from "~/lib/managedRunDelivery";
import { FlowDiagram } from "./FlowDiagram";
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

function SnapshotAge({ readAt }: { readAt: string }) {
  const now = useNowSecond();
  const asOf = Date.parse(readAt);
  return (
    <time dateTime={readAt}>
      {formatAge(Number.isFinite(asOf) ? Math.max(0, Math.round((now - asOf) / 1000)) : null)}
    </time>
  );
}

const stageStatusLabels = new Map([
  ["waiting_for_operator", "Needs a person"],
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
  const [selectedNode, setSelectedNode] = useState<string | undefined>();
  const flow = buildRunFlow(run);
  const selectedStage = flow.nodes.find((node) => node.id === selectedNode)?.stageId;
  const fields: Array<readonly [label: string, value: ReactNode]> = [
    ["Run ID", run.runId],
    ...(run.traceId ? ([["Langfuse correlation ID", run.traceId]] as const) : []),
    ["Status", run.status],
    ["Brief revision", run.revision],
    ["Workspace", brief.workspaceId],
    ["Repository", brief.repository],
    ["Base commit", brief.baseSha],
    ["Verified candidate", run.candidateSha ?? "Unavailable"],
    ["Sidecar host", run.source?.host ?? "Unavailable"],
    ["Sidecar build", run.source?.buildSha ?? "Unavailable"],
    [
      "Snapshot age",
      run.source ? <SnapshotAge key="snapshot-age" readAt={run.source.readAt} /> : "Unavailable",
    ],
    ["Scope", brief.scope],
    ["Brief tokens", formatCount(brief.tokens)],
    ["Reserved tokens", formatCount(budget.reserved)],
    ["Used tokens", formatCount(budget.used)],
    ["Remaining tokens", formatCount(budget.remaining)],
  ];
  return (
    <article className="mt-4 max-w-4xl rounded-lg border p-4">
      <h2 className="font-medium">Managed run · {run.ticket}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Read only. Approval and dispatch controls are unavailable here.
      </p>
      <h3 className="mt-4 text-sm font-medium">Flow</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Solid arrows were followed; dashed arrows are routes the run could still take. Select a
        stage to open its details below.
      </p>
      <FlowDiagram
        flow={flow}
        label={`Flow of managed run ${run.ticket}`}
        selectedId={selectedNode}
        onSelect={(node) => {
          setSelectedNode(node.id);
          document.getElementById(`stage-${node.stageId}`)?.scrollIntoView?.({ block: "nearest" });
        }}
      />
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
            <li
              id={`stage-${stage.stageId}`}
              className={`rounded-md border p-2 break-words ${selectedStage === stage.stageId ? "ring-2 ring-info" : ""}`}
              key={stage.stageId}
            >
              <p className="font-medium">
                {stage.role} ·{" "}
                {stage.status === "queued" && stage.role === "qa" && run.candidateSha
                  ? "Ready for review"
                  : stage.status === "running" && stage.threadId
                    ? "Waiting for worker"
                    : (stageStatusLabels.get(stage.status) ?? stage.status)}
              </p>
              <p>Stage ID {stage.stageId}</p>
              <p>Provider instance {stage.providerInstanceId ?? "Unknown"}</p>
              <WorkerThread id={stage.threadId} />
              {stage.status === "running" && stage.threadId && (
                <div>
                  <p>Next owner · bound worker</p>
                  <p>Next event · worker result</p>
                </div>
              )}
              {stage.status === "queued" && stage.role === "qa" && run.candidateSha && (
                <div>
                  <p>Next owner · controller</p>
                  <p>Next event · independent review launch</p>
                </div>
              )}
              <p>Tool calls {formatCount(stage.toolCalls ?? null)}</p>
              {run.stageAttempts
                ?.filter((attempt) => attempt.stageId === stage.stageId)
                .map((attempt) => (
                  <details
                    className="mt-2"
                    key={`${attempt.attemptId}:${selectedStage === stage.stageId}`}
                    open={selectedStage === stage.stageId || undefined}
                  >
                    <summary className="cursor-pointer">
                      {attempt.actualModel ?? attempt.providerInstanceId} {"·"} {attempt.status}{" "}
                      {"·"} Usage {attempt.usageStatus}
                    </summary>
                    <dl className="ml-4 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3">
                      <dt>Input tokens</dt>
                      <dd>{formatCount(attempt.tokens.inputTokens)}</dd>
                      <dt>Cached input tokens</dt>
                      <dd>{formatCount(attempt.tokens.cachedInputTokens)}</dd>
                      <dt>Cache creation tokens</dt>
                      <dd>{formatCount(attempt.tokens.cacheCreationTokens)}</dd>
                      <dt>Output tokens</dt>
                      <dd>{formatCount(attempt.tokens.outputTokens)}</dd>
                      <dt>Reasoning tokens</dt>
                      <dd>{formatCount(attempt.tokens.reasoningTokens)}</dd>
                      <dt>Requested reasoning</dt>
                      <dd>{attempt.requestedReasoningEffort ?? "Unknown"}</dd>
                    </dl>
                  </details>
                ))}
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
                <div className="mt-1 text-muted-foreground">
                  <p>Next owner · operator</p>
                  <p>Next event · response to the pending request in the worker thread</p>
                </div>
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
