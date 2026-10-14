import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  signInWithPassword: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
  reauthenticate: vi.fn(),
  cookieStore: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createServerClient,
}));
vi.mock("next/headers", () => ({ cookies: async () => mocks.cookieStore }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/auth/claim-invitation", () => ({
  claimInvitationOrConfirmExistingProfile: async () => true,
}));

function emailForm(email = "junyuc2027@sks.org") {
  const form = new FormData();
  form.set("email", email);
  return form;
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://beta.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-beta-publishable-key-00000000");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://beta.example.edu");
  vi.stubEnv("AUTH_PRODUCTION_SUPABASE_URL", "https://production.supabase.co");
  vi.stubEnv("AUTH_GOOGLE_MODE", "beta");
  vi.stubEnv("GOOGLE_AUTH_ALLOWED_DOMAINS", "sks.org");
  vi.stubEnv("AUTH_BETA_ALLOWED_EMAILS", "junyuc2027@sks.org");
  vi.stubEnv("AUTH_BETA_EMAIL_ENABLED", "false");
  vi.stubEnv("PASSWORD_UPDATE_CONTEXT_SECRET", "test-pilot-password-context-secret-00000000");
  vi.stubEnv("ALLOWED_EMAIL_DOMAINS", "sks.org");
  vi.stubEnv("VERCEL_ENV", "preview");
  mocks.resetPasswordForEmail.mockResolvedValue({ error: null });
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "test-pilot-user", email: "junyuc2027@sks.org" } },
    error: null,
  });
  mocks.updateUser.mockResolvedValue({ error: null });
  const { createPasswordUpdateContext } = await import("@/lib/auth/password-update-context");
  const context = await createPasswordUpdateContext(
    { subject: "test-pilot-user", purpose: "google" },
    "test-pilot-password-context-secret-00000000",
  );
  mocks.cookieStore.get.mockImplementation((name: string) =>
    name === "nhs-password-update-context" ? { value: context } : undefined,
  );
  mocks.createServerClient.mockResolvedValue({
    auth: {
      resetPasswordForEmail: mocks.resetPasswordForEmail,
      signInWithPassword: mocks.signInWithPassword,
      getUser: mocks.getUser,
      updateUser: mocks.updateUser,
      reauthenticate: mocks.reauthenticate,
    },
  });
});

describe("Google beta password verification", () => {
  function passwordForm() {
    const form = new FormData();
    form.set("password", "abcdef");
    form.set("confirmation", "abcdef");
    return form;
  }

  it("saves the optional six-character password using Google proof without email", async () => {
    const { updatePasswordAction } = await import("./auth-actions");
    await expect(updatePasswordAction({}, passwordForm())).rejects.toThrow(
      "REDIRECT:/dashboard?notice=password-updated",
    );
    expect(mocks.updateUser).toHaveBeenCalledExactlyOnceWith({ password: "abcdef" });
    expect(mocks.reauthenticate).not.toHaveBeenCalled();
    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("does not send a code for an explicit resend request", async () => {
    const { updatePasswordAction } = await import("./auth-actions");
    const form = new FormData();
    form.set("intent", "resend-verification-code");
    const result = await updatePasswordAction({}, form);
    expect(result.error).toContain("fresh school Google verification");
    expect(result.requiresNewPasswordLink).toBe(true);
    expect(mocks.reauthenticate).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.cookieStore.set).not.toHaveBeenCalled();
  });

  it.each(["reauthentication_needed", "reauthentication_not_valid", "session_expired"])(
    "offers fresh Google proof without email for %s",
    async (code) => {
      mocks.updateUser.mockResolvedValue({ error: { code, status: 400 } });
      const { updatePasswordAction } = await import("./auth-actions");
      const result = await updatePasswordAction({}, passwordForm());
      expect(result.error).toContain("school Google");
      expect(result.requiresNewPasswordLink).toBe(true);
      expect(mocks.reauthenticate).not.toHaveBeenCalled();
      expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
    },
  );

  it("offers fresh Google proof for a missing context", async () => {
    mocks.cookieStore.get.mockReturnValue(undefined);
    const { updatePasswordAction } = await import("./auth-actions");
    const result = await updatePasswordAction({}, passwordForm());
    expect(result.error).toContain("Verify again with your school Google");
    expect(result.requiresNewPasswordLink).toBe(true);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
});

afterEach(() => vi.unstubAllEnvs());

describe("Google beta email recovery availability", () => {
  it("explains Google recovery without making an email request or claiming delivery", async () => {
    const { forgotPasswordAction } = await import("./auth-actions");
    const result = await forgotPasswordAction({}, emailForm());
    expect(result.error).toContain("Email reset is not enabled in this beta");
    expect(result.error).toContain("school Google");
    expect(result.error).toContain("My profile");
    expect(result.error).toContain("at least 6 characters");
    expect(result.message).toBeUndefined();
    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("keeps the tester gate before the unavailable-email response", async () => {
    const { forgotPasswordAction } = await import("./auth-actions");
    const result = await forgotPasswordAction({}, emailForm("other@sks.org"));
    expect(result.error).toContain("only open to invited beta testers");
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it.each(["true", undefined])("retains email recovery when the beta flag is %s", async (flag) => {
    vi.stubEnv("AUTH_BETA_EMAIL_ENABLED", flag);
    const { forgotPasswordAction } = await import("./auth-actions");
    const result = await forgotPasswordAction({}, emailForm());
    expect(result.message).toBeTruthy();
    expect(result.error).toBeUndefined();
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledExactlyOnceWith("junyuc2027@sks.org", {
      redirectTo: "https://beta.example.edu/auth/recovery-callback",
    });
  });

  it.each(["disabled", "enabled"])(
    "does not suppress email outside beta mode: %s",
    async (mode) => {
      vi.stubEnv("AUTH_GOOGLE_MODE", mode);
      vi.stubEnv("AUTH_GOOGLE_BETA_APPROVED", "true");
      const { forgotPasswordAction } = await import("./auth-actions");
      const result = await forgotPasswordAction({}, emailForm());
      expect(result.message).toBeTruthy();
      expect(result.error).toBeUndefined();
      expect(mocks.resetPasswordForEmail).toHaveBeenCalledOnce();
    },
  );

  it.each(["invalid_credentials", "email_not_confirmed"])(
    "directs password sign-in failure %s to Google rather than unavailable email",
    async (code) => {
      mocks.signInWithPassword.mockResolvedValue({
        data: { user: null },
        error: { code, status: 400 },
      });
      const { loginAction } = await import("./auth-actions");
      const form = emailForm();
      form.set("password", "abcdef");
      const result = await loginAction({}, form);
      expect(result.error).toContain("school Google");
      expect(result.error).not.toContain("reset instructions");
      expect(result.error).not.toContain("Forgot your password");
    },
  );
});
