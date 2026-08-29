import { NextResponse } from "next/server";

import { claimInvitationOrConfirmExistingProfile } from "@/lib/auth/claim-invitation";
import { safeInternalPath } from "@/lib/safe-navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeInternalPath(url.searchParams.get("next"));
  if (!code) return NextResponse.redirect(new URL("/login?error=missing-code", url.origin));

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/login?error=callback-failed", url.origin));

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login?error=callback-failed", url.origin));

  if (!(await claimInvitationOrConfirmExistingProfile(supabase, user))) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=invitation-claim-failed", url.origin));
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
