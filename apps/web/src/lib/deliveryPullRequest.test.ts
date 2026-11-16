import { describe, expect, it } from "vite-plus/test";

import { deliveryCiRunUrl } from "./deliveryPullRequest";

describe("deliveryCiRunUrl", () => {
  it("builds a GitHub Actions URL for a positive numeric run ID", () => {
    expect(deliveryCiRunUrl("InTheta-tools/t3.code_fork", 43_772_162_509)).toBe(
      "https://github.com/InTheta-tools/t3.code_fork/actions/runs/43772162509",
    );
  });

  it.each([undefined, null, "123", 0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid run ID %s",
    (runId) => {
      expect(deliveryCiRunUrl("InTheta/t3code", runId)).toBeNull();
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
  ])("rejects invalid repository path %j", (repository) => {
    expect(deliveryCiRunUrl(repository, 123)).toBeNull();
  });
});
