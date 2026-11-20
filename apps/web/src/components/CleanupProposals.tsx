/* oxlint-disable t3code/no-untranslated-copy -- fork-only operator screen, English only */
import { useState } from "react";

import { decideProposal, formatBytes, proposeCleanup, type Proposal } from "~/lib/sidecarApi";

const stateWord: Record<Proposal["status"], string> = {
  pending: "Waiting for approval",
  approved: "Approved, not yet applied",
  rejected: "Rejected",
  expired: "Expired",
  applied: "Applied",
};

async function run(
  action: () => Promise<{ ok: boolean; message?: string }>,
  done: (result: { ok: boolean; message: string }) => void,
) {
  const result = await action();
  done({ ok: result.ok, message: result.ok ? "Done." : (result.message ?? "Failed.") });
}

export function CleanupProposals({
  proposals,
  onChanged,
}: {
  proposals: readonly Proposal[] | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; message: string } | null>(null);
  const start = (action: () => Promise<{ ok: boolean; message?: string }>) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    void run(action, (result) => {
      setBusy(false);
      setMessage(result);
      if (result.ok) onChanged();
    });
  };
  return (
    <article className="rounded-lg border p-4 text-sm" aria-label="Cleanup proposals">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Cleanup proposals</h2>
        <button
          className="rounded-md border px-3 py-1 disabled:opacity-50"
          type="button"
          disabled={busy}
          onClick={() => start(() => proposeCleanup(new AbortController().signal))}
        >
          Propose a cleanup now
        </button>
      </div>
      <p className="mt-2 text-muted-foreground">
        A proposal lists exactly what would be removed under your policy. Approving it records who
        agreed; it does not delete anything. The server operator then runs
        <code className="mx-1">scripts/retention_proposals.py apply &lt;id&gt;</code>, which removes
        only approved items that are still safe to remove.
      </p>
      {message && (
        <p className={`mt-2 ${message.ok ? "text-success" : "text-destructive"}`} role="status">
          {message.message}
        </p>
      )}
      {proposals === null || proposals.length === 0 ? (
        <p className="mt-3 text-muted-foreground">No proposals yet.</p>
      ) : (
        <ul className="mt-3 grid gap-3">
          {proposals.map((proposal) => (
            <li className="rounded-md border p-3" key={proposal.id}>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono">{proposal.id}</span>
                <span className="font-medium">{stateWord[proposal.status]}</span>
                <span>
                  {formatBytes(proposal.totalBytes)} · {proposal.itemCount.toLocaleString()} items
                </span>
                {proposal.decidedBy && (
                  <span className="text-muted-foreground">by {proposal.decidedBy}</span>
                )}
              </p>
              <p className="mt-1 text-muted-foreground">
                {Object.entries(proposal.byKind)
                  .map(
                    ([kind, entry]) =>
                      `${entry.count.toLocaleString()} ${kind.replaceAll("-", " ")} (${formatBytes(entry.bytes)})`,
                  )
                  .join(" · ")}
                {" · expires "}
                {proposal.expiresAt}
              </p>
              {proposal.applied && (
                <p className="mt-1">
                  Removed {proposal.applied.removed}, skipped {proposal.applied.skipped}, failed{" "}
                  {proposal.applied.failed}
                  {proposal.applied.freedBytes === null
                    ? ""
                    : `, freed ${formatBytes(proposal.applied.freedBytes)}`}
                  .
                </p>
              )}
              <details className="mt-2">
                <summary className="cursor-pointer">What would go</summary>
                <ul className="mt-2 grid gap-1">
                  {proposal.items.slice(0, 25).map((item) => (
                    <li
                      className="flex flex-wrap justify-between gap-2"
                      key={`${item.kind}:${item.task}:${item.sha ?? ""}`}
                    >
                      <span className="font-mono">
                        {item.task}
                        {item.sha ? `/${item.sha.slice(0, 8)}` : ""}
                      </span>
                      <span className="text-muted-foreground">
                        {item.kind} · {item.ageDays.toFixed(0)} days · {formatBytes(item.bytes)} ·{" "}
                        {item.reason}
                      </span>
                    </li>
                  ))}
                </ul>
                {(proposal.itemsTruncated || proposal.items.length > 25) && (
                  <p className="mt-1 text-muted-foreground">
                    Largest items first; the full list is in the proposal file.
                  </p>
                )}
              </details>
              {proposal.status === "pending" && (
                <div className="mt-3 flex gap-2">
                  <button
                    className="rounded-md border px-3 py-1 disabled:opacity-50"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      start(() =>
                        decideProposal(proposal.id, "approve", new AbortController().signal),
                      )
                    }
                  >
                    Approve
                  </button>
                  <button
                    className="rounded-md border px-3 py-1 disabled:opacity-50"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      start(() =>
                        decideProposal(proposal.id, "reject", new AbortController().signal),
                      )
                    }
                  >
                    Reject
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
