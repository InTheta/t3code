# Delivery

Open **Delivery** in the sidebar and enter a ticket identifier. The page reads the current pull
request head and the evidence for the commit that CI actually checked. Use **Refresh** after a push.
A passing run for an earlier commit is shown as stale. The independently reviewed patch and the
current pull request head are displayed separately.

The page expects a deployment-provided, same-origin read endpoint at
`GET /delivery-sidecar/v1/{ticket}`. An installation without an endpoint shows an unavailable
state. The endpoint should authorize the current reader, return current evidence on every read and
send `Cache-Control: no-store`. The page never sends mutations or provider credentials.

A version 1 response contains `version: 1`, `ticket`, `owner`, and `stage`, plus:

| Field            | Content                                                                        |
| ---------------- | ------------------------------------------------------------------------------ |
| `pullRequest`    | `number`, HTTPS `url`, and the full `head` SHA                                 |
| `ci`             | `status` and the full `head` SHA when evidence exists                          |
| `implementation` | `patchSha`, `model`, `effort`, `reserved` tokens, and `metered` tokens or null |
| `qa`             | `verdict`, `threadId`, and `traceId`                                           |

For a Vite development session, set T3CODE_DELIVERY_PROXY_URL to the URL of your read service.
For a deployed frontend, configure the same-origin route in your hosting or reverse proxy setup.

### Managed runs

Enter a managed run UUID in Delivery, or open `/delivery?run=<UUID>`. The isolated sidecar
must expose `GET /delivery-sidecar/v1/managed-runs/<UUID>` through the existing Delivery proxy.
Delivery shows the recorded brief revision, repository, base commit, scope, reservation, and
stages. Unknown token usage stays unknown. This view has no approval or dispatch controls.
Use Provider Settings and Usage to inspect providers in the current T3 environment.
