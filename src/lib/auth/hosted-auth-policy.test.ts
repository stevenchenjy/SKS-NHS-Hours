import { describe, expect, it } from "vitest";
import { checkHostedAuthConfig } from "./hosted-auth-policy";

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
