import { z } from "zod";

import {
  hasReviewCapability,
  membershipStatusSchema,
  schoolYearRoleSchema,
  type SchoolYearRole,
} from "./roles";

export const HOUR_REQUEST_STATUSES = [
  "draft",
  "pending",
  "changes_requested",
  "approved",
  "rejected",
  "withdrawn",
] as const;

export const HOUR_REQUEST_ACTIONS = [
  "edit",
  "submit",
  "resubmit",
  "withdraw",
  "approve",
  "request_changes",
  "reject",
  "reassign",
  "correct",
] as const;

export const REVIEW_ACTIONS = ["approve", "request_changes", "reject", "reassign"] as const;

export const hourRequestStatusSchema = z.enum(HOUR_REQUEST_STATUSES);
export const hourRequestActionSchema = z.enum(HOUR_REQUEST_ACTIONS);
export const reviewActionSchema = z.enum(REVIEW_ACTIONS);

export type HourRequestStatus = z.infer<typeof hourRequestStatusSchema>;
export type HourRequestAction = z.infer<typeof hourRequestActionSchema>;
export type ReviewAction = z.infer<typeof reviewActionSchema>;

const TRANSITIONS = {
  draft: {
    edit: "draft",
    submit: "pending",
  },
  pending: {
    withdraw: "withdrawn",
    approve: "approved",
    request_changes: "changes_requested",
    reject: "rejected",
    reassign: "pending",
  },
  changes_requested: {
    edit: "changes_requested",
    resubmit: "pending",
  },
  approved: {
    correct: "approved",
  },
  rejected: {},
  withdrawn: {},
} as const satisfies Record<
  HourRequestStatus,
  Partial<Record<HourRequestAction, HourRequestStatus>>
>;

export class InvalidRequestTransitionError extends Error {
  readonly currentStatus: HourRequestStatus;
  readonly action: HourRequestAction;

  constructor(currentStatus: HourRequestStatus, action: HourRequestAction) {
    super(`Action "${action}" is not permitted while a request is "${currentStatus}".`);
    this.name = "InvalidRequestTransitionError";
    this.currentStatus = currentStatus;
    this.action = action;
  }
}

export function allowedRequestActions(
  statusInput: HourRequestStatus,
): readonly HourRequestAction[] {
  const status = hourRequestStatusSchema.parse(statusInput);
  return Object.keys(TRANSITIONS[status]) as HourRequestAction[];
}

export function canTransitionRequest(
  statusInput: HourRequestStatus,
  actionInput: HourRequestAction,
): boolean {
  const status = hourRequestStatusSchema.parse(statusInput);
  const action = hourRequestActionSchema.parse(actionInput);
  return action in TRANSITIONS[status];
}

export function transitionRequestStatus(
  statusInput: HourRequestStatus,
  actionInput: HourRequestAction,
): HourRequestStatus {
  const status = hourRequestStatusSchema.parse(statusInput);
  const action = hourRequestActionSchema.parse(actionInput);
  const nextStatus = (TRANSITIONS[status] as Partial<Record<HourRequestAction, HourRequestStatus>>)[
    action
  ];

  if (!nextStatus) {
    throw new InvalidRequestTransitionError(status, action);
  }

  return nextStatus;
}

const optionalReviewCommentSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const comment = value.trim();
  return comment.length === 0 ? undefined : comment;
}, z.string().max(4_000).optional());

const requiredReviewCommentSchema = z
  .string()
  .trim()
  .min(1, "A reviewer comment is required for this action.")
  .max(4_000);

export const reviewDecisionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("approve"),
      comment: optionalReviewCommentSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("request_changes"),
      comment: requiredReviewCommentSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("reject"),
      comment: requiredReviewCommentSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("reassign"),
      requestedApproverMembershipId: z.string().uuid(),
      comment: optionalReviewCommentSchema,
    })
    .strict(),
]);

export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;

export const REVIEW_DENIAL_REASONS = [
  "request_not_pending",
  "self_review",
  "inactive_membership",
  "different_school_year",
  "missing_review_role",
] as const;

export const reviewDenialReasonSchema = z.enum(REVIEW_DENIAL_REASONS);
export type ReviewDenialReason = z.infer<typeof reviewDenialReasonSchema>;

export const reviewEligibilityInputSchema = z
  .object({
    requestStatus: hourRequestStatusSchema,
    submitterUserId: z.string().uuid(),
    reviewerUserId: z.string().uuid(),
    requestSchoolYearId: z.string().uuid(),
    reviewerSchoolYearId: z.string().uuid(),
    reviewerMembershipStatus: membershipStatusSchema,
    reviewerRoles: z.array(schoolYearRoleSchema).max(4),
  })
  .strict();

export type ReviewEligibilityInput = z.infer<typeof reviewEligibilityInputSchema>;

export interface ReviewEligibility {
  allowed: boolean;
  reasons: ReviewDenialReason[];
}

export class ReviewNotAllowedError extends Error {
  readonly reasons: readonly ReviewDenialReason[];

  constructor(reasons: readonly ReviewDenialReason[]) {
    super(`Review is not allowed: ${reasons.join(", ")}.`);
    this.name = "ReviewNotAllowedError";
    this.reasons = reasons;
  }
}

export function isSelfReview(submitterUserId: string, reviewerUserId: string): boolean {
  return submitterUserId === reviewerUserId;
}

export function evaluateReviewEligibility(input: ReviewEligibilityInput): ReviewEligibility {
  const value = reviewEligibilityInputSchema.parse(input);
  const reasons: ReviewDenialReason[] = [];

  if (value.requestStatus !== "pending") {
    reasons.push("request_not_pending");
  }

  if (isSelfReview(value.submitterUserId, value.reviewerUserId)) {
    reasons.push("self_review");
  }

  if (value.reviewerMembershipStatus !== "active") {
    reasons.push("inactive_membership");
  }

  if (value.requestSchoolYearId !== value.reviewerSchoolYearId) {
    reasons.push("different_school_year");
  }

  if (!hasReviewCapability(value.reviewerRoles)) {
    reasons.push("missing_review_role");
  }

  return { allowed: reasons.length === 0, reasons };
}

export function assertReviewAllowed(input: ReviewEligibilityInput): void {
  const result = evaluateReviewEligibility(input);
  if (!result.allowed) {
    throw new ReviewNotAllowedError(result.reasons);
  }
}

export interface RequestedApproverCandidate {
  membershipStatus: z.infer<typeof membershipStatusSchema>;
  membershipSchoolYearId: string;
  requestSchoolYearId: string;
  roles: readonly SchoolYearRole[];
}

export function isEligibleRequestedApprover(candidate: RequestedApproverCandidate): boolean {
  const membershipStatus = membershipStatusSchema.parse(candidate.membershipStatus);
  const roles = z.array(schoolYearRoleSchema).max(4).parse(candidate.roles);
  const membershipSchoolYearId = z.string().uuid().parse(candidate.membershipSchoolYearId);
  const requestSchoolYearId = z.string().uuid().parse(candidate.requestSchoolYearId);

  return (
    membershipStatus === "active" &&
    membershipSchoolYearId === requestSchoolYearId &&
    hasReviewCapability(roles)
  );
}
