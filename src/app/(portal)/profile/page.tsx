import type { Metadata } from "next";
import Link from "next/link";
import { Mail, ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/portal/page-header";
import { StatusBadge } from "@/components/portal/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requirePortalViewer } from "@/lib/dal/access";
import { formatRoleLabel } from "@/lib/domain/roles";
import { googleLoginAction } from "@/app/actions/auth-actions";
import { getServerEnvironment } from "@/lib/env";
import { isSchoolGoogleEmail } from "@/lib/auth/sign-in-policy";

export const metadata: Metadata = { title: "My profile" };

export default async function ProfilePage() {
  const viewer = await requirePortalViewer();

  return (
    <div className="page-container">
      <PageHeader
        title="My profile"

        actions={
          viewer.isMember ? <Button render={<Link href="/hours/new" />}>Log Hours</Button> : null
        }
      />

      <section aria-labelledby="account-heading" className="border-b pb-8">
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
              {viewer.isAdmin ? (
                <Badge variant="outline">Admin</Badge>
              ) : (
                viewer.roles.map((role) => (
                  <Badge key={role} variant="outline" className="capitalize">
                    {formatRoleLabel(role)}
                  </Badge>
                ))
              )}
            </dd>
          </div>
        </dl>
        {isSchoolGoogleEmail(viewer.email, getServerEnvironment()) ? (
          <div className="mt-5 flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">
              School Google sign-in works without a portal password. You can also choose a password
              of at least 6 characters as a fallback.
            </p>
            <form action={googleLoginAction}>
              <input type="hidden" name="email" value={viewer.email} />
              <input type="hidden" name="next" value="/update-password" />
              <Button type="submit" variant="outline">
                Set or change portal password
              </Button>
            </form>
          </div>
        ) : (
          <Link
            href="/forgot-password"
            className="mt-5 block text-sm font-medium text-primary underline"
          >
            Change your portal password
          </Link>
        )}
      </section>
    </div>
  );
}
