import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CalendarDays, Mail } from "lucide-react";

import { PageHeader } from "@/components/portal/page-header";
import { ProgressSummary, formatHours } from "@/components/portal/progress-summary";
import { StatusBadge } from "@/components/portal/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireReviewer } from "@/lib/dal/access";
import { canViewMemberProgress } from "@/lib/domain/roles";
import {
  getProfileRecord,
  getProgress,
  listMemberRequests,
  listMembershipsForProfile,
} from "@/lib/dal/portal";
import { deriveAnnualAccessStatus } from "@/lib/domain";
import { formatRoleLabel } from "@/lib/domain/roles";
import type { HourRequest } from "@/lib/types";

export const metadata: Metadata = { title: "Member profile" };

function categoryName(category: HourRequest["category"]): string {
  if (!category) return "Uncategorized";
  return Array.isArray(category) ? (category[0]?.name ?? "Uncategorized") : category.name;
}

export default async function MemberProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireReviewer();
  if (!canViewMemberProgress(viewer)) redirect("/admin/requests?notice=not-authorized");
  const { id } = await params;
  const yearValue = (await searchParams).year;
  const requestedYear = Array.isArray(yearValue) ? yearValue[0] : yearValue;
  let profile;
  let memberships;
  try {
    [profile, memberships] = await Promise.all([
      getProfileRecord(id),
      listMembershipsForProfile(id),
    ]);
  } catch {
    notFound();
  }
  const selectedMembership =
    memberships.find((membership) => membership.school_year_id === requestedYear) ?? memberships[0];
  if (!selectedMembership) notFound();
  const today = new Date().toISOString().slice(0, 10);
  const annualStatus = (membership: (typeof memberships)[number]) =>
    deriveAnnualAccessStatus({
      profileStatus: profile.status,
      membershipStatus: membership.status,
      membershipExpirationDate: membership.expiration_date,
      schoolYearStatus: membership.school_year.status,
      schoolYearStartDate: membership.school_year.start_date,
      schoolYearEndDate: membership.school_year.end_date,
      onDate: today,
    });
  const [progress, requests] = await Promise.all([
    getProgress(selectedMembership.id),
    listMemberRequests(
      memberships.map((membership) => membership.id),
      selectedMembership.school_year_id,
    ),
  ]);
  const approvedByCategory = new Map<string, number>();
  for (const request of requests) {
    if (request.status !== "approved" || request.hours == null) continue;
    const category = categoryName(request.category);
    approvedByCategory.set(
      category,
      (approvedByCategory.get(category) ?? 0) + Number(request.hours),
    );
  }

  return (
    <div className="page-container">
      <PageHeader
        eyebrow={
          <Link href="/admin/members" className="inline-flex items-center gap-2 hover:underline">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to members
          </Link>
        }
        title={profile.full_name}
        description={
          <span className="inline-flex flex-wrap items-center gap-x-5 gap-y-2">
            <span className="inline-flex items-center gap-2">
              <Mail className="size-4" aria-hidden="true" /> {profile.email}
            </span>
            <span className="inline-flex items-center gap-2">
              Account <StatusBadge status={profile.status} />
            </span>
            <span className="inline-flex items-center gap-2">
              {selectedMembership.school_year.label} access
              <StatusBadge status={annualStatus(selectedMembership)} />
            </span>
          </span>
        }
      />

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.6fr)]">
        <div className="space-y-8">
          <section aria-labelledby="progress-title" className="rounded-xl border p-6">
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 id="progress-title" className="text-xl font-bold">
                  {selectedMembership.school_year.label} progress
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Only approved requests count toward this total.
                </p>
              </div>
              <form>
                <label htmlFor="year" className="sr-only">
                  School year
                </label>
                <select
                  id="year"
                  name="year"
                  defaultValue={selectedMembership.school_year_id}
                  className="h-10 rounded-lg border bg-background px-3 text-sm"
                  onChange={undefined}
                >
                  {memberships.map((membership) => (
                    <option key={membership.id} value={membership.school_year_id}>
                      {membership.school_year.label}
                    </option>
                  ))}
                </select>
                <Button type="submit" variant="outline" size="sm" className="ml-2">
                  View
                </Button>
              </form>
            </div>
            <ProgressSummary progress={progress} />
          </section>

          <section aria-labelledby="log-title">
            <div className="mb-4">
              <h2 id="log-title" className="text-2xl font-bold">
                Complete service log
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Every request and its review-safe status for this school year.
              </p>
            </div>
            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/60 hover:bg-muted/60">
                    <TableHead className="pl-5">Activity</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Hours</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="pr-5 text-right">
                      <span className="sr-only">Open</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.length ? (
                    requests.map((request) => (
                      <TableRow key={request.id}>
                        <TableCell className="pl-5 font-semibold">
                          {request.title ?? "Untitled draft"}
                        </TableCell>
                        <TableCell>{categoryName(request.category)}</TableCell>
                        <TableCell>{request.service_date ?? "—"}</TableCell>
                        <TableCell>
                          {request.hours == null ? "—" : formatHours(Number(request.hours))}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={request.status} />
                        </TableCell>
                        <TableCell className="pr-5 text-right">
                          <Button
                            render={<Link href={`/admin/requests/${request.id}`} />}
                            variant="ghost"
                            size="sm"
                          >
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                        No service requests for this school year.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <section className="rounded-xl border p-5">
            <h2 className="font-semibold">Memberships and roles</h2>
            <div className="mt-4 space-y-4">
              {memberships.map((membership) => (
                <article key={membership.id} className="border-t pt-4 first:border-t-0 first:pt-0">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold">{membership.school_year.label}</h3>
                    <StatusBadge status={annualStatus(membership)} />
                  </div>
                  <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                    <CalendarDays className="size-4" aria-hidden="true" /> Expires{" "}
                    {membership.expiration_date}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {membership.roles.map((role) => (
                      <Badge key={role} variant="outline" className="capitalize">
                        {formatRoleLabel(role)}
                      </Badge>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
          <section className="rounded-xl border p-5">
            <h2 className="font-semibold">Approved category totals</h2>
            <dl className="mt-4 divide-y">
              {[...approvedByCategory.entries()].map(([category, total]) => (
                <div
                  key={category}
                  className="flex justify-between gap-4 py-3 first:pt-0 last:pb-0"
                >
                  <dt className="text-sm text-muted-foreground">{category}</dt>
                  <dd className="text-sm font-semibold">{formatHours(total)}</dd>
                </div>
              ))}
              {approvedByCategory.size === 0 ? (
                <p className="text-sm text-muted-foreground">No approved category totals yet.</p>
              ) : null}
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}
