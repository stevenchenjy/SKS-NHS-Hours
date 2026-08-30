import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";

import { changeSchoolYearStatusAction } from "@/app/actions/admin-actions";
import { CreateSchoolYearForm, SchoolYearDatesForm } from "@/components/admin/settings-forms";
import { PageHeader } from "@/components/portal/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireTeacherAdmin } from "@/lib/dal/access";
import { listSchoolYears } from "@/lib/dal/portal";

export const metadata: Metadata = { title: "School years" };

function displayStatus(input: {
  status: string;
  startDate: string;
  endDate: string;
  today: string;
}): string {
  if (input.status === "archived") return "Archived";
  if (input.status === "draft") return "Setup";
  if (input.endDate < input.today) return "Ended";
  if (input.startDate > input.today) return "Upcoming";
  return "Current";
}

export default async function SchoolYearsSettingsPage() {
  await requireTeacherAdmin();
  const years = await listSchoolYears();
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="page-container">
      <PageHeader
        title="School years"
        description="Set each school year's start and end dates. Access follows those dates automatically, so no manual year closure is required."
      />

      <section aria-labelledby="year-list-heading" className="mb-10">
        <h2 id="year-list-heading" className="mb-4 text-2xl font-bold">
          School-year records
        </h2>
        <div className="divide-y rounded-xl border">
          {years.map((year) => {
            const activate = changeSchoolYearStatusAction.bind(null, year.id, "activate");
            return (
              <article
                key={year.id}
                className="grid gap-5 p-5 lg:grid-cols-[minmax(180px,0.45fr)_minmax(420px,1.2fr)_auto] lg:items-start"
              >
                <div>
                  <h3 className="text-lg font-bold">{year.label}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">20 approved hours required</p>
                </div>
                <SchoolYearDatesForm schoolYear={year} />
                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                  <Badge variant="outline" className="w-fit">
                    {displayStatus({
                      status: year.status,
                      startDate: year.start_date,
                      endDate: year.end_date,
                      today,
                    })}
                  </Badge>
                  {year.status === "draft" ? (
                    <form action={activate}>
                      <Button type="submit" size="sm">
                        <CheckCircle2 data-icon="inline-start" aria-hidden="true" />
                        Activate
                      </Button>
                    </form>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="create-year-heading" className="max-w-3xl rounded-xl border p-6">
        <h2 id="create-year-heading" className="text-xl font-bold">
          Create the next school year
        </h2>
        <p className="mb-6 mt-1 text-sm leading-6 text-muted-foreground">
          A new year starts as a draft with the fixed 20-hour requirement. Add member and leadership
          access from Accounts; global administrators need no annual assignment. Dates remain
          editable after activation.
        </p>
        <CreateSchoolYearForm />
      </section>
    </div>
  );
}
