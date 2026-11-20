/* oxlint-disable t3code/no-untranslated-copy -- fork-only operator screen, English only */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { ManagedRunEvidence } from "~/components/ManagedRunEvidence";
import { deliveryCiRun } from "~/lib/deliveryPullRequest";
import { parseManagedRunId, readManagedRun } from "~/lib/managedRunDelivery";
import { readPullRequestDelivery } from "~/lib/pullRequestDeliveryEvidence";
import { useThreadProjection, useVisibleThreadShells } from "~/state/entities";
import { buildThreadRouteParams } from "~/threadRoutes";

const panel = "rounded-xl border border-border bg-card p-4";
const subdued = "text-sm text-muted-foreground";
const link = "underline underline-offset-4";

function GitHubToolEvidence({ threadRef }: { threadRef: ScopedThreadRef }) {
  const projection = useThreadProjection(threadRef)?.projection;
  if (!projection) return <p className={subdued}>GitHub tool evidence loading…</p>;

  const items = projection.turnItems;
  const mcpCalls = items.filter(
    (item) =>
      item.type === "dynamic_tool" &&
      item.toolName !== null &&
      /^mcp__github(?:[-_]readonly)?__/i.test(item.toolName),
  );
  const usedGh = items.some((item) => {
    if (item.status !== "completed") return false;
    const command =
      item.type === "command_execution"
        ? item.input
        : item.type === "dynamic_tool" &&
            item.toolName !== null &&
            /^(?:bash|powershell)$/i.test(item.toolName) &&
            item.input !== null &&
            typeof item.input === "object" &&
            "command" in item.input
          ? item.input.command
          : undefined;
    return (
      typeof command === "string" &&
      /(?:^|[\s;(|])gh(?:\.exe)?\s+(?:pr\s+(?:view|checks|diff|list)|issue\s+(?:view|list)|run\s+(?:view|list)|api\s+repos\/)/im.test(
        command,
      )
    );
  });
  const mcpCompleted = mcpCalls.some((item) => item.status === "completed");
  const observed = [
    mcpCompleted ? "GitHub MCP completed" : mcpCalls.length > 0 ? "GitHub MCP attempted" : null,
    usedGh ? (mcpCompleted ? "gh CLI also used" : "gh CLI fallback observed") : null,
  ].filter(Boolean);
  return (
    <p className={subdued}>
      {observed.length > 0 ? observed.join(" · ") : "No GitHub tool calls observed"}
    </p>
  );
}

function modelEffort(options: ReadonlyArray<{ id: string; value: unknown }> | undefined) {
  const effort = options?.find(({ id }) => id === "reasoningEffort" || id === "effort")?.value;
  return typeof effort === "string" ? effort : "Effort unavailable";
}

function useLiveEvidence<T>(
  key: string | undefined,
  read: (key: string, signal: AbortSignal) => Promise<T | null>,
) {
  const [snapshot, setSnapshot] = useState<{ key: string; value: T | null; checkedAt: Date }>();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns the sidecar polling timer and aborts requests when the selected record changes.
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh(value: string) {
      const result = await read(value, controller.signal);
      if (controller.signal.aborted) return;
      setSnapshot({ key: value, value: result, checkedAt: new Date() });
      timer = setTimeout(() => void refresh(value), 30_000);
    }
    void refresh(key);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [key, read]);
  return snapshot?.key === key ? snapshot : undefined;
}

function PullRequestCard({ url }: { url: string }) {
  const evidence = useLiveEvidence(url, readPullRequestDelivery);
  const row = evidence?.value;
  const ci = row && deliveryCiRun(row.pullRequest.repository, row.ci.runId);
  return (
    <li className="rounded-lg border p-3 text-sm">
      <a className={link} href={url} target="_blank" rel="noreferrer">
        {url.replace("https://github.com/", "")}
      </a>
      {row ? (
        <dl className="mt-2 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1">
          <dt>PR head</dt>
          <dd className="break-all font-mono">{row.pullRequest.head}</dd>
          <dt>QA</dt>
          <dd className="break-all">
            {row.qa.status}
            {row.qa.head && row.qa.head !== row.pullRequest.head ? " (stale)" : ""}
            {row.qa.head && ` · ${row.qa.head}`}
          </dd>
          <dt>CI</dt>
          <dd className="break-all">
            {row.ci.status}
            {row.ci.head && row.ci.head !== row.pullRequest.head ? " (stale)" : ""}
            {row.ci.head && ` · ${row.ci.head}`}{" "}
            {ci?.href && (
              <a className={link} href={ci.href} target="_blank" rel="noreferrer">
                {ci.label}
              </a>
            )}
          </dd>
        </dl>
      ) : (
        <p className={subdued}>
          {evidence ? "QA and CI evidence unavailable" : "Reading QA and CI evidence…"}
        </p>
      )}
      <Link className={link} to="/delivery" search={{ pr: url }}>
        Open Delivery
      </Link>
    </li>
  );
}

function WorkflowPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const threads = useVisibleThreadShells();
  const selected = threads.find(
    (thread) => thread.id === search.thread && thread.environmentId === search.environment,
  );
  const ref = selected ? scopeThreadRef(selected.environmentId, selected.id) : null;
  const projection = useThreadProjection(ref)?.projection;
  const managed = useLiveEvidence(search.run, readManagedRun);
  const [runInput, setRunInput] = useState(search.run ?? "");
  const agents = projection?.subagents ?? [];
  const recentMessages = (projection?.messages ?? []).slice(-24).reverse();
  const issues = [
    ...new Set(
      recentMessages.flatMap(
        ({ text }) =>
          text.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/[1-9]\d*\b/g) ?? [],
      ),
    ),
  ].slice(0, 12);
  const refs = new Set<string>();
  for (const url of [
    ...(selected?.pullRequests ?? []).map((pr) => pr.url),
    selected?.linkedPullRequest?.url ?? "",
    selected?.branchPullRequest?.url ?? "",
    ...recentMessages.flatMap(
      ({ text }) => text.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/[1-9]\d*\b/g) ?? [],
    ),
  ]) {
    if (/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/[1-9]\d*$/.test(url)) refs.add(url);
    if (refs.size === 12) break;
  }
  const latestRun = projection?.runs.find((run) => run.id === selected?.latestRun?.runId);
  return (
    <main className="scrollbar-gutter-both h-full overflow-y-auto bg-background">
      <div className="mx-auto grid max-w-6xl gap-4 px-5 py-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Workflow</h1>
            <p className={subdued}>Live thread activity and Delivery evidence</p>
          </div>
          <Link className={link} to="/usage">
            Usage
          </Link>
        </header>
        <label className="grid gap-1 text-sm">
          Thread
          <select
            className="max-w-full rounded-md border bg-background p-2"
            value={selected ? JSON.stringify([selected.environmentId, selected.id]) : ""}
            onChange={(event) => {
              const thread = threads.find(
                (item) => JSON.stringify([item.environmentId, item.id]) === event.target.value,
              );
              void navigate({
                search: { ...search, environment: thread?.environmentId, thread: thread?.id },
              });
            }}
          >
            <option value="">Select a thread</option>
            {threads.map((thread) => {
              const key = JSON.stringify([thread.environmentId, thread.id]);
              return (
                <option key={key} value={key}>
                  {thread.title} · {thread.branch ?? thread.environmentId}
                </option>
              );
            })}
          </select>
        </label>
        {selected && ref && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <section className={panel}>
              <h2 className="font-medium">Agents and tasks</h2>
              <article className="mt-3 rounded-lg border p-3">
                <Link
                  className={link}
                  to="/$environmentId/$threadId"
                  params={buildThreadRouteParams(ref)}
                >
                  {selected.title}
                </Link>
                <p className={subdued}>
                  {selected.providerInstanceId} · {selected.modelSelection.model} ·{" "}
                  {modelEffort(selected.modelSelection.options)} ·{" "}
                  {latestRun?.status ??
                    selected.latestRun?.status ??
                    selected.runtime?.status ??
                    "Idle"}
                </p>
                <p className={`${subdued} break-all`}>
                  {selected.worktreePath ?? "No separate worktree"} ·{" "}
                  {selected.branch ?? "Branch unavailable"}
                </p>
              </article>
              <ul className="ml-4 border-l pl-4">
                {agents.map((agent) => {
                  const child =
                    agent.childThreadId &&
                    threads.find(
                      (thread) =>
                        thread.environmentId === selected.environmentId &&
                        thread.id === agent.childThreadId,
                    );
                  const childRef = agent.remoteChild
                    ? scopeThreadRef(agent.remoteChild.environmentId, agent.remoteChild.threadId)
                    : agent.childThreadId
                      ? scopeThreadRef(selected.environmentId, agent.childThreadId)
                      : null;
                  const selection = agent.modelSelection;
                  return (
                    <li
                      className="relative pt-3 before:absolute before:-left-4 before:top-8 before:w-4 before:border-t"
                      key={agent.id}
                    >
                      <div className="rounded-lg border p-3">
                        <p className="font-medium">
                          {childRef ? (
                            <Link
                              className={link}
                              to="/$environmentId/$threadId"
                              params={buildThreadRouteParams(childRef)}
                            >
                              {agent.title ?? "Worker"}
                            </Link>
                          ) : (
                            (agent.title ?? "Worker")
                          )}
                        </p>
                        <p className={subdued}>
                          {agent.status} · {agent.providerInstanceId} ·{" "}
                          {agent.model ??
                            (selection
                              ? `${selection.model} (selected)`
                              : "Model unavailable")}{" "}
                          ·{" "}
                          {modelEffort(
                            selection?.options ??
                              (child ? child.modelSelection.options : undefined),
                          )}
                        </p>
                        <p className={`${subdued} break-all`}>
                          {child
                            ? `${child.worktreePath ?? "No separate worktree"} · ${child.branch ?? "Branch unavailable"}`
                            : "Worker checkout unavailable"}
                        </p>
                        {childRef && <GitHubToolEvidence threadRef={childRef} />}
                        {agent.result && (
                          <details className="mt-1 text-sm">
                            <summary>Worker report</summary>
                            <p className="mt-1 whitespace-pre-wrap break-words">{agent.result}</p>
                          </details>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {agents.length === 0 && (
                <p className={`mt-3 ${subdued}`}>
                  {projection ? "No delegated tasks recorded." : "Loading thread activity…"}
                </p>
              )}
            </section>
            <section className={panel}>
              <h2 className="font-medium">Pull requests, QA and CI</h2>
              <ul className="mt-3 grid gap-2">
                {[...refs].map((url) => (
                  <PullRequestCard key={url} url={url} />
                ))}
              </ul>
              {refs.size === 0 && (
                <p className={subdued}>
                  No GitHub pull requests linked or mentioned in recent messages.
                </p>
              )}
              {issues.length > 0 && (
                <>
                  <h3 className="mt-4 font-medium">Referenced issues</h3>
                  <ul className="mt-2 space-y-1 text-sm">
                    {issues.map((url) => (
                      <li key={url}>
                        <a className={link} href={url} target="_blank" rel="noreferrer">
                          {url.replace("https://github.com/", "")}
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </div>
        )}
        <section className={panel}>
          <h2 className="font-medium">Managed workflow</h2>
          <form
            className="mt-2 flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void navigate({ search: { ...search, run: parseManagedRunId(runInput) } });
            }}
          >
            <label className="grid gap-1 text-sm">
              Managed run ID
              <input
                className="rounded-md border bg-background px-2 py-1"
                value={runInput}
                onChange={(event) => setRunInput(event.target.value)}
              />
            </label>
            <button
              className="rounded-md border px-3 py-1 text-sm"
              type="submit"
              disabled={!parseManagedRunId(runInput)}
            >
              View run
            </button>
          </form>
          {search.run &&
            (managed?.value ? (
              <>
                <ManagedRunEvidence
                  run={managed.value}
                  allowQuotaDecisions={Boolean(window.desktopBridge)}
                />
                <h3 className="mt-3 font-medium">LangGraph and Symphony</h3>
                {managed.value.workflowEvents?.length ? (
                  <ol className="mt-2 space-y-2 text-sm">
                    {managed.value.workflowEvents.map((event) => (
                      <li className="break-all" key={`${event.kind}:${event.stageId}`}>
                        {event.kind === "langgraph-stage-queued"
                          ? "LangGraph queued stage"
                          : "Symphony controller accepted stage"}{" "}
                        · {event.stageId} · <time dateTime={event.at}>{event.at}</time>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className={subdued}>
                    No LangGraph or Symphony observations recorded for this run.
                  </p>
                )}
                <p className={subdued}>Checked {managed.checkedAt.toLocaleTimeString()}</p>
              </>
            ) : (
              <p className={subdued}>
                {managed ? "Managed run evidence unavailable." : "Loading managed stages…"}
              </p>
            ))}
        </section>
      </div>
    </main>
  );
}

export const Route = createFileRoute("/_chat/workflow")({
  validateSearch: (search: Record<string, unknown>) => ({
    environment: typeof search.environment === "string" ? search.environment : undefined,
    thread: typeof search.thread === "string" ? search.thread : undefined,
    run: parseManagedRunId(search.run),
  }),
  component: WorkflowPage,
});
