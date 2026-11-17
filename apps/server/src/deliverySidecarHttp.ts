import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";

import { EnvironmentAuth } from "./auth/EnvironmentAuth.ts";

const prefix = "/delivery-sidecar/v1/";
const ticket = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const pullRequest = /^pull-requests\/[a-z0-9-]+\/(?!\.{1,2}\/)[a-z0-9_.-]+\/[1-9][0-9]*$/i;
const managedRun = /^managed-runs\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const headers = { "cache-control": "no-store" };

function configuredPort() {
  return Number(process.env.T3CODE_DELIVERY_SIDECAR_PORT);
}

export const layer = HttpRouter.add(
  "GET",
  "/delivery-sidecar/v1/*",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const path = new URL(request.url, "http://127.0.0.1").pathname;
    const resource = path.slice(prefix.length);
    const port = configuredPort();
    if (
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535 ||
      !path.startsWith(prefix) ||
      !(ticket.test(resource) || pullRequest.test(resource) || managedRun.test(resource))
    ) {
      return HttpServerResponse.empty({ status: 404, headers });
    }

    const auth = yield* EnvironmentAuth;
    const session = yield* auth.authenticateHttpRequest(request).pipe(Effect.option);
    if (Option.isNone(session)) {
      return HttpServerResponse.empty({ status: 401, headers });
    }
    if (!session.value.scopes.includes("orchestration:read")) {
      return HttpServerResponse.empty({ status: 403, headers });
    }

    const client = yield* HttpClient.HttpClient;
    const response = yield* client
      .execute(HttpClientRequest.get(`http://127.0.0.1:${port}${prefix}${resource}`))
      .pipe(
        Effect.flatMap((result) =>
          result.status === 200
            ? Effect.map(result.json, (body) => ({ status: result.status, body }))
            : Effect.succeed({ status: result.status, body: null }),
        ),
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
        Effect.timeout("15 seconds"),
        Effect.option,
      );
    if (Option.isNone(response) || ![200, 404].includes(response.value.status)) {
      return HttpServerResponse.empty({ status: 502, headers });
    }
    if (response.value.status === 404) {
      return HttpServerResponse.empty({ status: 404, headers });
    }
    return HttpServerResponse.jsonUnsafe(response.value.body, { headers });
  }),
);
