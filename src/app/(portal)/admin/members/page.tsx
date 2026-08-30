import type { Metadata } from "next";
import Link from "next/link";
import { Search, UsersRound } from "lucide-react";

import { PageHeader } from "@/components/portal/page-header";
import { ProgressSummary, formatHours } from "@/components/portal/progress-summary";
import { StatusBadge } from "@/components/portal/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireReviewer } from "@/lib/dal/access";
import { listRosterProgress } from "@/lib/dal/portal";
import { formatRoleLabel } from "@/lib/domain/roles";

export const metadata: Metadata = { title: "Member roster" };

function param(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function MemberRosterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireReviewer();
  const params = await searchParams;
  const search = param(params.search).trim().toLowerCase();
  const role = param(params.role);
  const progressState = param(params.progress);
  const membershipStatus = param(params.membership_status);
  const sort = param(params.sort) || "name";
  const roster = (await listRosterProgress(viewer.activeMembership.school_year_id))
    .filter(
      (member) =>
        (!search ||
          member.full_name.toLowerCase().includes(search) ||
          member.email?.toLowerCase().includes(search)) &&
        (!role || member.roles?.includes(role as never)) &&
        (!membershipStatus || member.membership_status === membershipStatus) &&
        (!progressState ||
          (progressState === "met"
            ? Number(member.remaining_hours) === 0
            : progressState === "below"
              ? Number(member.remaining_hours) > 0
              : Number(member.approved_hours) === 0)),
    )
    .sort((a, b) => {
      if (sort === "progress") return Number(b.actual_percentage) - Number(a.actual_percentage);
      if (sort === "remaining") return Number(b.remaining_hours) - Number(a.remaining_hours);
      if (sort === "activity")
        return (b.last_activity_at ?? "").localeCompare(a.last_activity_at ?? "");
      return a.full_name.localeCompare(b.full_name);
    });

  return (
    <div className="page-container">
      <PageHeader
        eyebrow={viewer.activeMembership.school_year.label}
        title="Members"
        description="Search the complete roster, compare approved progress, and open any permitted service log."
      />

      <form className="mb-6 grid gap-3 rounded-xl border bg-muted/35 p-4 md:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_repeat(4,minmax(150px,auto))_auto]">
        <label className="relative">
          <span className="sr-only">Search members</span>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            name="search"
            defaultValue={search}
            placeholder="Search name or email"
            className="h-10 bg-background pl-9"
          />
        </label>
        <label>
          <span className="sr-only">Role</span>
          <select
            name="role"
            defaultValue={role}
            className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
          >
            <option value="">All roles</option>
            <option value="member">Member</option>
            <option value="committee_head">Committee head</option>
            <option value="president_vice_president">President / Vice President</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Progress state</span>
          <select
            name="progress"
            defaultValue={progressState}
            className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
          >
            <option value="">All progress</option>
            <option value="met">Requirement met</option>
            <option value="below">Below requirement</option>
            <option value="none">No approved hours</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Membership status</span>
          <select
            name="membership_status"
            defaultValue={membershipStatus}
            className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
          >
            <option value="">All memberships</option>
            <option value="active">Active</option>
            <option value="expired">Expired</option>
            <option value="suspended">Suspended</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Sort members</span>
          <select
            name="sort"
            defaultValue={sort}
            className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
          >
            <option value="name">Sort by name</option>
            <option value="progress">Highest progress</option>
            <option value="remaining">Most remaining</option>
            <option value="activity">Recent activity</option>
          </select>
        </label>
        <Button type="submit" variant="outline" className="h-10">
          Apply
        </Button>
      </form>

      <p className="mb-3 text-sm text-muted-foreground">
        {roster.length} member{roster.length === 1 ? "" : "s"} shown
      </p>
      <div className="hidden overflow-hidden rounded-xl border lg:block">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/60 hover:bg-muted/60">
              <TableHead className="pl-5">Member</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead className="min-w-[340px]">Approved progress</TableHead>
              <TableHead>Approved</TableHead>
              <TableHead>Pending</TableHead>
              <TableHead>Remaining / over</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="pr-5 text-right">
                <span className="sr-only">Open</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roster.length ? (
              roster.map((member) => (
                <TableRow key={member.membership_id}>
                  <TableCell className="pl-5">
                    <p className="font-semibold">{member.full_name}</p>
                    <p className="text-xs text-muted-foreground">{member.email}</p>
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-[220px] flex-wrap gap-1">
                      {member.roles?.map((memberRole) => (
                        <Badge key={memberRole} variant="outline" className="capitalize">
                          {formatRoleLabel(memberRole)}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <ProgressSummary progress={member} compact />
                  </TableCell>
                  <TableCell>{formatHours(Number(member.approved_hours))}</TableCell>
                  <TableCell>{formatHours(Number(member.pending_hours))}</TableCell>
                  <TableCell>
                    {Number(member.over_goal_hours) > 0
                      ? `${formatHours(Number(member.over_goal_hours))} over`
                      : `${formatHours(Number(member.remaining_hours))} remaining`}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={member.membership_status} />
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    <Button
                      render={<Link href={`/admin/members/${member.profile_id}`} />}
                      variant="ghost"
                      size="sm"
                    >
                      Open
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={8} className="h-40 text-center text-muted-foreground">
                  No members match these filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-3 lg:hidden">
        {roster.length ? (
          roster.map((member) => (
            <Link
              key={member.membership_id}
              href={`/admin/members/${member.profile_id}`}
              className="block rounded-xl border p-5"
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{member.full_name}</h2>
                  <p className="text-sm text-muted-foreground">{member.email}</p>
                </div>
                <StatusBadge status={member.membership_status} />
              </div>
              <ProgressSummary progress={member} compact />
            </Link>
          ))
        ) : (
          <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border text-center">
            <UsersRound className="mb-3 size-6 text-muted-foreground" aria-hidden="true" />
            <p className="font-semibold">No members found</p>
          </div>
        )}
      </div>
    </div>
  );
}
