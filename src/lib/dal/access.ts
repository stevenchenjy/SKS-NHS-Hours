import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { GlobalAccessLevel, Membership, RoleSlug, SchoolYear, Viewer } from "@/lib/types";

const reviewerRoles = new Set<RoleSlug>(["committee_head", "teacher_admin"]);

type MembershipRow = Omit<Membership, "school_year" | "roles"> & {
  school_years: SchoolYear | SchoolYear[];
};

function relationOne<T>(relation: T | T[] | null | undefined): T | null {
  if (Array.isArray(relation)) return relation[0] ?? null;
  return relation ?? null;
}

function membershipIsActive(membership: Membership, today: string): boolean {
  return (
    membership.status === "active" &&
    membership.school_year.status === "active" &&
    membership.school_year.start_date <= today &&
    membership.school_year.end_date >= today &&
    membership.expiration_date >= today
  );
}

export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) return null;

  const [
    { data: profile, error: profileError },
    { data: membershipRows, error: membershipError },
    { data: accessGrant, error: accessGrantError },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id,email,full_name,status,deactivated_at,created_at,updated_at")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("school_year_memberships")
      .select(
        "id,profile_id,school_year_id,status,expiration_date,target_hours_override,renewed_from_membership_id,created_at,school_years!inner(id,label,start_date,end_date,default_target_hours,status,created_at,closed_at)",
      )
      .eq("profile_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("platform_access_grants")
      .select("access_level")
      .eq("profile_id", user.id)
      .maybeSingle(),
  ]);

  if (profileError || membershipError || accessGrantError || !profile) return null;

  const rawMemberships = (membershipRows ?? []) as unknown as MembershipRow[];
  const membershipIds = rawMemberships.map((membership) => membership.id);
  const { data: roleRows, error: roleError } = membershipIds.length
    ? await supabase
        .from("membership_roles")
        .select("membership_id,roles!inner(role_key)")
        .in("membership_id", membershipIds)
    : { data: [], error: null };
  if (roleError) throw new Error(`Unable to load viewer roles: ${roleError.message}`);

  const roleMap = new Map<string, RoleSlug[]>();
  for (const row of (roleRows ?? []) as unknown as Array<{
    membership_id: string;
    roles: { role_key: RoleSlug } | Array<{ role_key: RoleSlug }>;
  }>) {
    const role = relationOne(row.roles)?.role_key;
    if (!role) continue;
    roleMap.set(row.membership_id, [...(roleMap.get(row.membership_id) ?? []), role]);
  }

  const memberships = rawMemberships.flatMap((row): Membership[] => {
    const schoolYear = relationOne(row.school_years);
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
        roles: roleMap.get(row.id) ?? [],
      },
    ];
  });

  const globalAccessLevel =
    accessGrant &&
    (accessGrant.access_level === "teacher_admin" || accessGrant.access_level === "platform_owner")
      ? (accessGrant.access_level as GlobalAccessLevel)
      : null;
  const isTeacherAdmin = globalAccessLevel !== null;
  const today = new Date().toISOString().slice(0, 10);
  const currentMembership = memberships.find((membership) => membershipIsActive(membership, today));
  const administratorAnchors = memberships.filter((membership) =>
    membership.roles.includes("teacher_admin"),
  );
  const administratorAnchor =
    administratorAnchors.find((membership) => membershipIsActive(membership, today)) ??
    administratorAnchors
      .filter(
        (membership) =>
          membership.status === "active" &&
          membership.school_year.status === "draft" &&
          membership.expiration_date >= today,
      )
      .sort((left, right) =>
        left.school_year.start_date.localeCompare(right.school_year.start_date),
      )[0] ??
    administratorAnchors.sort((left, right) =>
      right.school_year.start_date.localeCompare(left.school_year.start_date),
    )[0];
  const activeMembership =
    profile.status === "active"
      ? isTeacherAdmin
        ? (administratorAnchor ?? null)
        : (currentMembership ?? null)
      : null;
  const roles = activeMembership?.roles ?? [];
  const isMember = Boolean(
    activeMembership &&
    membershipIsActive(activeMembership, today) &&
    activeMembership.roles.includes("member"),
  );

  return {
    id: user.id,
    email: user.email ?? profile.email,
    profile,
    activeMembership,
    memberships,
    roles,
    globalAccessLevel,
    isMember,
    canReview: isTeacherAdmin || roles.some((role) => reviewerRoles.has(role)),
    isTeacherAdmin,
    isPlatformOwner: globalAccessLevel === "platform_owner",
  };
});

export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  return viewer;
}

export async function requireActiveViewer(): Promise<Viewer & { activeMembership: Membership }> {
  const viewer = await requireViewer();
  if (!viewer.activeMembership || !viewer.isMember) redirect("/account-expired");
  return viewer as Viewer & { activeMembership: Membership };
}

export const requireMember = requireActiveViewer;

export async function requirePortalViewer(): Promise<Viewer & { activeMembership: Membership }> {
  const viewer = await requireViewer();
  if (!viewer.activeMembership || (!viewer.isMember && !viewer.isTeacherAdmin)) {
    redirect("/account-expired");
  }
  return viewer as Viewer & { activeMembership: Membership };
}

export async function requireReviewer(): Promise<Viewer & { activeMembership: Membership }> {
  const viewer = await requirePortalViewer();
  if (!viewer.canReview) redirect("/dashboard?notice=not-authorized");
  return viewer;
}

export async function requireTeacherAdmin(): Promise<Viewer & { activeMembership: Membership }> {
  const viewer = await requirePortalViewer();
  if (!viewer.isTeacherAdmin) redirect("/admin?notice=teacher-admin-required");
  return viewer;
}

export async function requirePlatformOwner(): Promise<Viewer & { activeMembership: Membership }> {
  const viewer = await requireTeacherAdmin();
  if (!viewer.isPlatformOwner) redirect("/admin?notice=platform-owner-required");
  return viewer;
}

export function hasAnyRole(viewer: Viewer, roles: RoleSlug[]): boolean {
  return roles.some((role) => viewer.roles.includes(role));
}
