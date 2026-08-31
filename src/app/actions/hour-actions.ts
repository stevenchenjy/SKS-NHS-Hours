"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireActiveViewer } from "@/lib/dal/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface HourRequestFormState {
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string[]>;
}

const commonHourRequestSchema = z.object({
  request_id: z.uuid().optional(),
  revision: z.coerce.number().int().nonnegative().default(0),
  school_year_id: z.uuid(),
  client_submission_key: z.string().trim().min(8).max(200),
});

const categorySchema = z.uuid("Choose a service category.");
const reviewerSchema = z.uuid("Choose a committee head for the first approval.");
const titleSchema = z.string().trim().min(1, "Enter an activity title.").max(120);
const descriptionSchema = z.string().trim().max(2_000);
const serviceDateSchema = z.iso.date("Enter a valid service date.");
const hoursSchema = z.coerce
  .number()
  .positive("Hours must be greater than zero.")
  .max(24, "A single-date request cannot exceed 24 hours.")
  .refine((value) => Number.isInteger(value * 4), "Use quarter-hour increments.");

function blankToUndefined(value: unknown): unknown {
  return value == null || (typeof value === "string" && value.trim() === "") ? undefined : value;
}

const hourRequestSchema = z.discriminatedUnion("intent", [
  commonHourRequestSchema.extend({
    intent: z.literal("save_draft"),
    category_id: z.preprocess(blankToUndefined, categorySchema.optional()),
    requested_approver_membership_id: z.preprocess(blankToUndefined, reviewerSchema.optional()),
    title: z.preprocess(blankToUndefined, titleSchema.optional()),
    description: z.preprocess(blankToUndefined, descriptionSchema.optional()),
    service_date: z.preprocess(blankToUndefined, serviceDateSchema.optional()),
    hours: z.preprocess(blankToUndefined, hoursSchema.optional()),
  }),
  commonHourRequestSchema.extend({
    intent: z.literal("submit"),
    category_id: categorySchema,
    requested_approver_membership_id: reviewerSchema,
    title: titleSchema,
    description: z.preprocess(blankToUndefined, descriptionSchema.optional()),
    service_date: serviceDateSchema,
    hours: hoursSchema,
  }),
  commonHourRequestSchema.extend({
    intent: z.literal("save_changes"),
    category_id: categorySchema,
    requested_approver_membership_id: reviewerSchema,
    title: titleSchema,
    description: z.preprocess(blankToUndefined, descriptionSchema.optional()),
    service_date: serviceDateSchema,
    hours: hoursSchema,
  }),
]);

function rpcError(error: { message: string; code?: string } | null): string {
  if (!error) return "The request could not be saved.";
  if (error.message.includes("future")) return "The service date cannot be in the future.";
  if (error.message.includes("approver") || error.message.includes("committee head")) {
    return "Choose an active committee head for this school year.";
  }
  if (error.message.includes("category")) return "This service category is not available.";
  if (error.message.includes("revision") || error.message.includes("concurrent")) {
    return "This request changed in another session. Reload it before saving again.";
  }
  return "The request could not be saved. Review the fields and try again.";
}

function returnedRequest(
  data: unknown,
  fallbackId?: string,
): { id: string; revision: number } | null {
  const candidate = Array.isArray(data) ? data[0] : data;
  if (candidate && typeof candidate === "object") {
    const id = "id" in candidate && typeof candidate.id === "string" ? candidate.id : fallbackId;
    const revision = "revision" in candidate ? Number(candidate.revision) : Number.NaN;
    if (id && Number.isInteger(revision) && revision > 0) return { id, revision };
  }
  return null;
}

export async function saveHourRequestAction(
  _previous: HourRequestFormState,
  formData: FormData,
): Promise<HourRequestFormState> {
  const viewer = await requireActiveViewer();
  if (!viewer.roles.includes("member")) {
    return { error: "An active member role is required to submit personal service hours." };
  }

  const parsed = hourRequestSchema.safeParse({
    request_id: formData.get("request_id") || undefined,
    revision: formData.get("revision"),
    school_year_id: formData.get("school_year_id"),
    category_id: formData.get("category_id"),
    requested_approver_membership_id: formData.get("requested_approver_membership_id"),
    title: formData.get("title"),
    description: formData.get("description"),
    service_date: formData.get("service_date"),
    hours: formData.get("hours"),
    client_submission_key: formData.get("client_submission_key"),
    intent: formData.get("intent"),
  });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };

  const today = new Date().toISOString().slice(0, 10);
  if (parsed.data.service_date && parsed.data.service_date > today) {
    return { fieldErrors: { service_date: ["The service date cannot be in the future."] } };
  }
  if (parsed.data.school_year_id !== viewer.activeMembership.school_year_id) {
    return { error: "You may submit hours only for your active school year." };
  }

  const supabase = await createSupabaseServerClient();
  const values = {
    p_category_id: parsed.data.category_id ?? null,
    p_requested_approver_membership_id: parsed.data.requested_approver_membership_id ?? null,
    p_title: parsed.data.title ?? null,
    p_description: parsed.data.description ?? null,
    p_service_date: parsed.data.service_date ?? null,
    p_hours: parsed.data.hours ?? null,
  };

  const result = parsed.data.request_id
    ? await supabase.rpc("save_hour_request_draft", {
        p_request_id: parsed.data.request_id,
        p_expected_revision: parsed.data.revision,
        ...values,
      })
    : await supabase.rpc("create_hour_request_draft", {
        p_school_year_id: parsed.data.school_year_id,
        p_client_submission_key: parsed.data.client_submission_key,
        ...values,
      });
  if (result.error) return { error: rpcError(result.error) };

  const savedRequest = returnedRequest(result.data, parsed.data.request_id);
  if (!savedRequest) {
    return { error: "The request was saved but its revision could not be confirmed." };
  }

  if (parsed.data.intent === "submit") {
    const { error } = await supabase.rpc("submit_hour_request", {
      p_request_id: savedRequest.id,
      p_expected_revision: savedRequest.revision,
    });
    if (error) return { error: rpcError(error) };
  }

  revalidatePath("/dashboard");
  revalidatePath(`/hours/${savedRequest.id}`);
  redirect(
    parsed.data.intent === "submit"
      ? `/hours/${savedRequest.id}?notice=submitted`
      : `/hours/${savedRequest.id}/edit?notice=${
          parsed.data.intent === "save_changes" ? "changes-saved" : "draft-saved"
        }`,
  );
}

export async function withdrawHourRequestAction(requestId: string) {
  const viewer = await requireActiveViewer();
  if (!viewer.roles.includes("member")) redirect("/dashboard?notice=not-authorized");
  const parsedId = z.uuid().safeParse(requestId);
  if (!parsedId.success) redirect("/dashboard?notice=invalid-request");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("withdraw_hour_request", {
    p_request_id: parsedId.data,
  });
  if (error) redirect(`/hours/${requestId}?notice=withdraw-failed`);
  revalidatePath("/dashboard");
  redirect(`/hours/${requestId}?notice=withdrawn`);
}
