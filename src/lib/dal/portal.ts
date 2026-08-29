import "server-only";

import { cache } from "react";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  HourRequest,
  AccountDirectoryRecord,
  Membership,
  PendingQueueItem,
  Profile,
  ProgressRecord,
  ReviewerOption,
  RoleRecord,
  RoleSlug,
  SchoolYear,
  ServiceCategory,
} from "@/lib/types";

function requireData<T>(data: T | null, error: { message: string } | null, context: string): T {
  if (error) throw new Error(`${context}: ${error.message}`);
  if (data === null) throw new Error(`${context}: no data returned`);
  return data;
}

function normalizeProgress(row: Record<string, unknown>): ProgressRecord {
  const target = Number(row.target_hours ?? 0);
  const approved = Number(row.approved_hours ?? 0);
  return {
    ...(row as unknown as ProgressRecord),
    target_hours: target,
    approved_hours: approved,
    pending_hours: Number(row.pending_hours ?? 0),
    changes_requested_hours: Number(row.changes_requested_hours ?? 0),
    rejected_hours: Number(row.rejected_hours ?? 0),
    remaining_hours: Number(row.remaining_hours ?? Math.max(target - approved, 0)),
    over_goal_hours: Number(row.over_goal_hours ?? Math.max(approved - target, 0)),
    actual_percentage: Number(row.actual_percentage ?? row.progress_percent ?? 0),
    approved_count: Number(row.approved_count ?? 0),
    pending_count: Number(row.pending_count ?? 0),
    changes_requested_count: Number(row.changes_requested_count ?? 0),
    rejected_count: Number(row.rejected_count ?? 0),
    draft_count: Number(row.draft_count ?? 0),
    withdrawn_count: Number(row.withdrawn_count ?? 0),
    last_activity_at: typeof row.last_activity_at === "string" ? row.last_activity_at : null,
    roles: Array.isArray(row.role_keys) ? (row.role_keys as RoleSlug[]) : [],
  };
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function normalizeHourRequest(row: Record<string, unknown>): HourRequest {
  const { categoryAssignment, ...request } = row;
  const assignment = firstRelation(
    categoryAssignment as
      | {
          service_categories:
            | Pick<ServiceCategory, "id" | "name">
            | Array<Pick<ServiceCategory, "id" | "name">>
            | null;
        }
      | Array<{
          service_categories:
            | Pick<ServiceCategory, "id" | "name">
            | Array<Pick<ServiceCategory, "id" | "name">>
            | null;
        }>
      | null,
  );
  const category = firstRelation(assignment?.service_categories);
  return { ...request, category: category ?? undefined } as unknown as HourRequest;
}

export const listSchoolYears = cache(async (): Promise<SchoolYear[]> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("school_years")
    .select("id,label,start_date,end_date,default_target_hours,status,created_at,closed_at")
    .order("start_date", { ascending: false });
  return requireData(data, error, "Unable to load school years") as SchoolYear[];
});

export async function listCategories(schoolYearId: string): Promise<ServiceCategory[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("school_year_categories")
    .select(
      "display_order,max_hours_per_request,member_approved_hours_cap,service_categories!inner(id,name,description,display_order,is_active)",
    )
    .eq("school_year_id", schoolYearId)
    .eq("is_available", true);
  const rows = requireData(data, error, "Unable to load service categories") as unknown as Array<{
    display_order: number;
    max_hours_per_request: number | string | null;
    member_approved_hours_cap: number | string | null;
    service_categories: ServiceCategory | ServiceCategory[];
  }>;
  return rows
    .flatMap((row) => {
      const categories = Array.isArray(row.service_categories)
        ? row.service_categories
        : [row.service_categories];
      return categories.map((category) => ({
        ...category,
        display_order: row.display_order,
        max_hours_per_request: row.max_hours_per_request,
        member_approved_hours_cap: row.member_approved_hours_cap,
      }));
    })
    .filter((category) => category.is_active)
    .sort((a, b) => a.display_order - b.display_order);
}

export async function listActiveReviewers(schoolYearId: string): Promise<ReviewerOption[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_eligible_reviewers", {
    p_school_year_id: schoolYearId,
  });
  const rows = requireData(data, error, "Unable to load reviewers") as unknown as Array<{
    membership_id: string;
    profile_id: string;
    full_name: string;
    role_keys: RoleSlug[];
  }>;
  return rows
    .map((row) => ({
      membershipId: row.membership_id,
      userId: row.profile_id,
      fullName: row.full_name,
      roles: row.role_keys,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export async function getProgress(membershipId: string): Promise<ProgressRecord> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("member_progress")
    .select("*")
    .eq("membership_id", membershipId)
    .single();
  return normalizeProgress(
    requireData(data, error, "Unable to load progress") as Record<string, unknown>,
  );
}

export async function listRosterProgress(schoolYearId: string): Promise<ProgressRecord[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("member_progress")
    .select("*")
    .eq("school_year_id", schoolYearId)
    .order("full_name");
  return (requireData(data, error, "Unable to load roster") as Record<string, unknown>[]).map(
    normalizeProgress,
  );
}

export async function listMemberRequests(
  membershipIds: string[],
  schoolYearId?: string,
): Promise<HourRequest[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("hour_requests")
    .select(
      "*,categoryAssignment:school_year_categories!hour_requests_category_year_fkey(service_categories!school_year_categories_category_id_fkey(id,name)),memberMembership:school_year_memberships!hour_requests_member_year_fkey(id,profile_id,profiles!school_year_memberships_profile_id_fkey(id,full_name,email)),requestedApproverMembership:school_year_memberships!hour_requests_requested_approver_year_fkey(id,profile_id,profiles!school_year_memberships_profile_id_fkey(id,full_name)),actualReviewerMembership:school_year_memberships!hour_requests_actual_reviewer_year_fkey(id,profile_id,profiles!school_year_memberships_profile_id_fkey(id,full_name))",
    )
    .in("member_membership_id", membershipIds)
    .order("service_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (schoolYearId) query = query.eq("school_year_id", schoolYearId);
  const { data, error } = await query;
  return (
    requireData(data, error, "Unable to load hour requests") as unknown as Record<string, unknown>[]
  ).map(normalizeHourRequest);
}

export async function getHourRequest(requestId: string): Promise<HourRequest> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("hour_requests")
    .select(
      "*,categoryAssignment:school_year_categories!hour_requests_category_year_fkey(service_categories!school_year_categories_category_id_fkey(id,name)),memberMembership:school_year_memberships!hour_requests_member_year_fkey(id,profile_id,profiles!school_year_memberships_profile_id_fkey(id,full_name,email)),requestedApproverMembership:school_year_memberships!hour_requests_requested_approver_year_fkey(id,profile_id,profiles!school_year_memberships_profile_id_fkey(id,full_name)),actualReviewerMembership:school_year_memberships!hour_requests_actual_reviewer_year_fkey(id,profile_id,profiles!school_year_memberships_profile_id_fkey(id,full_name)),reviews:hour_reviews(*)",
    )
    .eq("id", requestId)
    .single();
  return normalizeHourRequest(
    requireData(data, error, "Unable to load request") as unknown as Record<string, unknown>,
  );
}

export async function listPendingQueue(
  schoolYearId: string,
  requestedApproverId?: string,
): Promise<PendingQueueItem[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("pending_review_queue")
    .select("*")
    .eq("school_year_id", schoolYearId)
    .order("submitted_at", { ascending: true });
  if (requestedApproverId)
    query = query.eq("requested_approver_membership_id", requestedApproverId);
  const { data, error } = await query;
  return (
    requireData(data, error, "Unable to load review queue") as Array<
      PendingQueueItem & { days_pending?: number }
    >
  ).map((row) => ({
    ...row,
    waiting_since: row.submitted_at ?? row.created_at,
    waiting_days: Number(row.days_pending ?? 0),
  }));
}

export async function listAuditEvents(schoolYearId: string, limit = 100) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("audit_events")
    .select(
      "id,actor_profile_id,actor_membership_id,action,entity_type,entity_id,school_year_id,old_values,new_values,metadata,occurred_at,profiles!audit_events_actor_profile_id_fkey(full_name,email)",
    )
    .eq("school_year_id", schoolYearId)
    .order("occurred_at", { ascending: false })
    .limit(Math.min(limit, 250));
  return requireData(data, error, "Unable to load audit events");
}

export async function listInvitations(schoolYearId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("invitations")
    .select("*,invitation_roles(roles(role_key,display_name))")
    .eq("school_year_id", schoolYearId)
    .order("created_at", { ascending: false });
  return requireData(data, error, "Unable to load invitations");
}

export async function getProfileRecord(profileId: string): Promise<Profile> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,full_name,status,deactivated_at,created_at,updated_at")
    .eq("id", profileId)
    .single();
  return requireData(data, error, "Unable to load profile") as Profile;
}

export async function listMembershipsForProfile(profileId: string): Promise<Membership[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("school_year_memberships")
    .select(
      "id,profile_id,school_year_id,status,expiration_date,target_hours_override,renewed_from_membership_id,created_at,school_years!inner(id,label,start_date,end_date,default_target_hours,status,created_at,closed_at)",
    )
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false });
  const rows = requireData(data, error, "Unable to load memberships") as unknown as Array<
    Omit<Membership, "school_year" | "roles"> & {
      school_years: SchoolYear | SchoolYear[];
    }
  >;
  const ids = rows.map((row) => row.id);
  const { data: assignments, error: assignmentError } = ids.length
    ? await supabase
        .from("membership_roles")
        .select("membership_id,roles!inner(role_key)")
        .in("membership_id", ids)
    : { data: [], error: null };
  if (assignmentError) throw new Error(`Unable to load roles: ${assignmentError.message}`);
  const roles = new Map<string, RoleSlug[]>();
  for (const row of (assignments ?? []) as unknown as Array<{
    membership_id: string;
    roles: { role_key: RoleSlug } | Array<{ role_key: RoleSlug }>;
  }>) {
    const relation = Array.isArray(row.roles) ? row.roles[0] : row.roles;
    if (!relation) continue;
    roles.set(row.membership_id, [...(roles.get(row.membership_id) ?? []), relation.role_key]);
  }
  return rows.flatMap((row) => {
    const schoolYear = Array.isArray(row.school_years) ? row.school_years[0] : row.school_years;
    if (!schoolYear) return [];
    return [
      {
        id: row.id,
        profile_id: row.profile_id,
        school_year_id: row.school_year_id,
        status: row.status,
        expiration_date: row.expiration_date,
        target_hours_override: row.target_hours_override,
        renewed_from_membership_id: row.renewed_from_membership_id,
        created_at: row.created_at,
        school_year: schoolYear,
        roles: roles.get(row.id) ?? [],
      },
    ];
  });
}

export async function listAccountDirectory(
  schoolYearId: string,
): Promise<AccountDirectoryRecord[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("school_year_memberships")
    .select(
      "id,profile_id,school_year_id,status,expiration_date,target_hours_override,renewed_from_membership_id,created_at,profiles!school_year_memberships_profile_id_fkey!inner(id,email,full_name,status,deactivated_at,created_at,updated_at),school_years!school_year_memberships_school_year_id_fkey!inner(id,label,start_date,end_date,default_target_hours,status,created_at,closed_at)",
    )
    .eq("school_year_id", schoolYearId)
    .order("created_at", { ascending: false });
  const rows = requireData(data, error, "Unable to load account directory") as unknown as Array<{
    id: string;
    profile_id: string;
    school_year_id: string;
    status: Membership["status"];
    expiration_date: string;
    target_hours_override: string | number | null;
    renewed_from_membership_id: string | null;
    created_at: string;
    profiles: Profile | Profile[];
    school_years: SchoolYear | SchoolYear[];
  }>;
  const ids = rows.map((row) => row.id);
  const { data: assignments } = ids.length
    ? await supabase
        .from("membership_roles")
        .select("membership_id,roles!inner(role_key)")
        .in("membership_id", ids)
    : { data: [] };
  const roles = new Map<string, RoleSlug[]>();
  for (const row of (assignments ?? []) as unknown as Array<{
    membership_id: string;
    roles: { role_key: RoleSlug } | Array<{ role_key: RoleSlug }>;
  }>) {
    const relation = Array.isArray(row.roles) ? row.roles[0] : row.roles;
    if (!relation) continue;
    roles.set(row.membership_id, [...(roles.get(row.membership_id) ?? []), relation.role_key]);
  }
  return rows.flatMap((row) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    const schoolYear = Array.isArray(row.school_years) ? row.school_years[0] : row.school_years;
    if (!profile || !schoolYear) return [];
    return [
      {
        profile,
        membership: {
          id: row.id,
          profile_id: row.profile_id,
          school_year_id: row.school_year_id,
          status: row.status,
          expiration_date: row.expiration_date,
          target_hours_override: row.target_hours_override,
          renewed_from_membership_id: row.renewed_from_membership_id,
          created_at: row.created_at,
          school_year: schoolYear,
          roles: roles.get(row.id) ?? [],
        },
      },
    ];
  });
}

export async function listRoleRecords(): Promise<RoleRecord[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("roles")
    .select("id,role_key,display_name,is_review_capable,is_teacher_admin,display_order")
    .order("display_order");
  return requireData(data, error, "Unable to load roles") as RoleRecord[];
}

export async function listAllServiceCategories() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("service_categories")
    .select("*")
    .order("display_order");
  return requireData(data, error, "Unable to load categories");
}

export async function listSchoolYearCategorySettings(schoolYearId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("school_year_categories")
    .select("*,service_categories!inner(*)")
    .eq("school_year_id", schoolYearId)
    .order("display_order");
  return requireData(data, error, "Unable to load category settings");
}
