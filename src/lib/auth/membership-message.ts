import type { Membership } from "@/lib/types";

export function inactiveMembershipMessage(
  membership: Membership | undefined,
  today: string,
  profileActive = true,
): string {
  if (!profileActive)
    return "Your portal account is inactive. NHS support can check whether it should be reactivated.";
  if (!membership)
    return "You are signed in, but no NHS school-year membership has been assigned. NHS support can check your roster access.";
  if (membership.status !== "active")
    return "Your school-year membership is inactive. NHS support can check your membership status.";
  if (membership.school_year.status === "draft")
    return `Your ${membership.school_year.label} membership is ready, but that school year has not been activated yet. Keep using the same account; you do not need a new password or invitation.`;
  if (membership.school_year.start_date > today)
    return `Your ${membership.school_year.label} access starts on ${membership.school_year.start_date}. Keep using the same account when the school year starts.`;
  return "Your previous school-year access has ended. NHS support can assign your next-year membership to this same account; you do not need a new password.";
}
