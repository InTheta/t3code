/** Isolated operator-only access to the loopback brief approval service. */
import {
  CommandId,
  MessageId,
  ModelSelection,
  ProjectId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";

import { EnvironmentAuth } from "./auth/EnvironmentAuth.ts";
import { ThreadManagementService } from "./orchestration-v2/ThreadManagementService.ts";

const ticket = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/));
const prepareBody = Schema.Struct({
  ticket,
  scope: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4000)),
});
const reviewBody = Schema.Struct({ ticket });
const revision = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const approveBody = Schema.Struct({ ticket, revision });
const uuid = "[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}";
const handoffIdentity = {
  runId: Schema.String.check(Schema.isPattern(new RegExp(`^${uuid}$`))),
  stageId: Schema.String.check(Schema.isPattern(new RegExp(`^${uuid}:(lead|implementation|qa)$`))),
};
const handoffReviewBody = Schema.Struct(handoffIdentity);
const handoffDecideBody = Schema.Struct({
  ...handoffIdentity,
  revision,
  decision: Schema.Literals(["approve", "decline"]),
});

const handoffRevision = { ...handoffIdentity, revision };
const continuationPermit = Schema.Struct({
  ...handoffRevision,
  threadId: ThreadId,
  projectId: ProjectId,
  originalTurnId: RunId,
  modelSelection: ModelSelection,
  replacementTurnId: Schema.NullOr(RunId),
});
const continuationReceipt = Schema.Struct({
  ...handoffRevision,
  threadId: ThreadId,
  replacementTurnId: RunId,
});
const approvalReceipt = Schema.Struct({
  ...handoffRevision,
  decision: Schema.Literals(["approve"]),
});

function decodeReply<S extends Schema.ConstraintDecoder<unknown>>(schema: S, body: string) {
  return Schema.decodeOption(Schema.fromJsonString(schema))(body);
}

function isolatedConfig() {
  return {
    port: Number(process.env.T3CODE_ISOLATED_APPROVAL_PORT),
    token: process.env.T3CODE_ISOLATED_APPROVAL_TOKEN,
    operator: process.env.T3CODE_ISOLATED_APPROVAL_SUBJECT,
    continueQuota: process.env.T3CODE_ISOLATED_QUOTA_CONTINUATION === "1",
  };
}

const bodies = {
  prepare: prepareBody,
  review: reviewBody,
  approve: approveBody,
  "handoff/review": handoffReviewBody,
  "handoff/decide": handoffDecideBody,
};

const route = (action: keyof typeof bodies) =>
  HttpRouter.add(
    "POST",
    `/api/isolated-approval/v1/${action}`,
    Effect.gen(function* () {
      const { port, token, operator, continueQuota } = isolatedConfig();
      if (!Number.isInteger(port) || port < 1 || port > 65535 || !token || !operator) {
        return HttpServerResponse.empty({ status: 404 });
      }

      const request = yield* HttpServerRequest.HttpServerRequest;
      if (
        request.headers.cookie !== undefined ||
        !/^Bearer \S+$/i.test(request.headers.authorization ?? "")
      ) {
        return HttpServerResponse.empty({ status: 401 });
      }
      const auth = yield* EnvironmentAuth;
      const session = yield* auth.authenticateHttpRequest(request).pipe(Effect.option);
      if (Option.isNone(session)) {
        return HttpServerResponse.empty({ status: 401 });
      }
      if (
        session.value.subject !== operator ||
        !session.value.scopes.includes("orchestration:operate")
      ) {
        return HttpServerResponse.empty({ status: 403 });
      }

      const length = Number(request.headers["content-length"]);
      if (
        !Number.isInteger(length) ||
        length < 1 ||
        length > 8192 ||
        request.headers["content-encoding"] !== undefined ||
        request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json"
      ) {
        return HttpServerResponse.empty({ status: 400 });
      }
      const body = yield* request.json.pipe(Effect.option);
      if (Option.isNone(body)) {
        return HttpServerResponse.empty({ status: 400 });
      }
      const schema = bodies[action];
      const input = Schema.decodeUnknownOption(schema)(body.value);
      if (Option.isNone(input)) {
        return HttpServerResponse.empty({ status: 400 });
      }
      const client = yield* HttpClient.HttpClient;
      const forward = (action: string, body: unknown) =>
        HttpClientRequest.post(`http://127.0.0.1:${port}/isolated-approval/v1/${action}`).pipe(
          HttpClientRequest.setHeader("authorization", `Bearer ${token}`),
          HttpClientRequest.bodyJson(body),
          Effect.flatMap((outbound) => client.execute(outbound)),
          Effect.flatMap((result) =>
            Effect.map(result.text, (body) => ({ status: result.status, body })),
          ),
          Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
          Effect.timeout("15 seconds"),
          Effect.option,
        );
      const response = yield* forward(action, input.value);
      if (Option.isNone(response) || ![200, 400, 404, 409].includes(response.value.status)) {
        return HttpServerResponse.empty({ status: 502, headers: { "cache-control": "no-store" } });
      }
      if (action === "handoff/decide" && continueQuota && response.value.status === 200) {
        const requested = Schema.decodeUnknownOption(handoffDecideBody)(input.value);
        if (Option.isSome(requested) && requested.value.decision === "approve") {
          const { runId, stageId, revision } = requested.value;
          const identity = { runId, stageId, revision };
          const matches = (value: typeof identity) =>
            value.runId === runId && value.stageId === stageId && value.revision === revision;
          const unavailable = () =>
            HttpServerResponse.empty({
              status: 502,
              headers: { "cache-control": "no-store" },
            });
          const decision = decodeReply(approvalReceipt, response.value.body);
          if (Option.isNone(decision) || !matches(decision.value)) return unavailable();
          const authorization = yield* forward("handoff/continuation", identity);
          if (Option.isNone(authorization) || authorization.value.status !== 200)
            return unavailable();
          const permit = decodeReply(continuationPermit, authorization.value.body);
          if (Option.isNone(permit) || !matches(permit.value)) return unavailable();
          const { threadId, projectId, originalTurnId, modelSelection, replacementTurnId } =
            permit.value;
          if (replacementTurnId === originalTurnId) return unavailable();
          let turnId = replacementTurnId;
          if (turnId === null) {
            const threads = yield* ThreadManagementService;
            const continued = yield* threads
              .sendToThread({
                threadId,
                projectId,
                commandId: CommandId.make(`isolated-quota:${revision}`),
                messageId: MessageId.make(`isolated-quota:${revision}`),
                manualContinuationOfRunId: originalTurnId,
                modelSelection,
                text: "",
                attachments: [],
                mode: "auto",
                createdBy: "user",
                creationSource: "web",
              })
              .pipe(Effect.option);
            if (
              Option.isNone(continued) ||
              continued.value.run.threadId !== threadId ||
              continued.value.run.manualContinuationOfRunId !== originalTurnId ||
              continued.value.run.id === originalTurnId
            )
              return unavailable();
            turnId = continued.value.run.id;
            const persisted = yield* forward("handoff/receipt", { ...identity, threadId, turnId });
            if (Option.isNone(persisted) || persisted.value.status !== 200) return unavailable();
            const receipt = decodeReply(continuationReceipt, persisted.value.body);
            if (
              Option.isNone(receipt) ||
              !matches(receipt.value) ||
              receipt.value.threadId !== threadId ||
              receipt.value.replacementTurnId !== turnId
            ) {
              return unavailable();
            }
          }
          return HttpServerResponse.jsonUnsafe(
            { ...identity, decision: "approve", replacementTurnId: turnId },
            { headers: { "cache-control": "no-store" } },
          );
        }
      }
      return HttpServerResponse.text(response.value.body, {
        status: response.value.status,
        contentType: "application/json",
        headers: { "cache-control": "no-store" },
      });
    }),
  );

export const layer = Layer.mergeAll(
  route("prepare"),
  route("review"),
  route("approve"),
  route("handoff/review"),
  route("handoff/decide"),
);
