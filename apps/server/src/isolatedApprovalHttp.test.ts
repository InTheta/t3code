import { AuthSessionId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { FetchHttpClient, HttpRouter } from "effect/http";
import { expect, it, vi } from "vite-plus/test";

import { EnvironmentAuth } from "./auth/EnvironmentAuth.ts";
import { layer } from "./isolatedApprovalHttp.ts";

it("forwards only explicit approvals from the configured authenticated operator", async () => {
  vi.stubEnv("T3CODE_ISOLATED_APPROVAL_PORT", "45678");
  vi.stubEnv("T3CODE_ISOLATED_APPROVAL_TOKEN", "sidecar-test-token");
  vi.stubEnv("T3CODE_ISOLATED_APPROVAL_SUBJECT", "operator");
  let subject = "different-account";
  const upstream = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json({ runId: "existing-run", revision: "a".repeat(64) }));
  const { handler, dispose } = HttpRouter.toWebHandler(
    layer.pipe(
      Layer.provideMerge(FetchHttpClient.layer),
      Layer.provideMerge(
        Layer.mock(EnvironmentAuth)({
          authenticateHttpRequest: () =>
            Effect.succeed({
              sessionId: AuthSessionId.make("fixture-session"),
              subject,
              method: "bearer-access-token",
              scopes: ["orchestration:operate"],
            }),
        }),
      ),
    ),
    { disableLogger: true },
  );
  try {
    const send = (body: string, auth?: string) =>
      handler(
        new Request("http://localhost/api/isolated-approval/v1/approve", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": String(body.length),
            ...(auth ? { authorization: auth } : {}),
          },
          body,
        }),
      );
    const body = JSON.stringify({ ticket: "fixture", revision: "a".repeat(64) });
    expect((await send(body)).status).toBe(401);
    expect((await send(body, "Bearer t3-session")).status).toBe(403);
    subject = "operator";
    expect((await send("{}", "Bearer t3-session")).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
    expect((await send(body, "Bearer t3-session")).status).toBe(200);
    const [url, forwarded] = upstream.mock.calls[0] ?? [];
    expect(String(url)).toBe("http://127.0.0.1:45678/isolated-approval/v1/approve");
    expect(forwarded?.redirect).toBe("error");
    expect(new Headers(forwarded?.headers).get("authorization")).toBe("Bearer sidecar-test-token");
    expect(forwarded?.body).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(forwarded?.body as Uint8Array<ArrayBuffer>)).toBe(body);
  } finally {
    await dispose();
    upstream.mockRestore();
    vi.unstubAllEnvs();
  }
});
