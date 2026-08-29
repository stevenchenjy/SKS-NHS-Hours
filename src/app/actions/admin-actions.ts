"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { parseSchoolYearDateRange, schoolYearRoleSchema, validateInvitation } from "@/lib/domain";
import {
  coordinateInvitationDelivery,
  type InvitationDeliveryOutcome,
  type PreparedInvitationDelivery,
} from "@/lib/auth/invitation-delivery";
import { getServerEnvironment } from "@/lib/env";
import { requireTeacherAdmin } from "@/lib/dal/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { RoleSlug } from "@/lib/types";

export interface AdminFormState {
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string[]>;
}

const INVITATION_VALIDITY_MS = 7 * 24 * 60 * 60 * 1_000;

function messageForDatabaseError(message: string): string {
  if (message.includes("last") || message.includes("teacher administrator")) {
    return "This change would remove the final active teacher administrator.";
  }
  if (
    message.includes("duplicate") ||
    message.includes("unique") ||
    message.includes("already exists")
  ) {
    return "A matching active record already exists.";
  }
  if (message.includes("permission") || message.includes("teacher_admin")) {
    return "An active teacher administrator role is required.";
  }
  return "The administrative change could not be completed. Review the values and try again.";
}

function rowId(data: unknown): string | null {
  if (Array.isArray(data)) return rowId(data[0]);
  return data && typeof data === "object" && "id" in data && typeof data.id === "string"
    ? data.id
    : null;
}

type ServerSupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

function preparedInvitation(data: unknown): PreparedInvitationDelivery | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;
  const values = row as Record<string, unknown>;
  if (
    typeof values.invitation_id !== "string" ||
    typeof values.email !== "string" ||
    typeof values.full_name !== "string"
  ) {
    return null;
  }
  return {
    invitationId: values.invitation_id,
    email: values.email,
    fullName: values.full_name,
  };
}

async function prepareInvitationSend(
  supabase: ServerSupabaseClient,
  invitationId: string,
): Promise<PreparedInvitationDelivery | null> {
  const { data, error } = await supabase.rpc("prepare_invitation_send", {
    p_invitation_id: invitationId,
  });
  return error ? null : preparedInvitation(data);
}

async function recordInvitationSendSuccess(
  supabase: ServerSupabaseClient,
  input: { invitationId: string; idempotencyKey: string; expiresAt: string },
): Promise<boolean> {
  const { error } = await supabase.rpc("record_invitation_send_success", {
    p_invitation_id: input.invitationId,
    p_send_idempotency_key: input.idempotencyKey,
    p_expires_at: input.expiresAt,
  });
  return !error;
}

async function sendPreparedInvitation(
  supabase: ServerSupabaseClient,
  input: { invitationId: string; expiresAt: string },
): Promise<InvitationDeliveryOutcome> {
  const environment = getServerEnvironment();
  return coordinateInvitationDelivery({
    prepare: () => prepareInvitationSend(supabase, input.invitationId),
    send: async (invitation, idempotencyKey) => {
      const admin = createSupabaseAdminClient();
      const { error } = await admin.auth.admin.inviteUserByEmail(invitation.email, {
        redirectTo: new URL("/update-password", environment.NEXT_PUBLIC_APP_URL).toString(),
        data: {
          invitation_id: invitation.invitationId,
          full_name: invitation.fullName,
          invitation_send_id: idempotencyKey,
        },
      });
      if (error) throw error;
    },
    acknowledge: (idempotencyKey) =>
      recordInvitationSendSuccess(supabase, {
        invitationId: input.invitationId,
        idempotencyKey,
        expiresAt: input.expiresAt,
      }),
  });
}

export async function inviteAccountAction(
  _previous: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  await requireTeacherAdmin();
  const environment = getServerEnvironment();
  const expiresAt = new Date(Date.now() + INVITATION_VALIDITY_MS).toISOString();
  let invitation: ReturnType<typeof validateInvitation>;
  try {
    invitation = validateInvitation(
      {
        email: formData.get("email"),
        fullName: formData.get("full_name"),
        schoolYearId: formData.get("school_year_id"),
        roles: formData.getAll("roles"),
        expiresAt,
      },
      {
        allowedEmailDomains: environment.allowedEmailDomains,
        now: new Date(),
        maximumValidityDays: 30,
      },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.issues[0]?.message ?? "The invitation details are invalid." };
    }
    return { error: "The invitation details are invalid." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_invitation", {
    p_email: invitation.email,
    p_full_name: invitation.fullName,
    p_school_year_id: invitation.schoolYearId,
    p_role_keys: invitation.roles,
    p_expires_at: invitation.expiresAt,
  });
  if (error) return { error: messageForDatabaseError(error.message) };
  const invitationId = rowId(data);
  if (!invitationId) return { error: "The invitation record did not return an identifier." };

  const delivery = await sendPreparedInvitation(supabase, { invitationId, expiresAt });
  if (delivery !== "sent") {
    revalidatePath("/admin/accounts");
    return {
      error:
        delivery === "record-failed"
          ? "Supabase Auth accepted the email, but its send receipt could not be recorded. Check the audit trail before retrying."
          : delivery === "not-sendable"
            ? "The invitation was created but became ineligible before delivery. Review its school year and status."
            : "The invitation was created, but Supabase Auth did not accept the email. Check the server key and SMTP settings, then use Resend.",
    };
  }

  revalidatePath("/admin/accounts");
  return { message: `Invitation sent to ${invitation.email}.` };
}

export async function resendInvitationAction(invitationId: string) {
  await requireTeacherAdmin();
  const parsedId = z.uuid().safeParse(invitationId);
  if (!parsedId.success) redirect("/admin/accounts?notice=invalid-invitation");
  const supabase = await createSupabaseServerClient();
  const expiresAt = new Date(Date.now() + INVITATION_VALIDITY_MS).toISOString();
  const delivery = await sendPreparedInvitation(supabase, {
    invitationId: parsedId.data,
    expiresAt,
  });
  if (delivery === "not-sendable") redirect("/admin/accounts?notice=resend-not-sendable");
  if (delivery === "provider-failed") redirect("/admin/accounts?notice=resend-email-failed");
  if (delivery === "record-failed") redirect("/admin/accounts?notice=resend-receipt-failed");
  revalidatePath("/admin/accounts");
  redirect("/admin/accounts?notice=invitation-resent");
}

export async function revokeInvitationAction(invitationId: string) {
  await requireTeacherAdmin();
  const parsedId = z.uuid().safeParse(invitationId);
  if (!parsedId.success) redirect("/admin/accounts?notice=invalid-invitation");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("revoke_invitation", {
    p_invitation_id: parsedId.data,
  });
  if (error) redirect("/admin/accounts?notice=revoke-failed");
  revalidatePath("/admin/accounts");
  redirect("/admin/accounts?notice=invitation-revoked");
}

export async function setProfileStatusAction(profileId: string, status: "active" | "inactive") {
  await requireTeacherAdmin();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_profile_status", {
    p_profile_id: profileId,
    p_status: status,
  });
  if (error)
    redirect(
      `/admin/accounts?notice=${encodeURIComponent(messageForDatabaseError(error.message))}`,
    );
  revalidatePath("/admin/accounts");
  redirect("/admin/accounts?notice=account-status-updated");
}

export async function setMembershipStatusAction(
  membershipId: string,
  status: "active" | "expired" | "suspended" | "archived",
) {
  await requireTeacherAdmin();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_membership_status", {
    p_membership_id: membershipId,
    p_status: status,
  });
  if (error)
    redirect(
      `/admin/accounts?notice=${encodeURIComponent(messageForDatabaseError(error.message))}`,
    );
  revalidatePath("/admin/accounts");
  revalidatePath("/admin/members");
  redirect("/admin/accounts?notice=membership-status-updated");
}

export async function assignRoleAction(membershipId: string, formData: FormData) {
  await requireTeacherAdmin();
  const role = schoolYearRoleSchema.safeParse(formData.get("role"));
  if (!role.success) redirect("/admin/settings/roles?notice=invalid-role");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("assign_membership_role", {
    p_membership_id: membershipId,
    p_role_key: role.data,
  });
  if (error)
    redirect(
      `/admin/settings/roles?notice=${encodeURIComponent(messageForDatabaseError(error.message))}`,
    );
  revalidatePath("/admin/settings/roles");
  revalidatePath("/admin/members");
  redirect("/admin/settings/roles?notice=role-assigned");
}

export async function removeRoleAction(membershipId: string, role: RoleSlug) {
  await requireTeacherAdmin();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("remove_membership_role", {
    p_membership_id: membershipId,
    p_role_key: role,
  });
  if (error)
    redirect(
      `/admin/settings/roles?notice=${encodeURIComponent(messageForDatabaseError(error.message))}`,
    );
  revalidatePath("/admin/settings/roles");
  revalidatePath("/admin/members");
  redirect("/admin/settings/roles?notice=role-removed");
}

export async function setTargetAction(
  _previous: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  await requireTeacherAdmin();
  const parsed = z
    .object({
      membership_id: z.uuid(),
      target: z
        .union([z.literal(""), z.coerce.number().min(0).max(999)])
        .refine(
          (value) => value === "" || Number.isInteger(value * 4),
          "Use quarter-hour increments.",
        )
        .transform((value) => (value === "" ? null : value)),
    })
    .safeParse({
      membership_id: formData.get("membership_id"),
      target: formData.get("target_hours_override") ?? "",
    });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_membership_target", {
    p_membership_id: parsed.data.membership_id,
    p_target_hours_override: parsed.data.target,
  });
  if (error) return { error: messageForDatabaseError(error.message) };
  revalidatePath("/admin/settings/targets");
  revalidatePath("/admin/members");
  return { message: "Target override updated." };
}

export async function createSchoolYearAction(
  _previous: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  await requireTeacherAdmin();
  let range;
  try {
    range = parseSchoolYearDateRange({
      label: formData.get("label"),
      startDate: formData.get("start_date"),
      endDate: formData.get("end_date"),
    });
  } catch (error) {
    return {
      error:
        error instanceof z.ZodError
          ? error.issues[0]?.message
          : "The school-year dates are invalid.",
    };
  }
  const target = z.coerce.number().min(0).max(999).safeParse(formData.get("default_target_hours"));
  if (!target.success || !Number.isInteger(target.data * 4)) {
    return { fieldErrors: { default_target_hours: ["Use a nonnegative quarter-hour target."] } };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("create_school_year", {
    p_label: range.label,
    p_start_date: range.startDate,
    p_end_date: range.endDate,
    p_default_target_hours: target.data,
  });
  if (error) return { error: messageForDatabaseError(error.message) };
  revalidatePath("/admin/settings/school-years");
  return {
    message:
      "Draft school year created. Renew at least one teacher administrator before activation.",
  };
}

export async function changeSchoolYearStatusAction(
  schoolYearId: string,
  action: "activate" | "close",
) {
  await requireTeacherAdmin();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc(
    action === "activate" ? "activate_school_year" : "close_school_year",
    { p_school_year_id: schoolYearId },
  );
  if (error)
    redirect(
      `/admin/settings/school-years?notice=${encodeURIComponent(messageForDatabaseError(error.message))}`,
    );
  revalidatePath("/admin/settings/school-years");
  redirect(`/admin/settings/school-years?notice=school-year-${action}d`);
}

export async function renewMembershipAction(
  _previous: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  await requireTeacherAdmin();
  const parsed = z
    .object({
      school_year_id: z.uuid(),
      profile_id: z.uuid(),
      expiration_date: z.iso.date(),
      target_hours_override: z.union([z.literal(""), z.coerce.number().min(0).max(999)]),
      roles: z.array(schoolYearRoleSchema).min(1),
    })
    .safeParse({
      school_year_id: formData.get("school_year_id"),
      profile_id: formData.get("profile_id"),
      expiration_date: formData.get("expiration_date"),
      target_hours_override: formData.get("target_hours_override") ?? "",
      roles: formData.getAll("roles"),
    });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("renew_memberships", {
    p_school_year_id: parsed.data.school_year_id,
    p_renewals: [
      {
        profile_id: parsed.data.profile_id,
        expiration_date: parsed.data.expiration_date,
        target_hours_override:
          parsed.data.target_hours_override === "" ? null : parsed.data.target_hours_override,
        role_keys: parsed.data.roles,
      },
    ],
  });
  if (error) return { error: messageForDatabaseError(error.message) };
  revalidatePath("/admin/settings/school-years");
  revalidatePath("/admin/accounts");
  return { message: "Membership renewed into the selected school year." };
}

const categorySchema = z.object({
  category_id: z.union([z.literal(""), z.uuid()]),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000),
  display_order: z.coerce.number().int().min(0).max(10_000),
  is_active: z.enum(["true", "false"]).transform((value) => value === "true"),
  default_max_hours_per_request: z.union([z.literal(""), z.coerce.number().positive().max(24)]),
});

export async function upsertCategoryAction(
  _previous: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  await requireTeacherAdmin();
  const parsed = categorySchema.safeParse({
    category_id: formData.get("category_id") ?? "",
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    display_order: formData.get("display_order"),
    is_active: formData.get("is_active"),
    default_max_hours_per_request: formData.get("default_max_hours_per_request") ?? "",
  });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  const cap = parsed.data.default_max_hours_per_request;
  if (cap !== "" && !Number.isInteger(cap * 4)) {
    return { fieldErrors: { default_max_hours_per_request: ["Use quarter-hour increments."] } };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("upsert_service_category", {
    p_name: parsed.data.name,
    p_description: parsed.data.description,
    p_display_order: parsed.data.display_order,
    p_is_active: parsed.data.is_active,
    p_default_max_hours_per_request: cap === "" ? null : cap,
    p_category_id: parsed.data.category_id || null,
  });
  if (error) return { error: messageForDatabaseError(error.message) };
  revalidatePath("/admin/settings/categories");
  return { message: parsed.data.category_id ? "Category updated." : "Category created." };
}

export async function setSchoolYearCategoryAction(
  _previous: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  await requireTeacherAdmin();
  const nullableQuarterHours = z.union([z.literal(""), z.coerce.number().positive().max(999)]);
  const parsed = z
    .object({
      school_year_id: z.uuid(),
      category_id: z.uuid(),
      is_available: z.enum(["true", "false"]).transform((value) => value === "true"),
      display_order: z.coerce.number().int().min(0),
      max_hours_per_request: nullableQuarterHours,
      member_approved_hours_cap: nullableQuarterHours,
    })
    .safeParse({
      school_year_id: formData.get("school_year_id"),
      category_id: formData.get("category_id"),
      is_available: formData.get("is_available"),
      display_order: formData.get("display_order"),
      max_hours_per_request: formData.get("max_hours_per_request") ?? "",
      member_approved_hours_cap: formData.get("member_approved_hours_cap") ?? "",
    });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  for (const value of [parsed.data.max_hours_per_request, parsed.data.member_approved_hours_cap]) {
    if (value !== "" && !Number.isInteger(value * 4)) {
      return { error: "Category limits must use quarter-hour increments." };
    }
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_school_year_category", {
    p_school_year_id: parsed.data.school_year_id,
    p_category_id: parsed.data.category_id,
    p_is_available: parsed.data.is_available,
    p_display_order: parsed.data.display_order,
    p_max_hours_per_request:
      parsed.data.max_hours_per_request === "" ? null : parsed.data.max_hours_per_request,
    p_member_approved_hours_cap:
      parsed.data.member_approved_hours_cap === "" ? null : parsed.data.member_approved_hours_cap,
  });
  if (error) return { error: messageForDatabaseError(error.message) };
  revalidatePath("/admin/settings/categories");
  return { message: "School-year category settings updated." };
}

export async function correctApprovedRequestAction(
  _previous: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  await requireTeacherAdmin();
  const parsed = z
    .object({
      request_id: z.uuid(),
      title: z.string().trim().min(3).max(120),
      description: z.string().trim().min(20).max(2000),
      category_id: z.uuid(),
      service_date: z.iso.date(),
      hours: z.coerce.number().positive().max(24),
      reason: z.string().trim().min(8, "Provide a specific correction reason.").max(2000),
    })
    .safeParse({
      request_id: formData.get("request_id"),
      title: formData.get("title"),
      description: formData.get("description"),
      category_id: formData.get("category_id"),
      service_date: formData.get("service_date"),
      hours: formData.get("hours"),
      reason: formData.get("reason"),
    });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  if (!Number.isInteger(parsed.data.hours * 4))
    return { error: "Hours must use quarter-hour increments." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("correct_approved_request", {
    p_request_id: parsed.data.request_id,
    p_title: parsed.data.title,
    p_description: parsed.data.description,
    p_category_id: parsed.data.category_id,
    p_service_date: parsed.data.service_date,
    p_hours: parsed.data.hours,
    p_reason: parsed.data.reason,
  });
  if (error) return { error: messageForDatabaseError(error.message) };
  revalidatePath(`/admin/requests/${parsed.data.request_id}`);
  revalidatePath("/admin/members");
  return { message: "Approved record corrected with immutable before/after history." };
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

export async function importRosterAction(
  _previous: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  await requireTeacherAdmin();
  const file = formData.get("roster");
  const schoolYearId = z.uuid().safeParse(formData.get("school_year_id"));
  if (
    !(file instanceof File) ||
    file.size === 0 ||
    file.size > 1_000_000 ||
    !schoolYearId.success
  ) {
    return { error: "Choose a CSV file under 1 MB and a valid school year." };
  }
  let rows;
  try {
    rows = parseCsv(await file.text());
  } catch (error) {
    return { error: error instanceof Error ? error.message : "The CSV could not be parsed." };
  }
  if (rows.length < 2 || rows.length > 251) {
    return { error: "The CSV must contain a header and between 1 and 250 account rows." };
  }
  const header = rows[0]?.map((value) => value.toLowerCase()) ?? [];
  const allowedHeaders = new Set(["email", "full_name", "roles"]);
  const unknownHeaders = header.filter((name) => !allowedHeaders.has(name));
  if (unknownHeaders.length > 0 || new Set(header).size !== header.length) {
    return { error: "CSV headers must be unique and limited to email, full_name, and roles." };
  }
  const emailIndex = header.indexOf("email");
  const nameIndex = header.indexOf("full_name");
  const rolesIndex = header.indexOf("roles");
  if (emailIndex < 0 || nameIndex < 0) {
    return {
      error:
        "CSV headers must include email and full_name. An optional roles column uses | separators.",
    };
  }

  const environment = getServerEnvironment();
  const supabase = await createSupabaseServerClient();
  const validatedInvitations: ReturnType<typeof validateInvitation>[] = [];
  const errors: string[] = [];
  const seenEmails = new Set<string>();
  for (const [offset, row] of rows.slice(1).entries()) {
    const line = offset + 2;
    const roles = (rolesIndex >= 0 ? row[rolesIndex] : "member")
      ?.split("|")
      .map((role) => role.trim())
      .filter(Boolean) ?? ["member"];
    let invitation: ReturnType<typeof validateInvitation>;
    try {
      invitation = validateInvitation(
        {
          email: row[emailIndex],
          fullName: row[nameIndex],
          schoolYearId: schoolYearId.data,
          roles,
          expiresAt: new Date(Date.now() + INVITATION_VALIDITY_MS).toISOString(),
        },
        {
          allowedEmailDomains: environment.allowedEmailDomains,
          now: new Date(),
          maximumValidityDays: 30,
        },
      );
    } catch {
      errors.push(`line ${line}: invalid account values`);
      continue;
    }
    if (seenEmails.has(invitation.email)) {
      errors.push(`line ${line}: duplicate email in this file`);
      continue;
    }
    seenEmails.add(invitation.email);
    validatedInvitations.push(invitation);
  }
  if (errors.length > 0) {
    return {
      error: `No accounts were changed. Fix ${errors.length} validation error(s): ${errors.slice(0, 8).join("; ")}`,
    };
  }

  let sent = 0;
  for (const [offset, invitation] of validatedInvitations.entries()) {
    const line = offset + 2;
    const { data, error } = await supabase.rpc("create_invitation", {
      p_email: invitation.email,
      p_full_name: invitation.fullName,
      p_school_year_id: invitation.schoolYearId,
      p_role_keys: invitation.roles,
      p_expires_at: invitation.expiresAt,
    });
    const invitationId = rowId(data);
    if (error || !invitationId) {
      errors.push(`line ${line}: invitation record rejected`);
      continue;
    }
    const delivery = await sendPreparedInvitation(supabase, {
      invitationId,
      expiresAt: invitation.expiresAt,
    });
    if (delivery !== "sent") {
      errors.push(
        delivery === "record-failed"
          ? `line ${line}: provider accepted email but receipt recording failed`
          : delivery === "not-sendable"
            ? `line ${line}: invitation became ineligible before delivery`
            : `line ${line}: email not accepted; use Resend`,
      );
      continue;
    }
    sent += 1;
  }
  revalidatePath("/admin/accounts");
  return {
    message: `${sent} invitation${sent === 1 ? "" : "s"} sent.${errors.length ? ` ${errors.length} row(s) need attention: ${errors.slice(0, 5).join("; ")}` : ""}`,
  };
}
