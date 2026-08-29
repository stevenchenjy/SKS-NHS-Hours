import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { HourRequestForm } from "@/components/hours/hour-request-form";
import { PageHeader } from "@/components/portal/page-header";
import { requireActiveViewer } from "@/lib/dal/access";
import { getHourRequest, listActiveReviewers, listCategories } from "@/lib/dal/portal";

export const metadata: Metadata = { title: "Edit service request" };

export default async function EditHourRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireActiveViewer();
  const { id } = await params;
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
            : "Draft changes remain private until you submit the request."
        }
      />
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
