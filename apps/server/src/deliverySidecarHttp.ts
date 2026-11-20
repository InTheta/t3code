import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
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
const sidecarRead = /^sidecar\/(?:status|retention|overview|inbox|retention\/proposals)$/;
const sidecarWrite = /^sidecar\/retention(?:\/proposals(?:\/[0-9a-f]{16})?)?$/;
const maxPolicyBody = 4096;
const headers = { "cache-control": "no-store" };

function configuredPort() {
  return Number(process.env.T3CODE_DELIVERY_SIDECAR_PORT);
}

function validPort(port: number) {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

const read = HttpRouter.add(
  "GET",
  "/delivery-sidecar/v1/*",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const path = new URL(request.url, "http://127.0.0.1").pathname;
    const resource = path.slice(prefix.length);
    const port = configuredPort();
    if (
      !validPort(port) ||
      !path.startsWith(prefix) ||
      !(
        ticket.test(resource) ||
        pullRequest.test(resource) ||
        managedRun.test(resource) ||
        sidecarRead.test(resource)
      )
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

/** Changing the sidecar retention policy or deciding a cleanup proposal is an operator action; neither deletes anything. */
const writeSidecar = Effect.gen(function* () {
  const port = configuredPort();
  const request = yield* HttpServerRequest.HttpServerRequest;
  const path = new URL(request.url, "http://127.0.0.1").pathname;
  const resource = path.slice(prefix.length);
  if (!validPort(port) || !path.startsWith(prefix) || !sidecarWrite.test(resource)) {
    return HttpServerResponse.empty({ status: 404, headers });
  }
  const auth = yield* EnvironmentAuth;
  const session = yield* auth.authenticateHttpRequest(request).pipe(Effect.option);
  if (Option.isNone(session)) {
    return HttpServerResponse.empty({ status: 401, headers });
  }
  if (!session.value.scopes.includes("orchestration:operate")) {
    return HttpServerResponse.empty({ status: 403, headers });
  }
  const length = Number(request.headers["content-length"]);
  if (
    !Number.isInteger(length) ||
    length < 2 ||
    length > maxPolicyBody ||
    request.headers["content-encoding"] !== undefined ||
    request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json"
  ) {
    return HttpServerResponse.empty({ status: 400, headers });
  }
  const body = yield* request.json.pipe(Effect.option);
  if (
    Option.isNone(body) ||
    typeof body.value !== "object" ||
    body.value === null ||
    Array.isArray(body.value)
  ) {
    return HttpServerResponse.empty({ status: 400, headers });
  }
  const client = yield* HttpClient.HttpClient;
  const response = yield* HttpClientRequest.put(
    `http://127.0.0.1:${port}${prefix}${resource}`,
  ).pipe(
    // The sidecar records who decided from this header; the browser cannot set it.
    HttpClientRequest.setHeader("x-operator-subject", session.value.subject.slice(0, 64)),
    HttpClientRequest.bodyJson(body.value),
    Effect.flatMap((outbound) => client.execute(outbound)),
    Effect.flatMap((result) =>
      Effect.map(result.text, (text) => ({ status: result.status, text })),
    ),
    Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
    Effect.timeout("15 seconds"),
    Effect.option,
  );
  if (Option.isNone(response) || ![200, 400].includes(response.value.status)) {
    return HttpServerResponse.empty({ status: 502, headers });
  }
  return HttpServerResponse.text(response.value.text, {
    status: response.value.status,
    contentType: "application/json",
    headers,
  });
});

const writeRoutes = HttpRouter.add("PUT", `${prefix}sidecar/*`, writeSidecar);

export const layer = Layer.mergeAll(read, writeRoutes);
