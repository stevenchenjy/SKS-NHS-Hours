import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { SupportContact } from "@/components/auth/support-contact";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getServerEnvironment } from "@/lib/env";
import { GOOGLE_PILOT_RECOVERY_MESSAGE } from "@/lib/auth/sign-in-policy";

export const metadata: Metadata = { title: "Reset password" };

export default async function ForgotPasswordPage() {
  // The proxy's CSP nonce is per request; a static page has no matching script nonce.
  await connection();
  const { emailDeliveryEnabled } = getServerEnvironment();
  return (
    <Card className="py-0 shadow-sm">
      <CardHeader className="border-b px-6 py-7">
        <Link
          href="/login"
          className="mb-4 flex w-fit items-center gap-2 text-sm font-medium text-primary hover:underline"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to sign in
        </Link>
        <CardTitle as="h1" className="text-3xl font-bold">
          {emailDeliveryEnabled ? "Reset password" : "Recover access"}
        </CardTitle>
        <CardDescription className="text-base">
          {emailDeliveryEnabled
            ? "We will email reset instructions when the address belongs to an invited account."
            : GOOGLE_PILOT_RECOVERY_MESSAGE}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 px-6 py-7">
        {emailDeliveryEnabled ? (
          <ForgotPasswordForm />
        ) : (
          <Link href="/login" className="font-medium text-primary underline">
            Sign in with school Google
          </Link>
        )}
        <SupportContact />
      </CardContent>
    </Card>
  );
}
