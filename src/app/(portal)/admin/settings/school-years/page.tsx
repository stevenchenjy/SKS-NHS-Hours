import type { Metadata } from "next";
import { Archive, CheckCircle2 } from "lucide-react";

import { changeSchoolYearStatusAction } from "@/app/actions/admin-actions";
import { CreateSchoolYearForm, RenewMembershipForm } from "@/components/admin/settings-forms";
import { PageHeader } from "@/components/portal/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireTeacherAdmin } from "@/lib/dal/access";
import { listAccountDirectory, listSchoolYears } from "@/lib/dal/portal";

export const metadata: Metadata = { title: "School years" };

export default async function SchoolYearsSettingsPage() {
  const viewer = await requireTeacherAdmin();
  const years = await listSchoolYears();
  const accounts = await listAccountDirectory(viewer.activeMembership.school_year_id);

  return (
    <div className="page-container">
      <PageHeader
        title="School years"
        description="Create, activate, close, and roll memberships forward without overwriting prior-year records."
      />

      <section aria-labelledby="year-list-heading" className="mb-10">
        <h2 id="year-list-heading" className="mb-4 text-2xl font-bold">
          School-year records
        </h2>
        <div className="divide-y rounded-xl border">
          {years.map((year) => {
            const activate = changeSchoolYearStatusAction.bind(null, year.id, "activate");
            const close = changeSchoolYearStatusAction.bind(null, year.id, "close");
            return (
              <article
                key={year.id}
                className="grid gap-4 p-5 lg:grid-cols-[minmax(180px,0.6fr)_minmax(260px,1fr)_150px_auto] lg:items-center"
              >
                <div>
                  <h3 className="text-lg font-bold">{year.label}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {year.start_date} – {year.end_date}
                  </p>
                </div>
                <p className="text-sm text-muted-foreground">
                  Default target:{" "}
                  <strong className="text-foreground">{year.default_target_hours} hours</strong>
                </p>
                <Badge variant="outline" className="w-fit capitalize">
                  {year.status}
                </Badge>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  {year.status === "draft" ? (
                    <form action={activate}>
                      <Button type="submit" size="sm">
                        <CheckCircle2 data-icon="inline-start" aria-hidden="true" />
                        Activate
                      </Button>
                    </form>
                  ) : null}
                  {["draft", "active"].includes(year.status) ? (
                    <form action={close}>
                      <Button type="submit" size="sm" variant="outline">
                        <Archive data-icon="inline-start" aria-hidden="true" />
                        Close year
                      </Button>
                    </form>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <div className="grid gap-8 xl:grid-cols-2">
        <section aria-labelledby="create-year-heading" className="rounded-xl border p-6">
          <h2 id="create-year-heading" className="text-xl font-bold">
            Create the next school year
          </h2>
          <p className="mb-6 mt-1 text-sm leading-6 text-muted-foreground">
            A new year starts as a draft. Add a teacher administrator membership before activation.
          </p>
          <CreateSchoolYearForm />
        </section>
        <section aria-labelledby="rollover-heading" className="rounded-xl border p-6 xl:row-span-2">
          <h2 id="rollover-heading" className="text-xl font-bold">
            School-year rollover
          </h2>
          <p className="mb-6 mt-1 text-sm leading-6 text-muted-foreground">
            Renew one selected identity at a time. Each confirmation creates a destination-year
            membership and keeps the source history read-only.
          </p>
          <RenewMembershipForm years={years} accounts={accounts} />
        </section>
      </div>
    </div>
  );
}
