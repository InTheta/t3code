import { readDesktopPrimaryBearerToken } from "~/environments/primary/desktopAuth";
import { resolvePrimaryEnvironmentHttpUrl } from "~/environments/primary/target";

async function sidecarRequest(
  path: string,
  request: RequestInit,
  headers: Record<string, string> = {},
): Promise<Response> {
  if (typeof window === "undefined" || !window.desktopBridge || import.meta.env.DEV) {
    return fetch(path, Object.keys(headers).length > 0 ? { ...request, headers } : request);
  }

  const url = resolvePrimaryEnvironmentHttpUrl(path);
  const token = await readDesktopPrimaryBearerToken();
  return fetch(url, {
    ...request,
    credentials: "omit",
    redirect: "error",
    headers: { ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
}

export async function fetchDeliverySidecar(path: string, signal: AbortSignal): Promise<Response> {
  return sidecarRequest(path, { cache: "no-store", signal });
}

/** Send a small JSON document to the sidecar (the server only allows this for operators). */
export async function sendDeliverySidecar(
  path: string,
  body: string,
  signal: AbortSignal,
): Promise<Response> {
  return sidecarRequest(
    path,
    { method: "PUT", body, cache: "no-store", signal },
    { "Content-Type": "application/json" },
  );
}
