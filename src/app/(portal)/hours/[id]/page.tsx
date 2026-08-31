import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock3, MessageSquareText, PencilLine, Undo2 } from "lucide-react";

import { withdrawHourRequestAction } from "@/app/actions/hour-actions";
import { PageHeader } from "@/components/portal/page-header";
import { StatusBadge } from "@/components/portal/status-badge";
import { Button } from "@/components/ui/button";
import { requireActiveViewer } from "@/lib/dal/access";
import { getHourRequest, getHourRequestReviewerNames } from "@/lib/dal/portal";
import type { HourRequest } from "@/lib/types";

export const metadata: Metadata = { title: "Service request" };

function reviewerDisplayName(
  membershipId: string | null,
  fullName: string | null,
  emptyLabel: string,
): string {
  return membershipId ? (fullName ?? "Committee head") : emptyLabel;
}

function categoryName(value: HourRequest["category"]): string {
  if (!value) return "Uncategorized";
  return Array.isArray(value) ? (value[0]?.name ?? "Uncategorized") : value.name;
}

function formatDate(value: string | null): string {
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

export default async function HourRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireActiveViewer();
  const { id } = await params;
  const noticeValue = (await searchParams).notice;
  const notice = Array.isArray(noticeValue) ? noticeValue[0] : noticeValue;
  let request;
  let reviewerNames: {
    requestedApproverName: string | null;
    actualReviewerName: string | null;
  };
  try {
    [request, reviewerNames] = await Promise.all([
      getHourRequest(id),
      getHourRequestReviewerNames(id),
    ]);
  } catch {
    notFound();
  }
  const owned = viewer.memberships.some(
    (membership) => membership.id === request.member_membership_id,
  );
  if (!owned && !viewer.canReview) notFound();
  const canEdit = owned && ["draft", "changes_requested"].includes(request.status);
  const canWithdraw = owned && request.status === "pending";
  const withdraw = withdrawHourRequestAction.bind(null, request.id);

  return (
    <div className="page-container max-w-6xl">
      <PageHeader
        eyebrow={
          <Link href="/dashboard" className="inline-flex items-center gap-2 hover:underline">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to dashboard
          </Link>
        }
        title={request.title ?? "Untitled draft"}
        description={
          <span className="inline-flex flex-wrap items-center gap-3">
            <StatusBadge
              status={
                request.status === "pending"
                  ? request.committee_head_approved_at
                    ? "pending_teacher_approval"
                    : "pending_committee_approval"
                  : request.status
              }
            />
            <span>
              {categoryName(request.category)} ·{" "}
              {request.hours == null ? "Hours not entered" : `${request.hours} hours`}
            </span>
          </span>
        }
        actions={
          canEdit ? (
            <Button render={<Link href={`/hours/${request.id}/edit`} />}>
              <PencilLine data-icon="inline-start" aria-hidden="true" />
              Edit request
            </Button>
          ) : undefined
        }
      />

      {notice ? (
        <p
          role="status"
          className="mb-6 rounded-lg bg-secondary p-4 text-sm text-secondary-foreground"
        >
          {notice === "submitted"
            ? "Request submitted. Your selected committee head must approve it first; then any teacher can give the final approval."
            : notice === "withdrawn"
              ? "The pending request was withdrawn and remains in your history."
              : "The request status was updated."}
        </p>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
        <div className="space-y-8">
          <section aria-labelledby="details-title" className="rounded-xl border">
            <div className="border-b px-5 py-4">
              <h2 id="details-title" className="text-xl font-bold">
                Activity details
              </h2>
            </div>
            <dl className="grid gap-x-8 gap-y-5 p-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <dt className="text-sm font-medium text-muted-foreground">Description</dt>
                <dd className="mt-1 whitespace-pre-wrap leading-7">
                  {request.description ?? "No description yet."}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Service date</dt>
                <dd className="mt-1 font-semibold">{formatDate(request.service_date)}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Hours requested</dt>
                <dd className="mt-1 font-semibold">{request.hours ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">
                  Selected committee head
                </dt>
                <dd className="mt-1 font-semibold">
                  {reviewerDisplayName(
                    request.requested_approver_membership_id,
                    reviewerNames.requestedApproverName,
                    "Not yet assigned",
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">
                  Committee-head approval
                </dt>
                <dd className="mt-1 font-semibold">
                  {request.committee_head_approved_at
                    ? `Approved ${formatDate(request.committee_head_approved_at)}`
                    : "Waiting for approval"}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">
                  Final teacher reviewer
                </dt>
                <dd className="mt-1 font-semibold">
                  {reviewerDisplayName(
                    request.actual_reviewer_membership_id,
                    reviewerNames.actualReviewerName,
                    "Not yet reviewed",
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Submitted</dt>
                <dd className="mt-1">{formatDate(request.submitted_at)}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Decision date</dt>
                <dd className="mt-1">{formatDate(request.decided_at)}</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="history-title" className="rounded-xl border">
            <div className="border-b px-5 py-4">
              <h2 id="history-title" className="text-xl font-bold">
                Request history
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                These request events cannot be edited or removed.
              </p>
            </div>
            {request.reviews?.length ? (
              <ol className="divide-y">
                {[...request.reviews]
                  .sort((a, b) => a.created_at.localeCompare(b.created_at))
                  .map((review) => (
                    <li key={review.id} className="flex gap-4 p-5">
                      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                        <MessageSquareText className="size-4" aria-hidden="true" />
                      </span>
                      <div>
                        <p className="font-semibold capitalize">
                          {historyActionLabel(review.action)}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {formatDate(review.created_at)}
                        </p>
                        {review.comment ? (
                          <p className="mt-3 whitespace-pre-wrap text-sm leading-6">
                            {review.comment}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  ))}
              </ol>
            ) : (
              <div className="flex gap-3 p-5 text-sm text-muted-foreground">
                <Clock3 className="size-4" aria-hidden="true" />
                No request events have been recorded.
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-5">
          <div className="rounded-xl border bg-muted/45 p-5">
            <h2 className="font-semibold">Request state</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {request.status === "pending"
                ? request.committee_head_approved_at
                  ? "The committee head approved this request. It is now available to every teacher for final approval."
                  : "The selected committee head must complete the first approval before the request goes to the teachers."
                : request.status === "approved"
                  ? "This approved record is locked. A teacher administrator must use the traceable correction process for any change."
                  : request.status === "changes_requested"
                    ? "Edit the activity using the reviewer’s comment, then resubmit it."
                    : "This request remains in the service record history."}
            </p>
          </div>
          {canWithdraw ? (
            <form action={withdraw}>
              <Button type="submit" variant="outline" className="w-full">
                <Undo2 data-icon="inline-start" aria-hidden="true" />
                Withdraw pending request
              </Button>
            </form>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
