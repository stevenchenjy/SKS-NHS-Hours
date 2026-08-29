import { describe, expect, it } from "vitest";

import { safeInternalPath } from "./safe-navigation";

describe("safeInternalPath", () => {
  it.each([
    ["/dashboard", "/dashboard"],
    ["/hours/123?notice=saved#top", "/hours/123?notice=saved#top"],
    [null, "/dashboard"],
    ["https://evil.example", "/dashboard"],
    ["//evil.example", "/dashboard"],
    ["/\\evil.example", "/dashboard"],
    ["/%5cevil.example", "/dashboard"],
    ["dashboard", "/dashboard"],
  ])("normalizes %p", (value, expected) => {
    expect(safeInternalPath(value)).toBe(expected);
  });

  it("supports a caller-provided fallback", () => {
    expect(safeInternalPath("//evil.example", "/login")).toBe("/login");
  });
});
