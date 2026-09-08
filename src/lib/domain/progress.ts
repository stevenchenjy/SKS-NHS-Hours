import { z } from "zod";

import { quarterHourUnitsToHours, requestHoursSchema, targetHoursSchema } from "./hours";
import { HOUR_REQUEST_STATUSES, hourRequestStatusSchema, type HourRequestStatus } from "./workflow";

export const progressEntrySchema = z
  .object({
    categoryId: z.string().uuid(),
    status: hourRequestStatusSchema,
    hours: requestHoursSchema,
  })
  .strict();

export const progressCalculationInputSchema = z
  .object({
    targetHours: targetHoursSchema,
    entries: z.array(progressEntrySchema),
  })
  .strict();

export type ProgressEntryInput = z.input<typeof progressEntrySchema>;
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

/**
 * Derives all progress from authoritative request rows. Every approved hour
 * receives goal credit regardless of service category.
 */
export function calculateProgress(input: ProgressCalculationInput): OverallProgress {
  const value = progressCalculationInputSchema.parse(input);
  const statusUnits = emptyStatusTotals();
  const requestCounts = emptyStatusCounts();
  const categories = new Map<string, CategoryAccumulator>();

  for (const entry of value.entries) {
    statusUnits[entry.status] += entry.hours;
    requestCounts[entry.status] += 1;

    const category = categories.get(entry.categoryId) ?? {
      categoryId: entry.categoryId,
      unitsByStatus: emptyStatusTotals(),
    };
    category.unitsByStatus[entry.status] += entry.hours;
    categories.set(entry.categoryId, category);
  }

  const categoryProgress = Array.from(categories.values()).map((category) => {
    const approvedUnits = category.unitsByStatus.approved;

    return {
      categoryId: category.categoryId,
      capHours: null,
      approvedHours: toHours(approvedUnits),
      countedApprovedHours: toHours(approvedUnits),
      excludedApprovedHours: 0,
      pendingHours: toHours(category.unitsByStatus.pending),
      changesRequestedHours: toHours(category.unitsByStatus.changes_requested),
      remainingToCapHours: null,
      pendingHoursEligibleUnderCap: toHours(category.unitsByStatus.pending),
    } satisfies CategoryProgress;
  });

  const targetUnits = value.targetHours;
  const approvedUnits = statusUnits.approved;
  const remainingUnits = Math.max(targetUnits - approvedUnits, 0);
  const overGoalUnits = Math.max(approvedUnits - targetUnits, 0);
  const projectedCountedUnits = approvedUnits + statusUnits.pending;
  const actualPercentage = percentage(approvedUnits, targetUnits);

  return {
    targetHours: toHours(targetUnits),
    approvedHours: toHours(approvedUnits),
    countedApprovedHours: toHours(approvedUnits),
    excludedApprovedHours: 0,
    pendingHours: toHours(statusUnits.pending),
    changesRequestedHours: toHours(statusUnits.changes_requested),
    rejectedHours: toHours(statusUnits.rejected),
    draftHours: toHours(statusUnits.draft),
    withdrawnHours: toHours(statusUnits.withdrawn),
    remainingApprovedHours: toHours(remainingUnits),
    hoursOverGoal: toHours(overGoalUnits),
    actualPercentage,
    visualPercentage: Math.min(Math.max(actualPercentage, 0), 100),
    goalReached: approvedUnits >= targetUnits,
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
