import { describe, expect, it } from "vitest";
import {
  isBetaTester,
  isEmailDeliveryEnabled,
  isSchoolGoogleEmail,
  parseSignInPolicy,
} from "./sign-in-policy";

const beta = {
  mode: "beta",
  googleDomains: "sks.org",
  betaEmails: "junyuc2027@sks.org",
  appUrl: "https://nhs-beta.vercel.app",
  supabaseUrl: "https://beta.supabase.co",
  productionSupabaseUrl: "https://production.supabase.co",
  vercelEnvironment: "preview",
};

describe("closed beta isolation", () => {
  it("suppresses email only in the explicitly configured Google beta", () => {
    expect(isEmailDeliveryEnabled("beta")).toBe(true);
    expect(isEmailDeliveryEnabled("beta", false)).toBe(false);
    expect(isEmailDeliveryEnabled("disabled", false)).toBe(true);
    expect(isEmailDeliveryEnabled("enabled", false)).toBe(true);
  });
  it("defaults Google to disabled and does not gate ordinary password users", () => {
    const policy = parseSignInPolicy({
      appUrl: "https://portal.example.edu",
      supabaseUrl: "https://production.supabase.co",
    });
    expect(policy.googleAuthMode).toBe("disabled");
    expect(isSchoolGoogleEmail("member@sks.org", policy)).toBe(false);
    expect(isBetaTester("member@sks.org", policy)).toBe(true);
  });
  it("allows only the explicit tester, including after a different Google account is selected", () => {
    const policy = parseSignInPolicy(beta);
    expect(isSchoolGoogleEmail(" JunyuC2027@SKS.ORG ", policy)).toBe(true);
    expect(isSchoolGoogleEmail("another@sks.org", policy)).toBe(false);
    expect(isSchoolGoogleEmail("junyuc2027@gmail.com", policy)).toBe(false);
    expect(isBetaTester(undefined, policy)).toBe(false);
  });
  it.each([
    { productionSupabaseUrl: undefined },
    { supabaseUrl: "https://production.supabase.co/" },
    { betaEmails: "" },
    { betaEmails: "tester@gmail.com" },
    { vercelEnvironment: "production" },
    { vercelEnvironment: undefined },
    { googleDomains: "" },
  ])("refuses unsafe or incomplete beta configuration %j", (override) => {
    expect(() => parseSignInPolicy({ ...beta, ...override })).toThrow();
  });
  it("allows local isolated beta testing while preserving exact school domain checks", () => {
    expect(
      parseSignInPolicy({ ...beta, appUrl: "http://127.0.0.1:3017", vercelEnvironment: undefined })
        .googleAuthMode,
    ).toBe("beta");
    const policy = parseSignInPolicy({
      ...beta,
      mode: "enabled",
      betaEmails: "",
      humanBetaApproved: true,
    });
    expect(isSchoolGoogleEmail("another@sks.org", policy)).toBe(true);
    expect(isSchoolGoogleEmail("member@evil-sks.org", policy)).toBe(false);
  });
  it("requires human beta approval before enabling Google for everyone", () => {
    expect(() => parseSignInPolicy({ ...beta, mode: "enabled" })).toThrow(
      "real-person closed beta",
    );
  });
});
