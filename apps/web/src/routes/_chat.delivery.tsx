import { createFileRoute, useRouter, useRouterState } from "@tanstack/react-router";

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

async function readDelivery(signal: AbortSignal): Promise<Delivery | null> {
  try {
    const response = await fetch("/delivery-sidecar/v1/LAB-74", { cache: "no-store", signal });
    if (!response.ok) return null;
    const result = (await response.json()) as Delivery;
    return result.version === 1 && result.ticket === "LAB-74" && result.pullRequest?.head
      ? result
      : null;
  } catch {
    return null;
  }
}

function DeliveryPage() {
  const router = useRouter();
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
      {(loading || !delivery) && (
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
  loader: ({ abortController }) => readDelivery(abortController.signal),
  component: DeliveryPage,
});
