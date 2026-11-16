import { describe, expect, it } from "vite-plus/test";

import { deliveryCiRun } from "./deliveryPullRequest";

describe("deliveryCiRun", () => {
  it("builds a GitHub Actions URL for a positive numeric run ID", () => {
    expect(deliveryCiRun("InTheta-tools/t3.code_fork", 43_772_162_509)).toEqual({
      label: "run 43772162509",
      href: "https://github.com/InTheta-tools/t3.code_fork/actions/runs/43772162509",
    });
  });

  it.each([undefined, null, "123", 0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid run ID %s",
    (runId) => {
      expect(deliveryCiRun("InTheta/t3code", runId)).toBeNull();
    },
  );

  it.each([
    "",
    "InTheta",
    "/t3code",
    "InTheta/",
    "./t3code",
    "../t3code",
    "InTheta/.",
    "InTheta/..",
    "InTheta/%2e%2e",
    "InTheta/t3code/actions",
    "InTheta//t3code",
    "InTheta/t3code?x",
    "InTheta/t3code#x",
    "InTheta/t3code\n",
    "InTheta\\other/t3code",
    "https://example.org/t3code",
    "//example.org/t3code",
    "example.org/t3code",
    "github.com@example.org/t3code",
  ])("keeps the run label without a link for invalid repository path %j", (repository) => {
    expect(deliveryCiRun(repository, 123)).toEqual({ label: "run 123", href: null });
  });
});
