import { AuthSessionId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { FetchHttpClient, HttpRouter } from "effect/http";
import { expect, it, vi } from "vite-plus/test";

import { EnvironmentAuth } from "./auth/EnvironmentAuth.ts";
import { layer } from "./deliverySidecarHttp.ts";

it("reads approved Delivery resources without forwarding client credentials", async () => {
  vi.stubEnv("T3CODE_DELIVERY_SIDECAR_PORT", "45678");
  const upstream = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () => Response.json({ version: 1 }));
  const { handler, dispose } = HttpRouter.toWebHandler(
    layer.pipe(
      Layer.provideMerge(FetchHttpClient.layer),
      Layer.provideMerge(
        Layer.mock(EnvironmentAuth)({
          authenticateHttpRequest: (request) =>
            Effect.succeed({
              sessionId: AuthSessionId.make("fixture-session"),
              subject: "fixture",
              method: "bearer-access-token",
              scopes: request.headers.authorization ? ["orchestration:read"] : [],
            }),
        }),
      ),
    ),
    { disableLogger: true },
  );
  const prefix = "/delivery-sidecar/v1/";
  const resource = "pull-requests/InTheta/omni-symphony-canary/340";
  const send = (path: string, method = "GET", authenticated = true) =>
    handler(
      new Request(`http://localhost${prefix}${path}`, {
        method,
        headers: authenticated
          ? { authorization: "Bearer t3-session", cookie: "session=test" }
          : {},
      }),
    );
  try {
    expect((await send(resource, "GET", false)).status).toBe(403);
    expect((await send(resource, "POST")).status).toBe(404);
    expect((await send("pull-requests/org/repo%2Fextra/340")).status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();

    const response = await send(`${resource}?ignored=yes`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ version: 1 });
    const [url, init] = upstream.mock.calls[0] ?? [];
    expect(String(url)).toBe(`http://127.0.0.1:45678${prefix}${resource}`);
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("authorization")).toBeNull();
    expect(new Headers(init?.headers).get("cookie")).toBeNull();

    expect((await send("managed-runs/85c0326b-52e0-46dc-899d-d451c5afb228")).status).toBe(200);
    vi.stubEnv("T3CODE_DELIVERY_SIDECAR_PORT", "");
    expect((await send(resource)).status).toBe(404);
    expect(upstream).toHaveBeenCalledTimes(2);
  } finally {
    await dispose();
    upstream.mockRestore();
    vi.unstubAllEnvs();
  }
});
