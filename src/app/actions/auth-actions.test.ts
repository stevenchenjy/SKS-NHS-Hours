import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  resetPasswordForEmail,
  signInWithPassword,
  claim,
  rpc,
  getUser,
  updateUser,
  reauthenticate,
  signOut,
  cookieStore,
  redirect,
} = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  signInWithPassword: vi.fn(),
  claim: vi.fn(),
  rpc: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
  reauthenticate: vi.fn(),
  signOut: vi.fn(),
  cookieStore: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      signInWithPassword,
      resetPasswordForEmail,
      getUser,
      updateUser,
      reauthenticate,
      signOut,
    },
    rpc,
  }),
}));
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth/claim-invitation", () => ({ claimInvitationOrConfirmExistingProfile: claim }));

import {
  loginAction,
  forgotPasswordAction,
  updatePasswordAction,
  signOutAction,
} from "./auth-actions";
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
  signInWithPassword.mockReset().mockResolvedValue({
    data: { user: { id: "test-member", email: "member@example.edu" } },
    error: null,
  });
  claim.mockReset().mockResolvedValue(true);
  rpc.mockReset().mockResolvedValue({ error: null });
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "test-member" } }, error: null });
  updateUser.mockReset().mockResolvedValue({ error: null });
  reauthenticate.mockReset().mockResolvedValue({ error: null });
  signOut.mockReset().mockResolvedValue({ error: null });
  cookieStore.get.mockReset().mockReturnValue({
    value: await createPasswordUpdateContext(
      { subject: "test-member", purpose: "recovery" },
      signingSecret,
    ),
  });
  cookieStore.delete.mockReset();
  cookieStore.set.mockReset();
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
        "REDIRECT:/dashboard?notice=password-updated",
      );
      expect(updateUser).toHaveBeenCalledExactlyOnceWith({ password });
      expect(cookieStore.delete).toHaveBeenCalledWith({
        name: "nhs-password-update-context",
        path: "/update-password",
      });
      expect(signOut).not.toHaveBeenCalled();
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
        "REDIRECT:/dashboard?notice=password-updated",
      );
    },
  );

  it.each(["session_expired", "refresh_token_not_found"])(
    "requests a new link only when the session cannot authorize a change: %s",
    async (code) => {
      updateUser.mockResolvedValue({ error: { code, status: 401 } });
      const result = await updatePasswordAction({}, passwordForm("abcdef"));
      expect(result.requiresNewPasswordLink).toBe(true);
      expect(result.error).toContain("fresh reset link");
    },
  );

  it("allows a 30-hour-old verified form to finish through the provider's code challenge", async () => {
    vi.setSystemTime(new Date("2026-10-10T12:00:00Z"));
    const value = await createPasswordUpdateContext(
      { subject: "test-member", purpose: "recovery" },
      signingSecret,
    );
    cookieStore.get.mockReturnValue({ value });
    vi.setSystemTime(new Date("2026-10-11T18:00:00Z"));
    updateUser.mockResolvedValueOnce({ error: { code: "reauthentication_needed", status: 400 } });

    const result = await updatePasswordAction({}, passwordForm("abcdef"));
    expect(result.requiresPasswordVerification).toBe(true);
    expect(result.requiresNewPasswordLink).toBeUndefined();
    expect(result.message).toContain("sent a verification code");
    expect(reauthenticate).toHaveBeenCalledOnce();
    expect(cookieStore.delete).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();

    const form = passwordForm("abcdef");
    form.set("verificationCode", " 123456 ");
    await expect(updatePasswordAction(result, form)).rejects.toThrow(
      "REDIRECT:/dashboard?notice=password-updated",
    );
    expect(updateUser).toHaveBeenLastCalledWith({ password: "abcdef", nonce: "123456" });
    expect(reauthenticate).toHaveBeenCalledOnce();
  });

  it("asks for a missing code without repeatedly sending email", async () => {
    const result = await updatePasswordAction(
      { requiresPasswordVerification: true },
      passwordForm("abcdef"),
    );
    expect(result.fieldErrors?.verificationCode).toBeTruthy();
    expect(result.requiresPasswordVerification).toBe(true);
    expect(updateUser).not.toHaveBeenCalled();
    expect(reauthenticate).not.toHaveBeenCalled();
  });

  it("lets users correct an invalid or expired verification code on the same form", async () => {
    updateUser.mockResolvedValue({ error: { code: "reauthentication_not_valid", status: 400 } });
    const form = passwordForm("abcdef");
    form.set("verificationCode", "654321");
    const result = await updatePasswordAction({ requiresPasswordVerification: true }, form);
    expect(result.fieldErrors?.verificationCode?.[0]).toContain("invalid or expired");
    expect(result.requiresPasswordVerification).toBe(true);
    expect(result.requiresNewPasswordLink).toBeUndefined();
    expect(cookieStore.delete).not.toHaveBeenCalled();
    expect(reauthenticate).not.toHaveBeenCalled();
  });

  it("resends a code only after verifying the signed password context", async () => {
    const form = passwordForm("", "mismatch");
    form.set("intent", "resend-verification-code");
    const result = await updatePasswordAction({ requiresPasswordVerification: true }, form);
    expect(result.message).toContain("sent a verification code");
    expect(reauthenticate).toHaveBeenCalledOnce();
    expect(updateUser).not.toHaveBeenCalled();
    expect(cookieStore.delete).not.toHaveBeenCalled();
  });

  it("retains password verification state for a reload without extending the context", async () => {
    updateUser.mockResolvedValueOnce({ error: { code: "reauthentication_needed", status: 400 } });
    await updatePasswordAction({}, passwordForm("abcdef"));
    expect(cookieStore.set).toHaveBeenCalledWith(
      "nhs-password-verification",
      expect.any(String),
      expect.objectContaining({
        path: "/update-password",
        httpOnly: true,
        maxAge: expect.any(Number),
      }),
    );
    const [name, value] = cookieStore.set.mock.calls[0]!;
    const getContext = cookieStore.get.getMockImplementation();
    cookieStore.get.mockImplementation((key) => (key === name ? { value } : getContext?.(key)));
    const result = await updatePasswordAction({}, passwordForm("abcdef"));
    expect(result.requiresPasswordVerification).toBe(true);
    expect(result.fieldErrors?.verificationCode).toBeTruthy();
    expect(reauthenticate).toHaveBeenCalledOnce();
  });

  it("keeps the verified context when roster access is temporarily unavailable", async () => {
    claim.mockRejectedValue(new Error("database unavailable"));
    const result = await updatePasswordAction({}, passwordForm("abcdef"));
    expect(result.error).toContain("verified link has been kept");
    expect(result.requiresNewPasswordLink).toBeUndefined();
    expect(updateUser).not.toHaveBeenCalled();
    expect(cookieStore.delete).not.toHaveBeenCalled();
  });

  it("requires roster access before changing a password", async () => {
    claim.mockResolvedValue(false);
    const result = await updatePasswordAction({}, passwordForm("abcdef"));
    expect(result.error).toContain("roster access is not ready");
    expect(updateUser).not.toHaveBeenCalled();
    expect(cookieStore.delete).not.toHaveBeenCalled();
  });

  it.each(["expired", "wrong-user", "missing"])(
    "does not send a verification email for a %s context",
    async (scenario) => {
      const value = await createPasswordUpdateContext(
        {
          subject: scenario === "wrong-user" ? "another-member" : "test-member",
          purpose: "recovery",
          ...(scenario === "expired" ? { expiresAt: 1 } : {}),
        },
        signingSecret,
      );
      cookieStore.get.mockReturnValue(scenario === "missing" ? undefined : { value });
      const form = passwordForm("abcdef");
      form.set("intent", "resend-verification-code");
      const result = await updatePasswordAction({ requiresPasswordVerification: true }, form);
      expect(result.requiresNewPasswordLink).toBe(true);
      expect(reauthenticate).not.toHaveBeenCalled();
      expect(updateUser).not.toHaveBeenCalled();
    },
  );

  it.each([429, 503])(
    "reports verification email failure %s without claiming delivery",
    async (status) => {
      updateUser.mockResolvedValue({ error: { code: "reauthentication_needed", status: 400 } });
      reauthenticate.mockResolvedValue({
        error: { code: "send_failed", status, message: "Private email details" },
      });
      const result = await updatePasswordAction({}, passwordForm("abcdef"));
      expect(result.message).toBeUndefined();
      expect(result.error).toContain("Resend verification code");
      expect(result.requiresPasswordVerification).toBe(true);
      expect(result.requiresNewPasswordLink).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain("Private email details");
      expect(cookieStore.delete).not.toHaveBeenCalled();
    },
  );

  it("keeps the code form available after a verification-delivery network failure", async () => {
    updateUser.mockResolvedValue({ error: { code: "reauthentication_needed", status: 400 } });
    reauthenticate.mockRejectedValue(new Error("Network down"));
    const result = await updatePasswordAction({}, passwordForm("abcdef"));
    expect(result.error).toContain("Check your connection");
    expect(result.requiresPasswordVerification).toBe(true);
    expect(result.message).toBeUndefined();
  });

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
  vi.useRealTimers();
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
    expect(result.error).toContain("NHS support");
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

describe("password sign-in", () => {
  it("signs out only the current device", async () => {
    await expect(signOutAction()).rejects.toThrow("REDIRECT:/login");
    expect(signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
  });
  it("does not block a valid sign-in when milestone recording has a network failure", async () => {
    rpc.mockRejectedValue(new Error("milestone service unavailable"));
    const form = emailForm("member@example.edu");
    form.set("password", "abcdef");
    await expect(loginAction({}, form)).rejects.toThrow("REDIRECT:/dashboard");
    expect(signOut).not.toHaveBeenCalled();
  });
  it("normalizes pasted addresses, claims pending invitations, and preserves the session", async () => {
    const form = emailForm(" Member@Example.EDU ");
    form.set("password", "abcdef");
    await expect(loginAction({}, form)).rejects.toThrow("REDIRECT:/dashboard");
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "member@example.edu",
      password: "abcdef",
    });
    expect(claim).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("record_password_sign_in");
    expect(signOut).not.toHaveBeenCalled();
  });
  it.each([
    [{ code: "invalid_credentials", status: 400 }, "incorrect"],
    [{ code: "email_not_confirmed", status: 400 }, "not been verified"],
    [{ code: "over_request_rate_limit", status: 429 }, "Too many"],
    [{ code: "unexpected_failure", status: 503 }, "temporarily unavailable"],
  ])("distinguishes sign-in failure %j", async (error, expected) => {
    signInWithPassword.mockResolvedValue({ data: { user: null }, error });
    const form = emailForm("member@example.edu");
    form.set("password", "abcdef");
    const result = await loginAction({}, form);
    expect(result.error).toContain(expected);
    expect(claim).not.toHaveBeenCalled();
  });
  it("reports a network outage without discarding credentials or claiming an expired invitation", async () => {
    signInWithPassword.mockRejectedValue(new Error("offline"));
    const form = emailForm("member@example.edu");
    form.set("password", "abcdef");
    const result = await loginAction({}, form);
    expect(result.error).toContain("temporarily unavailable");
    expect(result.error).not.toContain("expired");
  });
});
