import * as Schema from "effect/Schema";
import { readDesktopPrimaryBearerToken } from "~/environments/primary/desktopAuth";
import { resolvePrimaryEnvironmentHttpUrl } from "~/environments/primary/target";

const isErrorResponse = Schema.is(Schema.Struct({ error: Schema.String }));

export async function postApproval(
  action: "prepare" | "review" | "approve" | "handoff/review" | "handoff/decide",
  input: Readonly<Record<string, string>>,
): Promise<unknown> {
  const token = await readDesktopPrimaryBearerToken();
  if (!token) throw new Error("Sign in to the local desktop environment.");
  const response = await fetch(
    resolvePrimaryEnvironmentHttpUrl(`/api/isolated-approval/v1/${action}`),
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(input),
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
    },
  );
  if (response.status === 400 || response.status === 409) {
    const value: unknown = await response.json().catch(() => undefined);
    throw new Error(
      isErrorResponse(value) ? value.error : "Review the latest proposal and try again.",
    );
  }
  if (response.status === 404)
    throw new Error(
      action === "prepare"
        ? "Draft preparation is disabled in this environment."
        : "Isolated approval is disabled in this environment.",
    );
  if (response.status === 401 || response.status === 403) {
    throw new Error("This session cannot approve isolated runs.");
  }
  if (!response.ok) throw new Error("The isolated approval service is unavailable.");
  return response.json();
}
