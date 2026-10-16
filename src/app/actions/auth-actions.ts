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
    .email("Enter your school email address.")
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
          ? "Email or password is incorrect. Try again or use Forgot your password."
          : "Sign-in could not be completed. Try again.",
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
      email: z.string().trim().toLowerCase().pipe(z.email("Enter your school email address.")),
    })
    .safeParse({ email: formData.get("email") });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };

  const environment = getServerEnvironment();
  try {
    assertAllowedEmail(parsed.data.email, environment.allowedEmailDomains);
  } catch {
    // Return the same response to avoid account and domain enumeration.
    return { message: "If your account is invited, check your email for reset instructions." };
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
            ? "Password reset requests are temporarily limited. Try again later or contact NHS support."
            : "We could not send reset instructions. Try again later.",
      };
    }
  } catch {
    console.error("Password reset request failed", { code: "request_failed" });
    return {
      error: "We could not send reset instructions. Try again later.",
    };
  }
  return { message: "If your account is invited, check your email for reset instructions." };
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
      error: "Password service unavailable. Retry on this form later. Keep this page open.",
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
      error: "Verify your account to set a password. Request a fresh reset link.",
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
              ? "Verification emails are temporarily limited. Try Resend verification code later."
              : "We could not send a code. Try Resend verification code later.",
        };
      }
      return {
        requiresPasswordVerification: true,
        message: "Verification code sent. Enter the latest code below.",
      };
    } catch {
      console.error("Password verification request failed", { code: "request_failed" });
      return {
        requiresPasswordVerification: true,
        error: "Check your connection, then select Resend verification code.",
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
            verificationCode: ["Enter the latest code or select Resend verification code."],
          },
        };
      }
      if (error.code === "same_password") {
        return {
          ...verificationState,
          fieldErrors: {
            password: ["Choose a different password."],
          },
        };
      }
      if (error.code === "weak_password") {
        return {
          ...verificationState,
          fieldErrors: {
            password: ["Choose another password of at least 6 characters."],
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
          error: "Your session has expired. Request a fresh reset link.",
          requiresNewPasswordLink: true,
        };
      }
      if (error.code === "user_banned" || error.code === "user_not_found") {
        return {
          ...verificationState,
          error: "This account is unavailable. Contact NHS support.",
        };
      }
      if (error.status === 429) {
        return {
          ...verificationState,
          error: "Too many attempts. Retry on this form later. Keep this page open.",
        };
      }
      return {
        ...verificationState,
        error: "Password service unavailable. Retry on this form later. Keep this page open.",
      };
    }
  } catch {
    console.error("Password update failed", { code: "request_failed" });
    return {
      ...verificationState,
      error: "Check your connection and retry on this form. Keep this page open.",
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
