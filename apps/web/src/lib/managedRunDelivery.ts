import * as Schema from "effect/Schema";

import { fetchDeliverySidecar } from "~/lib/deliverySidecarFetch";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CommitSha = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/));
const Tokens = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
const ManagedRun = Schema.Struct({
  version: Schema.Literal(1),
  runId: Schema.String.check(Schema.isPattern(uuid)),
  ticket: Schema.String,
  traceId: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/))),
  revision: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  status: Schema.String,
  candidateSha: Schema.optionalKey(CommitSha),
  source: Schema.optionalKey(
    Schema.Struct({
      host: Schema.String,
      buildSha: Schema.NullOr(CommitSha),
      readAt: Schema.String,
    }),
  ),
  brief: Schema.Struct({
    workspaceId: Schema.String,
    repository: Schema.String,
    baseSha: CommitSha,
    scope: Schema.String,
    tokens: Tokens,
  }),
  budget: Schema.Struct({
    reserved: Tokens,
    used: Schema.NullOr(Tokens),
    remaining: Schema.NullOr(Tokens),
  }),
  qa: Schema.optionalKey(
    Schema.Struct({
      reviewedSha: CommitSha,
      verdict: Schema.Literals(["pass", "fail"]),
      source: Schema.Literals(["provider", "operator"]),
      budgetExceeded: Schema.Boolean,
    }),
  ),
  workflowEvents: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        kind: Schema.Literals(["langgraph-stage-queued", "symphony-controller-accepted"]),
        at: Schema.String,
        stageId: Schema.String,
      }),
    ),
  ),
  stageAttempts: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        stageId: Schema.String,
        attemptId: Schema.String,
        providerInstanceId: Schema.String,
        status: Schema.String,
        actualModel: Schema.NullOr(Schema.String),
        requestedReasoningEffort: Schema.optionalKey(Schema.NullOr(Schema.String)),
        usageStatus: Schema.String,
        tokens: Schema.Struct({
          inputTokens: Schema.NullOr(Tokens),
          cachedInputTokens: Schema.NullOr(Tokens),
          cacheCreationTokens: Schema.NullOr(Tokens),
          outputTokens: Schema.NullOr(Tokens),
          reasoningTokens: Schema.NullOr(Tokens),
        }),
      }),
    ),
  ),
  stages: Schema.Array(
    Schema.Struct({
      stageId: Schema.String,
      role: Schema.String,
      status: Schema.String,
      providerInstanceId: Schema.NullOr(Schema.String),
      threadId: Schema.NullOr(Schema.String),
      toolCalls: Schema.optionalKey(Schema.NullOr(Tokens)),
    }),
  ),
});

export type ManagedRun = typeof ManagedRun.Type;
const isManagedRun = Schema.is(ManagedRun);

export function parseManagedRunId(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const normalized = input.trim().toLowerCase();
  return uuid.test(normalized) ? normalized : undefined;
}

export function parseManagedRun(input: unknown, requestedRunId: string): ManagedRun | null {
  if (!isManagedRun(input) || input.runId !== requestedRunId) return null;
  return input.traceId === undefined || input.traceId === input.runId.replaceAll("-", "")
    ? input
    : null;
}

type ManagedRunFailure =
  | { kind: "forbidden" | "missing" | "invalid" | "unreachable" }
  | { kind: "http"; status: number };

export async function readManagedRunResult(
  runId: string,
  signal: AbortSignal,
): Promise<{ run: ManagedRun; failure?: never } | { run?: never; failure: ManagedRunFailure }> {
  try {
    const response = await fetchDeliverySidecar(
      `/delivery-sidecar/v1/managed-runs/${encodeURIComponent(runId)}`,
      signal,
    );
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return { failure: { kind: "forbidden" } };
      }
      if (response.status === 404) {
        return { failure: { kind: "missing" } };
      }
      return { failure: { kind: "http", status: response.status } };
    }
    const run = parseManagedRun(await response.json(), runId);
    return run ? { run } : { failure: { kind: "invalid" } };
  } catch {
    return { failure: { kind: "unreachable" } };
  }
}

export async function readManagedRun(
  runId: string,
  signal: AbortSignal,
): Promise<ManagedRun | null> {
  return (await readManagedRunResult(runId, signal)).run ?? null;
}
