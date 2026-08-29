import { z } from "zod";

import {
  quarterHourUnitsToHours,
  requestHoursSchema,
  targetHoursSchema,
  type QuarterHourUnits,
} from "./hours";
import { HOUR_REQUEST_STATUSES, hourRequestStatusSchema, type HourRequestStatus } from "./workflow";

export const progressEntrySchema = z
  .object({
    categoryId: z.string().uuid(),
    status: hourRequestStatusSchema,
    hours: requestHoursSchema,
  })
  .strict();

export const categoryCapSchema = z
  .object({
    categoryId: z.string().uuid(),
    capHours: targetHoursSchema.refine(
      (units) => units > 0,
      "A category cap must be greater than zero.",
    ),
  })
  .strict();

export const progressCalculationInputSchema = z
  .object({
    targetHours: targetHoursSchema,
    entries: z.array(progressEntrySchema),
    categoryCaps: z.array(categoryCapSchema).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    const seenCategoryIds = new Set<string>();
    for (const [index, cap] of value.categoryCaps.entries()) {
      if (seenCategoryIds.has(cap.categoryId)) {
        context.addIssue({
          code: "custom",
          path: ["categoryCaps", index, "categoryId"],
          message: "Each category can have at most one cap.",
        });
      }
      seenCategoryIds.add(cap.categoryId);
    }
  });

export type ProgressEntryInput = z.input<typeof progressEntrySchema>;
export type CategoryCapInput = z.input<typeof categoryCapSchema>;
export type ProgressCalculationInput = z.input<typeof progressCalculationInputSchema>;

export type RequestStatusCounts = Record<HourRequestStatus, number>;

export interface CategoryProgress {
  categoryId: string;
  capHours: number | null;
  approvedHours: number;
  countedApprovedHours: number;
  excludedApprovedHours: number;
  pendingHours: number;
  changesRequestedHours: number;
  remainingToCapHours: number | null;
  pendingHoursEligibleUnderCap: number;
}

export interface OverallProgress {
  targetHours: number;
  approvedHours: number;
  countedApprovedHours: number;
  excludedApprovedHours: number;
  pendingHours: number;
  changesRequestedHours: number;
  rejectedHours: number;
  draftHours: number;
  withdrawnHours: number;
  remainingApprovedHours: number;
  hoursOverGoal: number;
  actualPercentage: number;
  visualPercentage: number;
  goalReached: boolean;
  projectedCountedApprovedHours: number;
  projectedPercentage: number;
  requestCounts: RequestStatusCounts;
  categories: CategoryProgress[];
}

interface CategoryAccumulator {
  categoryId: string;
  capUnits: number | null;
  unitsByStatus: Record<HourRequestStatus, number>;
}

function emptyStatusTotals(): Record<HourRequestStatus, number> {
  return {
    draft: 0,
    pending: 0,
    changes_requested: 0,
    approved: 0,
    rejected: 0,
    withdrawn: 0,
  };
}

function emptyStatusCounts(): RequestStatusCounts {
  return {
    draft: 0,
    pending: 0,
    changes_requested: 0,
    approved: 0,
    rejected: 0,
    withdrawn: 0,
  };
}

function percentage(numeratorUnits: number, targetUnits: number): number {
  if (targetUnits === 0) {
    return 0;
  }

  return Math.round((numeratorUnits / targetUnits) * 10_000) / 100;
}

function toHours(units: number): number {
  return quarterHourUnitsToHours(units);
}

export function applyCategoryCap(
  approvedUnits: QuarterHourUnits,
  capUnits: QuarterHourUnits | null,
): QuarterHourUnits {
  if (capUnits === null) {
    return approvedUnits;
  }

  return Math.min(approvedUnits, capUnits) as QuarterHourUnits;
}

/**
 * Derives all progress from authoritative request rows. Category caps affect
 * goal credit only; the raw approved total remains visible and auditable.
 */
export function calculateProgress(input: ProgressCalculationInput): OverallProgress {
  const value = progressCalculationInputSchema.parse(input);
  const statusUnits = emptyStatusTotals();
  const requestCounts = emptyStatusCounts();
  const categories = new Map<string, CategoryAccumulator>();

  for (const cap of value.categoryCaps) {
    categories.set(cap.categoryId, {
      categoryId: cap.categoryId,
      capUnits: cap.capHours,
      unitsByStatus: emptyStatusTotals(),
    });
  }

  for (const entry of value.entries) {
    statusUnits[entry.status] += entry.hours;
    requestCounts[entry.status] += 1;

    const category = categories.get(entry.categoryId) ?? {
      categoryId: entry.categoryId,
      capUnits: null,
      unitsByStatus: emptyStatusTotals(),
    };
    category.unitsByStatus[entry.status] += entry.hours;
    categories.set(entry.categoryId, category);
  }

  let countedApprovedUnits = 0;
  let pendingEligibleUnits = 0;

  const categoryProgress = Array.from(categories.values()).map((category) => {
    const approvedUnits = category.unitsByStatus.approved as QuarterHourUnits;
    const capUnits = category.capUnits as QuarterHourUnits | null;
    const countedUnits = applyCategoryCap(approvedUnits, capUnits);
    const remainingToCapUnits = capUnits === null ? null : Math.max(capUnits - countedUnits, 0);
    const eligiblePendingUnits =
      remainingToCapUnits === null
        ? category.unitsByStatus.pending
        : Math.min(category.unitsByStatus.pending, remainingToCapUnits);

    countedApprovedUnits += countedUnits;
    pendingEligibleUnits += eligiblePendingUnits;

    return {
      categoryId: category.categoryId,
      capHours: capUnits === null ? null : toHours(capUnits),
      approvedHours: toHours(approvedUnits),
      countedApprovedHours: toHours(countedUnits),
      excludedApprovedHours: toHours(approvedUnits - countedUnits),
      pendingHours: toHours(category.unitsByStatus.pending),
      changesRequestedHours: toHours(category.unitsByStatus.changes_requested),
      remainingToCapHours: remainingToCapUnits === null ? null : toHours(remainingToCapUnits),
      pendingHoursEligibleUnderCap: toHours(eligiblePendingUnits),
    } satisfies CategoryProgress;
  });

  const targetUnits = value.targetHours;
  const approvedUnits = statusUnits.approved;
  const remainingUnits = Math.max(targetUnits - countedApprovedUnits, 0);
  const overGoalUnits = Math.max(countedApprovedUnits - targetUnits, 0);
  const projectedCountedUnits = countedApprovedUnits + pendingEligibleUnits;
  const actualPercentage = percentage(countedApprovedUnits, targetUnits);

  return {
    targetHours: toHours(targetUnits),
    approvedHours: toHours(approvedUnits),
    countedApprovedHours: toHours(countedApprovedUnits),
    excludedApprovedHours: toHours(approvedUnits - countedApprovedUnits),
    pendingHours: toHours(statusUnits.pending),
    changesRequestedHours: toHours(statusUnits.changes_requested),
    rejectedHours: toHours(statusUnits.rejected),
    draftHours: toHours(statusUnits.draft),
    withdrawnHours: toHours(statusUnits.withdrawn),
    remainingApprovedHours: toHours(remainingUnits),
    hoursOverGoal: toHours(overGoalUnits),
    actualPercentage,
    visualPercentage: Math.min(Math.max(actualPercentage, 0), 100),
    goalReached: countedApprovedUnits >= targetUnits,
    projectedCountedApprovedHours: toHours(projectedCountedUnits),
    projectedPercentage: percentage(projectedCountedUnits, targetUnits),
    requestCounts,
    categories: categoryProgress,
  };
}

export function statusHasApprovedGoalCredit(status: HourRequestStatus): boolean {
  return hourRequestStatusSchema.parse(status) === "approved";
}

export const ALL_PROGRESS_STATUSES: readonly HourRequestStatus[] = HOUR_REQUEST_STATUSES;
