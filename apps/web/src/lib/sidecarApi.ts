/* oxlint-disable t3code/no-untranslated-copy -- fork-only operator screen, English only */
import { fetchDeliverySidecar, sendDeliverySidecar } from "~/lib/deliverySidecarFetch";
import {
  FLEET_STATES,
  type FleetPipeline,
  type FleetScope,
  type FleetStatuses,
  type FleetState,
  type FleetTask,
  type FleetTrack,
} from "~/lib/fleetFlow";

export type PolicyValue = number | boolean | null;
export interface PolicyField {
  readonly default: PolicyValue;
  readonly min: number | null;
  readonly max: number | null;
  readonly type: "number" | "boolean";
  readonly nullable: boolean;
}
export interface RetentionPolicy {
  readonly policy: Readonly<Record<string, PolicyValue>>;
  readonly sources: Readonly<Record<string, string>>;
  readonly schema: Readonly<Record<string, PolicyField>>;
}
export interface RetentionStatus {
  readonly generatedAt: string | null;
  readonly usage: { snapshotsBytes: number; workspacesBytes: number } | null;
  readonly projected: {
    freedBytes: number;
    removeByKind: Readonly<Record<string, { count: number; bytes: number }>>;
    keptByReason: Readonly<Record<string, number>>;
  } | null;
  readonly lastRun: {
    started: string | null;
    finished: string | null;
    removed: number;
    skipped: number;
    failed: number;
    freedBytes: number | null;
  } | null;
}
export interface SidecarStatus {
  readonly retention: RetentionPolicy & {
    statusAgeSeconds: number | null;
    status: RetentionStatus | null;
  };
  readonly filesystem: { freeBytes: number; totalBytes: number } | null;
}
export interface FleetOverview {
  readonly generatedAt: string;
  readonly idleDays: number;
  readonly ageSeconds: number | null;
  readonly summary: {
    readonly tasks: number;
    readonly byState: Readonly<Record<string, number>>;
    readonly staleByFlag: Readonly<Record<string, number>>;
    readonly pipeline: FleetPipeline;
    readonly pullRequestStateKnown: boolean;
  };
  readonly scope: FleetScope | null;
  readonly tasks: readonly FleetTask[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
const count = (value: unknown): number => {
  const parsed = num(value);
  return parsed !== null && parsed >= 0 ? parsed : 0;
};

function parseField(value: unknown): PolicyField | null {
  if (!isRecord(value) || (value.type !== "number" && value.type !== "boolean")) return null;
  const fallback = value.default;
  if (fallback !== null && typeof fallback !== "number" && typeof fallback !== "boolean")
    return null;
  return {
    default: fallback,
    min: num(value.min),
    max: num(value.max),
    type: value.type,
    nullable: value.nullable === true,
  };
}

export function parseRetentionPolicy(value: unknown): RetentionPolicy | null {
  if (!isRecord(value) || !isRecord(value.policy) || !isRecord(value.schema)) return null;
  const schema: Record<string, PolicyField> = {};
  for (const [key, field] of Object.entries(value.schema)) {
    const parsed = parseField(field);
    if (parsed) schema[key] = parsed;
  }
  const policy: Record<string, PolicyValue> = {};
  for (const [key, entry] of Object.entries(value.policy)) {
    if (
      key in schema &&
      (entry === null || typeof entry === "number" || typeof entry === "boolean")
    ) {
      policy[key] = entry;
    }
  }
  const sources: Record<string, string> = {};
  if (isRecord(value.sources)) {
    for (const [key, source] of Object.entries(value.sources))
      if (typeof source === "string") sources[key] = source;
  }
  return Object.keys(schema).length > 0 ? { policy, sources, schema } : null;
}

function parseRetentionStatus(value: unknown): RetentionStatus | null {
  if (!isRecord(value)) return null;
  const usage = isRecord(value.usage)
    ? {
        snapshotsBytes: count(value.usage.snapshotsBytes),
        workspacesBytes: count(value.usage.workspacesBytes),
      }
    : null;
  let projected: RetentionStatus["projected"] = null;
  if (isRecord(value.projected)) {
    const removeByKind: Record<string, { count: number; bytes: number }> = {};
    if (isRecord(value.projected.removeByKind)) {
      for (const [kind, entry] of Object.entries(value.projected.removeByKind)) {
        if (isRecord(entry))
          removeByKind[kind] = { count: count(entry.count), bytes: count(entry.bytes) };
      }
    }
    const keptByReason: Record<string, number> = {};
    if (isRecord(value.projected.keptByReason)) {
      for (const [reason, amount] of Object.entries(value.projected.keptByReason))
        keptByReason[reason] = count(amount);
    }
    projected = { freedBytes: count(value.projected.freedBytes), removeByKind, keptByReason };
  }
  const run = value.lastRun;
  const lastRun = isRecord(run)
    ? {
        started: str(run.started),
        finished: str(run.finished),
        removed: count(run.removed),
        skipped: count(run.skipped),
        failed: count(run.failed),
        freedBytes: num(run.freedBytes),
      }
    : null;
  return { generatedAt: str(value.generatedAt), usage, projected, lastRun };
}

export function parseSidecarStatus(value: unknown): SidecarStatus | null {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.retention)) return null;
  const retention = parseRetentionPolicy(value.retention);
  if (!retention) return null;
  const fs = value.filesystem;
  return {
    retention: {
      ...retention,
      statusAgeSeconds: num(value.retention.statusAgeSeconds),
      status: parseRetentionStatus(value.retention.status),
    },
    filesystem:
      isRecord(fs) && num(fs.freeBytes) !== null && num(fs.totalBytes) !== null
        ? { freeBytes: count(fs.freeBytes), totalBytes: count(fs.totalBytes) }
        : null,
  };
}

function parseTrack(value: Record<string, unknown>): FleetTrack | null {
  if (value.source !== "track") return null;
  const waiting = isRecord(value.waitingOn) ? value.waitingOn : null;
  const text = (input: unknown): string[] =>
    Array.isArray(input) ? input.filter((item): item is string => typeof item === "string") : [];
  return {
    phase: str(value.phase) ?? "running",
    doing: str(value.doing),
    statusLine: str(value.statusLine) ?? "",
    waitingOn:
      waiting && str(waiting.kind) && str(waiting.who) && str(waiting.action)
        ? {
            kind: str(waiting.kind) ?? "",
            who: str(waiting.who) ?? "",
            action: str(waiting.action) ?? "",
            requestId: str(waiting.requestId),
          }
        : null,
    openRequests: Array.isArray(value.openRequests)
      ? value.openRequests.flatMap((request) =>
          isRecord(request) && str(request.id) && str(request.action) && str(request.grantor)
            ? [
                {
                  id: str(request.id) ?? "",
                  action: str(request.action) ?? "",
                  grantor: str(request.grantor) ?? "",
                  deadline: str(request.deadline),
                },
              ]
            : [],
        )
      : [],
    links: text(value.links).filter((link) => link.startsWith("https://")),
    threadIds: text(value.threadIds),
    owner: str(value.owner),
  };
}

function parseStatuses(value: unknown): FleetStatuses | null {
  if (!isRecord(value) || !isRecord(value.ci) || !isRecord(value.deployment)) return null;
  const pr = isRecord(value.pullRequest) ? value.pullRequest : null;
  return {
    task: str(value.task) ?? "unknown",
    pullRequest: pr
      ? {
          state: str(pr.state) ?? "unknown",
          draft: pr.draft === true,
          number: count(pr.number),
          headSha: str(pr.headSha),
          checkedAt: str(pr.checkedAt),
        }
      : null,
    ci: {
      state: str(value.ci.state) ?? "not-recorded",
      head: str(value.ci.head),
      exactHead: typeof value.ci.exactHead === "boolean" ? value.ci.exactHead : null,
      checkedAt: str(value.ci.checkedAt),
      source: str(value.ci.source),
      failedSteps: Array.isArray(value.ci.failedSteps)
        ? value.ci.failedSteps.filter((step): step is string => typeof step === "string")
        : [],
    },
    deployment: {
      state: str(value.deployment.state) ?? "not-recorded",
      sha: str(value.deployment.sha),
      environment: str(value.deployment.environment),
    },
  };
}

function parseScope(value: unknown): FleetScope | null {
  if (!isRecord(value) || !isRecord(value.github) || !Array.isArray(value.repositories))
    return null;
  const sources: Record<string, string> = {};
  if (isRecord(value.sources))
    for (const [key, text] of Object.entries(value.sources))
      if (typeof text === "string") sources[key] = text;
  return {
    repositories: value.repositories.flatMap((item) =>
      isRecord(item) && typeof item.repository === "string"
        ? [
            {
              repository: item.repository,
              tasks: count(item.tasks),
              withPullRequest: count(item.withPullRequest),
              pullRequestUnknown: count(item.pullRequestUnknown),
            },
          ]
        : [],
    ),
    tasksShown: count(value.tasksShown),
    tasksOnDisk: count(value.tasksOnDisk),
    tasksTruncated: value.tasksTruncated === true,
    github: {
      queriedThisRun: value.github.queriedThisRun === true,
      lastCheckedAt: str(value.github.lastCheckedAt),
      oldestOpenCheckAt: str(value.github.oldestOpenCheckAt),
      openRefreshSeconds: count(value.github.openRefreshSeconds),
      cachedPullRequests: count(value.github.cachedPullRequests),
    },
    sources,
  };
}

function parseTask(value: unknown): FleetTask | null {
  if (!isRecord(value) || typeof value.task !== "string") return null;
  const track = parseTrack(value);
  if (!(track ? /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/ : /^GH-[1-9][0-9]*$/).test(value.task))
    return null;
  const state = FLEET_STATES.find((item) => item === value.state);
  if (!state) return null;
  const publication =
    isRecord(value.publication) && Number.isInteger(value.publication.pr)
      ? {
          pr: value.publication.pr as number,
          url:
            typeof value.publication.url === "string" &&
            value.publication.url.startsWith("https://github.com/")
              ? value.publication.url
              : null,
          branch: str(value.publication.branch),
          sha: str(value.publication.sha),
          repository: str(value.publication.repository),
          state: str(value.publication.state) ?? "unknown",
          draft: value.publication.draft === true,
          headSha: str(value.publication.headSha),
        }
      : null;
  const validated = isRecord(value.validated)
    ? {
        sha: str(value.validated.sha),
        at: str(value.validated.at),
        count: count(value.validated.count),
      }
    : null;
  const workspace = isRecord(value.workspace) ? value.workspace : {};
  return {
    task: value.task,
    title: str(value.title),
    repository: str(value.repository),
    state,
    stale: Array.isArray(value.stale)
      ? value.stale.filter((flag): flag is string => typeof flag === "string")
      : [],
    claimHeld: value.claimHeld === true,
    validated,
    publication,
    workspace: {
      exists: workspace.exists === true,
      idleDays: num(workspace.idleDays),
      stale: workspace.stale === true,
    },
    snapshots: count(value.snapshots),
    idleDays: count(value.idleDays),
    lastActivity: str(value.lastActivity),
    track,
    statuses: parseStatuses(value.statuses),
  };
}

export function parseFleetOverview(
  value: unknown,
  ageSeconds: number | null = null,
): FleetOverview | null {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !isRecord(value.summary) ||
    !Array.isArray(value.tasks)
  )
    return null;
  const pipeline = value.summary.pipeline;
  if (!isRecord(pipeline)) return null;
  const record = (input: unknown): Record<string, number> => {
    const out: Record<string, number> = {};
    if (isRecord(input))
      for (const [key, amount] of Object.entries(input)) out[key] = count(amount);
    return out;
  };
  const tasks = value.tasks.map(parseTask).filter((task): task is FleetTask => task !== null);
  return {
    generatedAt: str(value.generatedAt) ?? "",
    idleDays: count(value.idleDays),
    ageSeconds,
    summary: {
      tasks: count(value.summary.tasks),
      byState: record(value.summary.byState),
      staleByFlag: record(value.summary.staleByFlag),
      pipeline: {
        planned: count(pipeline.planned),
        validated: count(pipeline.validated),
        published: count(pipeline.published),
        inReview: count(pipeline.inReview),
        merged: count(pipeline.merged),
        closed: count(pipeline.closed),
      },
      pullRequestStateKnown: value.summary.pullRequestStateKnown === true,
    },
    scope: parseScope(value.scope),
    tasks,
  };
}

async function readJson(path: string, signal: AbortSignal): Promise<unknown> {
  try {
    const response = await fetchDeliverySidecar(`/delivery-sidecar/v1/sidecar/${path}`, signal);
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

export async function readSidecarStatus(signal: AbortSignal): Promise<SidecarStatus | null> {
  return parseSidecarStatus(await readJson("status", signal));
}

export async function readFleetOverview(signal: AbortSignal): Promise<FleetOverview | null> {
  const value = await readJson("overview", signal);
  let age: number | null = null;
  if (isRecord(value) && typeof value.generatedAt === "string") {
    const stamp = Date.parse(value.generatedAt);
    age = Number.isNaN(stamp) ? null : Math.max(0, Math.round((Date.now() - stamp) / 1000));
  }
  return parseFleetOverview(value, age);
}

export type SaveResult =
  | { ok: true; policy: RetentionPolicy | null }
  | { ok: false; message: string };

function failure(status: number, body: unknown): string {
  if (status === 401 || status === 403) return "Changing the sidecar needs operator access.";
  if (status === 404)
    return "The sidecar did not recognise that. Refresh; if it persists, it is not connected.";
  if (status === 502 || status === 503 || status === 504)
    return "The T3 server could not reach the sidecar. Check that the sidecar and its tunnel are running.";
  if (status === 400 && isRecord(body) && typeof body.error === "string") return body.error;
  return "The sidecar could not save the change.";
}

export async function saveRetentionPolicy(
  patch: Readonly<Record<string, PolicyValue>>,
  signal: AbortSignal,
): Promise<SaveResult> {
  try {
    const response = await sendDeliverySidecar(
      "/delivery-sidecar/v1/sidecar/retention",
      JSON.stringify(patch),
      signal,
    );
    const body: unknown = await response.json().catch(() => null);
    return response.ok
      ? { ok: true, policy: parseRetentionPolicy(body) }
      : { ok: false, message: failure(response.status, body) };
  } catch {
    return {
      ok: false,
      message: "This app could not reach its own T3 server (it may be restarting). Try again.",
    };
  }
}

export type Severity = "action" | "warning" | "info";
export interface InboxItem {
  readonly id: string;
  readonly kind: string;
  readonly severity: Severity;
  readonly title: string;
  readonly detail: string;
  readonly link: string | null;
}
export interface Inbox {
  readonly generatedAt: string;
  readonly items: readonly InboxItem[];
  readonly truncated: boolean;
  readonly channels: readonly string[];
  readonly configError: string | null;
}
export interface ProposalItem {
  readonly kind: string;
  readonly task: string;
  readonly sha: string | null;
  readonly bytes: number;
  readonly ageDays: number;
  readonly reason: string;
}
export interface Proposal {
  readonly id: string;
  readonly status: "pending" | "approved" | "rejected" | "expired" | "applied";
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly totalBytes: number;
  readonly itemCount: number;
  readonly byKind: Readonly<Record<string, { count: number; bytes: number }>>;
  readonly keptByReason: Readonly<Record<string, number>>;
  readonly items: readonly ProposalItem[];
  readonly itemsTruncated: boolean;
  readonly decidedBy: string | null;
  readonly applied: {
    removed: number;
    skipped: number;
    failed: number;
    freedBytes: number | null;
  } | null;
}

const severities: readonly Severity[] = ["action", "warning", "info"];
const proposalStates = ["pending", "approved", "rejected", "expired", "applied"] as const;

export function parseInbox(value: unknown): Inbox | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.items)) return null;
  const items: InboxItem[] = [];
  for (const entry of value.items) {
    if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.title !== "string")
      continue;
    const severity = severities.find((item) => item === entry.severity);
    if (!severity) continue;
    items.push({
      id: entry.id,
      kind: str(entry.kind) ?? "unknown",
      severity,
      title: entry.title,
      detail: str(entry.detail) ?? "",
      link: str(entry.link),
    });
  }
  return {
    generatedAt: str(value.generatedAt) ?? "",
    items,
    truncated: value.truncated === true,
    channels: Array.isArray(value.channels)
      ? value.channels.filter((c): c is string => typeof c === "string")
      : [],
    configError: str(value.configError),
  };
}

export function parseProposal(value: unknown): Proposal | null {
  if (!isRecord(value) || typeof value.id !== "string" || !/^[a-f0-9]{16}$/.test(value.id))
    return null;
  const status = proposalStates.find((item) => item === value.status);
  if (!status) return null;
  const byKind: Record<string, { count: number; bytes: number }> = {};
  if (isRecord(value.byKind)) {
    for (const [kind, entry] of Object.entries(value.byKind)) {
      if (isRecord(entry)) byKind[kind] = { count: count(entry.count), bytes: count(entry.bytes) };
    }
  }
  const keptByReason: Record<string, number> = {};
  if (isRecord(value.keptByReason)) {
    for (const [reason, amount] of Object.entries(value.keptByReason))
      keptByReason[reason] = count(amount);
  }
  const items: ProposalItem[] = [];
  for (const entry of Array.isArray(value.items) ? value.items : []) {
    if (isRecord(entry) && typeof entry.kind === "string" && typeof entry.task === "string") {
      items.push({
        kind: entry.kind,
        task: entry.task,
        sha: str(entry.sha),
        bytes: count(entry.bytes),
        ageDays: count(entry.ageDays),
        reason: str(entry.reason) ?? "",
      });
    }
  }
  const applied = isRecord(value.applied)
    ? {
        removed: count(value.applied.removed),
        skipped: count(value.applied.skipped),
        failed: count(value.applied.failed),
        freedBytes: num(value.applied.freedBytes),
      }
    : null;
  return {
    id: value.id,
    status,
    createdAt: str(value.createdAt) ?? "",
    expiresAt: str(value.expiresAt) ?? "",
    totalBytes: count(value.totalBytes),
    itemCount: count(value.itemCount),
    byKind,
    keptByReason,
    items,
    itemsTruncated: value.itemsTruncated === true,
    decidedBy: str(value.decidedBy),
    applied,
  };
}

export function parseProposals(value: unknown): Proposal[] | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.proposals)) return null;
  return value.proposals.map(parseProposal).filter((item): item is Proposal => item !== null);
}

export async function readInbox(signal: AbortSignal): Promise<Inbox | null> {
  return parseInbox(await readJson("inbox", signal));
}

export type Level = "fail" | "warn" | "info";
const levels: readonly Level[] = ["fail", "warn", "info"];
export interface QualityFinding {
  readonly severity: Level;
  readonly code: string;
  readonly message: string;
  readonly runId: string;
  readonly ticket: string;
}
export interface ScoreRow {
  readonly instance: string;
  readonly model: string;
  readonly role: string;
  readonly stages: number;
  readonly executed: number;
  readonly quotaPaused: number;
  readonly qaPassed: number;
  readonly qaFailed: number;
  readonly avgTokens: number | null;
  readonly comparable: boolean;
}
export interface Quality {
  readonly generatedAt: string;
  readonly runs: number;
  readonly decisions: number;
  readonly traceable: number;
  readonly coverage: number | null;
  readonly counts: { readonly fail: number; readonly warn: number; readonly info: number };
  readonly passed: boolean;
  readonly findings: readonly QualityFinding[];
  readonly findingsTruncated: boolean;
  readonly rows: readonly ScoreRow[];
  readonly suggestions: readonly {
    readonly subject: string;
    readonly note: string;
    readonly requiresHuman: boolean;
  }[];
}
export interface TracedDecision {
  readonly id: string;
  readonly title: string;
  readonly byType: string;
  readonly byName: string | null;
  readonly at: string | null;
  readonly launch: {
    readonly providerInstanceId: string | null;
    readonly threadId: string | null;
    readonly turnId: string | null;
  } | null;
  readonly modelApproved: string | null;
  readonly modelActual: string | null;
  readonly tokens: number | null;
  readonly gaps: readonly {
    readonly severity: Level;
    readonly code: string;
    readonly message: string;
  }[];
}
export interface RunOwner {
  readonly humanOwner: string | null;
  readonly requestedBy: string | null;
  readonly approvedBy: string | null;
  readonly prAuthor: string | null;
  readonly mergedBy: string | null;
  readonly commitAuthors: readonly string[];
  readonly prNumber: number | null;
  readonly prUrl: string | null;
  readonly prState: string | null;
}
export interface Provenance {
  readonly owner: RunOwner | null;
  readonly runId: string;
  readonly ticket: string;
  readonly status: string;
  readonly traceId: string | null;
  readonly traceable: number;
  readonly total: number;
  readonly decisions: readonly TracedDecision[];
}

const level = (value: unknown): Level | null => levels.find((item) => item === value) ?? null;

export function parseQuality(value: unknown): Quality | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.findings)) return null;
  const counts = isRecord(value.counts) ? value.counts : {};
  const findings: QualityFinding[] = [];
  for (const entry of value.findings) {
    const severity = isRecord(entry) ? level(entry.severity) : null;
    if (!isRecord(entry) || !severity || typeof entry.message !== "string") continue;
    findings.push({
      severity,
      code: str(entry.code) ?? "unknown",
      message: entry.message,
      runId: str(entry.runId) ?? "",
      ticket: str(entry.ticket) ?? "",
    });
  }
  const scorecard = isRecord(value.scorecard) ? value.scorecard : {};
  const rows: ScoreRow[] = [];
  for (const row of Array.isArray(scorecard.rows) ? scorecard.rows : []) {
    if (!isRecord(row) || typeof row.role !== "string") continue;
    rows.push({
      instance: str(row.instance) ?? "unknown",
      model: str(row.model) ?? "unreported",
      role: row.role,
      stages: count(row.stages),
      executed: count(row.executed),
      quotaPaused: count(row.quotaPaused),
      qaPassed: count(row.qaPassed),
      qaFailed: count(row.qaFailed),
      avgTokens: typeof row.avgTokens === "number" ? row.avgTokens : null,
      comparable: row.comparable === true,
    });
  }
  const suggestions = [];
  for (const note of Array.isArray(scorecard.suggestions) ? scorecard.suggestions : []) {
    if (!isRecord(note) || typeof note.note !== "string") continue;
    suggestions.push({
      subject: str(note.subject) ?? "",
      note: note.note,
      requiresHuman: note.requiresHuman === true,
    });
  }
  return {
    generatedAt: str(value.generatedAt) ?? "",
    runs: count(value.runs),
    decisions: count(value.decisions),
    traceable: count(value.traceable),
    coverage: typeof value.coverage === "number" ? value.coverage : null,
    counts: { fail: count(counts.fail), warn: count(counts.warn), info: count(counts.info) },
    passed: value.passed === true,
    findings,
    findingsTruncated: value.findingsTruncated === true,
    rows,
    suggestions,
  };
}

export interface ObservedModel {
  readonly provider: string;
  readonly model: string;
  readonly turns: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheHitRate: number | null;
}
export interface ObservedRunning {
  readonly provider: string;
  readonly model: string | null;
  readonly effort: string | null;
  readonly runtimeMode: string;
  readonly ageHours: number | null;
  readonly title: string | null;
}
export interface Observed {
  readonly windowHours: number;
  readonly threads: number;
  readonly runs: number;
  readonly failedRuns: number;
  readonly turns: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheHitRate: number | null;
  readonly modelRecordedRate: number | null;
  readonly models: readonly ObservedModel[];
  readonly running: readonly ObservedRunning[];
  readonly runtimeModes: readonly { readonly mode: string; readonly threads: number }[];
  readonly subagentsDifferentVendor: number;
  readonly subagentsSameVendor: number;
  readonly pullRequests: readonly {
    readonly repository: string;
    readonly number: number;
    readonly url: string | null;
    readonly threads: number;
  }[];
  readonly findings: readonly {
    readonly severity: Level;
    readonly id: string;
    readonly message: string;
  }[];
}

export function parseObserved(value: unknown): Observed | null {
  if (!isRecord(value) || value.version !== 1 || value.available !== true) return null;
  const tokens = isRecord(value.tokens) ? value.tokens : {};
  const runs = isRecord(value.runs) ? value.runs : {};
  const byStatus = isRecord(runs.byStatus) ? runs.byStatus : {};
  const coverage = isRecord(value.modelCoverage) ? value.modelCoverage : {};
  const subagents = isRecord(value.subagents) ? value.subagents : {};
  const models: ObservedModel[] = [];
  for (const row of Array.isArray(value.models) ? value.models : []) {
    if (!isRecord(row) || typeof row.model !== "string") continue;
    models.push({
      provider: str(row.provider) ?? "unknown",
      model: row.model,
      turns: count(row.turns),
      inputTokens: count(row.inputTokens),
      outputTokens: count(row.outputTokens),
      cacheHitRate: num(row.cacheHitRate),
    });
  }
  const running: ObservedRunning[] = [];
  for (const row of Array.isArray(value.running) ? value.running : []) {
    if (!isRecord(row)) continue;
    running.push({
      provider: str(row.provider) ?? "unknown",
      model: str(row.model),
      effort: str(row.effort),
      runtimeMode: str(row.runtimeMode) ?? "unknown",
      ageHours: num(row.ageHours),
      title: str(row.title),
    });
  }
  const pullRequests = [];
  for (const row of Array.isArray(value.pullRequests) ? value.pullRequests : []) {
    if (!isRecord(row) || typeof row.repository !== "string" || num(row.number) === null) continue;
    const url = str(row.url);
    pullRequests.push({
      repository: row.repository,
      number: count(row.number),
      url: url && /^https:\/\/github\.com\//.test(url) ? url : null,
      threads: count(row.threads),
    });
  }
  const findings: { severity: Level; id: string; message: string }[] = [];
  for (const entry of Array.isArray(value.findings) ? value.findings : []) {
    const severity = isRecord(entry) ? level(entry.severity) : null;
    if (!isRecord(entry) || !severity || typeof entry.message !== "string") continue;
    findings.push({ severity, id: str(entry.id) ?? "unknown", message: entry.message });
  }
  return {
    windowHours: count(value.windowHours),
    threads: count(value.threads),
    runs: count(runs.total),
    failedRuns: count(byStatus.failed),
    turns: count(value.turns),
    inputTokens: count(tokens.inputTokens),
    outputTokens: count(tokens.outputTokens),
    cacheHitRate: num(tokens.cacheHitRate),
    modelRecordedRate: num(coverage.rate),
    models,
    running,
    runtimeModes: isRecord(value.runtimeModes)
      ? Object.entries(value.runtimeModes).map(([mode, threads]) => ({
          mode,
          threads: count(threads),
        }))
      : [],
    subagentsDifferentVendor: count(subagents.differentVendor),
    subagentsSameVendor: count(subagents.sameVendor),
    pullRequests,
    findings,
  };
}

function parseOwner(value: unknown): RunOwner | null {
  if (!isRecord(value)) return null;
  const pr = isRecord(value.pr) ? value.pr : {};
  const url = str(pr.url);
  return {
    humanOwner: str(value.humanOwner),
    requestedBy: str(value.requestedBy),
    approvedBy: str(value.approvedBy),
    prAuthor: str(value.prAuthor),
    mergedBy: str(value.mergedBy),
    commitAuthors: Array.isArray(value.commitAuthors)
      ? value.commitAuthors.filter((name): name is string => typeof name === "string")
      : [],
    prNumber: typeof pr.number === "number" ? pr.number : null,
    prUrl: url && /^https:\/\/github\.com\//.test(url) ? url : null,
    prState: str(pr.state),
  };
}

export function parseProvenance(value: unknown): Provenance | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.decisions)) return null;
  const decisions: TracedDecision[] = [];
  for (const entry of value.decisions) {
    if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.title !== "string")
      continue;
    const by = isRecord(entry.by) ? entry.by : {};
    const launch = isRecord(entry.launch) ? entry.launch : null;
    const model = isRecord(entry.model) ? entry.model : {};
    const gaps = [];
    for (const gap of Array.isArray(entry.gaps) ? entry.gaps : []) {
      const severity = isRecord(gap) ? level(gap.severity) : null;
      if (isRecord(gap) && severity && typeof gap.message === "string") {
        gaps.push({ severity, code: str(gap.code) ?? "unknown", message: gap.message });
      }
    }
    decisions.push({
      id: entry.id,
      title: entry.title,
      byType: str(by.type) ?? "unknown",
      byName: str(by.name),
      at: str(entry.at),
      launch: launch
        ? {
            providerInstanceId: str(launch.providerInstanceId),
            threadId: str(launch.threadId),
            turnId: str(launch.turnId),
          }
        : null,
      modelApproved: str(model.approved),
      modelActual: str(model.actual),
      tokens: typeof entry.tokens === "number" ? entry.tokens : null,
      gaps,
    });
  }
  if (typeof value.runId !== "string") return null;
  return {
    runId: value.runId,
    ticket: str(value.ticket) ?? "",
    status: str(value.status) ?? "",
    traceId: str(value.traceId),
    owner: parseOwner(value.owner),
    traceable: count(value.traceable),
    total: count(value.total),
    decisions,
  };
}

export async function readQuality(signal: AbortSignal): Promise<Quality | null> {
  return parseQuality(await readJson("quality", signal));
}

export async function readObserved(signal: AbortSignal): Promise<Observed | null> {
  return parseObserved(await readJson("observed", signal));
}

export async function readProvenance(
  runId: string,
  signal: AbortSignal,
): Promise<Provenance | null> {
  return parseProvenance(await readJson(`provenance/${encodeURIComponent(runId)}`, signal));
}

export async function readProposals(signal: AbortSignal): Promise<Proposal[] | null> {
  return parseProposals(await readJson("retention/proposals", signal));
}

export type ActionResult = { ok: true } | { ok: false; message: string };

async function putSidecar(
  resource: string,
  body: unknown,
  signal: AbortSignal,
): Promise<ActionResult> {
  try {
    const response = await sendDeliverySidecar(
      `/delivery-sidecar/v1/sidecar/${resource}`,
      JSON.stringify(body),
      signal,
    );
    const reply: unknown = await response.json().catch(() => null);
    return response.ok ? { ok: true } : { ok: false, message: failure(response.status, reply) };
  } catch {
    return {
      ok: false,
      message: "This app could not reach its own T3 server (it may be restarting). Try again.",
    };
  }
}

/** A person says a request an agent raised is done (resolve) or no longer needed (dismiss). */
export function decideRequest(
  id: string,
  decision: "resolve" | "dismiss",
  signal: AbortSignal,
): Promise<ActionResult> {
  return putSidecar(`needs-human/${id}`, { decision }, signal);
}

export function proposeCleanup(signal: AbortSignal): Promise<ActionResult> {
  return putSidecar("retention/proposals", { action: "propose" }, signal);
}

export function decideProposal(
  id: string,
  decision: "approve" | "reject",
  signal: AbortSignal,
): Promise<ActionResult> {
  return putSidecar(`retention/proposals/${id}`, { decision }, signal);
}

/** Search parameters for an in-app link the sidecar sent, or null when it is not one we know. */
export function inboxSearch(
  link: string | null,
): { ticket?: string; run?: string; view?: "fleet" | "sidecar" | "inbox" | "quality" } | null {
  if (!link?.startsWith("/delivery?")) return null;
  const params = new URLSearchParams(link.slice("/delivery?".length));
  const run = params.get("run");
  const ticket = params.get("ticket");
  const view = params.get("view");
  if (run && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(run)) return { run };
  if (ticket && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(ticket)) return { ticket };
  if (view === "fleet" || view === "sidecar" || view === "inbox" || view === "quality")
    return { view };
  return null;
}
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function formatAge(seconds: number | null): string {
  if (seconds === null) return "unknown";
  if (seconds < 90) return "just now";
  if (seconds < 5400) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86400)} days ago`;
}

/** Only the settings that differ from what the sidecar already holds. */
export function policyPatch(
  saved: Readonly<Record<string, PolicyValue>>,
  edited: Readonly<Record<string, PolicyValue>>,
): Record<string, PolicyValue> {
  const patch: Record<string, PolicyValue> = {};
  for (const [key, value] of Object.entries(edited)) if (saved[key] !== value) patch[key] = value;
  return patch;
}

/** A message for one edited value, or null when it is acceptable. */
export function validateField(field: PolicyField, value: PolicyValue): string | null {
  if (field.type === "boolean") return typeof value === "boolean" ? null : "Choose on or off.";
  if (value === null) return field.nullable ? null : "A value is required.";
  if (typeof value !== "number" || !Number.isFinite(value)) return "Enter a number.";
  if (field.min !== null && value < field.min) return `At least ${field.min}.`;
  if (field.max !== null && value > field.max) return `At most ${field.max}.`;
  return null;
}

export type { FleetState };
