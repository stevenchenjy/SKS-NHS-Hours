import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyOtp, signOut, claim, createContext } = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  signOut: vi.fn(),
  claim: vi.fn(),
  createContext: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { verifyOtp, signOut } }),
}));
vi.mock("@/lib/auth/claim-invitation", () => ({ claimInvitationOrConfirmExistingProfile: claim }));
vi.mock("@/lib/env", () => ({
  getPasswordUpdateContextSecret: () => "test-only-secret",
  getServerEnvironment: () => ({ NEXT_PUBLIC_APP_URL: "https://portal.example.edu" }),
}));
vi.mock("@/lib/auth/password-update-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/password-update-context")>()),
  createPasswordUpdateContext: createContext,
}));

import { GET, POST } from "./route";

const origin = "https://portal.example.edu";
function request(type = "invite", token = "one-time-proof", requestOrigin = origin) {
  return new Request(`${origin}/auth/confirm`, {
    method: "POST",
    headers: { origin: requestOrigin, host: "portal.example.edu" },
    body: new URLSearchParams({ type, token_hash: token }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyOtp.mockReset().mockResolvedValue({ data: { user: { id: "member-id" } }, error: null });
  claim.mockReset().mockResolvedValue(true);
  createContext.mockReset().mockResolvedValue("signed-context");
});

describe("explicit email link confirmation", () => {
  it.each(["invite", "recovery"])("GET previews a %s link without consuming it", async (type) => {
    const response = await GET(
      new Request(`${origin}/auth/confirm?type=${type}&token_hash=one-time-proof`),
    );
    const destination = new URL(response.headers.get("location")!);
    expect(destination.pathname).toBe("/confirm-email");
    expect(destination.searchParams.get("token_hash")).toBe("one-time-proof");
    expect(destination.searchParams.get("type")).toBe(type);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("strict-origin");
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    expect(createContext).not.toHaveBeenCalled();
  });

  it.each(["invite", "recovery"])(
    "verifies %s only on POST and creates password proof",
    async (type) => {
      const response = await POST(request(type));
      expect(verifyOtp).toHaveBeenCalledExactlyOnceWith({ token_hash: "one-time-proof", type });
      expect(createContext).toHaveBeenCalledWith(
        { subject: "member-id", purpose: type },
        "test-only-secret",
      );
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(`${origin}/update-password`);
      expect(response.cookies.get("nhs-password-update-context")?.value).toBe("signed-context");
      expect(response.headers.get("set-cookie")).toContain("HttpOnly");
      expect(response.headers.get("set-cookie")).toContain("Path=/update-password");
    },
  );

  it("rejects cross-origin submissions before consuming a token", async () => {
    const response = await POST(request("invite", "one-time-proof", "https://other.example.edu"));
    expect(response.headers.get("location")).toContain("invalid-password-link");
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it.each([
    ["invite", ""],
    ["signup", "proof"],
  ])("rejects invalid proof %s/%s", async (type, token) => {
    await POST(request(type, token));
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it.each(["invite", "recovery"])("rejects an expired or used %s token", async (type) => {
    verifyOtp.mockResolvedValue({ data: { user: null }, error: { code: "otp_expired" } });
    const response = await POST(request(type));
    expect(response.headers.get("location")).toContain(
      type === "invite" ? "invitation-link-expired" : "password-link-expired",
    );
    expect(claim).not.toHaveBeenCalled();
    expect(createContext).not.toHaveBeenCalled();
  });

  it("requires application access after email verification", async () => {
    claim.mockResolvedValue(false);
    const response = await POST(request());
    expect(response.headers.get("location")).toContain("invitation-claim-failed");
    expect(signOut).toHaveBeenCalled();
    expect(createContext).not.toHaveBeenCalled();
  });

  it("signs out if a password context cannot be secured", async () => {
    createContext.mockRejectedValue(new Error("Missing secret"));
    const response = await POST(request());
    expect(response.headers.get("location")).toContain("password-context-failed");
    expect(signOut).toHaveBeenCalled();
    expect(response.cookies.get("nhs-password-update-context")).toBeUndefined();
  });
});
