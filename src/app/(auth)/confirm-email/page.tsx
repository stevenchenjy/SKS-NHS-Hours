import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Continue to password setup",
  // Strip the token-bearing path while retaining Origin for same-origin form POSTs.
  referrer: "strict-origin",
  robots: { index: false, follow: false },
};

export default async function ConfirmEmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const tokenHash = params.token_hash;
  const type = params.type;
  if (typeof tokenHash !== "string" || !tokenHash || (type !== "invite" && type !== "recovery")) {
    redirect("/login?error=invalid-password-link");
  }

  return (
    <Card className="py-0 shadow-sm">
      <CardHeader className="border-b px-6 py-7">
        <CardTitle as="h1">
          {type === "invite" ? "Accept your invitation" : "Reset your password"}
        </CardTitle>
        <CardDescription>
          Continue to verify your email and choose your own password for the NHS Hours Log.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 px-6 py-7">
        <form action="/auth/confirm" method="post">
          <input type="hidden" name="token_hash" value={tokenHash} />
          <input type="hidden" name="type" value={type} />
          <Button type="submit" size="lg" className="h-11 w-full">
            Continue to set password
          </Button>
        </form>
        <p className="text-sm leading-6 text-muted-foreground">This link can be used once.</p>
        <Link href="/login" className="text-sm text-primary hover:underline">
          Back to sign in
        </Link>
      </CardContent>
    </Card>
  );
}
