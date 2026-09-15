import { NextResponse } from "next/server";

import { claimInvitationOrConfirmExistingProfile } from "@/lib/auth/claim-invitation";
import {
  createPasswordUpdateContext,
  PASSWORD_UPDATE_CONTEXT_COOKIE,
  PASSWORD_UPDATE_CONTEXT_MAX_AGE_SECONDS,
  type PasswordUpdatePurpose,
} from "@/lib/auth/password-update-context";
import { getPasswordUpdateContextSecret, getServerEnvironment } from "@/lib/env";
import { isSameOriginRequest } from "@/lib/http/same-origin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Email scanners may follow GET/HEAD links. Only an explicit form POST consumes
 * the one-time proof. Existing TokenHash email URLs remain valid.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = new URL(getServerEnvironment().NEXT_PUBLIC_APP_URL).origin;
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  if (!tokenHash || (type !== "invite" && type !== "recovery")) {
    const reason = type === "recovery" ? "invalid-password-link" : "invalid-invitation-link";
    return NextResponse.redirect(new URL(`/login?error=${reason}`, origin));
  }

  const confirmation = new URL("/confirm-email", origin);
  confirmation.searchParams.set("token_hash", tokenHash);
  confirmation.searchParams.set("type", type);
  const response = NextResponse.redirect(confirmation);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "strict-origin");
  return response;
}

export async function POST(request: Request) {
  const origin = new URL(getServerEnvironment().NEXT_PUBLIC_APP_URL).origin;
  // A 303 turns the form POST into a GET at the destination.
  const redirect = (path: string) => {
    const response = NextResponse.redirect(new URL(path, origin), 303);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "strict-origin");
    return response;
  };
  if (!isSameOriginRequest(request)) return redirect("/login?error=invalid-password-link");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return redirect("/login?error=invalid-password-link");
  }
  const tokenHash = form.get("token_hash");
  const type = form.get("type");
  if (typeof tokenHash !== "string" || !tokenHash || (type !== "invite" && type !== "recovery")) {
    const reason = type === "recovery" ? "invalid-password-link" : "invalid-invitation-link";
    return redirect(`/login?error=${reason}`);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  });
  if (error || !data.user) {
    const reason = type === "recovery" ? "password-link-expired" : "invitation-link-expired";
    return redirect(`/login?error=${reason}`);
  }

  if (!(await claimInvitationOrConfirmExistingProfile(supabase, data.user))) {
    await supabase.auth.signOut();
    return redirect("/login?error=invitation-claim-failed");
  }

  let context: string;
  try {
    context = await createPasswordUpdateContext(
      { subject: data.user.id, purpose: type as PasswordUpdatePurpose },
      getPasswordUpdateContextSecret(),
    );
  } catch {
    await supabase.auth.signOut();
    return redirect("/login?error=password-context-failed");
  }

  const response = redirect("/update-password");
  response.cookies.set(PASSWORD_UPDATE_CONTEXT_COOKIE, context, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/update-password",
    maxAge: PASSWORD_UPDATE_CONTEXT_MAX_AGE_SECONDS,
  });
  return response;
}
