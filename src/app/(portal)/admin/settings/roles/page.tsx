import type { Metadata } from "next";
import Link from "next/link";
import { X } from "lucide-react";

import { assignRoleAction, removeRoleAction } from "@/app/actions/admin-actions";
import { PageHeader } from "@/components/portal/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireTeacherAdmin } from "@/lib/dal/access";
import { listAccountDirectory, listRoleRecords, listSchoolYears } from "@/lib/dal/portal";

export const metadata: Metadata = { title: "School-year roles" };

function param(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function RoleSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireTeacherAdmin();
  const params = await searchParams;
  const years = await listSchoolYears();
  const yearId = param(params.year) || viewer.activeMembership.school_year_id;
  const [accounts, roles] = await Promise.all([listAccountDirectory(yearId), listRoleRecords()]);

  return (
    <div className="page-container">
      <PageHeader
        title="School-year roles"
        description="Roles belong to a membership, may be combined, and automatically lose active authority when that membership expires."
      />
      <div className="mb-5 flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          The database prevents removal of the final active teacher administrator.
        </p>
        <form>
          <label htmlFor="roles-year" className="sr-only">
            School year
          </label>
          <select
            id="roles-year"
            name="year"
            defaultValue={yearId}
            className="h-10 rounded-lg border bg-background px-3 text-sm"
          >
            {years.map((year) => (
              <option key={year.id} value={year.id}>
                {year.label}
              </option>
            ))}
          </select>
          <Button type="submit" variant="outline" className="ml-2 h-10">
            View
          </Button>
        </form>
      </div>
      <div className="divide-y rounded-xl border">
        {accounts.map(({ profile, membership }) => {
          const assign = assignRoleAction.bind(null, membership.id);
          return (
            <article
              key={membership.id}
              className="grid gap-5 p-5 lg:grid-cols-[minmax(220px,0.7fr)_minmax(360px,1.3fr)_auto] lg:items-center"
            >
              <div>
                <Link
                  href={`/admin/members/${profile.id}`}
                  className="font-semibold hover:underline"
                >
                  {profile.full_name}
                </Link>
                <p className="mt-1 text-xs text-muted-foreground">{profile.email}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {membership.roles.map((role) => {
                  const remove = removeRoleAction.bind(null, membership.id, role);
                  return (
                    <Badge key={role} variant="outline" className="h-7 gap-1.5 capitalize">
                      {role.replaceAll("_", " ")}
                      {role !== "member" ? (
                        <form action={remove} className="inline-flex">
                          <button
                            type="submit"
                            aria-label={`Remove ${role.replaceAll("_", " ")} from ${profile.full_name}`}
                            className="rounded-sm p-0.5 hover:bg-muted"
                          >
                            <X className="size-3" aria-hidden="true" />
                          </button>
                        </form>
                      ) : null}
                    </Badge>
                  );
                })}
              </div>
              <form action={assign} className="flex gap-2">
                <label className="sr-only" htmlFor={`assign-${membership.id}`}>
                  Assign role to {profile.full_name}
                </label>
                <select
                  id={`assign-${membership.id}`}
                  name="role"
                  className="h-9 rounded-lg border bg-background px-2 text-sm"
                >
                  {roles
                    .filter((role) => !membership.roles.includes(role.role_key))
                    .map((role) => (
                      <option key={role.id} value={role.role_key}>
                        {role.display_name}
                      </option>
                    ))}
                </select>
                <Button type="submit" variant="outline" size="sm">
                  Assign
                </Button>
              </form>
            </article>
          );
        })}
      </div>
    </div>
  );
}
