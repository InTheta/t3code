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
