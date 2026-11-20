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

export async function readManagedRun(
  runId: string,
  signal: AbortSignal,
): Promise<ManagedRun | null> {
  try {
    const response = await fetchDeliverySidecar(
      `/delivery-sidecar/v1/managed-runs/${encodeURIComponent(runId)}`,
      signal,
    );
    return response.ok ? parseManagedRun(await response.json(), runId) : null;
  } catch {
    return null;
  }
}
