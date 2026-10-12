import type { Metadata } from "next";
import Link from "next/link";

import { googleLoginAction } from "@/app/actions/auth-actions";
import { LoginForm } from "@/components/auth/login-form";
import { SchoolBrand } from "@/components/auth/school-brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { safeInternalPath } from "@/lib/safe-navigation";
import { getServerEnvironment } from "@/lib/env";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SupportContact } from "@/components/auth/support-contact";

export const metadata: Metadata = { title: "Sign in" };

function safeNext(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  return safeInternalPath(candidate);
}

const authenticationErrors: Record<string, string> = {
  "google-not-configured": "School Google sign-in is not configured.",
  "beta-not-invited":
    "This test portal is only open to invited beta testers. Use your approved school Google account, or return to the current NHS portal.",
  "school-google-required":
    "Choose your school Google account, using the school email on your NHS roster.",
  "google-cancelled":
    "Google sign-in was cancelled or blocked. Try again with your school account, or use your portal password below.",
  "oauth-failed":
    "We could not start Google sign-in. Try again later or use your portal password below.",
  "missing-code":
    "Google did not finish sign-in. Select the Google button again, or use your portal password.",
  "callback-failed":
    "Google sign-in could not be completed in this browser. Start again here using the same browser, or use your portal password.",
  "invalid-invitation-link":
    "This invitation link is malformed. Ask the portal admin to resend it.",
  "invitation-link-expired":
    "This invitation link has expired or was already used. If the password form is still open in this browser, return there and finish. If you already saved your password, sign in below. Otherwise, ask the portal admin for a fresh link.",
  "invitation-claim-failed":
    "The invitation could not be matched to an active portal account. Contact the portal admin.",
  "password-context-required":
    "Password setup requires a verified link in this browser and must be completed within 48 hours. Ask the portal admin for a fresh link or use Forgot your password below.",
  "password-context-failed":
    "The password link could not be secured. Contact the portal admin or request a new reset link.",
  "password-link-expired":
    "This reset link has expired, was already used, or was replaced by a newer link. If the password form is still open in this browser, return there and retry. If you already saved your password, sign in below. Otherwise, ask the portal admin for one fresh link and use only the latest one.",
  "invalid-password-link":
    "This reset link is incomplete or invalid. Copy the entire latest link sent to you. If it still fails, ask the portal admin for a fresh link.",
  "password-verification-failed":
    "We could not verify your link because the authentication service is unavailable. Try opening the same link again in a few minutes. If this continues, contact the portal admin.",
};

const authenticationNotices: Record<string, string> = {
  "password-updated": "Your password was updated. Sign in with the new password.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeNext(params.next);
  const environment = getServerEnvironment();
  const googleEnabled = environment.googleAuthEnabled;
  const error = Array.isArray(params.error) ? params.error[0] : params.error;
  const notice = Array.isArray(params.notice) ? params.notice[0] : params.notice;

  return (
    <Card className="border-border/80 py-0 shadow-sm">
      <CardHeader className="border-b px-6 py-7">
        <div className="mb-5 flex items-center gap-3 lg:hidden">
          <SchoolBrand compact />
        </div>
        <CardTitle as="h1" className="text-3xl font-bold tracking-tight">
          Welcome back
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 px-6 py-7">
        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {(error && authenticationErrors[error]) ??
              "Authentication could not be completed. Try again or contact the portal admin."}
          </p>
        ) : null}
        {notice && authenticationNotices[notice] ? (
          <p
            role="status"
            className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-primary"
          >
            {authenticationNotices[notice]}
          </p>
        ) : null}
        {googleEnabled ? (
          <>
            <form action={googleLoginAction} className="flex flex-col gap-4">
              <input type="hidden" name="next" value={next} />
              {environment.googleAuthMode === "beta" ? (
                <Field>
                  <FieldLabel htmlFor="google-email">Beta school email</FieldLabel>
                  <Input
                    id="google-email"
                    type="email"
                    name="email"
                    autoComplete="email"
                    required
                    className="h-11"
                  />
                </Field>
              ) : null}
              <Button type="submit" size="lg" className="h-11 w-full">
                Sign in with school Google
              </Button>
            </form>
            <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              or use password
              <span className="h-px flex-1 bg-border" />
            </div>
          </>
        ) : null}
        <LoginForm next={next} />
        {error &&
        [
          "invitation-link-expired",
          "password-link-expired",
          "password-verification-failed",
        ].includes(error) ? (
          <div className="flex flex-col gap-2 text-sm">
            <Link
              href="/update-password"
              prefetch={false}
              className="font-medium text-primary underline"
            >
              Resume password setup in this browser
            </Link>
            <Link href="/forgot-password" className="font-medium text-primary underline">
              Request a fresh reset link
            </Link>
          </div>
        ) : null}
        <div className="flex flex-col gap-2 text-sm">
          <Link
            href="/forgot-password"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Forgot your password?
          </Link>
          <SupportContact />
        </div>
      </CardContent>
    </Card>
  );
}
