import type { Metadata } from "next";
import Link from "next/link";
import { Mail, ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/portal/page-header";
import { StatusBadge } from "@/components/portal/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireActiveViewer } from "@/lib/dal/access";
import { formatRoleLabel } from "@/lib/domain/roles";

export const metadata: Metadata = { title: "My profile" };

export default async function ProfilePage() {
  const viewer = await requireActiveViewer();

  return (
    <div className="page-container">
      <PageHeader
        title="My profile"
        description="Your account identity and current roles."
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
                <StatusBadge status={viewer.profile.status} />
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Current roles</dt>
              <dd className="mt-1 flex flex-wrap gap-1.5">
                {viewer.roles.map((role) => (
                  <Badge key={role} variant="outline" className="capitalize">
                    {formatRoleLabel(role)}
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
    </div>
  );
}
