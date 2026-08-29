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
import { getHourRequest, getProgress, listActiveReviewers, listCategories } from "@/lib/dal/portal";
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
  const [progress, allReviewers, categories] = await Promise.all([
    getProgress(request.member_membership_id),
    listActiveReviewers(request.school_year_id),
    listCategories(request.school_year_id),
  ]);
  const member = profileFromMembership(request.memberMembership);
  const memberEmail =
    member && "email" in member && typeof member.email === "string" ? member.email : null;
  const requestedApprover = profileFromMembership(request.requestedApproverMembership);
  const actualReviewer = profileFromMembership(request.actualReviewerMembership);
  const selfReview = viewer.activeMembership.id === request.member_membership_id;
  const reviewers = allReviewers.filter(
    (reviewer) => reviewer.membershipId !== request.member_membership_id,
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
            <span className="font-semibold text-foreground">{request.title}</span>
            <StatusBadge status={request.status} />
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
              <p className="whitespace-pre-wrap text-base leading-7">{request.description}</p>
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
                  <dd className="mt-1 font-semibold">{request.hours}</dd>
                </div>
                <div>
                  <dt className="flex items-center gap-2 text-sm text-muted-foreground">
                    <UserRound className="size-4" aria-hidden="true" /> Requested approver
                  </dt>
                  <dd className="mt-1 font-semibold">
                    {requestedApprover?.full_name ?? "Unassigned"}
                  </dd>
                </div>
              </dl>
            </div>
          </section>

          <section aria-labelledby="review-history-heading" className="rounded-xl border">
            <div className="border-b px-6 py-5">
              <h2 id="review-history-heading" className="flex items-center gap-2 text-xl font-bold">
                <History className="size-5" aria-hidden="true" />
                Immutable review history
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
                          {review.action.replaceAll("_", " ")}
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
              <p className="p-6 text-sm text-muted-foreground">No prior review events.</p>
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
              <Button
                render={<Link href={`/admin/members/${member?.id ?? progress.profile_id}`} />}
                variant="ghost"
                size="sm"
              >
                Profile
              </Button>
            </div>
            <div className="mt-6 border-t pt-5">
              <ProgressSummary progress={progress} compact />
            </div>
            {actualReviewer ? (
              <p className="mt-4 text-sm text-muted-foreground">
                Actual reviewer:{" "}
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
                You submitted this request under your own membership. Another active leader must
                process it.
              </p>
            </section>
          ) : (
            <section
              aria-labelledby="decision-heading"
              className="rounded-xl border p-5 shadow-[0_1px_8px_rgba(11,23,54,0.05)]"
            >
              <h2 id="decision-heading" className="mb-1 text-xl font-bold">
                Record a decision
              </h2>
              <p className="mb-5 text-sm leading-6 text-muted-foreground">
                Your identity becomes the actual reviewer, even when someone else was requested.
              </p>
              <ReviewDecisionPanel
                requestId={request.id}
                reviewers={reviewers}
                currentReviewerMembershipId={request.requested_approver_membership_id}
              />
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
