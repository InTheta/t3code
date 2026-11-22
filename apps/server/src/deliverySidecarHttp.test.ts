import { AuthSessionId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { FetchHttpClient, HttpRouter } from "effect/http";
import { expect, it, vi } from "vite-plus/test";

// The HTTP client keeps the first fetch function it sees, so the spy is shared by every test.
const upstream = vi.spyOn(globalThis, "fetch");

import { EnvironmentAuth } from "./auth/EnvironmentAuth.ts";
import { layer } from "./deliverySidecarHttp.ts";

it("reads approved Delivery resources without forwarding client credentials", async () => {
  vi.stubEnv("T3CODE_DELIVERY_SIDECAR_PORT", "45678");
  upstream.mockReset();
  upstream.mockImplementation(async () => Response.json({ version: 1 }));
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
    vi.unstubAllEnvs();
  }
});

it("serves sidecar status reads and writes retention only for operators", async () => {
  vi.stubEnv("T3CODE_DELIVERY_SIDECAR_PORT", "45678");
  upstream.mockReset();
  upstream.mockImplementation(async (_url, init) =>
    init?.method === "PUT"
      ? new Response(JSON.stringify({ policy: { snapshot_days: 3 } }), {
          status: String(init.body).includes("bad") ? 400 : 200,
        })
      : Response.json({ version: 1 }),
  );
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
              scopes:
                request.headers.authorization === "Bearer operator"
                  ? ["orchestration:read", "orchestration:operate"]
                  : request.headers.authorization
                    ? ["orchestration:read"]
                    : [],
            }),
        }),
      ),
    ),
    { disableLogger: true },
  );
  const base = "http://localhost/delivery-sidecar/v1/sidecar/";
  const put = (token: string, body: string, type = "application/json", origin?: string) =>
    handler(
      new Request(`${base}retention`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": type,
          "content-length": String(new TextEncoder().encode(body).length),
          ...(origin ? { origin } : {}),
        },
        body,
      }),
    );
  try {
    for (const name of [
      "status",
      "retention",
      "overview",
      "inbox",
      "quality",
      "provenance/00000000-0000-0000-0000-000000000000",
      "retention/proposals",
    ]) {
      const response = await handler(
        new Request(`${base}${name}`, { headers: { authorization: "Bearer reader" } }),
      );
      expect(response.status).toBe(200);
    }
    expect(
      (await handler(new Request(`${base}other`, { headers: { authorization: "Bearer reader" } })))
        .status,
    ).toBe(404);
    expect(upstream).toHaveBeenCalledTimes(7);

    expect((await put("reader", '{"snapshot_days":3}')).status).toBe(403);
    expect(
      (await handler(new Request(`${base}retention`, { method: "PUT", body: "{}" }))).status,
    ).toBe(403);
    expect((await put("operator", '{"snapshot_days":3}', "text/plain")).status).toBe(400);
    expect((await put("operator", "[1]")).status).toBe(400);
    expect((await put("operator", "x".repeat(5000))).status).toBe(400);
    expect(upstream).toHaveBeenCalledTimes(7);

    const ok = await put(
      "operator",
      '{"snapshot_days":3}',
      "application/json",
      "https://evil.example",
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ policy: { snapshot_days: 3 } });
    const [url, init] = upstream.mock.calls[7] ?? [];
    expect(String(url)).toBe("http://127.0.0.1:45678/delivery-sidecar/v1/sidecar/retention");
    expect(init?.method).toBe("PUT");
    const sent = new Headers(init?.headers);
    expect(sent.get("authorization")).toBeNull();
    expect(sent.get("origin")).toBeNull();
    expect(sent.get("cookie")).toBeNull();

    const decide = (token: string, id: string) =>
      handler(
        new Request(`${base}retention/proposals/${id}`, {
          method: "PUT",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "content-length": "22",
          },
          body: '{"decision":"approve"}',
        }),
      );
    expect((await decide("reader", "a".repeat(16))).status).toBe(403);
    expect((await decide("operator", "zz")).status).toBe(404);
    expect((await decide("operator", "a".repeat(16))).status).toBe(200);
    const [decisionUrl, decisionInit] = upstream.mock.calls[8] ?? [];
    expect(String(decisionUrl)).toBe(
      `http://127.0.0.1:45678/delivery-sidecar/v1/sidecar/retention/proposals/${"a".repeat(16)}`,
    );
    expect(new Headers(decisionInit?.headers).get("x-operator-subject")).toBe("fixture");
    expect(new Headers(decisionInit?.headers).get("authorization")).toBeNull();

    const decideRequest = (id: string) =>
      handler(
        new Request(`${base}needs-human/${id}`, {
          method: "PUT",
          headers: {
            authorization: "Bearer operator",
            "content-type": "application/json",
            "content-length": "22",
          },
          body: '{"decision":"resolve"}',
        }),
      );
    expect((await decideRequest("zz")).status).toBe(404);
    expect((await decideRequest("b".repeat(16))).status).toBe(200);
    const [requestUrl, requestInit] = upstream.mock.calls[9] ?? [];
    expect(String(requestUrl)).toBe(
      `http://127.0.0.1:45678/delivery-sidecar/v1/sidecar/needs-human/${"b".repeat(16)}`,
    );
    expect(new Headers(requestInit?.headers).get("x-operator-subject")).toBe("fixture");
    // Agents register tracks and raise requests on the host's loopback; the browser cannot.
    const agentWrite = (resource: string) =>
      handler(
        new Request(`${base}${resource}`, {
          method: "PUT",
          headers: {
            authorization: "Bearer operator",
            "content-type": "application/json",
            "content-length": "2",
          },
          body: "{}",
        }),
      );
    expect((await agentWrite("needs-human")).status).toBe(404);
    expect((await agentWrite("tracks/GH-327")).status).toBe(404);
    for (const resource of ["tracks", "tracks/GH-327", "needs-human"]) {
      expect(
        (
          await handler(
            new Request(`${base}${resource}`, { headers: { authorization: "Bearer reader" } }),
          )
        ).status,
      ).toBe(200);
    }

    expect((await put("operator", '{"bad":1}')).status).toBe(400);
    vi.stubEnv("T3CODE_DELIVERY_SIDECAR_PORT", "");
    expect((await put("operator", '{"snapshot_days":3}')).status).toBe(404);
  } finally {
    await dispose();
    vi.unstubAllEnvs();
  }
});
