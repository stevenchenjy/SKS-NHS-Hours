import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resetPasswordForEmail } = vi.hoisted(() => ({ resetPasswordForEmail: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { resetPasswordForEmail } }),
}));

import { forgotPasswordAction } from "./auth-actions";

function emailForm(email: string) {
  const form = new FormData();
  form.set("email", email);
  return form;
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "local-test-publishable-key");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://portal.example.edu");
  vi.stubEnv("ALLOWED_EMAIL_DOMAINS", "example.edu");
  resetPasswordForEmail.mockReset().mockResolvedValue({ error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("password reset delivery", () => {
  it("normalizes pasted school emails and sends the recovery callback", async () => {
    const result = await forgotPasswordAction({}, emailForm(" Member@Example.EDU "));
    expect(result.message).toBeTruthy();
    expect(result.error).toBeUndefined();
    expect(resetPasswordForEmail).toHaveBeenCalledExactlyOnceWith("member@example.edu", {
      redirectTo: "https://portal.example.edu/auth/recovery-callback",
    });
  });

  it.each(["", "not-an-email"])("rejects invalid email %j before delivery", async (email) => {
    const result = await forgotPasswordAction({}, emailForm(email));
    expect(result.fieldErrors?.email).toBeTruthy();
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("keeps non-account and disallowed-domain responses indistinguishable", async () => {
    const unknown = await forgotPasswordAction({}, emailForm("unknown@example.edu"));
    resetPasswordForEmail.mockClear();
    const disallowed = await forgotPasswordAction({}, emailForm("unknown@other.edu"));
    expect(disallowed).toEqual(unknown);
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("reports the production email quota failure instead of claiming email was sent", async () => {
    resetPasswordForEmail.mockResolvedValue({
      error: { code: "over_email_send_rate_limit", status: 429 },
    });
    const result = await forgotPasswordAction({}, emailForm("member@example.edu"));
    expect(result.message).toBeUndefined();
    expect(result.error).toContain("temporarily limited");
    expect(result.error).toContain("portal admin");
  });

  it.each([
    { code: "email_address_not_authorized", status: 403 },
    { code: "unexpected_failure", status: 500 },
  ])("handles provider rejection $code without exposing personal data", async (error) => {
    resetPasswordForEmail.mockResolvedValue({
      error: { ...error, message: "Private details for member@example.edu" },
    });
    const result = await forgotPasswordAction({}, emailForm("member@example.edu"));
    expect(result.message).toBeUndefined();
    expect(result.error).toContain("could not send");
    expect(console.error).toHaveBeenCalledExactlyOnceWith("Password reset request failed", error);
    expect(JSON.stringify(result)).not.toContain("member@example.edu");
  });

  it("handles a rejected network request without returning false success", async () => {
    resetPasswordForEmail.mockRejectedValue(new Error("Connection failed"));
    const result = await forgotPasswordAction({}, emailForm("member@example.edu"));
    expect(result.message).toBeUndefined();
    expect(result.error).toContain("could not send");
  });
});
