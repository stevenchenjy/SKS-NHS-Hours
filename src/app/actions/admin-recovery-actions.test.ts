import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  reserve: vi.fn(),
  complete: vi.fn(),
  generateLink: vi.fn(),
}));

vi.mock("@/lib/dal/access", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ rpc: mocks.reserve }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    auth: { admin: { generateLink: mocks.generateLink } },
    rpc: mocks.complete,
  }),
}));
vi.mock("@/lib/env", () => ({
  getServerEnvironment: () => ({
    NEXT_PUBLIC_APP_URL: "https://portal.example.edu",
    allowedEmailDomains: ["example.edu"],
  }),
  assertAllowedEmail: (email: string, domains: string[]) => {
    if (!domains.includes(email.split("@")[1] ?? "")) throw new Error("Disallowed domain");
  },
}));

import { generateMemberRecoveryLinkAction } from "./admin-recovery-actions";

const profileId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003";

function form(id = profileId, email = "member@example.edu") {
  const data = new FormData();
  data.set("profile_id", id);
  data.set("expected_email", email);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001" });
  mocks.reserve.mockResolvedValue({
    data: [{ attempt_id: 42, recipient_email: "member@example.edu" }],
    error: null,
  });
  mocks.generateLink.mockResolvedValue({
    data: {
      user: { id: profileId },
      properties: { verification_type: "recovery", hashed_token: "secret-token" },
    },
    error: null,
  });
  mocks.complete.mockResolvedValue({ error: null });
});

describe("admin recovery link generation", () => {
  it("uses the reserved member email and returns the portal's non-consuming confirmation link", async () => {
    const result = await generateMemberRecoveryLinkAction({}, form());

    expect(mocks.requireAdmin).toHaveBeenCalledOnce();
    expect(mocks.reserve).toHaveBeenCalledExactlyOnceWith("reserve_member_recovery_link", {
      p_profile_id: profileId,
    });
    expect(mocks.generateLink).toHaveBeenCalledExactlyOnceWith({
      type: "recovery",
      email: "member@example.edu",
    });
    expect(mocks.complete).toHaveBeenCalledExactlyOnceWith("complete_member_recovery_link", {
      p_attempt_id: 42,
      p_succeeded: true,
    });
    expect(result).toEqual({
      link: "https://portal.example.edu/auth/confirm?type=recovery&token_hash=secret-token",
      recipientEmail: "member@example.edu",
    });
  });

  it("stops before reservation when the caller is not an admin", async () => {
    mocks.requireAdmin.mockRejectedValueOnce(new Error("Not authorized"));
    await expect(generateMemberRecoveryLinkAction({}, form())).rejects.toThrow("Not authorized");
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.generateLink).not.toHaveBeenCalled();
  });

  it("does not generate a link for an invalid or ineligible profile", async () => {
    expect(await generateMemberRecoveryLinkAction({}, form("invalid"))).toEqual({
      error: "This account could not be identified.",
    });
    mocks.reserve.mockResolvedValueOnce({
      data: null,
      error: { code: "22023", message: "An active member account is required" },
    });
    expect(await generateMemberRecoveryLinkAction({}, form())).toEqual({
      error: "This account is not eligible for a reset link.",
    });
    expect(mocks.generateLink).not.toHaveBeenCalled();
  });

  it("returns a clear cooldown error without contacting Auth", async () => {
    mocks.reserve.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "Wait 15 minutes before generating another." },
    });
    expect(await generateMemberRecoveryLinkAction({}, form())).toEqual({
      error: "A reset link was requested recently. Wait 15 minutes before generating another.",
    });
    expect(mocks.generateLink).not.toHaveBeenCalled();
  });

  it("does not generate a link when the school email changed since the account list loaded", async () => {
    const result = await generateMemberRecoveryLinkAction({}, form(profileId, "old@example.edu"));
    expect(result).toEqual({
      error: "The account email changed. Refresh the account list before generating a link.",
    });
    expect(mocks.generateLink).not.toHaveBeenCalled();
    expect(mocks.complete).toHaveBeenCalledExactlyOnceWith("complete_member_recovery_link", {
      p_attempt_id: 42,
      p_succeeded: false,
    });
  });

  it("records provider failure without exposing the provider message or token", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.generateLink.mockResolvedValueOnce({
      data: null,
      error: {
        code: "unexpected_failure",
        status: 500,
        message: "Private token secret-token for member@example.edu",
      },
    });

    const result = await generateMemberRecoveryLinkAction({}, form());

    expect(result).toEqual({ error: "The reset link could not be generated. Try again later." });
    expect(mocks.complete).toHaveBeenCalledExactlyOnceWith("complete_member_recovery_link", {
      p_attempt_id: 42,
      p_succeeded: false,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret-token");
    expect(JSON.stringify(log.mock.calls)).not.toContain("member@example.edu");
    log.mockRestore();
  });

  it("withholds the link when the audit completion fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.complete.mockResolvedValueOnce({ error: { code: "PGRST500" } });
    const result = await generateMemberRecoveryLinkAction({}, form());
    expect(result).toEqual({ error: "The reset link could not be generated. Try again later." });
    log.mockRestore();
  });

  it("rejects an unexpected Auth user instead of returning that user's link", async () => {
    mocks.generateLink.mockResolvedValueOnce({
      data: {
        user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa004" },
        properties: { verification_type: "recovery", hashed_token: "secret-token" },
      },
      error: null,
    });
    expect(await generateMemberRecoveryLinkAction({}, form())).toEqual({
      error: "The reset link could not be generated. Try again later.",
    });
    expect(mocks.complete).toHaveBeenCalledWith("complete_member_recovery_link", {
      p_attempt_id: 42,
      p_succeeded: false,
    });
  });
});
