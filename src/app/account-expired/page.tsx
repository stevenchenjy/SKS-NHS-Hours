import type { Metadata } from "next";
import { Archive, LogOut } from "lucide-react";

import { signOutAction } from "@/app/actions/auth-actions";
import { StatusBadge } from "@/components/portal/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getViewer } from "@/lib/dal/access";

export const metadata: Metadata = { title: "Membership inactive" };

export default async function AccountExpiredPage() {
  const viewer = await getViewer();
  const latest = viewer?.memberships[0];
  return (
    <main
      id="main-content"
      className="flex min-h-dvh items-center justify-center bg-muted px-5 py-12"
    >
      <Card className="w-full max-w-2xl py-0 shadow-sm">
        <CardHeader className="border-b px-7 py-7">
          <span className="mb-3 flex size-11 items-center justify-center rounded-full bg-[var(--status-neutral-bg)] text-[var(--status-neutral)]">
            <Archive aria-hidden="true" className="size-5" />
          </span>
          <CardTitle as="h1" className="text-3xl font-bold">
            Your NHS membership is not active
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 px-7 py-7">
          <p className="text-base leading-7 text-muted-foreground">
            You can sign in, but you cannot submit or review service hours until a teacher
            administrator renews or reactivates your school-year membership.
          </p>
          {latest ? (
            <dl className="grid gap-4 rounded-lg border bg-background p-5 sm:grid-cols-3">
              <div>
                <dt className="text-sm text-muted-foreground">School year</dt>
                <dd className="mt-1 font-semibold">{latest.school_year.label}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Membership</dt>
                <dd className="mt-1">
                  <StatusBadge status={latest.status} />
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Expiration date</dt>
                <dd className="mt-1 font-semibold">{latest.expiration_date}</dd>
              </div>
            </dl>
          ) : null}
          <div className="flex flex-col gap-3 border-t pt-6 sm:flex-row">
            <p className="flex-1 text-sm leading-6 text-muted-foreground">
              Contact your NHS adviser through the school’s usual channel to request renewal.
            </p>
            <form action={signOutAction}>
              <Button type="submit" variant="outline" className="w-full sm:w-auto">
                <LogOut data-icon="inline-start" aria-hidden="true" />
                Sign out
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
