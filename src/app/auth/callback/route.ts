import { NextResponse } from "next/server";

import { claimInvitationOrConfirmExistingProfile } from "@/lib/auth/claim-invitation";
import { safeInternalPath } from "@/lib/safe-navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServerEnvironment } from "@/lib/env";
import { isSchoolGoogleEmail } from "@/lib/auth/sign-in-policy";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeInternalPath(url.searchParams.get("next"));
  const environment = getServerEnvironment();
  const redirect = (path: string) =>
    NextResponse.redirect(new URL(path, environment.NEXT_PUBLIC_APP_URL));
  if (!environment.googleAuthEnabled) return redirect("/login?error=google-not-configured");
  if (url.searchParams.get("error")) return redirect("/login?error=google-cancelled");
  if (!code) return NextResponse.redirect(new URL("/login?error=missing-code", url.origin));

  const supabase = await createSupabaseServerClient();
  try {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return redirect("/login?error=callback-failed");
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) return redirect("/login?error=callback-failed");
    const verifiedGoogle = user.identities?.some(
      (identity) =>
        identity.provider === "google" &&
        identity.identity_data?.email_verified === true &&
        String(identity.identity_data.email).toLowerCase() === user.email?.toLowerCase(),
    );
    if (
      !user.email_confirmed_at ||
      !verifiedGoogle ||
      !isSchoolGoogleEmail(user.email, environment)
    ) {
      await supabase.auth.signOut({ scope: "local" });
      return redirect(
        environment.googleAuthMode === "beta"
          ? "/login?error=beta-not-invited"
          : "/login?error=school-google-required",
      );
    }
    if (!(await claimInvitationOrConfirmExistingProfile(supabase, user))) {
      return redirect("/access-help?reason=not-provisioned");
    }
  } catch {
    // Retain the verified session so a database outage can be retried without
    // consuming another OAuth code or email link.
    return redirect("/access-help?reason=service-unavailable");
  }
  return redirect(next);
}
