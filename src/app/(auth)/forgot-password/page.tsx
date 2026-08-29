import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
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
          Reset password
        </CardTitle>
        <CardDescription className="text-base">
          We will email reset instructions when the address belongs to an invited account.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-6 py-7">
        <ForgotPasswordForm />
      </CardContent>
    </Card>
  );
}
