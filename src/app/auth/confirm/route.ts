import { NextResponse } from "next/server";

import { claimInvitationOrConfirmExistingProfile } from "@/lib/auth/claim-invitation";
import {
  createPasswordUpdateContext,
  PASSWORD_UPDATE_CONTEXT_COOKIE,
  PASSWORD_UPDATE_CONTEXT_MAX_AGE_SECONDS,
  type PasswordUpdatePurpose,
} from "@/lib/auth/password-update-context";
import { getPasswordUpdateContextSecret } from "@/lib/env";
import { safeInternalPath } from "@/lib/safe-navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Server-side invite and recovery verification endpoint. The Supabase email templates
 * must send TokenHash here; see supabase/templates/.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const next = safeInternalPath(url.searchParams.get("next"), "/update-password");
  if (!tokenHash || (type !== "invite" && type !== "recovery")) {
    const reason = type === "recovery" ? "invalid-password-link" : "invalid-invitation-link";
    return NextResponse.redirect(new URL(`/login?error=${reason}`, url.origin));
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  });
  if (error || !data.user) {
    const reason = type === "recovery" ? "password-link-expired" : "invitation-link-expired";
    return NextResponse.redirect(new URL(`/login?error=${reason}`, url.origin));
  }

  if (!(await claimInvitationOrConfirmExistingProfile(supabase, data.user))) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=invitation-claim-failed", url.origin));
  }

  let context: string;
  try {
    context = await createPasswordUpdateContext(
      { subject: data.user.id, purpose: type as PasswordUpdatePurpose },
      getPasswordUpdateContextSecret(),
    );
  } catch {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=password-context-failed", url.origin));
  }

  const response = NextResponse.redirect(new URL(next, url.origin));
  response.cookies.set(PASSWORD_UPDATE_CONTEXT_COOKIE, context, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/update-password",
    maxAge: PASSWORD_UPDATE_CONTEXT_MAX_AGE_SECONDS,
  });
  return response;
}
