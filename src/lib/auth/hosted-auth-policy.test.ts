import { describe, expect, it } from "vitest";
import { checkHostedAuthConfig, parseAuthPreflightOptions } from "./hosted-auth-policy";

const config = {
  password_min_length: 6,
  password_required_characters: "",
  security_update_password_require_reauthentication: false,
  mailer_otp_exp: 172800,
  disable_signup: true,
  external_anonymous_users_enabled: false,
  mailer_autoconfirm: false,
  external_google_enabled: true,
  smtp_host: "smtp.example.edu",
  rate_limit_email_sent: 100,
  site_url: "https://beta.example.edu",
  uri_allow_list: ["/auth/callback", "/auth/recovery-callback", "/update-password"]
    .map((path) => `https://beta.example.edu${path}`)
    .join(","),
  mailer_templates_invite_content:
    "{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=invite",
  mailer_templates_recovery_content:
    "{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=recovery",
};
const target = { appUrl: "https://beta.example.edu", googleEnabled: true };
const beta = {
  mode: "beta",
  googleDomains: "sks.org",
  betaEmails: "junyuc2027@sks.org",
  appUrl: target.appUrl,
  supabaseUrl: "https://beta.supabase.co",
  productionSupabaseUrl: "https://production.supabase.co",
  vercelEnvironment: "preview",
};

describe("hosted Auth release preflight", () => {
  it("accepts the intended beta policy", () =>
    expect(checkHostedAuthConfig(config, target)).toEqual([]));
  it("catches the production drift that caused repeated setup failures", () => {
    const failures = checkHostedAuthConfig(
      {
        ...config,
        password_min_length: 12,
        password_required_characters: "lower_upper_letters_digits",
        security_update_password_require_reauthentication: true,
        mailer_otp_exp: 86400,
        smtp_host: "",
        rate_limit_email_sent: 2,
        mailer_templates_invite_content: "{{ .ConfirmationURL }}",
        mailer_templates_recovery_content: "{{ .ConfirmationURL }}",
      },
      target,
    );
    expect(failures).toHaveLength(7);
    expect(failures.join(" ")).toMatch(/6 characters.*day-two.*48 hours.*SMTP.*100.*scanner-safe/);
  });
  it.each([
    { disable_signup: false },
    { external_anonymous_users_enabled: true },
    { external_google_enabled: false },
    { mailer_autoconfirm: true },
    { uri_allow_list: "https://*.example.edu/**" },
    { site_url: "https://production.example.edu" },
  ])("rejects unsafe settings %j", (override) =>
    expect(checkHostedAuthConfig({ ...config, ...override }, target).length).toBeGreaterThan(0),
  );
});

describe("Google-only pilot preflight", () => {
  const noMailConfig = {
    ...config,
    smtp_host: "",
    rate_limit_email_sent: 2,
    mailer_templates_invite_content: "{{ .ConfirmationURL }}",
    mailer_templates_recovery_content: "{{ .ConfirmationURL }}",
  };

  it("omits only email requirements for an explicitly isolated Google pilot", () => {
    const { googlePilot } = parseAuthPreflightOptions(["--google-pilot"], beta, false);
    expect(checkHostedAuthConfig(noMailConfig, { ...target, googlePilot })).toEqual([]);
    expect(checkHostedAuthConfig(noMailConfig, target)).toHaveLength(4);
    expect(parseAuthPreflightOptions([], beta, false).googlePilot).toBe(false);
  });

  it.each([
    { password_min_length: 12 },
    { password_required_characters: "letters_digits" },
    { security_update_password_require_reauthentication: true },
    { mailer_otp_exp: 86400 },
    { disable_signup: false },
    { external_anonymous_users_enabled: true },
    { external_google_enabled: false },
    { mailer_autoconfirm: true },
    { uri_allow_list: "https://*.example.edu/**" },
    { site_url: "https://production.example.edu" },
  ])("preserves non-email checks in pilot mode: %j", (override) => {
    expect(
      checkHostedAuthConfig({ ...noMailConfig, ...override }, { ...target, googlePilot: true }),
    ).not.toEqual([]);
  });

  it.each([
    { mode: "disabled" },
    { mode: "enabled", humanBetaApproved: true },
    { vercelEnvironment: "production" },
    { productionSupabaseUrl: undefined },
    { supabaseUrl: beta.productionSupabaseUrl },
    { betaEmails: "" },
  ])("rejects unsafe pilot use before hosted requests: %j", (override) => {
    expect(() =>
      parseAuthPreflightOptions(["--google-pilot"], { ...beta, ...override }, false),
    ).toThrow();
  });

  it("requires email delivery to be explicitly disabled and rejects unknown options", () => {
    expect(() => parseAuthPreflightOptions(["--google-pilot"], beta)).toThrow(
      "AUTH_BETA_EMAIL_ENABLED=false",
    );
    expect(() => parseAuthPreflightOptions(["--ignore-mail"], beta, false)).toThrow(
      "Unknown Auth preflight option",
    );
  });
});
