import { describe, expect, it } from "vitest";

import { isSameOriginRequest } from "@/lib/http/same-origin";

describe("isSameOriginRequest", () => {
  it("accepts a same-origin local request even when the internal URL hostname differs", () => {
    const request = new Request("http://localhost:3000/auth/recovery-callback/session", {
      method: "POST",
      headers: {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
      },
    });
    expect(isSameOriginRequest(request)).toBe(true);
  });

  it("accepts the public HTTPS origin behind a deployment proxy", () => {
    const request = new Request("http://internal:3000/auth/recovery-callback/session", {
      method: "POST",
      headers: {
        host: "internal:3000",
        origin: "https://sks-nhs-hours.vercel.app",
        "x-forwarded-host": "sks-nhs-hours.vercel.app",
        "x-forwarded-proto": "https",
      },
    });
    expect(isSameOriginRequest(request)).toBe(true);
  });

  it("rejects cross-origin and downgrade requests", () => {
    const crossOrigin = new Request(
      "https://sks-nhs-hours.vercel.app/auth/recovery-callback/session",
      {
        method: "POST",
        headers: {
          host: "sks-nhs-hours.vercel.app",
          origin: "https://attacker.example",
        },
      },
    );
    const downgrade = new Request(
      "https://sks-nhs-hours.vercel.app/auth/recovery-callback/session",
      {
        method: "POST",
        headers: {
          host: "sks-nhs-hours.vercel.app",
          origin: "http://sks-nhs-hours.vercel.app",
        },
      },
    );
    expect(isSameOriginRequest(crossOrigin)).toBe(false);
    expect(isSameOriginRequest(downgrade)).toBe(false);
  });

  it("fails closed when the origin or host is absent or malformed", () => {
    expect(
      isSameOriginRequest(
        new Request("https://sks-nhs-hours.vercel.app/auth/recovery-callback/session"),
      ),
    ).toBe(false);
    expect(
      isSameOriginRequest(
        new Request("https://sks-nhs-hours.vercel.app/auth/recovery-callback/session", {
          headers: { host: "sks-nhs-hours.vercel.app", origin: "://invalid" },
        }),
      ),
    ).toBe(false);
  });
});
