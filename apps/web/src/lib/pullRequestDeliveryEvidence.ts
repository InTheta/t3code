import { parseDeliveryPullRequestUrl } from "./deliveryPullRequest";
import { fetchDeliverySidecar } from "./deliverySidecarFetch";

const commitSha = /^[a-f0-9]{40}$/;

export interface PullRequestDelivery {
  version: 1;
  pullRequest: { repository: string; number: number; head: string; url: string };
  candidate: string | null;
  managedRunId?: string;
  qa: { status: string; head?: string; freshness?: string };
  ci: { status: string; head?: string; runId?: number };
  previousCi?: { status: string; head: string; runId?: number } | null;
}

export async function readPullRequestDelivery(value: string, signal: AbortSignal) {
  const link = parseDeliveryPullRequestUrl(value);
  if (!link) return null;
  const segments = link.repository.split("/").map(encodeURIComponent).join("/");
  try {
    const response = await fetchDeliverySidecar(
      `/delivery-sidecar/v1/pull-requests/${segments}/${link.number}`,
      signal,
    );
    if (!response.ok) return null;
    const row = (await response.json()) as Partial<PullRequestDelivery> | null;
    if (
      row?.version !== 1 ||
      typeof row.pullRequest?.repository !== "string" ||
      row.pullRequest.repository.toLowerCase() !== link.repository.toLowerCase() ||
      row.pullRequest.number !== link.number ||
      !commitSha.test(row.pullRequest.head) ||
      (row.candidate !== null &&
        (typeof row.candidate !== "string" || !commitSha.test(row.candidate))) ||
      typeof row.qa?.status !== "string" ||
      typeof row.ci?.status !== "string"
    )
      return null;
    return row as PullRequestDelivery;
  } catch {
    return null;
  }
}
