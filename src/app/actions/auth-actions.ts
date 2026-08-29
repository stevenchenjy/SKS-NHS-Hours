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
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface AuthFormState {
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string[]>;
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
    .object({ email: z.email("Enter a valid school email address.") })
    .safeParse({ email: formData.get("email") });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };

  const environment = getServerEnvironment();
  try {
    assertAllowedEmail(parsed.data.email, environment.allowedEmailDomains);
  } catch {
    // Return the same response to avoid account and domain enumeration.
    return { message: "If an invited account exists, password reset instructions are on the way." };
  }

  const supabase = await createSupabaseServerClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: new URL("/auth/recovery-callback", environment.NEXT_PUBLIC_APP_URL).toString(),
  });
  return { message: "If an invited account exists, password reset instructions are on the way." };
}

export async function updatePasswordAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = z
    .object({
      password: z
        .string()
        .min(12, "Use at least 12 characters.")
        .regex(/[a-z]/, "Include a lowercase letter.")
        .regex(/[A-Z]/, "Include an uppercase letter.")
        .regex(/[0-9]/, "Include a number."),
      confirmation: z.string(),
    })
    .refine((values) => values.password === values.confirmation, {
      path: ["confirmation"],
      message: "Passwords do not match.",
    })
    .safeParse({
      password: formData.get("password"),
      confirmation: formData.get("confirmation"),
    });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
      error: "This password link is missing, expired, or was already used. Request a new one.",
    };
  }
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: "The password could not be updated. Request a new reset link." };
  cookieStore.delete({ name: PASSWORD_UPDATE_CONTEXT_COOKIE, path: "/update-password" });
  await supabase.auth.signOut();
  redirect("/login?notice=password-updated");
}

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
