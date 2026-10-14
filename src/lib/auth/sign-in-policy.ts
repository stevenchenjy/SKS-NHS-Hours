import { z } from "zod";

export const googleAuthModeSchema = z.enum(["disabled", "beta", "enabled"]);
export type GoogleAuthMode = z.infer<typeof googleAuthModeSchema>;

export const GOOGLE_PILOT_RECOVERY_MESSAGE =
  "Email reset is not enabled in this beta. Sign in with your school Google account, then open My profile to set or change an optional portal password of at least 6 characters.";

export const GOOGLE_PILOT_INVITATION_MESSAGE =
  "Email invitations are not enabled in this beta. Approved tester access is prepared separately. No email was sent by this request.";

export function isEmailDeliveryEnabled(
  googleAuthMode: GoogleAuthMode,
  betaEmailEnabled = true,
): boolean {
  return googleAuthMode !== "beta" || betaEmailEnabled;
}

export interface SignInPolicy {
  googleAuthMode: GoogleAuthMode;
  googleAllowedDomains: string[];
  betaAllowedEmails: string[];
}

export function parseSignInPolicy(input: {
  mode?: string;
  googleDomains?: string;
  betaEmails?: string;
  appUrl: string;
  supabaseUrl: string;
  productionSupabaseUrl?: string;
  vercelEnvironment?: string;
  humanBetaApproved?: boolean;
}): SignInPolicy {
  const googleAuthMode = googleAuthModeSchema.parse(input.mode ?? "disabled");
  const googleAllowedDomains = (input.googleDomains ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (googleAllowedDomains.some((domain) => !/^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/.test(domain))) {
    throw new Error("GOOGLE_AUTH_ALLOWED_DOMAINS must contain exact school domains.");
  }
  const betaAllowedEmails = [
    ...new Set(
      (input.betaEmails ?? "")
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (betaAllowedEmails.some((email) => !z.email().safeParse(email).success)) {
    throw new Error("AUTH_BETA_ALLOWED_EMAILS must contain valid email addresses.");
  }
  if (googleAuthMode !== "disabled" && googleAllowedDomains.length === 0) {
    throw new Error("Google sign-in requires GOOGLE_AUTH_ALLOWED_DOMAINS.");
  }
  if (googleAuthMode === "enabled" && input.humanBetaApproved !== true) {
    throw new Error(
      "School Google rollout requires recorded approval after a real-person closed beta.",
    );
  }
  if (googleAuthMode === "beta") {
    if (betaAllowedEmails.length === 0) throw new Error("The closed beta requires a tester list.");
    if (
      betaAllowedEmails.some((email) => !googleAllowedDomains.includes(email.split("@")[1] ?? ""))
    ) {
      throw new Error("Every beta tester must use an allowed school Google domain.");
    }
    if (
      !input.productionSupabaseUrl ||
      new URL(input.productionSupabaseUrl).origin === new URL(input.supabaseUrl).origin
    ) {
      throw new Error("The closed beta must use a separate Supabase project from production.");
    }
    if (input.vercelEnvironment === "production") {
      throw new Error("The closed beta cannot run in the Vercel production environment.");
    }
    const host = new URL(input.appUrl).hostname;
    if (
      input.vercelEnvironment !== "preview" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(host)
    ) {
      throw new Error("The closed beta must run locally or in Vercel Preview.");
    }
  }
  return { googleAuthMode, googleAllowedDomains, betaAllowedEmails };
}

export function isBetaTester(email: string | undefined, policy: SignInPolicy): boolean {
  return (
    policy.googleAuthMode !== "beta" ||
    Boolean(email && policy.betaAllowedEmails.includes(email.trim().toLowerCase()))
  );
}

export function isSchoolGoogleEmail(email: string | undefined, policy: SignInPolicy): boolean {
  return (
    (policy.googleAuthMode === "beta" || policy.googleAuthMode === "enabled") &&
    Boolean(
      email &&
      policy.googleAllowedDomains.includes(email.trim().toLowerCase().split("@")[1] ?? "") &&
      isBetaTester(email, policy),
    )
  );
}
