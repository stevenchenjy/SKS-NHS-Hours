"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { z } from "zod";

import { assertAllowedEmail, getServerEnvironment } from "@/lib/env";
import { getPasswordUpdateContextSecret } from "@/lib/env";
import {
  PASSWORD_UPDATE_CONTEXT_COOKIE,
  verifyPasswordUpdateContext,
} from "@/lib/auth/password-update-context";
import { safeInternalPath } from "@/lib/safe-navigation";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password-policy";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { claimInvitationOrConfirmExistingProfile } from "@/lib/auth/claim-invitation";
import { isBetaTester, isSchoolGoogleEmail } from "@/lib/auth/sign-in-policy";
import { PASSWORD_VERIFICATION_COOKIE } from "@/lib/auth/password-verification";

export interface AuthFormState {
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  requiresNewPasswordLink?: boolean;
  requiresPasswordVerification?: boolean;
}

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid school email address.")),
  password: z.string().min(1, "Enter your password."),
});

export async function loginAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const environment = getServerEnvironment();
  if (!isBetaTester(parsed.data.email, environment))
    return {
      error:
        "This test portal is only open to invited beta testers. Use the current NHS portal for your account.",
    };
  try {
    assertAllowedEmail(parsed.data.email, environment.allowedEmailDomains);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "This account is not allowed." };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
    if (error) {
      if (error.code === "email_not_confirmed")
        return {
          error:
            "Your email has not been verified yet. Open your invitation and select Continue, or request reset instructions.",
        };
      if (error.status === 429)
        return {
          error:
            "Too many sign-in attempts. Please wait before trying again. Your email and password are still in this form.",
        };
      return {
        error:
          error.code === "invalid_credentials" || error.status === 400
            ? "The email or password is incorrect. Check your school email and password, or use Forgot your password."
            : "The sign-in service is temporarily unavailable. Please retry here; you do not need a new invitation.",
      };
    }
    if (!data.user)
      return { error: "The sign-in service did not complete your session. Please retry here." };
    if (!(await claimInvitationOrConfirmExistingProfile(supabase, data.user))) {
      return {
        error:
          "You signed in, but your NHS roster access is not ready. Contact NHS support to check your invitation or membership.",
      };
    }
    // The signed JWT's password AMR is checked by the database. Telemetry failure
    // must never block an otherwise successful sign-in during migration rollout.
    try {
      const { error: milestoneError } = await supabase.rpc("record_password_sign_in");
      if (milestoneError)
        console.error("Password sign-in milestone failed", { code: milestoneError.code });
    } catch {
      console.error("Password sign-in milestone failed", { code: "request_failed" });
    }
  } catch {
    return {
      error:
        "We could not check your NHS access because the service is temporarily unavailable. Retry here; you do not need a new invitation.",
    };
  }

  redirect(safeInternalPath(formData.get("next")));
}

export async function googleLoginAction(formData: FormData) {
  const environment = getServerEnvironment();
  if (!environment.googleAuthEnabled) {
    redirect("/login?error=google-not-configured");
  }
  const email =
    typeof formData.get("email") === "string"
      ? String(formData.get("email")).trim().toLowerCase()
      : undefined;
  if (environment.googleAuthMode === "beta" && !isSchoolGoogleEmail(email, environment))
    redirect("/login?error=beta-not-invited");

  const next = safeInternalPath(formData.get("next"));
  const callback = new URL("/auth/callback", environment.NEXT_PUBLIC_APP_URL);
  callback.searchParams.set("next", next);
  const supabase = await createSupabaseServerClient();
  let providerUrl: string | null = null;
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callback.toString(),
        scopes: "openid email profile",
        queryParams: {
          prompt: "select_account",
          ...(email ? { login_hint: email } : {}),
          ...(environment.googleAllowedDomains.length === 1
            ? { hd: environment.googleAllowedDomains[0] }
            : {}),
        },
      },
    });
    if (!error) providerUrl = data.url;
  } catch {
    /* Keep provider failures separate from credential errors. */
  }
  if (!providerUrl) redirect("/login?error=oauth-failed");
  redirect(providerUrl);
}

export async function forgotPasswordAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = z
    .object({
      email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid school email address.")),
    })
    .safeParse({ email: formData.get("email") });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };

  const environment = getServerEnvironment();
  if (!isBetaTester(parsed.data.email, environment))
    return {
      error:
        "This test portal is only open to invited beta testers. Request help through the current NHS portal.",
    };
  try {
    assertAllowedEmail(parsed.data.email, environment.allowedEmailDomains);
  } catch {
    // Return the same response to avoid account and domain enumeration.
    return { message: "If an invited account exists, password reset instructions are on the way." };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: new URL("/auth/recovery-callback", environment.NEXT_PUBLIC_APP_URL).toString(),
    });
    if (error) {
      // Never log the address, tokens, or provider message, which may contain personal data.
      console.error("Password reset request failed", { code: error.code, status: error.status });
      return {
        error:
          error.status === 429
            ? "Password reset requests are temporarily limited because email delivery has reached its sending limit. Try again later or contact NHS support for a reset link."
            : "We could not send reset instructions. Please try again later or contact the portal admin for help accessing your account.",
      };
    }
  } catch {
    console.error("Password reset request failed", { code: "request_failed" });
    return {
      error:
        "We could not send reset instructions. Please try again later or contact the portal admin for help accessing your account.",
    };
  }
  return { message: "If an invited account exists, password reset instructions are on the way." };
}

export async function updatePasswordAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const verificationState = _previous.requiresPasswordVerification
    ? { requiresPasswordVerification: true }
    : {};
  const parsed = z
    .object({
      password: z.string().min(MIN_PASSWORD_LENGTH, "Use at least 6 characters."),
      confirmation: z.string(),
      verificationCode: z.string().trim().max(128, "Enter the verification code from your email."),
    })
    .refine((values) => values.password === values.confirmation, {
      path: ["confirmation"],
      message: "Passwords do not match.",
    })
    .safeParse({
      password: formData.get("password"),
      confirmation: formData.get("confirmation"),
      verificationCode: formData.get("verificationCode") ?? "",
    });
  const resending = formData.get("intent") === "resend-verification-code";
  if (!parsed.success && !resending)
    return { ...verificationState, fieldErrors: parsed.error.flatten().fieldErrors };

  const supabase = await createSupabaseServerClient();
  let userResult;
  try {
    userResult = await supabase.auth.getUser();
  } catch {
    return {
      ...verificationState,
      error:
        "We could not reach the password service. Check your connection and retry on this form.",
    };
  }
  const {
    data: { user },
    error: userError,
  } = userResult;
  if (userError && (userError.status === undefined || userError.status >= 500)) {
    return {
      ...verificationState,
      error:
        "We could not verify your session because the password service is unavailable. Retry on this form in a few minutes. Keep this page open; do not reopen the original link.",
    };
  }
  const cookieStore = await cookies();
  const context = user
    ? await verifyPasswordUpdateContext(
        cookieStore.get(PASSWORD_UPDATE_CONTEXT_COOKIE)?.value,
        { subject: user.id },
        getPasswordUpdateContextSecret(),
      )
    : null;
  if (!user || !context) {
    return {
      error:
        "Your password setup session is missing or has expired. Request a fresh reset link from the portal admin or use Forgot your password.",
      requiresNewPasswordLink: true,
    };
  }
  if (!isBetaTester(user.email, getServerEnvironment()))
    return { error: "This test portal is only open to invited beta testers." };
  try {
    if (!(await claimInvitationOrConfirmExistingProfile(supabase, user)))
      return {
        error:
          "Your email is verified, but NHS roster access is not ready. Contact NHS support to check your invitation. Keep this page open.",
      };
  } catch {
    return {
      ...verificationState,
      error:
        "We could not check your NHS access. Retry on this form; your verified link has been kept.",
    };
  }

  async function sendVerificationCode(): Promise<AuthFormState> {
    cookieStore.set(PASSWORD_VERIFICATION_COOKIE, context!.nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/update-password",
      maxAge: context!.expiresAt - Math.floor(Date.now() / 1000),
    });
    try {
      const { error } = await supabase.auth.reauthenticate();
      if (error) {
        console.error("Password verification request failed", {
          code: error.code,
          status: error.status,
        });
        return {
          requiresPasswordVerification: true,
          error:
            error.status === 429
              ? "Verification emails are temporarily limited by the email sending limit. Try Resend verification code later or contact NHS support. Keep this page open."
              : "We could not send a verification code. Try Resend verification code later, or ask the portal admin for a fresh reset link. Your password has not been changed.",
        };
      }
      return {
        requiresPasswordVerification: true,
        message:
          "Your sign-in is more than 24 hours old. We sent a verification code to your account email. Enter the latest code below and update your password on this form.",
      };
    } catch {
      console.error("Password verification request failed", { code: "request_failed" });
      return {
        requiresPasswordVerification: true,
        error:
          "We could not reach the verification service. Check your connection, then select Resend verification code. Your password has not been changed.",
      };
    }
  }

  if (resending) return sendVerificationCode();
  if (!parsed.success)
    return { ...verificationState, fieldErrors: parsed.error.flatten().fieldErrors };
  const needsCode =
    _previous.requiresPasswordVerification ||
    cookieStore.get(PASSWORD_VERIFICATION_COOKIE)?.value === context.nonce;
  if (needsCode && !parsed.data.verificationCode) {
    return {
      requiresPasswordVerification: true,
      fieldErrors: { verificationCode: ["Enter the verification code from your account email."] },
    };
  }
  try {
    const { error } = await supabase.auth.updateUser({
      password: parsed.data.password,
      ...(parsed.data.verificationCode ? { nonce: parsed.data.verificationCode } : {}),
    });
    if (error) {
      // Never log provider messages, passwords, email addresses, or reset tokens.
      console.error("Password update failed", { code: error.code, status: error.status });
      if (error.code === "reauthentication_needed") return sendVerificationCode();
      if (error.code === "reauthentication_not_valid") {
        return {
          requiresPasswordVerification: true,
          fieldErrors: {
            verificationCode: [
              "This verification code is invalid or expired. Enter the latest code, or select Resend verification code.",
            ],
          },
        };
      }
      if (error.code === "same_password") {
        return {
          ...verificationState,
          fieldErrors: {
            password: [
              "Choose a different password from your current one, or sign in with your existing password.",
            ],
          },
        };
      }
      if (error.code === "weak_password") {
        return {
          ...verificationState,
          fieldErrors: {
            password: [
              "This password was rejected by the account's password policy. Choose a different password and retry here. If a password of at least 6 characters is still rejected, contact the portal admin.",
            ],
          },
        };
      }
      if (
        [
          "session_not_found",
          "session_expired",
          "refresh_token_not_found",
          "bad_jwt",
          "no_authorization",
        ].includes(error.code ?? "")
      ) {
        return {
          error:
            "Your sign-in session is no longer valid for changing a password. Request a fresh reset link from the portal admin or use Forgot your password.",
          requiresNewPasswordLink: true,
        };
      }
      if (error.code === "user_banned" || error.code === "user_not_found") {
        return {
          ...verificationState,
          error: "This account is unavailable. Contact the portal admin for help.",
        };
      }
      if (error.status === 429) {
        return {
          ...verificationState,
          error:
            "Too many attempts. Wait a few minutes, then retry on this form. Keep this page open; do not reopen the original link.",
        };
      }
      return {
        ...verificationState,
        error:
          "The password service is temporarily unavailable. Retry on this form. Keep this page open; do not reopen the original link.",
      };
    }
  } catch {
    console.error("Password update failed", { code: "request_failed" });
    return {
      ...verificationState,
      error:
        "We could not reach the password service. Check your connection and retry on this form. Keep this page open; do not reopen the original link.",
    };
  }
  cookieStore.delete({ name: PASSWORD_UPDATE_CONTEXT_COOKIE, path: "/update-password" });
  cookieStore.delete({ name: PASSWORD_VERIFICATION_COOKIE, path: "/update-password" });
  redirect("/dashboard?notice=password-updated");
}

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}

export async function retryPortalAccessAction(): Promise<AuthFormState> {
  let signedIn = false;
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error && (error.status === undefined || error.status >= 500))
      return { error: "The sign-in service is temporarily unavailable. Please retry later." };
    if (!user)
      return {
        error: "Your sign-in session is missing. Return to sign in using Google or your password.",
      };
    if (!isBetaTester(user.email, getServerEnvironment()))
      return { error: "This test portal is only open to invited beta testers." };
    signedIn = await claimInvitationOrConfirmExistingProfile(supabase, user);
    if (!signedIn)
      return {
        error:
          "Your NHS roster access is not ready. Use the support contact below to check your invitation.",
      };
  } catch {
    return {
      error: "We could not check NHS access. Your sign-in has been kept; please retry later.",
    };
  }
  if (signedIn) redirect("/dashboard");
  return {};
}
