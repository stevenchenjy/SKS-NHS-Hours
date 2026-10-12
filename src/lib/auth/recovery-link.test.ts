import { describe, expect, it } from "vitest";

import { parseRecoveryLink } from "@/lib/auth/recovery-link";

describe("parseRecoveryLink", () => {
  it("accepts a PKCE authorization code", () => {
    expect(parseRecoveryLink("  recovery-code  ", "")).toEqual({
      ok: true,
      proof: { code: "recovery-code" },
    });
  });

  it("accepts a Supabase implicit recovery fragment", () => {
    expect(
      parseRecoveryLink(
        undefined,
        "#access_token=access-token&refresh_token=refresh-token&type=recovery",
      ),
    ).toEqual({
      ok: true,
      proof: { accessToken: "access-token", refreshToken: "refresh-token" },
    });
  });

  it("rejects fragments for another authentication flow", () => {
    expect(
      parseRecoveryLink(undefined, "#access_token=access&refresh_token=refresh&type=invite"),
    ).toEqual({ ok: false, reason: "invalid-password-link" });
  });

  it("reports an expired Supabase token as an expired link", () => {
    expect(parseRecoveryLink(undefined, "#error=access_denied&error_code=otp_expired")).toEqual({
      ok: false,
      reason: "password-link-expired",
    });
  });

  it.each(["#error=server_error", "#error=access_denied&error_code=unexpected_failure"])(
    "does not label provider errors as expired links: %s",
    (fragment) => {
      expect(parseRecoveryLink(undefined, fragment)).toEqual({
        ok: false,
        reason: "password-verification-failed",
      });
    },
  );

  it("rejects incomplete proof", () => {
    expect(parseRecoveryLink(undefined, "#type=recovery&access_token=access")).toEqual({
      ok: false,
      reason: "invalid-password-link",
    });
  });
});
