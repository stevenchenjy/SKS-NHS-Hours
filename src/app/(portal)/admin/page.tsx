import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Clock3 } from "lucide-react";

import { MetricRail } from "@/components/portal/metric-rail";
import { PageHeader } from "@/components/portal/page-header";
import { ProgressSummary, formatHours } from "@/components/portal/progress-summary";
import { StatusBadge } from "@/components/portal/status-badge";
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
import { listAccountDirectory, listPendingQueue, listRosterProgress } from "@/lib/dal/portal";

export const metadata: Metadata = { title: "NHS overview" };

export default async function AdminOverviewPage() {
  const viewer = await requireReviewer();
  const schoolYearId = viewer.activeMembership.school_year_id;
  const [queue, roster, directory] = await Promise.all([
    listPendingQueue(schoolYearId),
    listRosterProgress(schoolYearId),
    viewer.isTeacherAdmin ? listAccountDirectory(schoolYearId) : Promise.resolve([]),
  ]);
  const assigned = queue.filter((request) => request.assigned_to_current_user);
  const activeRoster = roster.filter((member) => member.membership_status === "active");
  const membersAtGoal = activeRoster.filter(
    (member) => Number(member.remaining_hours) === 0,
  ).length;
  const membersBelowGoal = activeRoster.filter(
    (member) => Number(member.remaining_hours) > 0,
  ).length;
  const approvedHours = activeRoster.reduce(
    (total, member) => total + Number(member.approved_hours),
    0,
  );
  const waiting = queue.slice(0, 6);
  const today = new Date().toISOString().slice(0, 10);
  const attentionMemberships = directory
    .filter((record) => record.globalAccessLevel === null)
    .filter(
      (record): record is typeof record & { membership: NonNullable<typeof record.membership> } =>
        record.membership !== null,
    )
    .filter(({ membership }) => {
      const days = Math.ceil(
        (new Date(`${membership.expiration_date}T12:00:00`).getTime() -
          new Date(`${today}T12:00:00`).getTime()) /
          86_400_000,
      );
      return membership.status !== "active" || days <= 30;
    })
    .slice(0, 5);
  const needsAttention = activeRoster
    .filter((member) => Number(member.remaining_hours) > 0)
    .sort((a, b) => Number(b.actual_percentage) - Number(a.actual_percentage))
    .slice(0, 6);

  return (
    <div className="page-container">
      <PageHeader
        eyebrow={viewer.activeMembership.school_year.label}
        title="NHS overview"
        description="Review current service activity and member progress for the active school year."
        actions={
          <Button render={<Link href="/admin/requests" />} size="lg">
            Review requests
            <ArrowRight data-icon="inline-end" aria-hidden="true" />
          </Button>
        }
      />

      <MetricRail
        items={[
          { label: "Active members", value: activeRoster.length },
          { label: "Requirement met", value: membersAtGoal },
          { label: "Below requirement", value: membersBelowGoal },
          {
            label: "Pending requests",
            value: queue.length,
            detail: `${assigned.length} assigned to you`,
          },
          {
            label: "Approved hours",
            value: formatHours(approvedHours),
            detail: "Across this school year",
          },
        ]}
      />

      {attentionMemberships.length ? (
        <section
          aria-labelledby="membership-attention-heading"
          className="mt-7 flex flex-col gap-4 rounded-xl border border-[var(--status-pending)]/30 bg-[var(--status-pending-bg)] p-5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <h2 id="membership-attention-heading" className="font-semibold">
              Membership attention
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {attentionMemberships.length} membership{attentionMemberships.length === 1 ? "" : "s"}{" "}
              are expired, inactive, or expire within 30 days.
            </p>
          </div>
          <Button render={<Link href="/admin/accounts" />} variant="outline">
            Review accounts
          </Button>
        </section>
      ) : null}

      <section aria-labelledby="waiting-heading" className="mt-10">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <h2 id="waiting-heading" className="text-2xl font-bold">
              Requests waiting longest
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Any active leader can process an eligible pending request.
            </p>
          </div>
          <Button render={<Link href="/admin/requests" />} variant="ghost">
            View queue
          </Button>
        </div>
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/60 hover:bg-muted/60">
                <TableHead className="pl-5">Member</TableHead>
                <TableHead>Activity</TableHead>
                <TableHead>Hours</TableHead>
                <TableHead>Waiting</TableHead>
                <TableHead>Assignment</TableHead>
                <TableHead className="pr-5 text-right">
                  <span className="sr-only">Open</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {waiting.length ? (
                waiting.map((request) => (
                  <TableRow key={request.id}>
                    <TableCell className="pl-5 font-semibold">{request.member_name}</TableCell>
                    <TableCell className="max-w-[280px] truncate">{request.title}</TableCell>
                    <TableCell>{formatHours(Number(request.hours))}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5">
                        <Clock3 className="size-4 text-muted-foreground" aria-hidden="true" />
                        {request.waiting_days} day{request.waiting_days === 1 ? "" : "s"}
                      </span>
                    </TableCell>
                    <TableCell>
                      {request.assigned_to_current_user ? (
                        <StatusBadge status="pending" />
                      ) : (
                        request.requested_approver_name
                      )}
                    </TableCell>
                    <TableCell className="pr-5 text-right">
                      <Button
                        render={<Link href={`/admin/requests/${request.id}`} />}
                        size="sm"
                        variant="ghost"
                      >
                        Review
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="h-28 text-center text-muted-foreground">
                    No pending requests.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <section aria-labelledby="progress-heading" className="mt-10">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <h2 id="progress-heading" className="text-2xl font-bold">
              Members below requirement
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Approved progress, with pending hours kept separate.
            </p>
          </div>
          <Button render={<Link href="/admin/members" />} variant="ghost">
            View full roster
          </Button>
        </div>
        <div className="divide-y rounded-xl border">
          {needsAttention.length ? (
            needsAttention.map((member) => (
              <Link
                key={member.membership_id}
                href={`/admin/members/${member.profile_id}`}
                className="grid gap-4 p-5 transition-colors hover:bg-muted/40 lg:grid-cols-[minmax(180px,0.45fr)_minmax(320px,1fr)_auto] lg:items-center"
              >
                <div>
                  <p className="font-semibold">{member.full_name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {formatHours(Number(member.remaining_hours))} hours remaining
                  </p>
                </div>
                <ProgressSummary progress={member} compact />
                <ArrowRight
                  className="hidden size-4 text-muted-foreground lg:block"
                  aria-hidden="true"
                />
              </Link>
            ))
          ) : (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Every active member has met the requirement.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
