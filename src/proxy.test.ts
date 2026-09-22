import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getClaims, refreshedCookies } = vi.hoisted(() => ({
  getClaims: vi.fn(),
  refreshedCookies: [] as Array<{ name: string; value: string; options: { path: string } }>,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: { cookies: { setAll: (cookies: typeof refreshedCookies) => void } },
  ) => {
    options.cookies.setAll(refreshedCookies);
    return { auth: { getClaims } };
  },
}));

import { proxy } from "./proxy";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "local-test-key");
  getClaims.mockReset().mockResolvedValue({ data: null });
  refreshedCookies.length = 0;
});

afterEach(() => vi.unstubAllEnvs());

describe("emailed event links", () => {
  it("keeps the event destination when a signed-out volunteer follows a link", async () => {
    const path = "/events/60000000-0000-4000-8000-000000000001";
    const response = await proxy(new NextRequest(`https://portal.example.edu${path}`));
    const destination = new URL(response.headers.get("location")!);

    expect(response.status).toBe(307);
    expect(destination.origin).toBe("https://portal.example.edu");
    expect(destination.pathname).toBe("/login");
    expect(destination.searchParams.get("next")).toBe(path);
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  it("retains event filters and refreshed cookies through sign-in", async () => {
    refreshedCookies.push({ name: "session", value: "", options: { path: "/" } });
    const response = await proxy(new NextRequest("https://portal.example.edu/events?view=past"));
    expect(new URL(response.headers.get("location")!).searchParams.get("next")).toBe(
      "/events?view=past",
    );
    expect(response.cookies.get("session")?.value).toBe("");
  });

  it("lets signed-in volunteers reach the event's membership checks", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "member" } } });
    const response = await proxy(new NextRequest("https://portal.example.edu/events/event-id"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it.each(["/login", "/auth/callback", "/events-unrelated"])(
    "does not intercept %s",
    async (path) => {
      const response = await proxy(new NextRequest(`https://portal.example.edu${path}`));
      expect(response.headers.get("location")).toBeNull();
    },
  );
});
