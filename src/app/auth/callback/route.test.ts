import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  exchange: vi.fn(),
  getUser: vi.fn(),
  claim: vi.fn(),
  signOut: vi.fn(),
  environment: {
    NEXT_PUBLIC_APP_URL: "https://beta.example.edu",
    googleAuthEnabled: true,
    googleAuthMode: "beta",
    googleAllowedDomains: ["sks.org"],
    betaAllowedEmails: ["junyuc2027@sks.org"],
  },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  getServerEnvironment: () => mocks.environment,
  getPasswordUpdateContextSecret: () => "google-test-context-secret-0000000000000000",
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      exchangeCodeForSession: mocks.exchange,
      getUser: mocks.getUser,
      signOut: mocks.signOut,
    },
  }),
}));
vi.mock("@/lib/auth/claim-invitation", () => ({
  claimInvitationOrConfirmExistingProfile: mocks.claim,
}));
import { GET } from "./route";
import { verifyPasswordUpdateContext } from "@/lib/auth/password-update-context";
const user = {
  id: "tester",
  email: "junyuc2027@sks.org",
  email_confirmed_at: "2026-10-11T18:00:00Z",
  identities: [
    { provider: "google", identity_data: { email: "junyuc2027@sks.org", email_verified: true } },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.environment.googleAuthEnabled = true;
  mocks.environment.googleAuthMode = "beta";
  mocks.exchange.mockResolvedValue({ error: null });
  mocks.getUser.mockResolvedValue({ data: { user }, error: null });
  mocks.claim.mockResolvedValue(true);
  mocks.signOut.mockResolvedValue({ error: null });
});
function request(query = "code=proof&next=/events") {
  return new Request(`https://beta.example.edu/auth/callback?${query}`);
}
describe("school Google beta callback", () => {
  it("authorizes an optional portal password with fresh Google proof and no reset email", async () => {
    const response = await GET(request("code=proof&next=/update-password"));
    expect(response.headers.get("location")).toBe("https://beta.example.edu/update-password");
    const cookie = response.cookies.get("nhs-password-update-context");
    expect(cookie?.maxAge).toBe(172800);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(
      await verifyPasswordUpdateContext(
        cookie?.value,
        { subject: "tester" },
        "google-test-context-secret-0000000000000000",
      ),
    ).toMatchObject({ purpose: "google", subject: "tester" });
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it("allows the verified tester and returns to the original destination", async () => {
    const response = await GET(request());
    expect(response.headers.get("location")).toBe("https://beta.example.edu/events");
    expect(mocks.claim).toHaveBeenCalledWith(expect.anything(), user);
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(response.cookies.get("nhs-password-update-context")).toBeUndefined();
  });
  it("does not exchange an OAuth proof when Google is disabled", async () => {
    mocks.environment.googleAuthEnabled = false;
    const response = await GET(request());
    expect(response.headers.get("location")).toContain("google-not-configured");
    expect(mocks.exchange).not.toHaveBeenCalled();
  });
  it.each([
    {
      ...user,
      email: "other@sks.org",
      identities: [
        { provider: "google", identity_data: { email: "other@sks.org", email_verified: true } },
      ],
    },
    { ...user, email: "tester@gmail.com" },
    { ...user, email_confirmed_at: null },
    {
      ...user,
      identities: [
        { provider: "google", identity_data: { email: user.email, email_verified: false } },
      ],
    },
  ])("rejects an unapproved or unverified selected identity", async (rejected) => {
    mocks.getUser.mockResolvedValue({ data: { user: rejected }, error: null });
    const response = await GET(request());
    expect(response.headers.get("location")).toContain("beta-not-invited");
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
  it("retains the verified session for retry after a database outage", async () => {
    mocks.claim.mockRejectedValue(new Error("database unavailable"));
    const response = await GET(request());
    expect(response.headers.get("location")).toContain("access-help?reason=service-unavailable");
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it("does not turn an unprovisioned school account into a member", async () => {
    mocks.claim.mockResolvedValue(false);
    const response = await GET(request());
    expect(response.headers.get("location")).toContain("access-help?reason=not-provisioned");
  });
  it("rejects external next destinations", async () => {
    const response = await GET(request("code=proof&next=https://evil.example"));
    expect(response.headers.get("location")).toBe("https://beta.example.edu/dashboard");
  });
});
