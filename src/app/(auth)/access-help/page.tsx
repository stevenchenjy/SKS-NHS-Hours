import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AccessRetryForm } from "@/components/auth/access-retry-form";
import { SupportContact } from "@/components/auth/support-contact";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "NHS access help" };

export default async function AccessHelpPage() {
  await connection();
  return (
    <Card className="py-0">
      <CardHeader>
        <CardTitle as="h1">Check your NHS access</CardTitle>
        <CardDescription>
          Being signed in and being on the NHS roster are separate steps.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <p className="text-sm leading-6 text-muted-foreground">
          If the service was unavailable, retry below using your existing sign-in. If your account
          has not been added to the roster, NHS support can check your invitation or school-year
          membership. You do not need to reset your password for a roster issue.
        </p>
        <AccessRetryForm />
        <SupportContact />
        <Link href="/login" className="text-sm text-primary underline">
          Return to sign in
        </Link>
      </CardContent>
    </Card>
  );
}
