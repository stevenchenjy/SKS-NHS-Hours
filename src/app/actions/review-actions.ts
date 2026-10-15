"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireReviewer, requireAdmin, requireTeacherAdmin } from "@/lib/dal/access";
import {
  bulkApprovalInputSchema,
  parseBulkApprovalResult,
  type BulkApprovalInput,
  type BulkApprovalResult,
} from "@/lib/domain/bulk-approval";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface ReviewFormState {
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

const reviewSchema = z
  .object({
    request_id: z.uuid(),
    decision: z.enum(["approve", "request_changes", "reject"]),
    comment: z.string().trim().max(2_000).default(""),
  })
  .superRefine((data, context) => {
    if (data.decision !== "approve" && data.comment.length < 3) {
      context.addIssue({
        code: "custom",
        path: ["comment"],
        message: "A specific reviewer comment is required for this decision.",
      });
    }
  });

function decisionError(message: string): string {
  if (message.includes("own") || message.includes("self")) {
    return "You can approve your own request only as its selected committee head. A teacher must give final approval.";
  }
  if (message.includes("pending") || message.includes("concurrent")) {
    return "This request is no longer pending. Another reviewer may have processed it.";
  }
  if (message.includes("committee head") || message.includes("teacher administrator")) {
    return "This request is waiting for a different approval stage or approver.";
  }
  if (message.includes("active") || message.includes("permission")) {
    return "Your active school-year role does not permit this review.";
  }
  return "The decision could not be recorded. Reload the request and try again.";
}

export async function reviewHourRequestAction(
  _previous: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  await requireReviewer();
  const parsed = reviewSchema.safeParse({
    request_id: formData.get("request_id"),
    decision: formData.get("decision"),
    comment: formData.get("comment"),
  });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("review_hour_request", {
    p_request_id: parsed.data.request_id,
    p_action: parsed.data.decision,
    p_comment: parsed.data.comment || null,
  });
  if (error) return { error: decisionError(error.message) };

  revalidatePath("/admin/members");
  revalidatePath("/admin/requests");
  revalidatePath(`/admin/requests/${parsed.data.request_id}`);
  revalidatePath(`/hours/${parsed.data.request_id}`);
  revalidatePath("/dashboard");
  redirect(`/admin/requests/${parsed.data.request_id}?notice=decision-recorded`);
}

const reassignSchema = z.object({
  request_id: z.uuid(),
  new_reviewer_membership_id: z.uuid("Choose an active committee head."),
  comment: z.string().trim().max(2_000).default(""),
});

export async function reassignHourRequestAction(
  _previous: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  await requireAdmin();
  const parsed = reassignSchema.safeParse({
    request_id: formData.get("request_id"),
    new_reviewer_membership_id: formData.get("new_reviewer_membership_id"),
    comment: formData.get("reassignment_comment"),
  });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("reassign_hour_request", {
    p_request_id: parsed.data.request_id,
    p_new_reviewer_membership_id: parsed.data.new_reviewer_membership_id,
    p_comment: parsed.data.comment || null,
  });
  if (error) return { error: decisionError(error.message) };

  revalidatePath("/admin/requests");
  revalidatePath(`/admin/requests/${parsed.data.request_id}`);
  redirect(`/admin/requests/${parsed.data.request_id}?notice=reassigned`);
}

export async function bulkApproveTeacherRequestsAction(
  input: BulkApprovalInput,
): Promise<{ error?: string; result?: BulkApprovalResult }> {
  const viewer = await requireTeacherAdmin();
  const parsed = bulkApprovalInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Select between 1 and 50 different requests from the current review page." };
  }

  if (
    parsed.data.schoolYearId !== viewer.activeMembership.school_year_id ||
    viewer.activeMembership.status !== "active" ||
    viewer.activeMembership.school_year.status !== "active" ||
    viewer.profile.status !== "active"
  ) {
    return {
      error: "Your active school-year role does not permit these approvals. Reload the queue.",
    };
  }

  const retryMessage =
    "The approval results could not be confirmed. Retry this same selection to safely check the batch.";
  let result: BulkApprovalResult | null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("bulk_approve_teacher_requests", {
      p_school_year_id: parsed.data.schoolYearId,
      p_batch_id: parsed.data.batchId,
      p_requests: parsed.data.requests,
    });
    if (error) return { error: retryMessage };
    result = parseBulkApprovalResult(data, parsed.data);
    if (!result) return { error: retryMessage };
  } catch {
    // A network error can occur after commit. The caller retains the batch ID
    // and exact payload so the database can return the original result on retry.
    return { error: retryMessage };
  }

  revalidatePath("/admin/requests");
  revalidatePath("/admin/members");
  revalidatePath("/admin/members/[id]", "page");
  revalidatePath("/dashboard");
  revalidatePath("/profile");
  revalidatePath("/hours");
  for (const request of result.results) {
    revalidatePath(`/admin/requests/${request.requestId}`);
    revalidatePath(`/hours/${request.requestId}`);
  }
  return { result };
}
