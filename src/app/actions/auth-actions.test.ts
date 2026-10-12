import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resetPasswordForEmail, getUser, updateUser, signOut, cookieStore, redirect } = vi.hoisted(
  () => ({
    resetPasswordForEmail: vi.fn(),
    getUser: vi.fn(),
    updateUser: vi.fn(),
    signOut: vi.fn(),
    cookieStore: { get: vi.fn(), delete: vi.fn() },
    redirect: vi.fn((path: string) => {
      throw new Error(`REDIRECT:${path}`);
    }),
  }),
);
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { resetPasswordForEmail, getUser, updateUser, signOut },
  }),
}));
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));
vi.mock("next/navigation", () => ({ redirect }));

import { forgotPasswordAction, updatePasswordAction } from "./auth-actions";
import { createPasswordUpdateContext } from "@/lib/auth/password-update-context";

const signingSecret = "test-only-password-context-secret-00000000";

function emailForm(email: string) {
  const form = new FormData();
  form.set("email", email);
  return form;
}

beforeEach(async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "local-test-publishable-key");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://portal.example.edu");
  vi.stubEnv("ALLOWED_EMAIL_DOMAINS", "example.edu");
  vi.stubEnv("PASSWORD_UPDATE_CONTEXT_SECRET", signingSecret);
  resetPasswordForEmail.mockReset().mockResolvedValue({ error: null });
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "test-member" } }, error: null });
  updateUser.mockReset().mockResolvedValue({ error: null });
  signOut.mockReset().mockResolvedValue({ error: null });
  cookieStore.get.mockReset().mockReturnValue({
    value: await createPasswordUpdateContext(
      { subject: "test-member", purpose: "recovery" },
      signingSecret,
    ),
  });
  cookieStore.delete.mockReset();
  redirect.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function passwordForm(password: string, confirmation = password) {
  const form = new FormData();
  form.set("password", password);
  form.set("confirmation", confirmation);
  return form;
}

describe("password setup and retry", () => {
  it.each(["abcdef", "123456", "ABCDEF", "lowercase10"])(
    "accepts %s with six or more characters and no required character types",
    async (password) => {
      await expect(updatePasswordAction({}, passwordForm(password))).rejects.toThrow(
        "REDIRECT:/login?notice=password-updated",
      );
      expect(updateUser).toHaveBeenCalledExactlyOnceWith({ password });
      expect(cookieStore.delete).toHaveBeenCalledWith({
        name: "nhs-password-update-context",
        path: "/update-password",
      });
      expect(signOut).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["short", "short", "password"],
    ["abcdef", "different", "confirmation"],
  ])(
    "rejects invalid input without changing the password",
    async (password, confirmation, field) => {
      const result = await updatePasswordAction({}, passwordForm(password, confirmation));
      expect(result.fieldErrors?.[field]).toBeTruthy();
      expect(updateUser).not.toHaveBeenCalled();
      expect(cookieStore.delete).not.toHaveBeenCalled();
    },
  );

  it.each(["weak_password", "same_password"])(
    "allows correction and retry after %s without consuming the password context",
    async (code) => {
      updateUser.mockResolvedValueOnce({
        error: { code, status: 422, message: "Private provider data" },
      });
      const result = await updatePasswordAction({}, passwordForm("abcdef"));
      expect(result.fieldErrors?.password?.[0]).toBeTruthy();
      expect(result.requiresNewPasswordLink).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain("Private provider data");
      expect(cookieStore.delete).not.toHaveBeenCalled();
      expect(signOut).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith("Password update failed", { code, status: 422 });
      await expect(updatePasswordAction(result, passwordForm("newpass"))).rejects.toThrow(
        "REDIRECT:/login?notice=password-updated",
      );
    },
  );

  it.each(["session_expired", "reauthentication_needed"])(
    "requests a new link only when the session cannot authorize a change: %s",
    async (code) => {
      updateUser.mockResolvedValue({ error: { code, status: 401 } });
      const result = await updatePasswordAction({}, passwordForm("abcdef"));
      expect(result.requiresNewPasswordLink).toBe(true);
      expect(result.error).toContain("fresh reset link");
    },
  );

  it("rejects an expired password context before contacting the update API", async () => {
    cookieStore.get.mockReturnValue({
      value: await createPasswordUpdateContext(
        { subject: "test-member", purpose: "recovery", expiresAt: 1 },
        signingSecret,
      ),
    });
    const result = await updatePasswordAction({}, passwordForm("abcdef"));
    expect(result.requiresNewPasswordLink).toBe(true);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it.each([429, 500])("keeps the form retryable after provider status %s", async (status) => {
    updateUser.mockResolvedValue({ error: { code: "unexpected_failure", status } });
    const result = await updatePasswordAction({}, passwordForm("abcdef"));
    expect(result.error).toMatch(/retry on this form/i);
    expect(result.requiresNewPasswordLink).toBeUndefined();
    expect(cookieStore.delete).not.toHaveBeenCalled();
  });

  it("keeps the form retryable after a network failure", async () => {
    updateUser.mockRejectedValue(new Error("Connection lost"));
    const result = await updatePasswordAction({}, passwordForm("abcdef"));
    expect(result.error).toContain("Check your connection");
    expect(result.requiresNewPasswordLink).toBeUndefined();
    expect(cookieStore.delete).not.toHaveBeenCalled();
  });

  it("does not request a new link for a temporary session-verification outage", async () => {
    getUser.mockResolvedValue({
      data: { user: null },
      error: { code: "unexpected_failure", status: 503 },
    });
    const result = await updatePasswordAction({}, passwordForm("abcdef"));
    expect(result.error).toContain("Retry on this form");
    expect(result.requiresNewPasswordLink).toBeUndefined();
    expect(updateUser).not.toHaveBeenCalled();
  });
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
