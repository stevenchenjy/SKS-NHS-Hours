import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { HourRequestForm } from "@/components/hours/hour-request-form";
import { PageHeader } from "@/components/portal/page-header";
import { requireActiveViewer } from "@/lib/dal/access";
import { getHourRequest, listActiveReviewers, listCategories } from "@/lib/dal/portal";

export const metadata: Metadata = { title: "Edit service request" };

export default async function EditHourRequestPage({
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
  try {
    request = await getHourRequest(id);
  } catch {
    notFound();
  }
  if (
    !viewer.memberships.some((membership) => membership.id === request.member_membership_id) ||
    !["draft", "changes_requested"].includes(request.status)
  ) {
    notFound();
  }
  const latestChangeRequest = [...(request.reviews ?? [])]
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .find((review) => review.action === "changes_requested" && review.comment);

  const [categories, allReviewers] = await Promise.all([
    listCategories(request.school_year_id),
    listActiveReviewers(request.school_year_id),
  ]);
  const reviewers = allReviewers.filter(
    (reviewer) => reviewer.membershipId !== request.member_membership_id,
  );

  return (
    <div className="page-container max-w-5xl">
      <PageHeader
        eyebrow={
          <Link
            href={`/hours/${request.id}`}
            className="inline-flex items-center gap-2 hover:underline"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to request
          </Link>
        }
        title={
          request.status === "changes_requested" ? "Update and resubmit" : "Edit service draft"
        }
        description={
          request.status === "changes_requested"
            ? "Address the reviewer’s feedback before sending the request back for a new decision."
            : "Draft changes remain editable until you submit the request."
        }
      />
      {notice === "draft-saved" || notice === "changes-saved" ? (
        <p
          role="status"
          className="mb-6 rounded-lg bg-secondary p-4 text-sm text-secondary-foreground"
        >
          {notice === "changes-saved"
            ? "Changes saved. Resubmit when the request is ready for review."
            : "Draft saved. You can keep editing until you submit it."}
        </p>
      ) : null}
      {request.status === "changes_requested" && latestChangeRequest?.comment ? (
        <section
          aria-labelledby="reviewer-feedback-title"
          className="mb-6 rounded-xl border border-[var(--status-pending)]/30 bg-[var(--status-pending-bg)] p-5"
        >
          <h2 id="reviewer-feedback-title" className="font-semibold">
            Reviewer feedback
          </h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
            {latestChangeRequest.comment}
          </p>
        </section>
      ) : null}
      <HourRequestForm
        schoolYearId={request.school_year_id}
        schoolYearLabel={
          viewer.memberships.find(
            (membership) => membership.school_year_id === request.school_year_id,
          )?.school_year.label ?? "Selected school year"
        }
        categories={categories}
        reviewers={reviewers}
        submissionKey={request.client_submission_key ?? crypto.randomUUID()}
        request={request}
      />
    </div>
  );
}
