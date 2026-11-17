import * as Schema from "effect/Schema";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const Tokens = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
const ManagedRun = Schema.Struct({
  version: Schema.Literal(1),
  runId: Schema.String.check(Schema.isPattern(uuid)),
  ticket: Schema.String,
  revision: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  status: Schema.String,
  brief: Schema.Struct({
    workspaceId: Schema.String,
    repository: Schema.String,
    baseSha: Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/)),
    scope: Schema.String,
    tokens: Tokens,
  }),
  budget: Schema.Struct({
    reserved: Tokens,
    used: Schema.NullOr(Tokens),
    remaining: Schema.NullOr(Tokens),
  }),
  stages: Schema.Array(
    Schema.Struct({
      stageId: Schema.String,
      role: Schema.String,
      status: Schema.String,
      providerInstanceId: Schema.NullOr(Schema.String),
      threadId: Schema.NullOr(Schema.String),
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
  return isManagedRun(input) && input.runId === requestedRunId ? input : null;
}

export async function readManagedRun(
  runId: string,
  signal: AbortSignal,
): Promise<ManagedRun | null> {
  try {
    const response = await fetch(`/delivery-sidecar/v1/managed-runs/${encodeURIComponent(runId)}`, {
      cache: "no-store",
      signal,
    });
    return response.ok ? parseManagedRun(await response.json(), runId) : null;
  } catch {
    return null;
  }
}
