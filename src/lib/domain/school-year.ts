import { z } from "zod";

import { membershipStatusSchema } from "./roles";

export const SCHOOL_YEAR_LABEL_PATTERN = /^(\d{4})-(\d{4})$/;
export const ISO_DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const SCHOOL_YEAR_STATUSES = ["draft", "active", "closed", "archived"] as const;

export const schoolYearStatusSchema = z.enum(SCHOOL_YEAR_STATUSES);
export type SchoolYearStatus = z.infer<typeof schoolYearStatusSchema>;

export function isIsoCalendarDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) {
    return false;
  }

  const parts = value.split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

export const isoDateSchema = z
  .string()
  .trim()
  .refine(isIsoCalendarDate, "Use a real calendar date in YYYY-MM-DD format.");

export const schoolYearLabelSchema = z
  .string()
  .trim()
  .regex(SCHOOL_YEAR_LABEL_PATTERN, "Use a school-year label such as 2026-2027.")
  .refine((label) => {
    const match = SCHOOL_YEAR_LABEL_PATTERN.exec(label);
    return match !== null && Number(match[2]) === Number(match[1]) + 1;
  }, "A school-year label must contain consecutive years.");

export const schoolYearDateRangeSchema = z
  .object({
    label: schoolYearLabelSchema,
    startDate: isoDateSchema,
    endDate: isoDateSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.startDate >= value.endDate) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "The school-year end date must be after its start date.",
      });
    }

    const match = SCHOOL_YEAR_LABEL_PATTERN.exec(value.label);
    if (!match) {
      return;
    }

    const startYear = Number(value.startDate.slice(0, 4));
    const endYear = Number(value.endDate.slice(0, 4));

    if (startYear !== Number(match[1])) {
      context.addIssue({
        code: "custom",
        path: ["startDate"],
        message: "The start date must fall in the label's first year.",
      });
    }

    if (endYear !== Number(match[2])) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "The end date must fall in the label's second year.",
      });
    }
  });

export type SchoolYearDateRange = z.infer<typeof schoolYearDateRangeSchema>;

export function parseSchoolYearDateRange(input: unknown): SchoolYearDateRange {
  return schoolYearDateRangeSchema.parse(input);
}

export function isDateWithinRange(dateInput: string, rangeInput: SchoolYearDateRange): boolean {
  const date = isoDateSchema.parse(dateInput);
  const range = schoolYearDateRangeSchema.parse(rangeInput);
  return date >= range.startDate && date <= range.endDate;
}

export function schoolYearLabelForDateRange(startDateInput: string, endDateInput: string): string {
  const startDate = isoDateSchema.parse(startDateInput);
  const endDate = isoDateSchema.parse(endDateInput);
  const label = `${startDate.slice(0, 4)}-${endDate.slice(0, 4)}`;

  return schoolYearLabelSchema.parse(label);
}

export function isServiceDateAllowed(
  serviceDateInput: string,
  schoolYearInput: SchoolYearDateRange,
  todayInput: string,
): boolean {
  const serviceDate = isoDateSchema.parse(serviceDateInput);
  const today = isoDateSchema.parse(todayInput);

  return serviceDate <= today && isDateWithinRange(serviceDate, schoolYearInput);
}

export function schoolYearAcceptsSubmissions(input: {
  status: SchoolYearStatus;
  dateRange: SchoolYearDateRange;
  onDate: string;
}): boolean {
  const status = schoolYearStatusSchema.parse(input.status);
  const onDate = isoDateSchema.parse(input.onDate);

  return status === "active" && isDateWithinRange(onDate, input.dateRange);
}

export const MEMBERSHIP_ACCESS_DENIAL_REASONS = [
  "membership_not_active",
  "outside_school_year",
  "membership_expired_by_date",
] as const;

export const membershipAccessDenialReasonSchema = z.enum(MEMBERSHIP_ACCESS_DENIAL_REASONS);

export type MembershipAccessDenialReason = z.infer<typeof membershipAccessDenialReasonSchema>;

export const membershipAccessInputSchema = z
  .object({
    membershipStatus: membershipStatusSchema,
    membershipExpirationDate: isoDateSchema,
    schoolYear: schoolYearDateRangeSchema,
    onDate: isoDateSchema,
  })
  .strict();

export type MembershipAccessInput = z.infer<typeof membershipAccessInputSchema>;

export interface MembershipAccessEvaluation {
  active: boolean;
  reasons: MembershipAccessDenialReason[];
}

/**
 * Evaluates access at request time; it does not rely on a scheduled expiration
 * job having updated the stored membership status.
 */
export function evaluateMembershipAccess(input: MembershipAccessInput): MembershipAccessEvaluation {
  const value = membershipAccessInputSchema.parse(input);
  const reasons: MembershipAccessDenialReason[] = [];

  if (value.membershipStatus !== "active") {
    reasons.push("membership_not_active");
  }

  if (!isDateWithinRange(value.onDate, value.schoolYear)) {
    reasons.push("outside_school_year");
  }

  if (value.onDate > value.membershipExpirationDate) {
    reasons.push("membership_expired_by_date");
  }

  return { active: reasons.length === 0, reasons };
}

export function isMembershipActiveOnDate(input: MembershipAccessInput): boolean {
  return evaluateMembershipAccess(input).active;
}
