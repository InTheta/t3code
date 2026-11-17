/** Isolated operator-only access to the loopback brief approval service. */
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

const ticket = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/));
const reviewBody = Schema.Struct({ ticket });
const approveBody = Schema.Struct({
  ticket,
  revision: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
});

function isolatedConfig() {
  return {
    port: Number(process.env.T3CODE_ISOLATED_APPROVAL_PORT),
    token: process.env.T3CODE_ISOLATED_APPROVAL_TOKEN,
    operator: process.env.T3CODE_ISOLATED_APPROVAL_SUBJECT,
  };
}

const route = (action: "review" | "approve") =>
  HttpRouter.add(
    "POST",
    `/api/isolated-approval/v1/${action}`,
    Effect.gen(function* () {
      const { port, token, operator } = isolatedConfig();
      if (!Number.isInteger(port) || port < 1 || port > 65535 || !token || !operator) {
        return HttpServerResponse.empty({ status: 404 });
      }

      const request = yield* HttpServerRequest.HttpServerRequest;
      if (!/^Bearer \S+$/i.test(request.headers.authorization ?? "")) {
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
      const schema = action === "review" ? reviewBody : approveBody;
      const input = Schema.decodeUnknownOption(schema)(body.value);
      if (Option.isNone(input)) {
        return HttpServerResponse.empty({ status: 400 });
      }
      const client = yield* HttpClient.HttpClient;
      const response = yield* HttpClientRequest.post(
        `http://127.0.0.1:${port}/isolated-approval/v1/${action}`,
      ).pipe(
        HttpClientRequest.setHeader("authorization", `Bearer ${token}`),
        HttpClientRequest.bodyJson(input.value),
        Effect.flatMap((outbound) => client.execute(outbound)),
        Effect.flatMap((result) =>
          Effect.map(result.text, (body) => ({ status: result.status, body })),
        ),
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
        Effect.timeout("15 seconds"),
        Effect.option,
      );
      if (Option.isNone(response) || ![200, 409].includes(response.value.status)) {
        return HttpServerResponse.empty({ status: 502, headers: { "cache-control": "no-store" } });
      }
      return HttpServerResponse.text(response.value.body, {
        status: response.value.status,
        contentType: "application/json",
        headers: { "cache-control": "no-store" },
      });
    }),
  );

export const layer = Layer.mergeAll(route("review"), route("approve"));
