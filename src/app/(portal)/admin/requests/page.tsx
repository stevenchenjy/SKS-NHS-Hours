import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";

import { RouteRefresh } from "@/components/portal/route-refresh";
import { PageHeader } from "@/components/portal/page-header";
import { StatusBadge } from "@/components/portal/status-badge";
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
import { listApprovedReviewArchive, listPendingQueue } from "@/lib/dal/portal";

export const metadata: Metadata = { title: "Review requests" };

function value(input: string | string[] | undefined): string {
  return Array.isArray(input) ? (input[0] ?? "") : (input ?? "");
}

export default async function ReviewQueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireReviewer();
  const params = await searchParams;
  const search = value(params.search).trim().toLowerCase();
  const notice = value(params.notice);
  const archived = value(params.view) === "archive";
  const all = await (archived ? listApprovedReviewArchive : listPendingQueue)(
    viewer.activeMembership.school_year_id,
    viewer.isTeacherAdmin ? undefined : viewer.activeMembership.id,
  );
  const queue = all.filter(
    (request) =>
      !search ||
      request.member_name.toLowerCase().includes(search) ||
      request.title.toLowerCase().includes(search) ||
      request.category_name.toLowerCase().includes(search),
  );

  return (
    <div className="page-container">
      <RouteRefresh />
      <PageHeader
        eyebrow={viewer.activeMembership.school_year.label}
        title="Review requests"
        description={
          viewer.isTeacherAdmin
            ? "These requests already have committee-head approval. One teacher’s approval completes the request and moves it to Archive for all teachers."
            : "Complete the first approval for requests that members assigned to you. Approved requests move automatically to all teachers."
        }
      />
      {notice === "decision-recorded" ? (
        <p
          role="status"
          className="mb-6 rounded-lg bg-secondary p-4 text-sm text-secondary-foreground"
        >
          The review decision was recorded in immutable history.
        </p>
      ) : null}

      <nav aria-label="Review request views" className="mb-6 flex gap-2">
        <Button
          variant={archived ? "outline" : "default"}
          render={<Link href="/admin/requests" aria-current={!archived ? "page" : undefined} />}
        >
          Pending
        </Button>
        <Button
          variant={archived ? "default" : "outline"}
          render={
            <Link
              href="/admin/requests?view=archive"
              aria-current={archived ? "page" : undefined}
            />
          }
        >
          Archive
        </Button>
      </nav>
      {archived ? (
        <p className="mb-5 text-sm text-muted-foreground">
          Approved requests are saved here with the teacher’s decision. No further approval is
          needed.
        </p>
      ) : null}
      <div className="mb-5 flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-center lg:justify-between">
        <p className="text-sm font-semibold">
          {archived
            ? "Approved requests"
            : viewer.isTeacherAdmin
              ? "Teacher approval queue"
              : "Assigned to me"}{" "}
          ({all.length})
        </p>
        <form className="flex w-full gap-2 lg:max-w-md">
          {archived ? <input type="hidden" name="view" value="archive" /> : null}
          <label htmlFor="search" className="sr-only">
            Search requests
          </label>
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="search"
              name="search"
              defaultValue={search}
              placeholder="Member, activity, or category"
              className="h-10 pl-9"
            />
          </div>
          <Button type="submit" variant="outline" className="h-10">
            Search
          </Button>
        </form>
      </div>

      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/60 hover:bg-muted/60">
              <TableHead className="pl-5">Member</TableHead>
              <TableHead>Activity</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Service date</TableHead>
              <TableHead>Hours</TableHead>
              <TableHead>{archived ? "Status" : "Approval stage"}</TableHead>
              <TableHead>{archived ? "Approved by" : "Selected committee head"}</TableHead>
              <TableHead className="pr-5 text-right">
                <span className="sr-only">Review</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {queue.length ? (
              queue.map((request) => (
                <TableRow key={request.id}>
                  <TableCell className="pl-5">
                    <p className="font-semibold">{request.member_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {"waiting_days" in request
                        ? `${request.waiting_days} day${request.waiting_days === 1 ? "" : "s"} waiting`
                        : `Approved ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" }).format(new Date(request.decided_at))}`}
                    </p>
                  </TableCell>
                  <TableCell className="max-w-[280px] truncate font-medium">
                    {request.title}
                  </TableCell>
                  <TableCell>{request.category_name}</TableCell>
                  <TableCell>{request.service_date}</TableCell>
                  <TableCell>{request.hours}</TableCell>
                  <TableCell>
                    <StatusBadge
                      status={
                        request.status === "approved"
                          ? "approved"
                          : request.approval_stage === "teacher"
                            ? "pending_teacher_approval"
                            : "pending_committee_approval"
                      }
                      className="whitespace-nowrap"
                    />
                  </TableCell>
                  <TableCell>
                    {"actual_reviewer_name" in request
                      ? request.actual_reviewer_name
                      : request.requested_approver_name}
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    <Button render={<Link href={`/admin/requests/${request.id}`} />} size="sm">
                      {archived ? "View history" : "Review"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={8} className="h-36 text-center text-muted-foreground">
                  {archived
                    ? "No approved requests match this view."
                    : "No pending requests match this view."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
