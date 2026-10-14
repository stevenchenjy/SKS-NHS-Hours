import { parseSignInPolicy } from "./sign-in-policy.ts";

export function parseAuthPreflightOptions(
  args: readonly string[],
  policyInput: Parameters<typeof parseSignInPolicy>[0],
  betaEmailEnabled = true,
) {
  if (args.some((argument) => argument !== "--google-pilot"))
    throw new Error("Unknown Auth preflight option.");
  // Reuse all application isolation checks before any hosted request is made.
  const policy = parseSignInPolicy(policyInput);
  const googlePilot = args.includes("--google-pilot");
  if (googlePilot && (policy.googleAuthMode !== "beta" || betaEmailEnabled))
    throw new Error(
      "The Google-only pilot preflight requires an isolated beta with AUTH_BETA_EMAIL_ENABLED=false.",
    );
  return { policy, googlePilot };
}

export interface HostedAuthConfig {
  password_min_length?: number;
  password_required_characters?: string;
  security_update_password_require_reauthentication?: boolean;
  mailer_otp_exp?: number;
  disable_signup?: boolean;
  external_anonymous_users_enabled?: boolean;
  external_google_enabled?: boolean;
  mailer_autoconfirm?: boolean;
  rate_limit_email_sent?: number;
  smtp_host?: string;
  site_url?: string;
  uri_allow_list?: string;
  mailer_templates_invite_content?: string;
  mailer_templates_recovery_content?: string;
}

export function checkHostedAuthConfig(
  config: HostedAuthConfig,
  input: {
    appUrl: string;
    googleEnabled: boolean;
    minimumEmailsPerHour?: number;
    googlePilot?: boolean;
  },
): string[] {
  const failures: string[] = [];
  const require = (condition: boolean, message: string) => {
    if (!condition) failures.push(message);
  };
  const origin = new URL(input.appUrl).origin;
  require(config.password_min_length === 6 &&
    config.password_required_characters ===
      "", "Password policy must be at least 6 characters with no required character types.");
  require(config.security_update_password_require_reauthentication ===
    false, "Disable the extra day-two password email challenge; the portal verifies its own 48-hour setup context.");
  require(config.mailer_otp_exp ===
    172800, "Email invitation and reset proofs must expire after 48 hours (172800 seconds).");
  require(config.disable_signup ===
    true, "Public signup must remain disabled; provision roster accounts before Google sign-in.");
  require(config.external_anonymous_users_enabled ===
    false, "Anonymous sign-in must remain disabled.");
  require(config.mailer_autoconfirm === false, "Email ownership verification must remain enabled.");
  require(config.external_google_enabled ===
    input.googleEnabled, "The hosted Google provider must match this environment's Google sign-in mode.");
  if (!input.googlePilot) {
    require(Boolean(
      config.smtp_host?.trim(),
    ), "Configure a school-owned SMTP provider before onboarding students.");
    require((config.rate_limit_email_sent ?? 0) >=
      (input.minimumEmailsPerHour ??
        100), "Set email capacity to cover the onboarding roster (at least 100 messages/hour by default), within the sender's limits.");
  }
  require(config.site_url?.replace(/\/$/, "") ===
    origin, "The hosted Site URL must match this environment's canonical origin.");
  const redirects = (config.uri_allow_list ?? "").split(",").map((value) => value.trim());
  for (const path of ["/auth/callback", "/auth/recovery-callback", "/update-password"])
    require(redirects.includes(
      `${origin}${path}`,
    ), `Allow the exact ${path} redirect for this environment.`);
  require(!redirects.some((url) =>
    url.includes("*"),
  ), "Use exact Auth redirect URLs, without wildcards.");
  if (!input.googlePilot)
    for (const [purpose, template] of [
      ["invite", config.mailer_templates_invite_content],
      ["recovery", config.mailer_templates_recovery_content],
    ] as const) {
      require(Boolean(
        template?.includes("/auth/confirm?token_hash={{ .TokenHash }}") &&
        template.includes(`type=${purpose}`) &&
        !template.includes(".ConfirmationURL"),
      ), `Apply the scanner-safe ${purpose} email template; it must verify only after the portal's Continue button.`);
    }
  return failures;
}
