/* oxlint-disable t3code/no-untranslated-copy -- fork-only operator screen, English only */
import { Link } from "@tanstack/react-router";

import type { Provenance, Quality } from "~/lib/sidecarApi";

const levelClass = {
  fail: "border-destructive text-destructive",
  warn: "border-warning text-warning",
  info: "border-border text-muted-foreground",
} as const;

function percent(value: number | null): string {
  return value === null ? "no decisions yet" : `${Math.round(value * 100)}%`;
}

function OwnerLine({ owner }: { owner: NonNullable<Provenance["owner"]> }) {
  const rows: [string, string | null][] = [
    ["Accountable person", owner.humanOwner],
    ["Approved by", owner.approvedBy],
    ["Pull request author", owner.prAuthor],
    ["Merged by", owner.mergedBy],
    ["Commit authors", owner.commitAuthors.length > 0 ? owner.commitAuthors.join(", ") : null],
  ];
  return (
    <dl className="mt-3 grid max-w-xl grid-cols-[max-content_1fr] gap-x-6 gap-y-1 rounded-lg border p-3 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd>{value ?? "not recorded"}</dd>
        </div>
      ))}
      {owner.prNumber !== null && (
        <div className="contents">
          <dt className="text-muted-foreground">Pull request</dt>
          <dd>
            {owner.prUrl ? (
              <a className="underline" href={owner.prUrl} target="_blank" rel="noreferrer noopener">
                #{owner.prNumber}
              </a>
            ) : (
              `#${owner.prNumber}`
            )}
            {owner.prState ? ` · ${owner.prState}` : ""}
          </dd>
        </div>
      )}
    </dl>
  );
}

function DecisionTrace({ trace }: { trace: Provenance }) {
  return (
    <section className="mt-6 max-w-3xl" aria-label={`Decisions of ${trace.ticket}`}>
      <h2 className="font-medium">
        {trace.ticket} · {trace.status}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {trace.traceable} of {trace.total} decisions trace fully to who made them and the worker.
        {trace.traceId ? ` Trace ${trace.traceId}.` : ""}
      </p>
      {trace.owner ? (
        <OwnerLine owner={trace.owner} />
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          No pull request is linked, so only the approver is known.
        </p>
      )}
      <ol className="mt-3 grid gap-3">
        {trace.decisions.map((decision) => (
          <li key={decision.id} className="rounded-lg border p-3 text-sm">
            <p className="font-medium">{decision.title}</p>
            <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1">
              <dt className="text-muted-foreground">Decided by</dt>
              <dd>
                {decision.byName ?? "not recorded"} ({decision.byType})
              </dd>
              {decision.at && (
                <>
                  <dt className="text-muted-foreground">When</dt>
                  <dd>{decision.at}</dd>
                </>
              )}
              {decision.launch && (
                <>
                  <dt className="text-muted-foreground">Worker</dt>
                  <dd className="break-all">
                    {decision.launch.providerInstanceId ?? "unknown"} · thread{" "}
                    {decision.launch.threadId ?? "none"} · turn {decision.launch.turnId ?? "none"}
                  </dd>
                </>
              )}
              {(decision.modelApproved || decision.modelActual) && (
                <>
                  <dt className="text-muted-foreground">Model</dt>
                  <dd>
                    approved {decision.modelApproved ?? "unknown"} · reported{" "}
                    {decision.modelActual ?? "not reported"}
                  </dd>
                </>
              )}
              {decision.tokens !== null && (
                <>
                  <dt className="text-muted-foreground">Tokens</dt>
                  <dd>{decision.tokens.toLocaleString()}</dd>
                </>
              )}
            </dl>
            {decision.gaps.length > 0 && (
              <ul className="mt-2 grid gap-1">
                {decision.gaps.map((gap) => (
                  <li key={gap.code} className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs ${levelClass[gap.severity]}`}
                    >
                      {gap.severity}
                    </span>
                    {gap.message}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function QualityPanel({
  quality,
  trace,
  onRefresh,
}: {
  quality: Quality | null;
  trace: Provenance | null;
  onRefresh: () => void;
}) {
  if (quality === null) {
    return (
      <p className="mt-4 max-w-2xl text-sm" role="status">
        No managed-run ledger is connected, so there is nothing to check. Start the sidecar HTTP
        service with --managed-ledger and --managed-workspace, then refresh.
      </p>
    );
  }
  return (
    <section className="mt-4 max-w-3xl" aria-label="Quality">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p>
          <span
            className={`rounded-full border px-2 py-0.5 text-xs ${quality.passed ? "border-success text-success" : levelClass.fail}`}
          >
            {quality.passed ? "Record check passed" : "Record check failed"}
          </span>{" "}
          {quality.runs} runs · {quality.decisions} decisions · {percent(quality.coverage)}{" "}
          traceable · {quality.counts.fail} failed · {quality.counts.warn} to review
        </p>
        <button className="rounded-md border px-3 py-1" onClick={onRefresh}>
          Refresh
        </button>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Checks that every decision can be followed to who made it and the worker that did the work.
        Read-only; it never changes a run or a route.
      </p>

      <h2 className="mt-5 font-medium">Findings</h2>
      {quality.findings.length === 0 ? (
        <p className="mt-2 text-sm">Nothing to report.</p>
      ) : (
        <ul className="mt-2 grid gap-2">
          {quality.findings.map((finding) => (
            <li
              key={`${finding.runId}:${finding.code}:${finding.message}`}
              className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3 text-sm"
            >
              <p className="min-w-0 flex-1">
                <span
                  className={`mr-2 rounded-full border px-2 py-0.5 text-xs ${levelClass[finding.severity]}`}
                >
                  {finding.severity}
                </span>
                <span className="font-medium">{finding.ticket}</span> · {finding.message}
              </p>
              <Link
                className="rounded-md border px-3 py-1"
                to="/delivery"
                search={{ view: "quality", trace: finding.runId }}
              >
                Trace
              </Link>
            </li>
          ))}
        </ul>
      )}
      {quality.findingsTruncated && (
        <p className="mt-2 text-sm text-muted-foreground">Showing the first findings only.</p>
      )}

      {trace && <DecisionTrace trace={trace} />}

      <h2 className="mt-6 font-medium">Routes so far</h2>
      {quality.rows.length === 0 ? (
        <p className="mt-2 text-sm">No stages have run yet.</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 pr-4 font-normal">Role</th>
                <th className="py-1 pr-4 font-normal">Provider</th>
                <th className="py-1 pr-4 font-normal">Model</th>
                <th className="py-1 pr-4 font-normal">Stages</th>
                <th className="py-1 pr-4 font-normal">Quota pauses</th>
                <th className="py-1 pr-4 font-normal">QA pass / fail</th>
                <th className="py-1 font-normal">Avg tokens</th>
              </tr>
            </thead>
            <tbody>
              {quality.rows.map((row) => (
                <tr key={`${row.role}:${row.instance}:${row.model}`} className="border-t">
                  <td className="py-1 pr-4">{row.role}</td>
                  <td className="py-1 pr-4">{row.instance}</td>
                  <td className="py-1 pr-4">{row.model}</td>
                  <td className="py-1 pr-4">
                    {row.stages}
                    {row.comparable ? "" : " (too few to compare)"}
                  </td>
                  <td className="py-1 pr-4">{row.quotaPaused}</td>
                  <td className="py-1 pr-4">
                    {row.qaPassed} / {row.qaFailed}
                  </td>
                  <td className="py-1">{row.avgTokens?.toLocaleString() ?? "unknown"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {quality.suggestions.length > 0 && (
        <ul className="mt-3 grid gap-1 text-sm">
          {quality.suggestions.map((note) => (
            <li key={`${note.subject}:${note.note}`}>
              <span className="font-medium">{note.subject}</span> · {note.note}
              {note.requiresHuman ? " A person decides whether to change the route." : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
