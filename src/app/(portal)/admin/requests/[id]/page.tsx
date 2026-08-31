import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  Clock3,
  History,
  LockKeyhole,
  Tag,
  UserRound,
} from "lucide-react";

import { PageHeader } from "@/components/portal/page-header";
import { CorrectionForm } from "@/components/admin/correction-form";
import { ProgressSummary } from "@/components/portal/progress-summary";
import { StatusBadge } from "@/components/portal/status-badge";
import { ReviewDecisionPanel } from "@/components/review/review-decision-panel";
import { Button } from "@/components/ui/button";
import { requireReviewer } from "@/lib/dal/access";
import { canViewMemberProgress } from "@/lib/domain/roles";
import {
  getHourRequest,
  getProgress,
  listActiveCommitteeHeads,
  listCategories,
} from "@/lib/dal/portal";
import type { HourRequest } from "@/lib/types";

export const metadata: Metadata = { title: "Review request" };

function profileFromMembership(
  membership:
    | HourRequest["memberMembership"]
    | HourRequest["requestedApproverMembership"]
    | HourRequest["actualReviewerMembership"],
) {
  if (!membership) return null;
  return Array.isArray(membership.profiles)
    ? (membership.profiles[0] ?? null)
    : membership.profiles;
}

function categoryName(category: HourRequest["category"]): string {
  if (!category) return "Uncategorized";
  return Array.isArray(category) ? (category[0]?.name ?? "Uncategorized") : category.name;
}

function date(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value.length === 10 ? `${value}T12:00:00` : value));
}

function historyActionLabel(action: string): string {
  return action === "committee_approved" ? "Committee head approved" : action.replaceAll("_", " ");
}

export default async function ReviewRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireReviewer();
  const { id } = await params;
  const noticeValue = (await searchParams).notice;
  const notice = Array.isArray(noticeValue) ? noticeValue[0] : noticeValue;
  let request;
  try {
    request = await getHourRequest(id);
  } catch {
    notFound();
  }
  const progressAccess = canViewMemberProgress(viewer);
  const approvalStage = request.committee_head_approved_at ? "teacher" : "committee_head";
  const canDecide =
    request.status === "pending" &&
    (approvalStage === "teacher"
      ? viewer.isTeacherAdmin
      : viewer.roles.includes("committee_head") &&
        viewer.activeMembership.id === request.requested_approver_membership_id);
  const canReassign =
    request.status === "pending" && approvalStage === "committee_head" && viewer.isTeacherAdmin;
  const [progress, allCommitteeHeads, categories] = await Promise.all([
    progressAccess ? getProgress(request.member_membership_id) : Promise.resolve(null),
    canReassign ? listActiveCommitteeHeads(request.school_year_id) : Promise.resolve([]),
    listCategories(request.school_year_id),
  ]);
  const member = profileFromMembership(request.memberMembership);
  const memberEmail =
    member && "email" in member && typeof member.email === "string" ? member.email : null;
  const requestedApprover = profileFromMembership(request.requestedApproverMembership);
  const actualReviewer = profileFromMembership(request.actualReviewerMembership);
  const selfReview = viewer.activeMembership.id === request.member_membership_id;
  const committeeHeads = allCommitteeHeads.filter(
    (committeeHead) => committeeHead.membershipId !== request.member_membership_id,
  );

  return (
    <div className="page-container">
      <PageHeader
        eyebrow={
          <Link href="/admin/requests" className="inline-flex items-center gap-2 hover:underline">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to queue
          </Link>
        }
        title="Review request"
        description={
          <span className="inline-flex flex-wrap items-center gap-3">
            <span className="font-semibold text-foreground">
              {request.title ?? "Untitled draft"}
            </span>
            <StatusBadge
              status={
                request.status === "pending"
                  ? approvalStage === "teacher"
                    ? "pending_teacher_approval"
                    : "pending_committee_approval"
                  : request.status
              }
            />
          </span>
        }
      />

      {notice === "reassigned" ? (
        <p
          role="status"
          className="mb-6 rounded-lg bg-secondary p-4 text-sm text-secondary-foreground"
        >
          The requested approver was changed and the reassignment was recorded.
        </p>
      ) : null}
      {notice === "decision-recorded" ? (
        <p
          role="status"
          className="mb-6 rounded-lg bg-secondary p-4 text-sm text-secondary-foreground"
        >
          {request.status === "pending" && request.committee_head_approved_at
            ? "The committee-head approval was recorded. The request is now in every teacher’s final-approval queue."
            : "Your decision was recorded. The immutable request history is shown below."}
        </p>
      ) : null}

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1.4fr)_minmax(340px,0.6fr)]">
        <div className="space-y-8">
          <section aria-labelledby="activity-heading" className="rounded-xl border">
            <div className="border-b px-6 py-5">
              <h2 id="activity-heading" className="text-xl font-bold">
                Activity
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Submitted {date(request.submitted_at)}
              </p>
            </div>
            <div className="p-6">
              <p className="whitespace-pre-wrap text-base leading-7">
                {request.description ?? "No description yet."}
              </p>
              <dl className="mt-7 grid gap-5 border-t pt-6 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Tag className="size-4" aria-hidden="true" /> Category
                  </dt>
                  <dd className="mt-1 font-semibold">{categoryName(request.category)}</dd>
                </div>
                <div>
                  <dt className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CalendarDays className="size-4" aria-hidden="true" /> Service date
                  </dt>
                  <dd className="mt-1 font-semibold">{date(request.service_date)}</dd>
                </div>
                <div>
                  <dt className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock3 className="size-4" aria-hidden="true" /> Hours
                  </dt>
                  <dd className="mt-1 font-semibold">{request.hours ?? "—"}</dd>
                </div>
                <div>
                  <dt className="flex items-center gap-2 text-sm text-muted-foreground">
                    <UserRound className="size-4" aria-hidden="true" /> Selected committee head
                  </dt>
                  <dd className="mt-1 font-semibold">
                    {requestedApprover?.full_name ?? "Unassigned"}
                  </dd>
                </div>
              </dl>
              <div className="mt-6 rounded-lg bg-muted/55 p-4 text-sm">
                <p className="font-semibold">
                  {request.committee_head_approved_at
                    ? `Committee-head approval completed ${date(request.committee_head_approved_at)}`
                    : "Waiting for committee-head approval"}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {request.committee_head_approved_at
                    ? "All teachers can now review this request. One teacher decision completes the process."
                    : "The request will enter the shared teacher queue after the selected committee head approves it."}
                </p>
              </div>
            </div>
          </section>

          <section aria-labelledby="review-history-heading" className="rounded-xl border">
            <div className="border-b px-6 py-5">
              <h2 id="review-history-heading" className="flex items-center gap-2 text-xl font-bold">
                <History className="size-5" aria-hidden="true" />
                Immutable request history
              </h2>
            </div>
            {request.reviews?.length ? (
              <ol className="divide-y">
                {[...request.reviews]
                  .sort((a, b) => a.created_at.localeCompare(b.created_at))
                  .map((review) => (
                    <li key={review.id} className="p-6">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold capitalize">
                          {historyActionLabel(review.action)}
                        </p>
                        <time className="text-sm text-muted-foreground">
                          {date(review.created_at)}
                        </time>
                      </div>
                      {review.comment ? (
                        <p className="mt-3 whitespace-pre-wrap text-sm leading-6">
                          {review.comment}
                        </p>
                      ) : null}
                    </li>
                  ))}
              </ol>
            ) : (
              <p className="p-6 text-sm text-muted-foreground">No prior request events.</p>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <section aria-labelledby="member-context-heading" className="rounded-xl border p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Member</p>
                <h2 id="member-context-heading" className="mt-1 text-xl font-bold">
                  {member?.full_name ?? "Member"}
                </h2>
                {memberEmail ? (
                  <p className="mt-1 text-sm text-muted-foreground">{memberEmail}</p>
                ) : null}
              </div>
              {progressAccess && member?.id ? (
                <Button
                  render={<Link href={`/admin/members/${member.id}`} />}
                  variant="ghost"
                  size="sm"
                >
                  Profile
                </Button>
              ) : null}
            </div>
            {progressAccess && progress ? (
              <div className="mt-6 border-t pt-5">
                <ProgressSummary progress={progress} compact />
              </div>
            ) : null}
            {actualReviewer ? (
              <p className="mt-4 text-sm text-muted-foreground">
                Final teacher reviewer:{" "}
                <span className="font-medium text-foreground">{actualReviewer.full_name}</span>
              </p>
            ) : null}
          </section>

          {request.status !== "pending" ? (
            <section className="rounded-xl border bg-muted/45 p-5">
              <div className="flex gap-3">
                <LockKeyhole className="mt-0.5 size-5 text-muted-foreground" aria-hidden="true" />
                <div>
                  <h2 className="font-semibold">Decision controls are locked</h2>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    This request is {request.status.replaceAll("_", " ")}. Its existing decision
                    remains in history.
                  </p>
                </div>
              </div>
            </section>
          ) : selfReview ? (
            <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
              <h2 className="font-semibold text-destructive">Self-review is prohibited</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                You submitted this request under your own membership. Another eligible approver must
                process it.
              </p>
            </section>
          ) : canDecide || canReassign ? (
            <section
              aria-labelledby="decision-heading"
              className="rounded-xl border p-5 shadow-[0_1px_8px_rgba(11,23,54,0.05)]"
            >
              <h2 id="decision-heading" className="mb-1 text-xl font-bold">
                {canDecide ? "Record a decision" : "Assign a committee head"}
              </h2>
              <p className="mb-5 text-sm leading-6 text-muted-foreground">
                {approvalStage === "committee_head"
                  ? canDecide
                    ? "Your approval sends this request to the shared teacher queue; it does not approve the hours yet."
                    : "This legacy request needs an active committee head before the two-stage review can continue."
                  : "This committee-head-approved request is available to every teacher. The first teacher decision completes the review."}
              </p>
              <ReviewDecisionPanel
                requestId={request.id}
                reviewers={committeeHeads}
                currentReviewerMembershipId={request.requested_approver_membership_id}
                approvalStage={approvalStage}
                canDecide={canDecide}
                canReassign={canReassign}
              />
            </section>
          ) : (
            <section className="rounded-xl border bg-muted/45 p-5">
              <div className="flex gap-3">
                <Clock3 className="mt-0.5 size-5 text-muted-foreground" aria-hidden="true" />
                <div>
                  <h2 className="font-semibold">Waiting for the next approver</h2>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {approvalStage === "committee_head"
                      ? "Only the committee head selected by the member can complete this first stage."
                      : "Only a teacher can complete the final approval."}
                  </p>
                </div>
              </div>
            </section>
          )}
          {request.status === "approved" && viewer.isTeacherAdmin ? (
            <section aria-labelledby="correction-heading" className="rounded-xl border p-5">
              <h2 id="correction-heading" className="text-xl font-bold">
                Correct approved record
              </h2>
              <p className="mb-5 mt-1 text-sm leading-6 text-muted-foreground">
                Use only for a documented factual correction. Silent edits to approved records are
                blocked.
              </p>
              <CorrectionForm request={request} categories={categories} />
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
