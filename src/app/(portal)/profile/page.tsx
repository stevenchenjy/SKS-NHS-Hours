import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Mail, ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/portal/page-header";
import { ProgressSummary } from "@/components/portal/progress-summary";
import { StatusBadge } from "@/components/portal/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireActiveViewer } from "@/lib/dal/access";
import { getProgress } from "@/lib/dal/portal";

export const metadata: Metadata = { title: "My profile" };

export default async function ProfilePage() {
  const viewer = await requireActiveViewer();
  const progressResults = await Promise.allSettled(
    viewer.memberships.map((membership) => getProgress(membership.id)),
  );

  return (
    <div className="page-container">
      <PageHeader
        title="My profile"
        description="Your account identity, school-year memberships, roles, and progress history."
        actions={<Button render={<Link href="/hours/new" />}>Log Hours</Button>}
      />

      <section
        aria-labelledby="account-heading"
        className="grid gap-6 border-b pb-8 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.55fr)]"
      >
        <div>
          <h2 id="account-heading" className="text-xl font-bold">
            Account summary
          </h2>
          <dl className="mt-5 grid gap-5 rounded-xl border p-5 sm:grid-cols-2">
            <div>
              <dt className="flex items-center gap-2 text-sm text-muted-foreground">
                <ShieldCheck className="size-4" aria-hidden="true" /> Full name
              </dt>
              <dd className="mt-1 font-semibold">{viewer.profile.full_name}</dd>
            </div>
            <div>
              <dt className="flex items-center gap-2 text-sm text-muted-foreground">
                <Mail className="size-4" aria-hidden="true" /> School email
              </dt>
              <dd className="mt-1 break-all font-semibold">{viewer.profile.email}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Account status</dt>
              <dd className="mt-1">
                <StatusBadge status={viewer.profile.status === "active" ? "active" : "suspended"} />
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Current roles</dt>
              <dd className="mt-1 flex flex-wrap gap-1.5">
                {viewer.roles.map((role) => (
                  <Badge key={role} variant="outline" className="capitalize">
                    {role.replaceAll("_", " ")}
                  </Badge>
                ))}
              </dd>
            </div>
          </dl>
        </div>
        <aside className="rounded-xl border bg-muted/45 p-5">
          <h2 className="font-semibold">Account help</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Names, roles, and membership dates are managed by a teacher administrator. Contact the
            NHS adviser if anything is incorrect.
          </p>
        </aside>
      </section>

      <section aria-labelledby="membership-history" className="mt-8">
        <div className="mb-5">
          <h2 id="membership-history" className="text-2xl font-bold">
            School-year history
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Prior years remain read-only after rollover.
          </p>
        </div>
        <div className="space-y-4">
          {viewer.memberships.map((membership, index) => {
            const result = progressResults[index];
            const progress = result?.status === "fulfilled" ? result.value : null;
            return (
              <article key={membership.id} className="rounded-xl border p-5 sm:p-6">
                <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-xl font-bold">{membership.school_year.label}</h3>
                    <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                      <CalendarDays className="size-4" aria-hidden="true" />
                      {membership.school_year.start_date} through {membership.school_year.end_date}
                    </p>
                  </div>
                  <StatusBadge status={membership.status} />
                </div>
                <div className="mb-5 flex flex-wrap gap-2">
                  {membership.roles.map((role) => (
                    <Badge key={role} variant="outline" className="capitalize">
                      {role.replaceAll("_", " ")}
                    </Badge>
                  ))}
                </div>
                {progress ? (
                  <ProgressSummary progress={progress} compact />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No progress record is available for this membership.
                  </p>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
