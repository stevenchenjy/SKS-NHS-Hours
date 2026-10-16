import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { z } from "zod";

import { RouteRefresh } from "@/components/portal/route-refresh";
import { TeacherApprovalQueue } from "@/components/review/teacher-approval-queue";
import { PageHeader } from "@/components/portal/page-header";
import { StatusBadge } from "@/components/portal/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireReviewer } from "@/lib/dal/access";
import {
  listApprovedReviewArchive,
  listAwaitingTeacherReviews,
  listPendingQueue,
  listTeacherReviewPage,
  listCategories,
  listActiveCommitteeHeads,
} from "@/lib/dal/portal";

export const metadata: Metadata = { title: "Review requests" };

function value(input: string | string[] | undefined): string {
  return Array.isArray(input) ? (input[0] ?? "") : (input ?? "");
}

async function TeacherReviewPage({
  schoolYearId,
  schoolYearLabel,
  params,
}: {
  schoolYearId: string;
  schoolYearLabel: string;
  params: Record<string, string | string[] | undefined>;
}) {
  const search = value(params.search).trim().slice(0, 120);
  const categoryId = z.uuid().safeParse(value(params.categoryId)).data;
  const committeeHeadId = z.uuid().safeParse(value(params.committeeHeadId)).data;
  const requestedPage = Number(value(params.page) || 1);
  const page =
    Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 10_000) : 1;
  const [loadedQueue, categories, heads] = await Promise.all([
    listTeacherReviewPage(schoolYearId, { search, categoryId, committeeHeadId, page }),
    listCategories(schoolYearId),
    listActiveCommitteeHeads(schoolYearId),
  ]);
  const pages = Math.max(1, Math.ceil(loadedQueue.totalCount / loadedQueue.pageSize));
  const queue =
    loadedQueue.page > pages
      ? await listTeacherReviewPage(schoolYearId, {
          search,
          categoryId,
          committeeHeadId,
          page: pages,
        })
      : loadedQueue;
  const selectionScope = JSON.stringify([schoolYearId, search, categoryId, committeeHeadId, page]);
  function pageHref(nextPage: number): string {
    const query = new URLSearchParams();
    if (search) query.set("search", search);
    if (categoryId) query.set("categoryId", categoryId);
    if (committeeHeadId) query.set("committeeHeadId", committeeHeadId);
    query.set("page", String(nextPage));
    return `/admin/requests?${query.toString()}`;
  }

  return (
    <div className="page-container">
      <RouteRefresh />
      <PageHeader
        eyebrow={schoolYearLabel}
        title="Review requests"
        description="Review committee-approved requests, select a group, and give final approval together. One teacher’s decision completes each request for all teachers."
      />
      <nav aria-label="Review request views" className="mb-6 flex flex-wrap gap-2">
        <Button render={<Link href="/admin/requests" aria-current="page" />}>Pending</Button>
        <Button variant="outline" render={<Link href="/admin/requests?view=archive" />}>
          Archive
        </Button>
      </nav>
      <form className="mb-5 flex flex-col gap-4 rounded-xl border p-4">
        <FieldGroup className="grid gap-4 md:grid-cols-3">
          <Field>
            <FieldLabel htmlFor="search">Search requests</FieldLabel>
            <Input
              id="search"
              name="search"
              defaultValue={search}
              placeholder="Member, activity, or category"
              maxLength={120}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="category-filter">Category</FieldLabel>
            <Select
              name="categoryId"
              defaultValue={categoryId || "all"}
              items={{
                all: "All categories",
                ...Object.fromEntries(categories.map((category) => [category.id, category.name])),
              }}
            >
              <SelectTrigger id="category-filter" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">All categories</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="committee-filter">Committee head</FieldLabel>
            <Select
              name="committeeHeadId"
              defaultValue={committeeHeadId || "all"}
              items={{
                all: "All committee heads",
                ...Object.fromEntries(heads.map((head) => [head.membershipId, head.fullName])),
              }}
            >
              <SelectTrigger id="committee-filter" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">All committee heads</SelectItem>
                  {heads.map((head) => (
                    <SelectItem key={head.membershipId} value={head.membershipId}>
                      {head.fullName}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </FieldGroup>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="outline">
            Apply filters
          </Button>
          {search || categoryId || committeeHeadId ? (
            <Button variant="ghost" render={<Link href="/admin/requests" />}>
              Reset filters
            </Button>
          ) : null}
        </div>
      </form>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="font-semibold">Teacher approval queue ({queue.totalCount})</p>
        <p className="text-muted-foreground">
          Oldest waiting for teacher first · {queue.requests.length} on this page
        </p>
      </div>
      <TeacherApprovalQueue
        key={selectionScope}
        selectionScope={selectionScope}
        requests={queue.requests}
        schoolYearId={schoolYearId}
      />
      <nav aria-label="Review queue pages" className="mt-5 flex items-center justify-between gap-3">
        {queue.page > 1 ? (
          <Button variant="outline" render={<Link href={pageHref(queue.page - 1)} />}>
            Previous page
          </Button>
        ) : (
          <Button variant="outline" disabled>
            Previous page
          </Button>
        )}
        <p className="text-sm text-muted-foreground">
          Page {queue.page} of {pages}
        </p>
        {queue.page < pages ? (
          <Button variant="outline" render={<Link href={pageHref(queue.page + 1)} />}>
            Next page
          </Button>
        ) : (
          <Button variant="outline" disabled>
            Next page
          </Button>
        )}
      </nav>
    </div>
  );
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
  if (viewer.isTeacherAdmin && !archived) {
    return await TeacherReviewPage({
      schoolYearId: viewer.activeMembership.school_year_id,
      schoolYearLabel: viewer.activeMembership.school_year.label,
      params,
    });
  }
  const awaitingTeacher = !viewer.isTeacherAdmin && value(params.view) === "awaiting-teacher";
  const all = awaitingTeacher
    ? await listAwaitingTeacherReviews(
        viewer.activeMembership.school_year_id,
        viewer.activeMembership.id,
      )
    : await (archived ? listApprovedReviewArchive : listPendingQueue)(
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
            : "Approve requests assigned to you, then track them in Awaiting teacher. They move to Archive after a teacher gives final approval."
        }
      />
      {notice === "decision-recorded" ? (
        <p
          role="status"
          className="mb-6 rounded-lg bg-secondary p-4 text-sm text-secondary-foreground"
        >
          Decision saved.
        </p>
      ) : null}

      <nav aria-label="Review request views" className="mb-6 flex flex-wrap gap-2">
        <Button
          variant={archived || awaitingTeacher ? "outline" : "default"}
          render={
            <Link
              href="/admin/requests"
              aria-current={!archived && !awaitingTeacher ? "page" : undefined}
            />
          }
        >
          Pending
        </Button>
        {!viewer.isTeacherAdmin ? (
          <Button
            variant={awaitingTeacher ? "default" : "outline"}
            render={
              <Link
                href="/admin/requests?view=awaiting-teacher"
                aria-current={awaitingTeacher ? "page" : undefined}
              />
            }
          >
            Awaiting teacher
          </Button>
        ) : null}
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
      {awaitingTeacher ? (
        <p className="mb-5 text-sm text-muted-foreground">
          You completed the committee-head approval for these requests. The hours remain pending
          until a teacher gives final approval; then the requests move to Archive.
        </p>
      ) : null}
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
            : awaitingTeacher
              ? "Awaiting teacher approval"
              : viewer.isTeacherAdmin
                ? "Teacher approval queue"
                : "Assigned to me"}{" "}
          ({all.length})
        </p>
        <form className="flex w-full gap-2 lg:max-w-md">
          {archived || awaitingTeacher ? (
            <input type="hidden" name="view" value={archived ? "archive" : "awaiting-teacher"} />
          ) : null}
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
                      {archived || awaitingTeacher ? "View history" : "Review"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={8} className="h-36 text-center text-muted-foreground">
                  {archived
                    ? "No approved requests match this view."
                    : awaitingTeacher
                      ? "No requests are awaiting teacher approval in this view."
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
