import type { Metadata } from "next";
import Link from "next/link";

import { googleLoginAction } from "@/app/actions/auth-actions";
import { LoginForm } from "@/components/auth/login-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { safeInternalPath } from "@/lib/safe-navigation";

export const metadata: Metadata = { title: "Sign in" };

function safeNext(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  return safeInternalPath(candidate);
}

const authenticationErrors: Record<string, string> = {
  "google-not-configured": "School Google sign-in is not configured.",
  "invalid-invitation-link": "This invitation link is malformed. Ask the NHS adviser to resend it.",
  "invitation-link-expired":
    "This invitation link is invalid or expired. Ask the NHS adviser to resend it.",
  "invitation-claim-failed":
    "The invitation could not be matched to an active portal account. Contact the NHS adviser.",
  "password-context-required":
    "Open a fresh invitation or password-reset email before choosing a new password.",
  "password-context-failed":
    "The password link could not be secured. Contact the NHS adviser or request a new reset link.",
  "password-link-expired": "This password-reset link is invalid or expired. Request a new one.",
  "invalid-password-link": "This password-reset link is malformed. Request a new one.",
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
  const googleEnabled = process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true";
  const error = Array.isArray(params.error) ? params.error[0] : params.error;
  const notice = Array.isArray(params.notice) ? params.notice[0] : params.notice;

  return (
    <Card className="border-border/80 py-0 shadow-sm">
      <CardHeader className="border-b px-6 py-7">
        <div className="mb-5 flex items-center gap-3 lg:hidden">
          <span className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
            NHS
          </span>
          <span className="text-sm font-semibold">NHS Service Hours</span>
        </div>
        <CardTitle className="text-3xl font-bold tracking-tight">Welcome back</CardTitle>
        <CardDescription className="text-base leading-6">
          Use the account from your NHS invitation. There is no public registration.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 px-6 py-7">
        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {(error && authenticationErrors[error]) ??
              "Authentication could not be completed. Try again or contact the NHS adviser."}
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
            <form action={googleLoginAction}>
              <input type="hidden" name="next" value={next} />
              <Button type="submit" variant="outline" size="lg" className="h-11 w-full">
                Continue with school Google
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
        <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
          <Link
            href="/forgot-password"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Forgot your password?
          </Link>
          <span className="text-muted-foreground">Need access? Contact the NHS adviser.</span>
        </div>
      </CardContent>
    </Card>
  );
}
