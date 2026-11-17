import { readDesktopPrimaryBearerToken } from "~/environments/primary/desktopAuth";
import { resolvePrimaryEnvironmentHttpUrl } from "~/environments/primary/target";

export async function fetchDeliverySidecar(path: string, signal: AbortSignal): Promise<Response> {
  const request = { cache: "no-store", signal } as const;
  if (typeof window === "undefined" || !window.desktopBridge || import.meta.env.DEV) {
    return fetch(path, request);
  }

  const url = resolvePrimaryEnvironmentHttpUrl(path);
  const token = await readDesktopPrimaryBearerToken();
  return fetch(url, {
    ...request,
    credentials: "omit",
    redirect: "error",
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  });
}
