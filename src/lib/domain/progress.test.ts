import { describe, expect, it } from "vitest";

import { calculateProgress, statusHasApprovedGoalCredit } from "./progress";

const CATEGORY_A = "a0000000-0000-4000-8000-000000000001";
const CATEGORY_B = "a0000000-0000-4000-8000-000000000002";

describe("overall NHS progress", () => {
  it("matches the below-target example and keeps pending separate", () => {
    const progress = calculateProgress({
      targetHours: "20.00",
      entries: [
        { categoryId: CATEGORY_A, status: "approved", hours: "8.00" },
        { categoryId: CATEGORY_A, status: "pending", hours: "4.00" },
      ],
    });

    expect(progress).toMatchObject({
      targetHours: 20,
      approvedHours: 8,
      countedApprovedHours: 8,
      pendingHours: 4,
      remainingApprovedHours: 12,
      hoursOverGoal: 0,
      actualPercentage: 40,
      visualPercentage: 40,
      goalReached: false,
      projectedCountedApprovedHours: 12,
      projectedPercentage: 60,
    });
  });

  it("reports exactly 100 percent at the target", () => {
    const progress = calculateProgress({
      targetHours: 20,
      entries: [{ categoryId: CATEGORY_A, status: "approved", hours: 20 }],
    });

    expect(progress.actualPercentage).toBe(100);
    expect(progress.visualPercentage).toBe(100);
    expect(progress.remainingApprovedHours).toBe(0);
    expect(progress.hoursOverGoal).toBe(0);
    expect(progress.goalReached).toBe(true);
  });

  it("preserves the actual percentage above target while capping only the bar", () => {
    const progress = calculateProgress({
      targetHours: 20,
      entries: [
        { categoryId: CATEGORY_A, status: "approved", hours: 23 },
        { categoryId: CATEGORY_B, status: "pending", hours: 2 },
      ],
    });

    expect(progress.actualPercentage).toBe(115);
    expect(progress.visualPercentage).toBe(100);
    expect(progress.hoursOverGoal).toBe(3);
    expect(progress.pendingHours).toBe(2);
  });

  it("handles a zero target without division by zero", () => {
    const empty = calculateProgress({ targetHours: 0, entries: [] });
    const withHours = calculateProgress({
      targetHours: 0,
      entries: [{ categoryId: CATEGORY_A, status: "approved", hours: "1.25" }],
    });

    expect(empty.actualPercentage).toBe(0);
    expect(empty.projectedPercentage).toBe(0);
    expect(empty.goalReached).toBe(true);
    expect(withHours.actualPercentage).toBe(0);
    expect(withHours.hoursOverGoal).toBe(1.25);
  });

  it("sums quarter-hours exactly and separates every workflow status", () => {
    const progress = calculateProgress({
      targetHours: "20.00",
      entries: [
        { categoryId: CATEGORY_A, status: "approved", hours: "0.25" },
        { categoryId: CATEGORY_A, status: "approved", hours: "0.25" },
        { categoryId: CATEGORY_A, status: "pending", hours: "0.50" },
        {
          categoryId: CATEGORY_A,
          status: "changes_requested",
          hours: "0.75",
        },
        { categoryId: CATEGORY_A, status: "rejected", hours: "1.00" },
        { categoryId: CATEGORY_A, status: "draft", hours: "1.25" },
        { categoryId: CATEGORY_A, status: "withdrawn", hours: "1.50" },
      ],
    });

    expect(progress).toMatchObject({
      approvedHours: 0.5,
      pendingHours: 0.5,
      changesRequestedHours: 0.75,
      rejectedHours: 1,
      draftHours: 1.25,
      withdrawnHours: 1.5,
      requestCounts: {
        draft: 1,
        pending: 1,
        changes_requested: 1,
        approved: 2,
        rejected: 1,
        withdrawn: 1,
      },
    });
  });

  it("credits only approved status toward the goal", () => {
    expect(statusHasApprovedGoalCredit("approved")).toBe(true);
    for (const status of [
      "draft",
      "pending",
      "changes_requested",
      "rejected",
      "withdrawn",
    ] as const) {
      expect(statusHasApprovedGoalCredit(status)).toBe(false);
    }
  });
});

describe("unlimited service categories", () => {
  it("credits every approved hour regardless of category", () => {
    const progress = calculateProgress({
      targetHours: 20,
      entries: [
        { categoryId: CATEGORY_A, status: "approved", hours: 8 },
        { categoryId: CATEGORY_A, status: "pending", hours: 2 },
        { categoryId: CATEGORY_B, status: "approved", hours: 6 },
        { categoryId: CATEGORY_B, status: "pending", hours: 1 },
      ],
    });

    expect(progress).toMatchObject({
      approvedHours: 14,
      countedApprovedHours: 14,
      excludedApprovedHours: 0,
      actualPercentage: 70,
      remainingApprovedHours: 6,
      pendingHours: 3,
      projectedCountedApprovedHours: 17,
    });
    expect(progress.categories).toEqual([
      {
        categoryId: CATEGORY_A,
        capHours: null,
        approvedHours: 8,
        countedApprovedHours: 8,
        excludedApprovedHours: 0,
        pendingHours: 2,
        changesRequestedHours: 0,
        remainingToCapHours: null,
        pendingHoursEligibleUnderCap: 2,
      },
      {
        categoryId: CATEGORY_B,
        capHours: null,
        approvedHours: 6,
        countedApprovedHours: 6,
        excludedApprovedHours: 0,
        pendingHours: 1,
        changesRequestedHours: 0,
        remainingToCapHours: null,
        pendingHoursEligibleUnderCap: 1,
      },
    ]);
  });
});
