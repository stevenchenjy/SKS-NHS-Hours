export const roleSlugs = [
  "member",
  "committee_head",
  "president_vice_president",
  "teacher_admin",
] as const;

export type RoleSlug = (typeof roleSlugs)[number];
export type ReviewerRole = Exclude<RoleSlug, "member">;
export type GlobalAccessLevel = "teacher_admin" | "platform_owner";
export type MembershipStatus = "active" | "expired" | "suspended" | "archived";
export type SchoolYearStatus = "draft" | "active" | "closed" | "archived";
export type HourRequestStatus =
  "draft" | "pending" | "changes_requested" | "approved" | "rejected" | "withdrawn";
export type HourApprovalStage = "committee_head" | "teacher";
export type HourReviewAction =
  | "submitted"
  | "resubmitted"
  | "committee_approved"
  | "approved"
  | "changes_requested"
  | "rejected"
  | "reassigned"
  | "withdrawn"
  | "corrected";
export type ServiceEventRegistrationStatus = "confirmed" | "waitlisted" | "withdrawn";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  status: "active" | "inactive";
  deactivated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SchoolYear {
  id: string;
  label: string;
  start_date: string;
  end_date: string;
  default_target_hours: string | number;
  status: SchoolYearStatus;
  created_at: string;
  closed_at: string | null;
}

export interface Membership {
  id: string;
  profile_id: string;
  school_year_id: string;
  status: MembershipStatus;
  expiration_date: string;
  target_hours_override: string | number | null;
  renewed_from_membership_id: string | null;
  created_at: string;
  school_year: SchoolYear;
  roles: RoleSlug[];
}

export interface Viewer {
  id: string;
  email: string;
  profile: Profile;
  activeMembership: Membership | null;
  memberships: Membership[];
  roles: RoleSlug[];
  globalAccessLevel: GlobalAccessLevel | null;
  isMember: boolean;
  canReview: boolean;
  isTeacherAdmin: boolean;
  isPlatformOwner: boolean;
}

export interface ServiceCategory {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
}

export interface ReviewerOption {
  membershipId: string;
  userId: string;
  fullName: string;
  roles: RoleSlug[];
}

export interface ProgressRecord {
  membership_id: string;
  profile_id: string;
  school_year_id: string;
  full_name: string;
  email?: string;
  membership_status: MembershipStatus;
  target_hours: number | string;
  approved_hours: number | string;
  pending_hours: number | string;
  changes_requested_hours: number | string;
  rejected_hours: number | string;
  remaining_hours: number | string;
  over_goal_hours: number | string;
  actual_percentage: number | string;
  approved_count: number;
  pending_count: number;
  changes_requested_count: number;
  rejected_count: number;
  draft_count: number;
  withdrawn_count: number;
  last_activity_at: string | null;
  roles?: RoleSlug[];
}

export interface HourReview {
  id: number | string;
  hour_request_id: string;
  reviewer_membership_id: string | null;
  reviewer_name?: string;
  action: HourReviewAction;
  comment: string | null;
  previous_status: HourRequestStatus | null;
  new_status: HourRequestStatus | null;
  created_at: string;
}

export interface HourRequest {
  id: string;
  member_membership_id: string;
  school_year_id: string;
  title: string | null;
  description: string | null;
  category_id: string | null;
  service_date: string | null;
  hours: number | string | null;
  requested_approver_membership_id: string | null;
  committee_head_reviewer_membership_id: string | null;
  committee_head_approved_at: string | null;
  actual_reviewer_membership_id: string | null;
  status: HourRequestStatus;
  client_submission_key?: string | null;
  revision: number;
  created_at: string;
  submitted_at: string | null;
  updated_at: string;
  decided_at: string | null;
  category?: Pick<ServiceCategory, "id" | "name">;
  requestedApprover?: Pick<Profile, "id" | "full_name"> | null;
  actualReviewer?: Pick<Profile, "id" | "full_name"> | null;
  member?: Pick<Profile, "id" | "full_name" | "email">;
  memberMembership?: {
    id: string;
    profile_id: string;
    profiles:
      | Pick<Profile, "id" | "full_name" | "email">
      | Array<Pick<Profile, "id" | "full_name" | "email">>;
  };
  requestedApproverMembership?: {
    id: string;
    profile_id: string;
    profiles: Pick<Profile, "id" | "full_name"> | Array<Pick<Profile, "id" | "full_name">>;
  } | null;
  actualReviewerMembership?: {
    id: string;
    profile_id: string;
    profiles: Pick<Profile, "id" | "full_name"> | Array<Pick<Profile, "id" | "full_name">>;
  } | null;
  reviews?: HourReview[];
}

export interface PendingQueueItem extends HourRequest {
  title: string;
  description: string;
  category_id: string;
  service_date: string;
  hours: number | string;
  requested_approver_membership_id: string;
  status: "pending";
  submitted_at: string;
  member_profile_id: string;
  member_name: string;
  member_email?: string;
  category_name: string;
  requested_approver_name: string;
  approval_stage: HourApprovalStage;
  assigned_to_current_user: boolean;
  waiting_since: string;
  waiting_days: number;
}

export interface AccountDirectoryRecord {
  membership: Membership | null;
  profile: Profile;
  globalAccessLevel: GlobalAccessLevel | null;
}

export interface RoleRecord {
  id: number;
  role_key: RoleSlug;
  display_name: string;
  is_review_capable: boolean;
  is_teacher_admin: boolean;
  display_order: number;
}

export interface ServiceEvent {
  id: string;
  school_year_id: string;
  school_year_label: string;
  title: string;
  description: string;
  location: string;
  volunteer_audience: string;
  starts_at: string;
  ends_at: string;
  contact_name: string;
  contact_email: string;
  capacity: number;
  organizer_name: string;
  confirmed_count: number;
  waitlist_count: number;
  spots_remaining: number;
  is_expired: boolean;
  my_registration_status: ServiceEventRegistrationStatus | null;
  my_waitlist_position: number | null;
  can_manage: boolean;
}

export interface ServiceEventRosterEntry {
  registration_id: number;
  member_membership_id: string;
  full_name: string;
  email: string;
  status: Exclude<ServiceEventRegistrationStatus, "withdrawn">;
  joined_at: string;
  promoted_at: string | null;
  waitlist_position: number | null;
}
