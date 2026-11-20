/* oxlint-disable t3code/no-untranslated-copy -- fork-only operator screen, English only */
import { Link } from "@tanstack/react-router";

import { inboxSearch, type Inbox, type InboxItem, type Severity } from "~/lib/sidecarApi";

const heading: Record<Severity, string> = {
  action: "Needs you",
  warning: "Worth a look",
  info: "For your information",
};
const badge: Record<Severity, string> = {
  action: "border-warning text-warning",
  warning: "border-border text-muted-foreground",
  info: "border-success text-success",
};

function Item({ item }: { item: InboxItem }) {
  const search = inboxSearch(item.link);
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3 text-sm">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          <span
            className={`rounded-full border px-2 py-0.5 text-xs font-normal ${badge[item.severity]}`}
          >
            {item.kind.replaceAll("-", " ")}
          </span>
          {item.title}
        </p>
        <p className="mt-1 text-muted-foreground">{item.detail}</p>
      </div>
      {search && (
        <Link className="rounded-md border px-3 py-1" to="/delivery" search={search}>
          Open
        </Link>
      )}
    </li>
  );
}

export function InboxPanel({ inbox, onRefresh }: { inbox: Inbox | null; onRefresh: () => void }) {
  if (inbox === null) {
    return (
      <p className="mt-4 max-w-2xl text-sm" role="status">
        The sidecar is not connected, so nothing can be listed here. Start the sidecar HTTP service
        and set T3CODE_DELIVERY_SIDECAR_PORT, then refresh.
      </p>
    );
  }
  const groups = (["action", "warning", "info"] as const).map((severity) => ({
    severity,
    items: inbox.items.filter((item) => item.severity === severity),
  }));
  const notified = inbox.channels.filter((channel) => channel !== "stdout");
  return (
    <section className="mt-4 grid max-w-3xl gap-4" aria-label="Needs you">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-muted-foreground">
          {notified.length > 0
            ? `New items are also sent to ${notified.join(", ")}.`
            : "No chat notifications are set up. Items only appear here."}
        </p>
        <button className="rounded-md border px-3 py-1" type="button" onClick={onRefresh}>
          Refresh
        </button>
      </div>
      {inbox.configError && (
        <p className="text-sm text-destructive" role="alert">
          Notification settings are invalid and defaults are in use: {inbox.configError}
        </p>
      )}
      {inbox.items.length === 0 && (
        <p className="rounded-lg border p-4 text-sm" role="status">
          Nothing is waiting on you.
        </p>
      )}
      {groups
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <div key={group.severity}>
            <h2 className="mb-2 font-medium">
              {heading[group.severity]} · {group.items.length}
            </h2>
            <ul className="grid gap-2">
              {group.items.map((item) => (
                <Item item={item} key={item.id} />
              ))}
            </ul>
          </div>
        ))}
      {inbox.truncated && (
        <p className="text-sm text-muted-foreground">Only the first 200 items are shown.</p>
      )}
      <p className="text-xs text-muted-foreground">
        Approving or declining always happens here in T3, never from a chat message.
      </p>
    </section>
  );
}
