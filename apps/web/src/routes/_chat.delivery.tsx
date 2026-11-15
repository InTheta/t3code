import { createFileRoute, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";

interface Delivery {
  version: 1;
  ticket: string;
  owner: string;
  stage: string;
  pullRequest: { number: number; head: string; url: string };
  ci: { status: string; head?: string; url?: string };
  implementation: {
    patchSha: string;
    model: string;
    effort: string;
    reserved: number;
    metered: number | null;
  };
  qa: { verdict: string; threadId: string; traceId: string };
}

const validTicket = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const commitSha = /^[a-f0-9]{40}$/;

function readDeliveryShape(value: unknown, ticket: string): Delivery | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<Delivery>;
  if (
    row.version !== 1 ||
    row.ticket !== ticket ||
    typeof row.owner !== "string" ||
    typeof row.stage !== "string" ||
    typeof row.pullRequest?.head !== "string" ||
    !commitSha.test(row.pullRequest.head) ||
    typeof row.pullRequest.url !== "string" ||
    !/^https:\/\//.test(row.pullRequest.url) ||
    !Number.isInteger(row.pullRequest.number) ||
    typeof row.ci?.status !== "string" ||
    typeof row.implementation?.patchSha !== "string" ||
    !commitSha.test(row.implementation.patchSha) ||
    typeof row.implementation.model !== "string" ||
    typeof row.implementation.effort !== "string" ||
    !Number.isSafeInteger(row.implementation.reserved) ||
    (row.implementation.metered !== null && !Number.isSafeInteger(row.implementation.metered)) ||
    typeof row.qa?.verdict !== "string" ||
    typeof row.qa.threadId !== "string" ||
    typeof row.qa.traceId !== "string"
  )
    return null;
  return row as Delivery;
}

async function readDelivery(ticket: string, signal: AbortSignal): Promise<Delivery | null> {
  try {
    const response = await fetch(`/delivery-sidecar/v1/${encodeURIComponent(ticket)}`, {
      cache: "no-store",
      signal,
    });
    return response.ok ? readDeliveryShape(await response.json(), ticket) : null;
  } catch {
    return null;
  }
}

function DeliveryPage() {
  const router = useRouter();
  const navigate = useNavigate({ from: Route.fullPath });
  const { ticket } = Route.useSearch();
  const delivery = Route.useLoaderData();
  const loading = useRouterState({ select: (state) => state.isLoading });
  const ciStatus =
    delivery?.ci.status === "passed" && delivery.ci.head !== delivery.pullRequest.head
      ? "stale"
      : delivery?.ci.status;
  const fields = delivery
    ? [
        ["Owner", delivery.owner],
        ["Stage", delivery.stage],
        ["Model", [delivery.implementation.model, delivery.implementation.effort].join(" · ")],
        ["Reserved tokens", delivery.implementation.reserved.toLocaleString()],
        ["Observed usage", delivery.implementation.metered?.toLocaleString() ?? "Unknown"],
        ["Reviewed patch", delivery.implementation.patchSha],
        ["Independent QA", delivery.qa.verdict],
        ["QA thread", delivery.qa.threadId],
        ["Langfuse trace", delivery.qa.traceId],
        ["Current PR commit", delivery.pullRequest.head],
        ["CI evidence commit", delivery.ci.head ?? "Unavailable"],
        ["CI", ciStatus],
      ]
    : [];

  return (
    <main className="min-h-0 flex-1 overflow-auto p-6">
      <div className="flex max-w-2xl items-center justify-between">
        <h1 className="text-lg font-semibold">Delivery</h1>
        <button
          className="rounded-md border px-3 py-1 text-sm"
          onClick={() => void router.invalidate()}
        >
          Refresh
        </button>
      </div>
      <form
        className="mt-4 flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get("ticket");
          if (typeof value === "string" && validTicket.test(value)) {
            void navigate({ search: { ticket: value } });
          }
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          Ticket
          <input
            key={ticket}
            className="rounded-md border bg-transparent px-3 py-1"
            defaultValue={ticket}
            maxLength={64}
            name="ticket"
            pattern="[A-Za-z0-9][A-Za-z0-9_\-]{0,63}"
            required
          />
        </label>
        <button className="rounded-md border px-3 py-1 text-sm" type="submit">
          Open ticket
        </button>
      </form>
      {ticket && (loading || !delivery) && (
        <p className="mt-4 text-sm" role="status">
          {loading ? "Reading delivery evidence…" : "Delivery sidecar unavailable."}
        </p>
      )}
      {delivery && !loading && (
        <article className="mt-4 max-w-2xl rounded-lg border p-4">
          <h2 className="font-medium">
            {delivery.ticket} ·{" "}
            <a
              className="underline"
              href={delivery.pullRequest.url}
              target="_blank"
              rel="noreferrer"
            >
              PR #{delivery.pullRequest.number}
            </a>
          </h2>
          <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
            {fields.map(([label, value]) => (
              <div className="contents" key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="break-all">{value}</dd>
              </div>
            ))}
          </dl>
        </article>
      )}
    </main>
  );
}

export const Route = createFileRoute("/_chat/delivery")({
  validateSearch: (search: Record<string, unknown>) => ({
    ticket:
      typeof search.ticket === "string" && validTicket.test(search.ticket)
        ? search.ticket
        : undefined,
  }),
  loaderDeps: ({ search }) => ({ ticket: search.ticket }),
  loader: ({ abortController, deps }) =>
    deps.ticket ? readDelivery(deps.ticket, abortController.signal) : null,
  component: DeliveryPage,
});
