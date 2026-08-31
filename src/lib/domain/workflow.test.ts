import { describe, expect, it } from "vitest";

import {
  InvalidRequestTransitionError,
  ReviewNotAllowedError,
  allowedRequestActions,
  assertReviewAllowed,
  canTransitionRequest,
  evaluateReviewEligibility,
  isEligibleRequestedApprover,
  isSelfReview,
  reviewDecisionSchema,
  transitionRequestStatus,
  type ReviewEligibilityInput,
} from "./workflow";

const MEMBER_USER_ID = "10000000-0000-4000-8000-000000000001";
const REVIEWER_USER_ID = "10000000-0000-4000-8000-000000000002";
const SCHOOL_YEAR_ID = "20000000-0000-4000-8000-000000000001";
const OTHER_SCHOOL_YEAR_ID = "20000000-0000-4000-8000-000000000002";
const APPROVER_MEMBERSHIP_ID = "30000000-0000-4000-8000-000000000001";

const ELIGIBLE_REVIEW: ReviewEligibilityInput = {
  requestStatus: "pending",
  submitterUserId: MEMBER_USER_ID,
  reviewerUserId: REVIEWER_USER_ID,
  requestSchoolYearId: SCHOOL_YEAR_ID,
  reviewerSchoolYearId: SCHOOL_YEAR_ID,
  reviewerMembershipStatus: "active",
  reviewerRoles: ["committee_head"],
};

describe("hour-request finite state machine", () => {
  it.each([
    ["draft", "edit", "draft"],
    ["draft", "submit", "pending"],
    ["pending", "withdraw", "withdrawn"],
    ["pending", "approve", "approved"],
    ["pending", "request_changes", "changes_requested"],
    ["pending", "reject", "rejected"],
    ["pending", "reassign", "pending"],
    ["changes_requested", "edit", "changes_requested"],
    ["changes_requested", "resubmit", "pending"],
    ["approved", "correct", "approved"],
  ] as const)("transitions %s via %s to %s", (from, action, to) => {
    expect(canTransitionRequest(from, action)).toBe(true);
    expect(transitionRequestStatus(from, action)).toBe(to);
  });

  it.each([
    ["draft", "approve"],
    ["pending", "submit"],
    ["changes_requested", "approve"],
    ["approved", "edit"],
    ["rejected", "resubmit"],
    ["withdrawn", "submit"],
  ] as const)("rejects %s -> %s", (from, action) => {
    expect(canTransitionRequest(from, action)).toBe(false);
    expect(() => transitionRequestStatus(from, action)).toThrow(InvalidRequestTransitionError);
  });

  it("exposes only actions valid for the current state", () => {
    expect(allowedRequestActions("pending")).toEqual([
      "withdraw",
      "approve",
      "request_changes",
      "reject",
      "reassign",
    ]);
    expect(allowedRequestActions("rejected")).toEqual([]);
  });
});

describe("review decisions", () => {
  it("allows approval without a comment and normalizes an empty one", () => {
    expect(reviewDecisionSchema.parse({ action: "approve", comment: "  " })).toEqual({
      action: "approve",
      comment: undefined,
    });
  });

  it.each(["request_changes", "reject"] as const)(
    "requires a useful comment when choosing %s",
    (action) => {
      expect(reviewDecisionSchema.safeParse({ action, comment: " " }).success).toBe(false);
      expect(reviewDecisionSchema.parse({ action, comment: " Needs documentation. " })).toEqual({
        action,
        comment: "Needs documentation.",
      });
    },
  );

  it("requires a valid destination for reassignment", () => {
    expect(
      reviewDecisionSchema.parse({
        action: "reassign",
        requestedApproverMembershipId: APPROVER_MEMBERSHIP_ID,
      }),
    ).toEqual({
      action: "reassign",
      requestedApproverMembershipId: APPROVER_MEMBERSHIP_ID,
    });
    expect(
      reviewDecisionSchema.safeParse({
        action: "reassign",
        requestedApproverMembershipId: "not-a-uuid",
      }).success,
    ).toBe(false);
  });
});

describe("review authorization invariants", () => {
  it("allows a different active reviewer with a current review role", () => {
    expect(evaluateReviewEligibility(ELIGIBLE_REVIEW)).toEqual({
      allowed: true,
      reasons: [],
    });
    expect(() => assertReviewAllowed(ELIGIBLE_REVIEW)).not.toThrow();
  });

  it("compares underlying users, not membership IDs, for self-review", () => {
    expect(isSelfReview(MEMBER_USER_ID, MEMBER_USER_ID)).toBe(true);
    const result = evaluateReviewEligibility({
      ...ELIGIBLE_REVIEW,
      reviewerUserId: MEMBER_USER_ID,
    });
    expect(result).toEqual({ allowed: false, reasons: ["self_review"] });
    expect(() =>
      assertReviewAllowed({
        ...ELIGIBLE_REVIEW,
        reviewerUserId: MEMBER_USER_ID,
      }),
    ).toThrow(ReviewNotAllowedError);
  });

  it("reports every independent denial reason", () => {
    expect(
      evaluateReviewEligibility({
        ...ELIGIBLE_REVIEW,
        requestStatus: "approved",
        reviewerUserId: MEMBER_USER_ID,
        reviewerMembershipStatus: "expired",
        reviewerSchoolYearId: OTHER_SCHOOL_YEAR_ID,
        reviewerRoles: ["member"],
      }),
    ).toEqual({
      allowed: false,
      reasons: [
        "request_not_pending",
        "self_review",
        "inactive_membership",
        "different_school_year",
        "missing_review_role",
      ],
    });
  });

  it.each(["committee_head", "teacher_admin"] as const)(
    "recognizes %s as a review-capable role",
    (role) => {
      expect(
        isEligibleRequestedApprover({
          membershipStatus: "active",
          membershipSchoolYearId: SCHOOL_YEAR_ID,
          requestSchoolYearId: SCHOOL_YEAR_ID,
          roles: [role],
        }),
      ).toBe(true);
    },
  );

  it("rejects inactive, wrong-year, member-only, and president-only requested approvers", () => {
    expect(
      isEligibleRequestedApprover({
        membershipStatus: "suspended",
        membershipSchoolYearId: SCHOOL_YEAR_ID,
        requestSchoolYearId: SCHOOL_YEAR_ID,
        roles: ["teacher_admin"],
      }),
    ).toBe(false);
    expect(
      isEligibleRequestedApprover({
        membershipStatus: "active",
        membershipSchoolYearId: SCHOOL_YEAR_ID,
        requestSchoolYearId: SCHOOL_YEAR_ID,
        roles: ["president_vice_president"],
      }),
    ).toBe(false);
    expect(
      isEligibleRequestedApprover({
        membershipStatus: "active",
        membershipSchoolYearId: OTHER_SCHOOL_YEAR_ID,
        requestSchoolYearId: SCHOOL_YEAR_ID,
        roles: ["teacher_admin"],
      }),
    ).toBe(false);
    expect(
      isEligibleRequestedApprover({
        membershipStatus: "active",
        membershipSchoolYearId: SCHOOL_YEAR_ID,
        requestSchoolYearId: SCHOOL_YEAR_ID,
        roles: ["member"],
      }),
    ).toBe(false);
  });
});
