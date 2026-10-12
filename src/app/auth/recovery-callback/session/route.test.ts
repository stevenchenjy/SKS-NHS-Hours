import { beforeEach, describe, expect, it, vi } from "vitest";

const { exchangeCodeForSession, setSession, claim, createContext } = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  setSession: vi.fn(),
  claim: vi.fn(),
  createContext: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { exchangeCodeForSession, setSession, signOut: vi.fn() },
  }),
}));
vi.mock("@/lib/auth/claim-invitation", () => ({ claimInvitationOrConfirmExistingProfile: claim }));
vi.mock("@/lib/env", () => ({ getPasswordUpdateContextSecret: () => "test-only-secret" }));
vi.mock("@/lib/auth/password-update-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/password-update-context")>()),
  createPasswordUpdateContext: createContext,
}));

import { POST } from "./route";

function request(proof: unknown = { code: "synthetic-code" }) {
  return new Request("https://portal.example.edu/auth/recovery-callback/session", {
    method: "POST",
    headers: {
      origin: "https://portal.example.edu",
      host: "portal.example.edu",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(proof),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  exchangeCodeForSession
    .mockReset()
    .mockResolvedValue({ data: { user: { id: "member-id" } }, error: null });
  setSession.mockReset().mockResolvedValue({ data: { user: { id: "member-id" } }, error: null });
  claim.mockReset().mockResolvedValue(true);
  createContext.mockReset().mockResolvedValue("signed-context");
});

describe("email recovery callback", () => {
  it("creates a password context after verifying an email code", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.cookies.get("nhs-password-update-context")?.value).toBe("signed-context");
    expect(exchangeCodeForSession).toHaveBeenCalledExactlyOnceWith("synthetic-code");
  });

  it("requests fresh verification for a missing refresh token", async () => {
    setSession.mockResolvedValue({
      data: { user: null },
      error: { code: "refresh_token_not_found" },
    });
    const response = await POST(
      request({ accessToken: "synthetic-access", refreshToken: "synthetic-refresh" }),
    );
    expect(await response.json()).toEqual({ reason: "password-link-expired" });
    expect(createContext).not.toHaveBeenCalled();
  });

  it("does not label a provider outage as an expired email link", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: null },
      error: { code: "unexpected_failure", status: 503 },
    });
    const response = await POST(request());
    expect(await response.json()).toEqual({ reason: "password-verification-failed" });
    expect(createContext).not.toHaveBeenCalled();
  });

  it("returns a retryable error after a network failure", async () => {
    exchangeCodeForSession.mockRejectedValue(new Error("Connection lost"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ reason: "password-verification-failed" });
    expect(createContext).not.toHaveBeenCalled();
  });
});
