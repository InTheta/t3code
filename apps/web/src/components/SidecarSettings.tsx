/* oxlint-disable t3code/no-untranslated-copy -- fork-only operator screen, English only */
import { useState } from "react";

import {
  formatAge,
  formatBytes,
  policyPatch,
  saveRetentionPolicy,
  validateField,
  type PolicyValue,
  type SidecarStatus,
} from "~/lib/sidecarApi";

interface FieldCopy {
  readonly key: string;
  readonly label: string;
  readonly help: string;
  readonly unit?: string;
}

const groups: readonly { title: string; fields: readonly FieldCopy[] }[] = [
  {
    title: "Days",
    fields: [
      {
        key: "snapshot_days",
        label: "Keep snapshots for",
        unit: "days",
        help: "Validated commits younger than this are kept.",
      },
      {
        key: "keep_per_task",
        label: "Newest snapshots kept per active task",
        help: "Always kept for a task that was touched recently.",
      },
      {
        key: "idle_days",
        label: "A task counts as active for",
        unit: "days",
        help: "Days since the task was last touched.",
      },
      {
        key: "workspace_idle_days",
        label: "Keep idle workspaces for",
        unit: "days",
        help: "Only used when workspace cleanup is on.",
      },
    ],
  },
  {
    title: "Size",
    fields: [
      {
        key: "max_snapshots_gb",
        label: "Snapshot size cap",
        unit: "GB",
        help: "If snapshots stay above this after the day rules, the oldest unprotected ones go first.",
      },
      {
        key: "max_workspaces_gb",
        label: "Workspace size cap",
        unit: "GB",
        help: "The same for workspaces and worker homes together.",
      },
    ],
  },
  {
    title: "Scope and safety",
    fields: [
      {
        key: "workspaces",
        label: "Also clean workspaces and worker homes",
        help: "Off by default. Snapshots are always considered.",
      },
      {
        key: "min_age_hours",
        label: "Never remove anything younger than",
        unit: "hours",
        help: "A size cap cannot override this.",
      },
      {
        key: "max_delete_gb",
        label: "Most one cleanup run may free",
        unit: "GB",
        help: "A run stops once it has freed this much.",
      },
    ],
  },
];

async function saveAndReload(
  patch: Record<string, PolicyValue>,
  done: (result: { ok: boolean; message: string }) => void,
) {
  const result = await saveRetentionPolicy(patch, new AbortController().signal);
  done(
    result.ok
      ? { ok: true, message: "Saved. It applies to the next cleanup run. Nothing was deleted." }
      : { ok: false, message: result.message },
  );
}

export function SidecarSettings({
  status,
  onChanged,
}: {
  status: SidecarStatus | null;
  onChanged: () => void;
}) {
  const [edits, setEdits] = useState<Record<string, PolicyValue>>({});
  const [message, setMessage] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  if (status === null) {
    return (
      <p className="mt-4 text-sm" role="status">
        The sidecar is not connected. Start the sidecar HTTP service and set
        T3CODE_DELIVERY_SIDECAR_PORT, then refresh.
      </p>
    );
  }

  const { retention, filesystem } = status;
  const values = { ...retention.policy, ...edits };
  const errors = new Map<string, string>();
  for (const group of groups) {
    for (const field of group.fields) {
      const schema = retention.schema[field.key];
      const problem = schema ? validateField(schema, values[field.key] ?? null) : null;
      if (problem) errors.set(field.key, problem);
    }
  }
  const patch = policyPatch(retention.policy, values);
  const dirty = Object.keys(patch).length > 0;
  const report = retention.status;
  const used = filesystem ? filesystem.totalBytes - filesystem.freeBytes : null;

  return (
    <section className="mt-4 grid max-w-3xl gap-4" aria-label="Sidecar settings">
      <article className="rounded-lg border p-4 text-sm">
        <h2 className="font-medium">Disk and cleanup</h2>
        <dl className="mt-2 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-1">
          {filesystem && used !== null && (
            <>
              <dt className="text-muted-foreground">Disk</dt>
              <dd>
                {formatBytes(filesystem.freeBytes)} free of {formatBytes(filesystem.totalBytes)} (
                {Math.round((used / filesystem.totalBytes) * 100)}% used)
              </dd>
            </>
          )}
          {report?.usage && (
            <>
              <dt className="text-muted-foreground">Snapshots</dt>
              <dd>{formatBytes(report.usage.snapshotsBytes)}</dd>
              <dt className="text-muted-foreground">Workspaces and worker homes</dt>
              <dd>{formatBytes(report.usage.workspacesBytes)}</dd>
            </>
          )}
          {report?.projected && (
            <>
              <dt className="text-muted-foreground">A cleanup would free</dt>
              <dd>
                {formatBytes(report.projected.freedBytes)}
                {Object.entries(report.projected.removeByKind).map(([kind, entry]) => (
                  <span className="text-muted-foreground" key={kind}>
                    {" "}
                    · {entry.count.toLocaleString()} {kind.replaceAll("-", " ")} (
                    {formatBytes(entry.bytes)})
                  </span>
                ))}
              </dd>
              <dt className="text-muted-foreground">Kept on purpose</dt>
              <dd>
                {Object.keys(report.projected.keptByReason).length === 0
                  ? "Nothing is protected right now."
                  : Object.entries(report.projected.keptByReason)
                      .map(
                        ([reason, amount]) =>
                          `${amount.toLocaleString()} ${reason.replaceAll("-", " ")}`,
                      )
                      .join(" · ")}
              </dd>
            </>
          )}
          <dt className="text-muted-foreground">Last cleanup</dt>
          <dd>
            {report?.lastRun
              ? `${report.lastRun.finished ?? report.lastRun.started ?? "unknown time"} · removed ${report.lastRun.removed}, skipped ${report.lastRun.skipped}, failed ${report.lastRun.failed}${report.lastRun.freedBytes === null ? "" : `, freed ${formatBytes(report.lastRun.freedBytes)}`}`
              : "Never run"}
          </dd>
          <dt className="text-muted-foreground">Report</dt>
          <dd>
            {report
              ? `updated ${formatAge(retention.statusAgeSeconds)}`
              : "No usage report yet. The daily report timer writes one."}
          </dd>
        </dl>
        <p className="mt-3 text-muted-foreground">
          This screen only changes the policy. Cleanup itself runs on the server with
          <code className="mx-1">scripts/retention.py --apply</code>
          and is never started from here.
        </p>
      </article>

      <form
        className="grid gap-4 rounded-lg border p-4 text-sm"
        onSubmit={(event) => {
          event.preventDefault();
          if (!dirty || errors.size > 0 || saving) return;
          setSaving(true);
          setMessage(null);
          void saveAndReload(patch, (result) => {
            setSaving(false);
            setMessage(result);
            if (result.ok) {
              setEdits({});
              onChanged();
            }
          });
        }}
      >
        <h2 className="font-medium">Retention policy</h2>
        {groups.map((group) => (
          <fieldset className="grid gap-3" key={group.title}>
            <legend className="mb-1 font-medium text-muted-foreground">{group.title}</legend>
            {group.fields.map((field) => {
              const schema = retention.schema[field.key];
              if (!schema) return null;
              const value = values[field.key] ?? null;
              const error = errors.get(field.key);
              const source = retention.sources[field.key] ?? "default";
              const id = `sidecar-${field.key}`;
              return (
                <div className="grid gap-1" key={field.key}>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="min-w-64" htmlFor={id}>
                      {field.label}
                    </label>
                    {schema.type === "boolean" ? (
                      <input
                        id={id}
                        type="checkbox"
                        checked={value === true}
                        onChange={(event) =>
                          setEdits({ ...edits, [field.key]: event.target.checked })
                        }
                      />
                    ) : (
                      <>
                        <input
                          id={id}
                          className="w-28 rounded-md border bg-transparent px-2 py-1 disabled:opacity-50"
                          type="number"
                          step="any"
                          min={schema.min ?? undefined}
                          max={schema.max ?? undefined}
                          disabled={value === null}
                          aria-invalid={error ? true : undefined}
                          aria-describedby={`${id}-help`}
                          value={value === null ? "" : String(value)}
                          onChange={(event) =>
                            setEdits({
                              ...edits,
                              [field.key]:
                                event.target.value === "" ? null : Number(event.target.value),
                            })
                          }
                        />
                        {field.unit && <span className="text-muted-foreground">{field.unit}</span>}
                        {schema.nullable && (
                          <label className="flex items-center gap-1 text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={value === null}
                              onChange={(event) =>
                                setEdits({
                                  ...edits,
                                  [field.key]: event.target.checked
                                    ? null
                                    : (schema.min ?? 1) > 1
                                      ? (schema.min ?? 1)
                                      : 10,
                                })
                              }
                            />
                            No cap
                          </label>
                        )}
                      </>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {source === "default" ? "default" : source}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground" id={`${id}-help`}>
                    {field.help}
                  </p>
                  {error && (
                    <p className="text-xs text-destructive" role="alert">
                      {error}
                    </p>
                  )}
                </div>
              );
            })}
          </fieldset>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <button
            className="rounded-md border px-3 py-1 disabled:opacity-50"
            type="submit"
            disabled={!dirty || errors.size > 0 || saving}
          >
            {saving ? "Saving…" : "Save policy"}
          </button>
          <button
            className="rounded-md border px-3 py-1 disabled:opacity-50"
            type="button"
            disabled={!dirty || saving}
            onClick={() => setEdits({})}
          >
            Discard changes
          </button>
          <button className="rounded-md border px-3 py-1" type="button" onClick={() => onChanged()}>
            Refresh
          </button>
          {message && (
            <span className={message.ok ? "text-success" : "text-destructive"} role="status">
              {message.message}
            </span>
          )}
        </div>
      </form>
    </section>
  );
}
