import type { Metadata } from "next";
import { Download, FileSpreadsheet } from "lucide-react";

import { PageHeader } from "@/components/portal/page-header";
import { Button } from "@/components/ui/button";
import { requireTeacherAdmin } from "@/lib/dal/access";
import { listSchoolYears } from "@/lib/dal/portal";

export const metadata: Metadata = { title: "Exports" };

const exports = [
  [
    "progress",
    "Current member progress",
    "Approved, pending, remaining, over-goal, role, and membership values.",
  ],
  [
    "hours",
    "Complete hour records",
    "Every service record with requested and actual reviewer identifiers.",
  ],
  ["pending", "Pending requests", "The current review queue for follow-up."],
  ["approved", "Approved requests", "Approved service records for school administration."],
  [
    "categories",
    "Category summaries",
    "Approved and pending hours grouped by member and category.",
  ],
  ["directory", "Membership directory", "Provisioned account and school-year access records."],
  ["archive", "School-year archive", "A complete record export suitable for archive storage."],
] as const;

function param(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function ExportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireTeacherAdmin();
  const params = await searchParams;
  const years = await listSchoolYears();
  const yearId = param(params.year) || viewer.activeMembership.school_year_id;

  return (
    <div className="page-container">
      <PageHeader
        title="Exports"
        description="Every CSV is authorized and generated on the server, neutralizes spreadsheet formulas, and records an audit event."
      />
      <form className="mb-6 rounded-xl border bg-muted/35 p-4">
        <label htmlFor="export-year" className="mr-3 text-sm font-semibold">
          School year
        </label>
        <select
          id="export-year"
          name="year"
          defaultValue={yearId}
          className="h-10 rounded-lg border bg-background px-3 text-sm"
        >
          {years.map((year) => (
            <option key={year.id} value={year.id}>
              {year.label} · {year.status}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline" className="ml-2 h-10">
          View
        </Button>
      </form>
      <div className="divide-y rounded-xl border">
        {exports.map(([type, label, description]) => (
          <article
            key={type}
            className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-primary">
                <FileSpreadsheet className="size-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="font-semibold">{label}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{description}</p>
              </div>
            </div>
            <Button render={<a href={`/api/exports/${type}?year=${yearId}`} />} variant="outline">
              <Download data-icon="inline-start" aria-hidden="true" />
              Download CSV
            </Button>
          </article>
        ))}
      </div>
      <aside className="mt-6 rounded-xl border border-[var(--status-pending)]/30 bg-[var(--status-pending-bg)] p-5 text-sm leading-6 text-muted-foreground">
        <strong className="text-foreground">Handle student records carefully.</strong> Store exports
        only in school-approved locations, share them with authorized staff, and delete local copies
        according to school retention policy.
      </aside>
    </div>
  );
}
