/* oxlint-disable t3code/no-untranslated-copy -- fork-only operator screen, English only */
import { useState } from "react";

import { FlowDiagram } from "~/components/FlowDiagram";
import {
  FLEET_STATES,
  buildPipelineFlow,
  buildTaskFlow,
  buildTrackFlow,
  phaseLabels,
  stateLabels,
  staleLabels,
  type FleetState,
  type FleetTask,
} from "~/lib/fleetFlow";
import { decideRequest, formatAge, type FleetOverview } from "~/lib/sidecarApi";

const badge: Record<FleetState, string> = {
  running: "border-info text-info",
  "in-review": "border-info text-info",
  draft: "border-border text-muted-foreground",
  merged: "border-success text-success",
  closed: "border-destructive text-destructive",
  "awaiting-publication": "border-warning text-warning",
  validated: "border-success text-success",
  idle: "border-border text-muted-foreground",
  new: "border-border",
};
const PAGE = 60;

function ageOf(stamp: string | null): string {
  if (!stamp) return "never";
  const time = Date.parse(stamp);
  return Number.isNaN(time)
    ? "unknown"
    : formatAge(Math.max(0, Math.round((Date.now() - time) / 1000)));
}

function ciText(statuses: NonNullable<FleetTask["statuses"]>): string {
  const ci = statuses.ci;
  if (ci.state === "not-recorded") return "Not recorded for this task";
  const head = ci.head ? ` on ${ci.head.slice(0, 10)}` : "";
  const by = ci.source === "sidecar-checks" ? `, run by the sidecar ${ageOf(ci.checkedAt)}` : "";
  const failed = ci.failedSteps.length > 0 ? `; failed: ${ci.failedSteps.join(", ")}` : "";
  if (ci.exactHead === true) return `${ci.state}${head} (matches the PR head${by})${failed}`;
  if (ci.exactHead === false) return `${ci.state}${head} (NOT the PR head, so it does not count)`;
  return `${ci.state}${head} (head match unknown)`;
}

function ScopePanel({ overview }: { overview: FleetOverview }) {
  const scope = overview.scope;
  if (!scope) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        This snapshot does not say which repositories it covers or when GitHub was checked. Refresh
        the sidecar to get a newer one.
      </p>
    );
  }
  const github = scope.github;
  return (
    <details className="rounded-lg border p-3 text-sm" open>
      <summary className="cursor-pointer font-medium">
        Scope and freshness · {scope.repositories.length} repositories · GitHub checked{" "}
        {github.lastCheckedAt ? ageOf(github.lastCheckedAt) : "never"}
      </summary>
      <dl className="mt-3 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-1">
        <dt className="text-muted-foreground">Snapshot built</dt>
        <dd>{overview.generatedAt || "Unknown"}</dd>
        <dt className="text-muted-foreground">Tasks covered</dt>
        <dd>
          {scope.tasksShown.toLocaleString()} of {scope.tasksOnDisk.toLocaleString()} on disk
          {scope.tasksTruncated && " (the list is cut off; older tasks are not shown)"}
        </dd>
        <dt className="text-muted-foreground">GitHub last checked</dt>
        <dd>
          {github.lastCheckedAt
            ? `${github.lastCheckedAt} (${ageOf(github.lastCheckedAt)})`
            : "Never; pull request states are unknown"}
          {github.oldestOpenCheckAt &&
            ` · oldest open pull request check ${ageOf(github.oldestOpenCheckAt)}`}
          {!github.queriedThisRun && " · not queried on the latest run"}
        </dd>
        <dt className="text-muted-foreground">Not covered</dt>
        <dd>
          CI is only what the task receipt recorded and deployment is{" "}
          {scope.sources.deployment ?? "not recorded"}; neither is read live from GitHub or the
          hosts.
        </dd>
        <dt className="text-muted-foreground">Repositories</dt>
        <dd className="grid gap-1">
          {scope.repositories.map((item) => (
            <span key={item.repository}>
              <span className="font-mono">{item.repository}</span> · {item.tasks.toLocaleString()}{" "}
              tasks · {item.withPullRequest.toLocaleString()} with a pull request
              {item.pullRequestUnknown > 0 && ` (${item.pullRequestUnknown} state unknown)`}
            </span>
          ))}
        </dd>
      </dl>
    </details>
  );
}

function matches(
  task: FleetTask,
  states: ReadonlySet<string>,
  flag: string,
  text: string,
): boolean {
  if (states.size > 0 && !states.has(task.state)) return false;
  if (flag === "any-stale" ? task.stale.length === 0 : flag !== "" && !task.stale.includes(flag))
    return false;
  const needle = text.trim().toLowerCase();
  return (
    needle === "" ||
    task.task.toLowerCase().includes(needle) ||
    (task.title ?? "").toLowerCase().includes(needle) ||
    (task.publication?.branch ?? "").toLowerCase().includes(needle) ||
    (task.repository ?? "").toLowerCase().includes(needle)
  );
}

function pullRequestText(task: FleetTask): string {
  const pr = task.publication;
  if (!pr) return "No pull request";
  const state = pr.state === "open" ? (pr.draft ? "draft" : "open") : pr.state;
  return `#${pr.pr} ${state}`;
}

function TrackPanel({ task, onRefresh }: { task: FleetTask; onRefresh: () => void }) {
  const track = task.track;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!track) return null;
  const waiting = track.waitingOn;
  const decide = async (id: string, decision: "resolve" | "dismiss") => {
    setBusy(id);
    setError(null);
    const result = await decideRequest(id, decision, new AbortController().signal);
    setBusy(null);
    if (result.ok) onRefresh();
    else setError(result.message);
  };
  return (
    <div className="mt-3 grid gap-3">
      <FlowDiagram flow={buildTrackFlow(task)} label={`${task.task} status`} />
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-2">
        <dt className="text-muted-foreground">What it is doing</dt>
        <dd>{track.doing ?? "No status has been given."}</dd>
        <dt className="text-muted-foreground">Why it is stopped</dt>
        <dd>
          {waiting
            ? `Waiting on ${waiting.kind === "human" ? "a person" : waiting.kind} (${waiting.who}): ${waiting.action}`
            : "It is not blocked."}
        </dd>
        <dt className="text-muted-foreground">How to unblock</dt>
        <dd className="grid gap-2">
          {track.openRequests.length === 0 &&
            (waiting?.kind === "human"
              ? "A person is needed, but no request was raised. Ask the agent to raise one."
              : waiting
                ? `Nothing for you to do; ${waiting.who} holds this.`
                : "Nothing is needed.")}
          {track.openRequests.map((request) => (
            <div className="rounded-md border p-2" key={request.id}>
              <p>
                <strong>{request.grantor}</strong> must: {request.action}
              </p>
              {request.deadline && (
                <p className="text-muted-foreground">Deadline {request.deadline}</p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  className="rounded-md border px-3 py-1 disabled:opacity-50"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void decide(request.id, "resolve")}
                >
                  I did this or granted it
                </button>
                <button
                  className="rounded-md border px-3 py-1 text-muted-foreground disabled:opacity-50"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void decide(request.id, "dismiss")}
                >
                  Not needed
                </button>
              </div>
            </div>
          ))}
          {error && (
            <p className="text-destructive" role="alert">
              {error}
            </p>
          )}
        </dd>
        {track.owner && (
          <>
            <dt className="text-muted-foreground">Owner</dt>
            <dd>{track.owner}</dd>
          </>
        )}
        {track.threadIds.length > 0 && (
          <>
            <dt className="text-muted-foreground">Thread</dt>
            <dd className="break-all font-mono">{track.threadIds.join(", ")}</dd>
          </>
        )}
        {track.links.length > 0 && (
          <>
            <dt className="text-muted-foreground">Links</dt>
            <dd className="grid gap-1">
              {track.links.map((link) => (
                <a
                  className="break-all underline"
                  href={link}
                  key={link}
                  target="_blank"
                  rel="noreferrer"
                >
                  {link}
                </a>
              ))}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

export function FleetBoard({
  overview,
  onRefresh,
}: {
  overview: FleetOverview | null;
  onRefresh: () => void;
}) {
  const [states, setStates] = useState<ReadonlySet<string>>(new Set());
  const [flag, setFlag] = useState("");
  const [text, setText] = useState("");
  const [shown, setShown] = useState(PAGE);

  if (overview === null) {
    return (
      <p className="mt-4 max-w-2xl text-sm" role="status">
        No fleet overview yet. Run{" "}
        <code>scripts/t3_bridge/fleet_overview.py --root &lt;service root&gt;</code> or enable the
        hourly <code>omni-symphony-overview.timer</code>, then refresh.
      </p>
    );
  }

  const visible = overview.tasks.filter((task) => matches(task, states, flag, text));
  const staleTotal = overview.tasks.filter((task) => task.stale.length > 0).length;
  const toggle = (state: string) => {
    const next = new Set(states);
    if (next.has(state)) next.delete(state);
    else next.add(state);
    setStates(next);
    setShown(PAGE);
  };

  return (
    <section className="mt-4 grid max-w-5xl gap-4" aria-label="Fleet board">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-muted-foreground">
          {overview.summary.tasks.toLocaleString()} tasks · updated {formatAge(overview.ageSeconds)}
          {!overview.summary.pullRequestStateKnown &&
            " · pull request states unknown (GitHub was not queried)"}
        </p>
        <button className="rounded-md border px-3 py-1" type="button" onClick={onRefresh}>
          Refresh
        </button>
      </div>

      <ScopePanel overview={overview} />

      <FlowDiagram
        flow={buildPipelineFlow(overview.summary.pipeline)}
        label="Where tasks are in the pipeline"
      />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by state">
        {FLEET_STATES.filter((state) => (overview.summary.byState[state] ?? 0) > 0).map((state) => (
          <button
            key={state}
            type="button"
            aria-pressed={states.has(state)}
            className={`rounded-full border px-3 py-1 text-xs ${badge[state]} ${states.has(state) ? "bg-muted font-semibold" : ""}`}
            onClick={() => toggle(state)}
          >
            {stateLabels[state]} · {overview.summary.byState[state]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="grid gap-1">
          Needs attention
          <select
            aria-label="Needs attention"
            className="rounded-md border bg-background p-2"
            value={flag}
            onChange={(event) => {
              setFlag(event.target.value);
              setShown(PAGE);
            }}
          >
            <option value="">All tasks</option>
            <option value="any-stale">Any stale flag ({staleTotal})</option>
            {Object.entries(staleLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label} ({overview.summary.staleByFlag[key] ?? 0})
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          Search
          <input
            aria-label="Search"
            className="rounded-md border bg-transparent px-3 py-2"
            value={text}
            placeholder="Task, title, branch"
            onChange={(event) => {
              setText(event.target.value);
              setShown(PAGE);
            }}
          />
        </label>
        <p className="pb-2 text-muted-foreground" role="status">
          Showing {Math.min(shown, visible.length).toLocaleString()} of{" "}
          {visible.length.toLocaleString()}
        </p>
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tasks match.</p>
      ) : (
        <ul className="grid gap-2">
          {visible.slice(0, shown).map((task) => (
            <li key={task.task}>
              <details className="rounded-lg border p-3 text-sm">
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono font-medium">{task.task}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${badge[task.state]}`}>
                    {stateLabels[task.state]}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{task.title ?? "Untitled"}</span>
                  {task.track ? (
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs ${task.track.waitingOn?.kind === "human" ? "border-warning text-warning" : "border-border text-muted-foreground"}`}
                    >
                      {phaseLabels[task.track.phase] ?? task.track.phase}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{pullRequestText(task)}</span>
                  )}
                  {task.track?.statusLine && (
                    <span className="basis-full text-muted-foreground">
                      {task.track.statusLine}
                    </span>
                  )}
                  {task.stale.map((item) => (
                    <span
                      className="rounded-full border border-warning px-2 py-0.5 text-xs text-warning"
                      key={item}
                    >
                      {item}
                    </span>
                  ))}
                </summary>
                {task.track ? (
                  <TrackPanel task={task} onRefresh={onRefresh} />
                ) : (
                  <FlowDiagram flow={buildTaskFlow(task)} label={`${task.task} journey`} />
                )}
                <dl
                  hidden={task.track !== null && task.track !== undefined}
                  className="mt-3 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-1"
                >
                  <dt className="text-muted-foreground">Repository</dt>
                  <dd>{task.repository ?? "Unknown"}</dd>
                  {task.statuses && (
                    <>
                      <dt className="text-muted-foreground">Task status</dt>
                      <dd>{stateLabels[task.state]}</dd>
                      <dt className="text-muted-foreground">PR status</dt>
                      <dd>
                        {task.statuses.pullRequest
                          ? `${pullRequestText(task)} · checked ${ageOf(task.statuses.pullRequest.checkedAt)}`
                          : "No pull request"}
                      </dd>
                      <dt className="text-muted-foreground">Exact-head CI</dt>
                      <dd>{ciText(task.statuses)}</dd>
                      <dt className="text-muted-foreground">Deployment</dt>
                      <dd>
                        {task.statuses.deployment.state === "not-recorded"
                          ? "Not recorded for this task"
                          : `${task.statuses.deployment.state}${task.statuses.deployment.environment ? ` in ${task.statuses.deployment.environment}` : ""}${task.statuses.deployment.sha ? ` at ${task.statuses.deployment.sha.slice(0, 10)}` : ""}`}
                      </dd>
                    </>
                  )}
                  <dt className="text-muted-foreground">Pull request</dt>
                  <dd>
                    {task.publication?.url ? (
                      <a
                        className="underline"
                        href={task.publication.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {pullRequestText(task)}
                      </a>
                    ) : (
                      pullRequestText(task)
                    )}
                    {task.publication?.branch && (
                      <span className="text-muted-foreground"> · {task.publication.branch}</span>
                    )}
                    {task.stale.includes("head-moved") &&
                      " · the PR head is not the commit that was published"}
                  </dd>
                  <dt className="text-muted-foreground">Validated commit</dt>
                  <dd className="break-all font-mono">{task.validated?.sha ?? "None"}</dd>
                  <dt className="text-muted-foreground">Workspace</dt>
                  <dd>
                    {task.workspace.exists
                      ? `Present, idle ${task.workspace.idleDays ?? "?"} days${task.workspace.stale ? " (stale)" : ""}`
                      : "None"}
                  </dd>
                  <dt className="text-muted-foreground">Snapshots</dt>
                  <dd>{task.snapshots.toLocaleString()}</dd>
                  <dt className="text-muted-foreground">Last activity</dt>
                  <dd>
                    {task.lastActivity ?? "Unknown"} ({task.idleDays} days ago)
                  </dd>
                  {task.stale.length > 0 && (
                    <>
                      <dt className="text-muted-foreground">Needs attention</dt>
                      <dd>{task.stale.map((item) => staleLabels[item] ?? item).join(" · ")}</dd>
                    </>
                  )}
                </dl>
              </details>
            </li>
          ))}
        </ul>
      )}
      {shown < visible.length && (
        <button
          className="justify-self-start rounded-md border px-3 py-1 text-sm"
          type="button"
          onClick={() => setShown(shown + PAGE)}
        >
          Show {Math.min(PAGE, visible.length - shown)} more
        </button>
      )}
    </section>
  );
}
