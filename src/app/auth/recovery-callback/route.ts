import { NextResponse } from "next/server";

import { claimInvitationOrConfirmExistingProfile } from "@/lib/auth/claim-invitation";
import {
  createPasswordUpdateContext,
  PASSWORD_UPDATE_CONTEXT_COOKIE,
  PASSWORD_UPDATE_CONTEXT_MAX_AGE_SECONDS,
} from "@/lib/auth/password-update-context";
import { getPasswordUpdateContextSecret } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * PKCE fallback for Supabase's stock recovery template. The custom token-hash
 * recovery template uses /auth/confirm, but both paths require a fresh one-time
 * Auth proof before minting the password-update context.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code)
    return NextResponse.redirect(new URL("/login?error=invalid-password-link", url.origin));

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    return NextResponse.redirect(new URL("/login?error=password-link-expired", url.origin));
  }

  if (!(await claimInvitationOrConfirmExistingProfile(supabase, data.user))) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=invitation-claim-failed", url.origin));
  }

  let context: string;
  try {
    context = await createPasswordUpdateContext(
      { subject: data.user.id, purpose: "recovery" },
      getPasswordUpdateContextSecret(),
    );
  } catch {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=password-context-failed", url.origin));
  }

  const response = NextResponse.redirect(new URL("/update-password", url.origin));
  response.cookies.set(PASSWORD_UPDATE_CONTEXT_COOKIE, context, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/update-password",
    maxAge: PASSWORD_UPDATE_CONTEXT_MAX_AGE_SECONDS,
  });
  return response;
}
