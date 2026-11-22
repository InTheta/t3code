/* oxlint-disable t3code/no-untranslated-copy -- fork-only operator screen, English only */
import type { Flow, FlowNode, FlowStatus } from "./runFlow";

export const FLEET_STATES = [
  "running",
  "in-review",
  "draft",
  "merged",
  "closed",
  "awaiting-publication",
  "validated",
  "idle",
  "new",
] as const;
export type FleetState = (typeof FLEET_STATES)[number];

export interface FleetWaitingOn {
  readonly kind: string;
  readonly who: string;
  readonly action: string;
  readonly requestId: string | null;
}

export interface FleetRequest {
  readonly id: string;
  readonly action: string;
  readonly grantor: string;
  readonly deadline: string | null;
}

/** Work that is run outside Symphony's task files (for example straight from a T3 thread). */
export interface FleetTrack {
  readonly phase: string;
  readonly doing: string | null;
  readonly statusLine: string;
  readonly waitingOn: FleetWaitingOn | null;
  readonly openRequests: readonly FleetRequest[];
  readonly links: readonly string[];
  readonly threadIds: readonly string[];
  readonly owner: string | null;
}

export const phaseLabels: Record<string, string> = {
  running: "Working",
  "waiting-human": "Waiting on a person",
  "waiting-agent": "Waiting on an agent",
  blocked: "Blocked",
  done: "Done",
};

export interface FleetTask {
  readonly task: string;
  readonly title: string | null;
  readonly repository: string | null;
  readonly state: FleetState;
  readonly stale: readonly string[];
  readonly claimHeld: boolean;
  readonly validated: {
    readonly sha: string | null;
    readonly at: string | null;
    readonly count: number;
  } | null;
  readonly publication: {
    readonly pr: number;
    readonly url: string | null;
    readonly branch: string | null;
    readonly sha: string | null;
    readonly repository: string | null;
    readonly state: string;
    readonly draft: boolean;
    readonly headSha: string | null;
  } | null;
  readonly workspace: {
    readonly exists: boolean;
    readonly idleDays: number | null;
    readonly stale: boolean;
  };
  readonly snapshots: number;
  readonly idleDays: number;
  readonly lastActivity: string | null;
  readonly track?: FleetTrack | null | undefined;
}

export interface FleetPipeline {
  readonly planned: number;
  readonly validated: number;
  readonly published: number;
  readonly inReview: number;
  readonly merged: number;
  readonly closed: number;
}

export const stateLabels: Record<FleetState, string> = {
  running: "Running",
  "in-review": "In review",
  draft: "Draft PR",
  merged: "Merged",
  closed: "Closed unmerged",
  "awaiting-publication": "Awaiting publication",
  validated: "Validated",
  idle: "Idle",
  new: "New",
};

export const staleLabels: Record<string, string> = {
  "head-moved": "PR head moved since publish",
  idle: "Idle too long",
  unpublished: "Validated but never published",
  leftovers: "Finished, workspace or snapshots remain",
};

/** Fleet-wide pipeline: how many tasks reached each step. */
export function buildPipelineFlow(pipeline: FleetPipeline): Flow {
  const step = (
    id: string,
    label: string,
    count: number,
    col: number,
    row: number,
    status: FlowStatus,
  ): FlowNode => ({
    id,
    label,
    sub: `${count.toLocaleString()} task${count === 1 ? "" : "s"}`,
    status,
    kind: "step",
    col,
    row,
  });
  const status = (count: number): FlowStatus => (count > 0 ? "done" : "pending");
  return {
    nodes: [
      step("planned", "Planned", pipeline.planned, 0, 0, status(pipeline.planned)),
      step("validated", "Validated", pipeline.validated, 1, 0, status(pipeline.validated)),
      step("published", "Published", pipeline.published, 2, 0, status(pipeline.published)),
      step(
        "review",
        "In review",
        pipeline.inReview,
        3,
        0,
        pipeline.inReview > 0 ? "active" : "pending",
      ),
      step("merged", "Merged", pipeline.merged, 4, 0, status(pipeline.merged)),
      step(
        "closed",
        "Closed unmerged",
        pipeline.closed,
        4,
        1,
        pipeline.closed > 0 ? "failed" : "pending",
      ),
    ],
    edges: [
      { from: "planned", to: "validated", taken: pipeline.validated > 0 },
      { from: "validated", to: "published", taken: pipeline.published > 0 },
      { from: "published", to: "review", taken: pipeline.inReview > 0 },
      { from: "review", to: "merged", taken: pipeline.merged > 0 },
      { from: "review", to: "closed", taken: pipeline.closed > 0 },
    ],
  };
}

/** One task's journey: where its work stands and what the next step is. */
export function buildTaskFlow(task: FleetTask): Flow {
  const published = task.publication !== null;
  const merged = task.state === "merged";
  const closed = task.state === "closed";
  const reviewing = task.state === "in-review" || task.state === "draft";
  const awaiting = task.state === "awaiting-publication";
  const nodes: FlowNode[] = [
    {
      id: "work",
      label: "Work",
      sub: task.claimHeld
        ? "a worker is running"
        : task.state === "new"
          ? "recent activity"
          : "no worker now",
      status: task.claimHeld ? "active" : "done",
      kind: "step",
      col: 0,
      row: 0,
    },
    {
      id: "validate",
      label: "Validated",
      sub: task.validated
        ? `${task.validated.count} pass${task.validated.count === 1 ? "" : "es"}`
        : "not yet",
      status: task.validated ? "done" : "pending",
      kind: "step",
      col: 1,
      row: 0,
    },
    {
      id: "publish",
      label: "Published",
      sub: published ? `PR #${task.publication?.pr}` : awaiting ? "waiting to publish" : "not yet",
      status: published ? "done" : awaiting ? "waiting" : "pending",
      kind: "step",
      col: 2,
      row: 0,
    },
    {
      id: "review",
      label: task.state === "draft" ? "Draft" : "Review",
      sub: reviewing ? "open" : merged || closed ? "finished" : "not yet",
      status: reviewing ? "active" : merged || closed ? "done" : "pending",
      kind: "step",
      col: 3,
      row: 0,
    },
    {
      id: "result",
      label: merged ? "Merged" : closed ? "Closed unmerged" : "Outcome",
      sub: merged || closed ? "pull request finished" : "open",
      status: merged ? "done" : closed ? "failed" : "pending",
      kind: "step",
      col: 4,
      row: 0,
    },
  ];
  return {
    nodes,
    edges: [
      { from: "work", to: "validate", taken: task.validated !== null },
      { from: "validate", to: "publish", taken: published },
      { from: "publish", to: "review", taken: published },
      { from: "review", to: "result", taken: merged || closed },
    ],
  };
}

/** A track's journey: it works, it may wait on someone, then it is done. */
export function buildTrackFlow(task: FleetTask): Flow {
  const track = task.track;
  const waiting = track?.waitingOn ?? null;
  const phase = track?.phase ?? "running";
  const finished = phase === "done";
  const nodes: FlowNode[] = [
    {
      id: "work",
      label: "Working",
      sub: track?.doing ?? "no status given",
      status: finished ? "done" : waiting === null ? "active" : "done",
      kind: "step",
      col: 0,
      row: 0,
    },
    {
      id: "wait",
      label: waiting
        ? `Waiting on ${waiting.kind === "human" ? "a person" : waiting.kind}`
        : "Not blocked",
      sub: waiting ? waiting.who : "nothing to wait for",
      status: waiting ? (phase === "blocked" ? "blocked" : "waiting") : "pending",
      kind: waiting?.kind === "human" ? "decision" : "step",
      col: 1,
      row: 0,
    },
    {
      id: "done",
      label: "Done",
      sub: finished ? "finished" : "not yet",
      status: finished ? "done" : "pending",
      kind: "step",
      col: 2,
      row: 0,
    },
  ];
  return {
    nodes,
    edges: [
      { from: "work", to: "wait", taken: waiting !== null },
      { from: "wait", to: "done", taken: finished },
    ],
  };
}
