import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";

export function parseDeliveryPullRequestUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.origin !== "https://github.com" || url.username || url.password) return null;
    return sourceControlClients.parseChangeRequestUrl(url.href)?.link ?? null;
  } catch {
    return null;
  }
}

export function deliveryCiRun(repository: string, runId: unknown) {
  if (typeof runId !== "number" || !Number.isSafeInteger(runId) || runId <= 0) return null;

  const label = `run ${runId}`;
  const parts = repository.split("/");
  const [owner, repo] = parts;
  if (
    parts.length !== 2 ||
    !owner ||
    !repo ||
    /[^a-z0-9-]/i.test(owner) ||
    owner.startsWith("-") ||
    owner.endsWith("-") ||
    /[^a-z0-9_.-]/i.test(repo) ||
    repo === "." ||
    repo === ".."
  ) {
    return { label, href: null };
  }
  return { label, href: `https://github.com/${owner}/${repo}/actions/runs/${runId}` };
}
