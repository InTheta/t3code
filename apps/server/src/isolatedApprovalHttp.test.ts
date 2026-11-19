import { AuthSessionId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { FetchHttpClient, HttpRouter } from "effect/http";
import { expect, it, vi } from "vite-plus/test";

import { EnvironmentAuth } from "./auth/EnvironmentAuth.ts";
import { layer } from "./isolatedApprovalHttp.ts";
import {
  ThreadManagementService,
  type ThreadManagementSendResult,
} from "./orchestration-v2/ThreadManagementService.ts";

it("forwards only explicit approvals from the configured authenticated operator", async () => {
  vi.stubEnv("T3CODE_ISOLATED_APPROVAL_PORT", "45678");
  vi.stubEnv("T3CODE_ISOLATED_APPROVAL_TOKEN", "sidecar-test-token");
  vi.stubEnv("T3CODE_ISOLATED_APPROVAL_SUBJECT", "operator");
  let subject = "different-account";
  const sendToThread = vi.fn(
    (input: Parameters<ThreadManagementService["Service"]["sendToThread"]>[0]) =>
      Effect.succeed({
        run: {
          threadId: input.threadId,
          id: "new-turn",
          manualContinuationOfRunId: input.manualContinuationOfRunId,
        },
      } as ThreadManagementSendResult),
  );
  const upstream = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () =>
      Response.json({ runId: "existing-run", revision: "a".repeat(64) }),
    );
  const { handler, dispose } = HttpRouter.toWebHandler(
    layer.pipe(
      Layer.provideMerge(FetchHttpClient.layer),
      Layer.provideMerge(Layer.mock(ThreadManagementService)({ sendToThread })),
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
    const send = (body: string, auth?: string, cookie?: string, action = "approve") =>
      handler(
        new Request(`http://localhost/api/isolated-approval/v1/${action}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": String(body.length),
            ...(auth ? { authorization: auth } : {}),
            ...(cookie ? { cookie } : {}),
          },
          body,
        }),
      );
    const body = JSON.stringify({ ticket: "fixture", revision: "a".repeat(64) });
    expect((await send(body)).status).toBe(401);
    expect((await send(body, "Bearer t3-session")).status).toBe(403);
    subject = "operator";
    expect((await send(body, "Bearer t3-session", "session=fixture")).status).toBe(401);
    expect((await send("{}", "Bearer t3-session")).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
    expect((await send(body, "Bearer t3-session")).status).toBe(200);
    const [url, forwarded] = upstream.mock.calls[0] ?? [];
    expect(String(url)).toBe("http://127.0.0.1:45678/isolated-approval/v1/approve");
    expect(forwarded?.redirect).toBe("error");
    expect(new Headers(forwarded?.headers).get("authorization")).toBe("Bearer sidecar-test-token");
    expect(forwarded?.body).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(forwarded?.body as Uint8Array<ArrayBuffer>)).toBe(body);
    const draft = JSON.stringify({ ticket: "fixture", scope: "Update fixture" });
    expect((await send(draft, "Bearer t3-session", undefined, "prepare")).status).toBe(200);
    const [prepareUrl, prepared] = upstream.mock.calls[1] ?? [];
    expect(String(prepareUrl)).toBe("http://127.0.0.1:45678/isolated-approval/v1/prepare");
    expect(new TextDecoder().decode(prepared?.body as Uint8Array<ArrayBuffer>)).toBe(draft);
    const runId = "537729d4-a075-4bed-9fd7-8a63eb4cb0bd";
    const handoff = JSON.stringify({
      runId,
      stageId: `${runId}:implementation`,
      revision: "b".repeat(64),
      decision: "decline",
    });
    subject = "scheduler";
    expect((await send(handoff, "Bearer t3-session", undefined, "handoff/decide")).status).toBe(
      403,
    );
    subject = "operator";
    expect(
      (
        await send(
          handoff.replace("decline", "auto"),
          "Bearer t3-session",
          undefined,
          "handoff/decide",
        )
      ).status,
    ).toBe(400);
    expect(upstream).toHaveBeenCalledTimes(2);
    expect((await send(handoff, "Bearer t3-session", undefined, "handoff/decide")).status).toBe(
      200,
    );
    const [handoffUrl, decision] = upstream.mock.calls[2] ?? [];
    expect(String(handoffUrl)).toBe("http://127.0.0.1:45678/isolated-approval/v1/handoff/decide");
    expect(new TextDecoder().decode(decision?.body as Uint8Array<ArrayBuffer>)).toBe(handoff);

    vi.stubEnv("T3CODE_ISOLATED_QUOTA_CONTINUATION", "1");
    const identity = { runId, stageId: `${runId}:implementation`, revision: "b".repeat(64) };
    const approval = { ...identity, decision: "approve" };
    const modelSelection = { instanceId: "codex-replacement", model: "codex-test" };
    let recordedTurn: string | null = null;
    let droppedReceipt = true;
    upstream.mockImplementation(async (url) => {
      if (String(url).endsWith("/decide")) return Response.json(approval);
      if (String(url).endsWith("/continuation")) {
        return Response.json({
          ...identity,
          threadId: "isolated-thread",
          projectId: "isolated-project",
          originalTurnId: "old-turn",
          modelSelection,
          replacementTurnId: recordedTurn,
        });
      }
      if (String(url).endsWith("/receipt")) {
        if (droppedReceipt) {
          droppedReceipt = false;
          return Response.json({}, { status: 503 });
        }
        recordedTurn = "new-turn";
        return Response.json({
          ...identity,
          threadId: "isolated-thread",
          replacementTurnId: recordedTurn,
        });
      }
      throw new Error("Unexpected request");
    });
    const approve = () =>
      send(JSON.stringify(approval), "Bearer t3-session", undefined, "handoff/decide");
    expect((await approve()).status).toBe(502);
    expect(await (await approve()).json()).toEqual({ ...approval, replacementTurnId: "new-turn" });
    expect(await (await approve()).json()).toEqual({ ...approval, replacementTurnId: "new-turn" });
    expect(sendToThread).toHaveBeenCalledTimes(2);
    expect(sendToThread.mock.calls[0]).toEqual(sendToThread.mock.calls[1]);
    expect(sendToThread.mock.calls[0]?.[0]).toMatchObject({
      commandId: `isolated-quota:${identity.revision}`,
      messageId: `isolated-quota:${identity.revision}`,
      projectId: "isolated-project",
      threadId: "isolated-thread",
      manualContinuationOfRunId: "old-turn",
      modelSelection,
    });
  } finally {
    await dispose();
    upstream.mockRestore();
    vi.unstubAllEnvs();
  }
});
