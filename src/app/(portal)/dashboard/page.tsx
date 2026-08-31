import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertCircle, ArrowRight, ClipboardList, Plus } from "lucide-react";

import { PageHeader } from "@/components/portal/page-header";
import { ProgressSummary, formatHours } from "@/components/portal/progress-summary";
import { StatusBadge } from "@/components/portal/status-badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requirePortalViewer } from "@/lib/dal/access";
import { getProgress, listCategories, listMemberRequests, listSchoolYears } from "@/lib/dal/portal";
import type { HourRequest, HourRequestStatus, ServiceCategory } from "@/lib/types";

export const metadata: Metadata = { title: "Dashboard" };

function relationName(category: HourRequest["category"]): string {
  if (!category) return "Uncategorized";
  return Array.isArray(category) ? (category[0]?.name ?? "Uncategorized") : category.name;
}

function date(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function requestTitle(value: string | null): string {
  return value ?? "Untitled draft";
}

function requestHours(value: number | string | null): string {
  return value == null ? "—" : formatHours(Number(value));
}

function stringParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requirePortalViewer();
  if (!viewer.isMember) redirect("/admin/members");
  const params = await searchParams;
  const selectedYearId = stringParam(params.year) ?? viewer.activeMembership.school_year_id;
  const selectedStatus = stringParam(params.status);
  const selectedCategory = stringParam(params.category);
  const membershipIds = viewer.memberships.map((membership) => membership.id);

  const [progress, requests, years, categories] = await Promise.all([
    getProgress(viewer.activeMembership.id),
    listMemberRequests(membershipIds, selectedYearId),
    listSchoolYears(),
    listCategories(selectedYearId),
  ]);

  const filtered = requests.filter(
    (request) =>
      (!selectedStatus || request.status === selectedStatus) &&
      (!selectedCategory || request.category_id === selectedCategory),
  );
  const changesRequested = requests.filter((request) => request.status === "changes_requested");
  const recent = filtered.slice(0, 8);

  return (
    <div className="page-container">
      <PageHeader
        eyebrow={viewer.activeMembership.school_year.label}
        title="Your service progress"
        description={
          <>
            Welcome, {viewer.profile.full_name}. Only approved hours count toward your annual
            requirement.
          </>
        }
        actions={
          <Button render={<Link href="/hours/new" />} size="lg" className="h-10 px-4">
            <Plus data-icon="inline-start" aria-hidden="true" />
            Log Hours
          </Button>
        }
      />

      <section aria-labelledby="progress-heading" className="border-b pb-8">
        <h2 id="progress-heading" className="sr-only">
          Approved-hours progress
        </h2>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="rounded-xl border bg-background p-5 shadow-[0_1px_8px_rgba(11,23,54,0.05)] sm:p-7">
            <div className="mb-6 flex items-end justify-between gap-5">
              <div>
                <p className="text-sm font-semibold text-muted-foreground">Approved hours</p>
                <p className="mt-1 text-5xl font-bold tracking-tight">
                  {formatHours(Number(progress.approved_hours))}
                  <span className="ml-2 text-xl font-medium text-muted-foreground">
                    / {formatHours(Number(progress.target_hours))}
                  </span>
                </p>
              </div>
              <StatusBadge
                status={Number(progress.remaining_hours) > 0 ? "below_goal" : "at_goal"}
                className="hidden sm:inline-flex"
              />
            </div>
            <ProgressSummary progress={progress} />
          </div>
          <dl className="grid grid-cols-2 divide-x rounded-xl border lg:min-w-[310px]">
            <div className="p-5">
              <dt className="text-sm text-muted-foreground">Pending</dt>
              <dd className="mt-1 text-3xl font-bold text-[var(--status-pending)]">
                {formatHours(Number(progress.pending_hours))}
              </dd>
            </div>
            <div className="p-5">
              <dt className="text-sm text-muted-foreground">
                {Number(progress.over_goal_hours) > 0 ? "Over goal" : "Remaining"}
              </dt>
              <dd className="mt-1 text-3xl font-bold">
                {formatHours(
                  Number(progress.over_goal_hours) > 0
                    ? Number(progress.over_goal_hours)
                    : Number(progress.remaining_hours),
                )}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      {changesRequested.length > 0 ? (
        <section
          aria-labelledby="attention-heading"
          className="my-7 flex flex-col gap-4 rounded-xl border border-[var(--status-pending)]/30 bg-[var(--status-pending-bg)] p-5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex gap-3">
            <AlertCircle
              className="mt-0.5 size-5 shrink-0 text-[var(--status-pending)]"
              aria-hidden="true"
            />
            <div>
              <h2 id="attention-heading" className="font-semibold">
                {changesRequested.length} request{changesRequested.length === 1 ? "" : "s"} need
                your changes
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Review the leader’s comment, update the activity, and resubmit it.
              </p>
            </div>
          </div>
          <Button
            render={<Link href={`/hours/${changesRequested[0]?.id}/edit`} />}
            variant="outline"
          >
            Review feedback
            <ArrowRight data-icon="inline-end" aria-hidden="true" />
          </Button>
        </section>
      ) : null}

      <section aria-labelledby="history-heading" className="mt-8">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 id="history-heading" className="text-2xl font-bold tracking-tight">
              Service history
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Draft, pending, reviewed, and withdrawn requests remain visible.
            </p>
          </div>
          <form className="grid gap-2 sm:grid-cols-4" aria-label="Filter service history">
            <label className="sr-only" htmlFor="year">
              School year
            </label>
            <select
              id="year"
              name="year"
              defaultValue={selectedYearId}
              className="h-10 rounded-lg border bg-background px-3 text-sm"
            >
              {years.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.label}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor="status">
              Status
            </label>
            <select
              id="status"
              name="status"
              defaultValue={selectedStatus ?? ""}
              className="h-10 rounded-lg border bg-background px-3 text-sm"
            >
              <option value="">All statuses</option>
              {(
                [
                  "draft",
                  "pending",
                  "changes_requested",
                  "approved",
                  "rejected",
                  "withdrawn",
                ] satisfies HourRequestStatus[]
              ).map((status) => (
                <option key={status} value={status}>
                  {status.replaceAll("_", " ")}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor="category">
              Category
            </label>
            <select
              id="category"
              name="category"
              defaultValue={selectedCategory ?? ""}
              className="h-10 rounded-lg border bg-background px-3 text-sm"
            >
              <option value="">All categories</option>
              {categories.map((category: ServiceCategory) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <Button type="submit" variant="outline" className="h-10">
              Apply filters
            </Button>
          </form>
        </div>

        {recent.length === 0 ? (
          <Empty className="min-h-64 border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ClipboardList />
              </EmptyMedia>
              <EmptyTitle>No service requests found</EmptyTitle>
              <EmptyDescription>
                Log a new activity or change the filters to see other school years.
              </EmptyDescription>
            </EmptyHeader>
            <Button render={<Link href="/hours/new" />}>Log Hours</Button>
          </Empty>
        ) : (
          <>
            <div className="hidden overflow-hidden rounded-xl border md:block">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/60 hover:bg-muted/60">
                    <TableHead className="pl-5">Activity</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Service date</TableHead>
                    <TableHead>Hours</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="pr-5 text-right">
                      <span className="sr-only">Open</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recent.map((request) => (
                    <TableRow key={request.id}>
                      <TableCell className="max-w-[320px] truncate pl-5 font-semibold">
                        {requestTitle(request.title)}
                      </TableCell>
                      <TableCell>{relationName(request.category)}</TableCell>
                      <TableCell>{date(request.service_date)}</TableCell>
                      <TableCell>{requestHours(request.hours)}</TableCell>
                      <TableCell>
                        <StatusBadge status={request.status} />
                      </TableCell>
                      <TableCell className="pr-5 text-right">
                        <Button
                          render={
                            <Link
                              href={
                                request.status === "draft" || request.status === "changes_requested"
                                  ? `/hours/${request.id}/edit`
                                  : `/hours/${request.id}`
                              }
                            />
                          }
                          variant="ghost"
                          size="sm"
                        >
                          {request.status === "draft" || request.status === "changes_requested"
                            ? "Edit"
                            : "View"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="space-y-3 md:hidden">
              {recent.map((request) => (
                <Link
                  key={request.id}
                  href={
                    request.status === "draft" || request.status === "changes_requested"
                      ? `/hours/${request.id}/edit`
                      : `/hours/${request.id}`
                  }
                  className="block rounded-xl border p-4 transition-colors hover:bg-muted/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">{requestTitle(request.title)}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {relationName(request.category)} · {date(request.service_date)}
                      </p>
                    </div>
                    <StatusBadge status={request.status} />
                  </div>
                  <p className="mt-4 text-sm font-semibold">
                    {request.hours == null ? "—" : `${requestHours(request.hours)} hours`}
                  </p>
                </Link>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
