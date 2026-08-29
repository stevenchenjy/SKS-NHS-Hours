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

export const metadata: Metadata = { title: "Choose a password" };

export default async function UpdatePasswordPage() {
  const supabase = await createSupabaseServerClient();
  const [{ data }, cookieStore] = await Promise.all([supabase.auth.getUser(), cookies()]);
  const context = data.user
    ? await verifyPasswordUpdateContext(
        cookieStore.get(PASSWORD_UPDATE_CONTEXT_COOKIE)?.value,
        { subject: data.user.id },
        getPasswordUpdateContextSecret(),
      )
    : null;
  if (!data.user || !context) redirect("/login?error=password-context-required");

  return (
    <Card className="py-0 shadow-sm">
      <CardHeader className="border-b px-6 py-7">
        <CardTitle as="h1" className="text-3xl font-bold">
          Choose a new password
        </CardTitle>
        <CardDescription className="text-base">
          This one-time form is available for 30 minutes after you verify an invitation or reset
          link.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-6 py-7">
        <UpdatePasswordForm />
      </CardContent>
    </Card>
  );
}
