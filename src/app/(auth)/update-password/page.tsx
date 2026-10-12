import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { UpdatePasswordForm } from "@/components/auth/update-password-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PASSWORD_UPDATE_CONTEXT_COOKIE,
  verifyPasswordUpdateContext,
} from "@/lib/auth/password-update-context";
import { getPasswordUpdateContextSecret } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { claimInvitationOrConfirmExistingProfile } from "@/lib/auth/claim-invitation";
import { PASSWORD_VERIFICATION_COOKIE } from "@/lib/auth/password-verification";
import { isBetaTester } from "@/lib/auth/sign-in-policy";
import { getServerEnvironment } from "@/lib/env";
import { SupportContact } from "@/components/auth/support-contact";
import Link from "next/link";

export const metadata: Metadata = { title: "Choose a password" };

export default async function UpdatePasswordPage() {
  const supabase = await createSupabaseServerClient();
  const [{ data, error }, cookieStore] = await Promise.all([supabase.auth.getUser(), cookies()]);
  if (error && (error.status === undefined || error.status >= 500))
    throw new Error(
      "The password service is temporarily unavailable. Your setup session has not been discarded.",
    );
  const context = data.user
    ? await verifyPasswordUpdateContext(
        cookieStore.get(PASSWORD_UPDATE_CONTEXT_COOKIE)?.value,
        { subject: data.user.id },
        getPasswordUpdateContextSecret(),
      )
    : null;
  if (!data.user || !context) redirect("/login?error=password-context-required");
  if (!isBetaTester(data.user.email, getServerEnvironment()))
    redirect("/login?error=beta-not-invited");
  let accessReady = false;
  let unavailable = false;
  try {
    accessReady = await claimInvitationOrConfirmExistingProfile(supabase, data.user);
  } catch {
    unavailable = true;
  }

  return (
    <Card className="py-0 shadow-sm">
      <CardHeader className="border-b px-6 py-7">
        <CardTitle as="h1" className="text-3xl font-bold">
          Choose a new password
        </CardTitle>
        <CardDescription className="text-base">
          Your link has been verified. Keep this page open and save your password within 48 hours of
          verification, using this browser. You can return to this page if you close it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 px-6 py-7">
        {accessReady ? (
          <UpdatePasswordForm
            requiresVerification={
              cookieStore.get(PASSWORD_VERIFICATION_COOKIE)?.value === context.nonce
            }
          />
        ) : (
          <div className="flex flex-col gap-4">
            <p role="alert">
              {unavailable
                ? "Your email is verified, but we could not load your NHS access. Your setup session is still available; retry here without reopening the email link."
                : "Your email is verified, but your NHS roster access is not ready. Contact NHS support to check your invitation."}
            </p>
            <Link
              href="/update-password"
              prefetch={false}
              className="font-medium text-primary underline"
            >
              Retry access check
            </Link>
          </div>
        )}
        <SupportContact />
      </CardContent>
    </Card>
  );
}
