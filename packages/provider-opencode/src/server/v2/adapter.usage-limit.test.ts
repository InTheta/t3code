import { describe, expect, it } from "vite-plus/test";

import { isUsageLimit } from "./adapter.ts";

describe("OpenCode provider usage limits", () => {
  it.each(["provider.go-limit", "provider.free-limit", "provider.chatgpt-limit"])(
    "classifies terminal %s as a usage limit",
    (type) => {
      expect(
        isUsageLimit({
          type,
          status: 429,
          message: "Provider usage window exhausted",
        }),
      ).toBe(true);
    },
  );

  it("preserves the distinction between a quota window and missing credits", () => {
    expect(isUsageLimit({ type: "provider.quota", status: 429, message: "Quota exceeded" })).toBe(
      true,
    );
    expect(
      isUsageLimit({ type: "provider.quota", status: 402, message: "Insufficient credits" }),
    ).toBe(false);
  });
});
