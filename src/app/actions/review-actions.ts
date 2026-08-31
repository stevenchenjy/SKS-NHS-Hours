"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireReviewer, requireTeacherAdmin } from "@/lib/dal/access";
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
    return "You cannot review a request submitted under your own membership.";
  }
  if (message.includes("pending") || message.includes("concurrent")) {
    return "This request is no longer pending. Another reviewer may have processed it.";
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
  revalidatePath("/dashboard");
  redirect(`/admin/requests/${parsed.data.request_id}?notice=decision-recorded`);
}

const reassignSchema = z.object({
  request_id: z.uuid(),
  new_reviewer_membership_id: z.uuid("Choose an active reviewer."),
  comment: z.string().trim().max(2_000).default(""),
});

export async function reassignHourRequestAction(
  _previous: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  await requireTeacherAdmin();
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
