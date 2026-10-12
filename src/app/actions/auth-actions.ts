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

export interface AuthFormState {
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  requiresNewPasswordLink?: boolean;
  requiresPasswordVerification?: boolean;
}

const loginSchema = z.object({
  email: z
    .email("Enter a valid school email address.")
    .transform((value) => value.trim().toLowerCase()),
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

  try {
    assertAllowedEmail(parsed.data.email, getServerEnvironment().allowedEmailDomains);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "This account is not allowed." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return {
      error:
        error.status === 400
          ? "The email or password is incorrect, or the invitation has not been accepted."
          : "We could not sign you in. Please try again.",
    };
  }

  redirect(safeInternalPath(formData.get("next")));
}

export async function googleLoginAction(formData: FormData) {
  const environment = getServerEnvironment();
  if (!environment.googleAuthEnabled) {
    redirect("/login?error=google-not-configured");
  }

  const next = safeInternalPath(formData.get("next"));
  const callback = new URL("/auth/callback", environment.NEXT_PUBLIC_APP_URL);
  callback.searchParams.set("next", next);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callback.toString() },
  });
  if (error || !data.url) redirect("/login?error=oauth-failed");
  redirect(data.url);
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
            ? "Password reset requests are temporarily limited. Wait a few minutes and try again. If this continues, contact the portal admin."
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
  if (!parsed.success)
    return { ...verificationState, fieldErrors: parsed.error.flatten().fieldErrors };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
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

  async function sendVerificationCode(): Promise<AuthFormState> {
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
              ? "Verification emails are temporarily limited. Wait a few minutes, then select Resend verification code. If this continues, ask the portal admin for a fresh reset link."
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

  if (formData.get("intent") === "resend-verification-code") return sendVerificationCode();
  if (_previous.requiresPasswordVerification && !parsed.data.verificationCode) {
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
  await supabase.auth.signOut();
  redirect("/login?notice=password-updated");
}

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
