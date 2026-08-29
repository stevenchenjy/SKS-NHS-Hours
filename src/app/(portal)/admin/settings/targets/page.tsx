import type { Metadata } from "next";

import { TargetOverrideForm } from "@/components/admin/settings-forms";
import { PageHeader } from "@/components/portal/page-header";
import { Button } from "@/components/ui/button";
import { requireTeacherAdmin } from "@/lib/dal/access";
import { listAccountDirectory, listSchoolYears } from "@/lib/dal/portal";

export const metadata: Metadata = { title: "Member targets" };

function param(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function TargetSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireTeacherAdmin();
  const params = await searchParams;
  const years = await listSchoolYears();
  const yearId = param(params.year) || viewer.activeMembership.school_year_id;
  const year = years.find((item) => item.id === yearId);
  const accounts = await listAccountDirectory(yearId);

  return (
    <div className="page-container">
      <PageHeader
        title="Member targets"
        description={`The ${year?.label ?? "selected"} default is ${year?.default_target_hours ?? 20} hours. Blank overrides inherit that value.`}
      />
      <form className="mb-5">
        <label htmlFor="target-year" className="sr-only">
          School year
        </label>
        <select
          id="target-year"
          name="year"
          defaultValue={yearId}
          className="h-10 rounded-lg border bg-background px-3 text-sm"
        >
          {years.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline" className="ml-2 h-10">
          View
        </Button>
      </form>
      <div className="divide-y rounded-xl border">
        {accounts.map(({ profile, membership }) => (
          <article
            key={membership.id}
            className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <h2 className="font-semibold">{profile.full_name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {membership.target_hours_override === null
                  ? "Uses school-year default"
                  : `${membership.target_hours_override} hour override`}
              </p>
            </div>
            <TargetOverrideForm membership={membership} />
          </article>
        ))}
      </div>
    </div>
  );
}
