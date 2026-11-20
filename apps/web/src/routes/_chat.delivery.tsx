/* oxlint-disable t3code/no-untranslated-copy -- fork-only operator screen, English only */
import {
  Link,
  createFileRoute,
  useNavigate,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";

import type { ReactNode } from "react";

import { FleetBoard } from "~/components/FleetBoard";
import { InboxPanel } from "~/components/InboxPanel";
import { ManagedRunEvidence } from "~/components/ManagedRunEvidence";
import { QualityPanel } from "~/components/QualityPanel";
import { SidecarSettings } from "~/components/SidecarSettings";
import { deliveryCiRun, parseDeliveryPullRequestUrl } from "~/lib/deliveryPullRequest";
import { fetchDeliverySidecar } from "~/lib/deliverySidecarFetch";
import { parseManagedRunId, readManagedRun } from "~/lib/managedRunDelivery";
import {
  readFleetOverview,
  readInbox,
  readProposals,
  readProvenance,
  readQuality,
  readSidecarStatus,
} from "~/lib/sidecarApi";
import {
  readPullRequestDelivery,
  type PullRequestDelivery,
} from "~/lib/pullRequestDeliveryEvidence";

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

const views = [
  ["evidence", "Evidence"],
  ["inbox", "Needs you"],
  ["fleet", "Fleet"],
  ["quality", "Quality"],
  ["sidecar", "Sidecar settings"],
] as const;
type DeliveryView = (typeof views)[number][0];

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
    typeof row.pullRequest.head !== "string" ||
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
    const response = await fetchDeliverySidecar(
      `/delivery-sidecar/v1/${encodeURIComponent(ticket)}`,
      signal,
    );
    return response.ok ? readDeliveryShape(await response.json(), ticket) : null;
  } catch {
    return null;
  }
}

function CiRunLink({ repository, runId }: { repository: string; runId?: number | undefined }) {
  const run = deliveryCiRun(repository, runId);
  if (!run) return null;
  if (!run.href) return ` · ${run.label}`;
  return (
    <>
      {" · "}
      <a className="underline" href={run.href} target="_blank" rel="noreferrer">
        {run.label}
      </a>
    </>
  );
}

function PullRequestEvidence({ delivery }: { delivery: PullRequestDelivery }) {
  const { pullRequest, candidate, qa, ci } = delivery;
  const run = parseManagedRunId(delivery.managedRunId);
  const fields: ReadonlyArray<readonly [string, ReactNode]> = [
    ["Current PR commit", pullRequest.head],
    ["Verified candidate", candidate ?? "No managed candidate"],
    ["QA reviewed commit", qa.head ?? "Unavailable"],
    ["Independent QA", qa.freshness === "stale" ? `${qa.status} (stale)` : qa.status],
    ["CI tested commit", ci.head ?? "Unavailable"],
    [
      "CI",
      <>
        {ci.head && ci.head !== pullRequest.head ? "stale" : ci.status}
        <CiRunLink repository={pullRequest.repository} runId={ci.runId} />
      </>,
    ],
    ...(delivery.previousCi && delivery.previousCi.head !== pullRequest.head
      ? ([
          ["Previous CI commit", delivery.previousCi.head],
          [
            "Previous CI",
            <>
              stale
              <CiRunLink repository={pullRequest.repository} runId={delivery.previousCi.runId} />
            </>,
          ],
        ] as const)
      : []),
  ];
  return (
    <article className="mt-4 max-w-2xl rounded-lg border p-4">
      <h2 className="font-medium">
        {pullRequest.repository} #{pullRequest.number}
      </h2>
      {run && (
        <Link className="mt-2 inline-block text-sm underline" to="/delivery" search={{ run }}>
          Open managed run
        </Link>
      )}
      <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        {fields.map(([label, value]) => (
          <div className="contents" key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="break-all">{value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

function DeliveryPage() {
  const router = useRouter();
  const navigate = useNavigate({ from: Route.fullPath });
  const { ticket, pr, run, view = "evidence" } = Route.useSearch();
  const {
    delivery,
    pullRequestDelivery,
    managedRun,
    fleet,
    sidecar,
    proposals,
    inbox,
    quality,
    provenance,
  } = Route.useLoaderData();
  const waiting = inbox?.items.filter((item) => item.severity === "action").length ?? 0;
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
      <nav className="mt-3 flex flex-wrap gap-2 text-sm" aria-label="Delivery views">
        {views.map(([id, label]) => (
          <Link
            key={id}
            to="/delivery"
            search={id === "evidence" ? {} : { view: id }}
            aria-current={view === id ? "page" : undefined}
            className={`rounded-md border px-3 py-1 ${view === id ? "bg-muted font-semibold" : ""}`}
          >
            {label}
            {id === "inbox" && waiting > 0 ? ` · ${waiting}` : ""}
          </Link>
        ))}
      </nav>
      {view === "inbox" &&
        (loading ? (
          <p className="mt-4 text-sm" role="status">
            Reading what needs you…
          </p>
        ) : (
          <InboxPanel inbox={inbox} onRefresh={() => void router.invalidate()} />
        ))}
      {view === "fleet" &&
        (loading ? (
          <p className="mt-4 text-sm" role="status">
            Reading the fleet overview…
          </p>
        ) : (
          <FleetBoard overview={fleet} onRefresh={() => void router.invalidate()} />
        ))}
      {view === "quality" &&
        (loading ? (
          <p className="mt-4 text-sm" role="status">
            Checking the record…
          </p>
        ) : (
          <QualityPanel
            quality={quality}
            trace={provenance}
            onRefresh={() => void router.invalidate()}
          />
        ))}
      {view === "sidecar" &&
        (loading ? (
          <p className="mt-4 text-sm" role="status">
            Reading the sidecar…
          </p>
        ) : (
          <SidecarSettings
            status={sidecar}
            proposals={proposals}
            onChanged={() => void router.invalidate()}
          />
        ))}
      {view === "evidence" && (
        <>
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
          <form
            className="mt-4 flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const value = new FormData(event.currentTarget).get("pr");
              if (typeof value === "string" && parseDeliveryPullRequestUrl(value)) {
                void navigate({ search: { pr: value.trim() } });
              } else {
                const field = event.currentTarget.elements.namedItem("pr");
                if (field instanceof HTMLInputElement) {
                  field.setCustomValidity("Enter a GitHub pull request URL.");
                  field.reportValidity();
                }
              }
            }}
          >
            <label className="flex flex-col gap-1 text-sm">
              Pull request URL
              <input
                key={pr}
                className="rounded-md border bg-transparent px-3 py-1"
                defaultValue={pr}
                name="pr"
                type="url"
                required
                onInput={(event) => event.currentTarget.setCustomValidity("")}
              />
            </label>
            <button className="rounded-md border px-3 py-1 text-sm" type="submit">
              Open Delivery
            </button>
          </form>
          <form
            className="mt-4 flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const value = parseManagedRunId(new FormData(event.currentTarget).get("run"));
              if (value) {
                void navigate({ search: { run: value } });
              } else {
                const field = event.currentTarget.elements.namedItem("run");
                if (field instanceof HTMLInputElement) {
                  field.setCustomValidity("Enter a managed run UUID.");
                  field.reportValidity();
                }
              }
            }}
          >
            <label className="flex flex-col gap-1 text-sm">
              Managed run ID
              <input
                key={run}
                className="rounded-md border bg-transparent px-3 py-1"
                defaultValue={run}
                name="run"
                required
                onInput={(event) => event.currentTarget.setCustomValidity("")}
              />
            </label>
            <button className="rounded-md border px-3 py-1 text-sm" type="submit">
              Open managed run
            </button>
          </form>
          {run && (loading || !managedRun) && (
            <p className="mt-4 text-sm" role="status">
              {loading
                ? "Reading managed run…"
                : "Managed run unavailable. Check the run ID and sidecar connection."}
            </p>
          )}
          {managedRun && !loading && <ManagedRunEvidence run={managedRun} />}
          {!run && pr && (loading || !pullRequestDelivery) && (
            <p className="mt-4 text-sm" role="status">
              {loading
                ? "Reading pull request evidence…"
                : "Pull request evidence unavailable. Check GitHub access and the sidecar connection."}
            </p>
          )}
          {pullRequestDelivery && !loading && (
            <PullRequestEvidence delivery={pullRequestDelivery} />
          )}
          {!run && ticket && (loading || !delivery) && (
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
        </>
      )}
    </main>
  );
}

export const Route = createFileRoute("/_chat/delivery")({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    ticket?: string | undefined;
    pr?: string | undefined;
    run?: string | undefined;
    trace?: string | undefined;
    view?: DeliveryView | undefined;
  } => ({
    view: views.find(([id]) => id === search.view)?.[0],
    ticket:
      typeof search.ticket === "string" && validTicket.test(search.ticket)
        ? search.ticket
        : undefined,
    pr:
      typeof search.pr === "string" && parseDeliveryPullRequestUrl(search.pr)
        ? search.pr
        : undefined,
    run: parseManagedRunId(search.run),
    trace: parseManagedRunId(search.trace),
  }),
  loaderDeps: ({ search }) => ({
    ticket: search.ticket,
    pr: search.pr,
    run: search.run,
    trace: search.trace,
    view: search.view,
  }),
  loader: async ({ abortController, deps }) => ({
    delivery:
      !deps.run && !deps.pr && deps.ticket
        ? await readDelivery(deps.ticket, abortController.signal)
        : null,
    pullRequestDelivery:
      !deps.run && deps.pr ? await readPullRequestDelivery(deps.pr, abortController.signal) : null,
    managedRun: deps.run ? await readManagedRun(deps.run, abortController.signal) : null,
    fleet: deps.view === "fleet" ? await readFleetOverview(abortController.signal) : null,
    sidecar: deps.view === "sidecar" ? await readSidecarStatus(abortController.signal) : null,
    proposals: deps.view === "sidecar" ? await readProposals(abortController.signal) : null,
    inbox: await readInbox(abortController.signal),
    quality: deps.view === "quality" ? await readQuality(abortController.signal) : null,
    provenance:
      deps.view === "quality" && deps.trace
        ? await readProvenance(deps.trace, abortController.signal)
        : null,
  }),
  component: DeliveryPage,
});
