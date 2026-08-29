import { z } from "zod";

export const SCHOOL_YEAR_ROLES = [
  "member",
  "committee_head",
  "president",
  "vice_president",
  "teacher_admin",
] as const;

export const REVIEW_CAPABLE_ROLES = [
  "committee_head",
  "president",
  "vice_president",
  "teacher_admin",
] as const;

export const MEMBERSHIP_STATUSES = ["active", "expired", "suspended", "archived"] as const;

export const schoolYearRoleSchema = z.enum(SCHOOL_YEAR_ROLES);
export const reviewCapableRoleSchema = z.enum(REVIEW_CAPABLE_ROLES);
export const membershipStatusSchema = z.enum(MEMBERSHIP_STATUSES);

export type SchoolYearRole = z.infer<typeof schoolYearRoleSchema>;
export type ReviewCapableRole = z.infer<typeof reviewCapableRoleSchema>;
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;

const REVIEW_CAPABLE_ROLE_SET: ReadonlySet<SchoolYearRole> = new Set(REVIEW_CAPABLE_ROLES);

export function hasReviewCapability(roles: readonly SchoolYearRole[]): boolean {
  return roles.some((role) => REVIEW_CAPABLE_ROLE_SET.has(role));
}

export function hasTeacherAdminCapability(roles: readonly SchoolYearRole[]): boolean {
  return roles.includes("teacher_admin");
}
