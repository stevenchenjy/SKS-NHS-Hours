import { z } from "zod";

import { isoDateSchema } from "./school-year";
import { membershipStatusSchema, schoolYearRoleSchema } from "./roles";
import { hourRequestStatusSchema } from "./workflow";

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const MAX_PAGE_NUMBER = 10_000;

export type QueryValue = string | readonly string[] | undefined;
export type QueryRecord = Readonly<Record<string, QueryValue>>;
export type QuerySource = URLSearchParams | QueryRecord;

function unwrapSingleQueryValue(value: unknown): unknown {
  if (Array.isArray(value) && value.length === 1) {
    return value[0];
  }

  return value;
}

function optionalQueryScalar<T>(schema: z.ZodType<T>) {
  return z.preprocess((value) => {
    const scalar = unwrapSingleQueryValue(value);
    if (typeof scalar !== "string") {
      return scalar;
    }

    const trimmed = scalar.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  }, schema.optional());
}

function optionalQueryList<T>(schema: z.ZodType<T>, maximumItems: number) {
  return z.preprocess((value) => {
    if (value === undefined) {
      return undefined;
    }

    const rawValues = Array.isArray(value) ? value : [value];
    if (!rawValues.every((item) => typeof item === "string")) {
      return value;
    }

    const values = rawValues
      .flatMap((item) => item.split(","))
      .map((item) => item.trim())
      .filter(Boolean);

    return values.length === 0 ? undefined : [...new Set(values)];
  }, z.array(schema).min(1).max(maximumItems).optional());
}

const positiveIntegerQuerySchema = z
  .string()
  .regex(/^[1-9]\d*$/, "Use a positive base-10 integer.")
  .transform(Number);

const pageQuerySchema = optionalQueryScalar(
  positiveIntegerQuerySchema.pipe(z.number().int().max(MAX_PAGE_NUMBER)),
).default(1);

const pageSizeQuerySchema = optionalQueryScalar(
  positiveIntegerQuerySchema.pipe(z.number().int().max(MAX_PAGE_SIZE)),
).default(DEFAULT_PAGE_SIZE);

const booleanQuerySchema = optionalQueryScalar(
  z.enum(["true", "false", "1", "0"]).transform((value) => value === "true" || value === "1"),
);

const searchQuerySchema = optionalQueryScalar(
  z.string().max(120, "Search text cannot exceed 120 characters."),
);

const uuidQuerySchema = optionalQueryScalar(z.string().uuid());
const isoDateQuerySchema = optionalQueryScalar(isoDateSchema);

export const requestSortFieldSchema = z.enum([
  "submitted_at",
  "service_date",
  "status",
  "member_name",
  "hours",
]);

export const memberSortFieldSchema = z.enum([
  "name",
  "approved_hours",
  "pending_hours",
  "remaining_hours",
  "last_activity",
  "membership_status",
]);

export const sortDirectionSchema = z.enum(["asc", "desc"]);
export const progressStateSchema = z.enum(["no_activity", "below_goal", "complete", "over_goal"]);

export const hourRequestQuerySchema = z
  .object({
    page: pageQuerySchema,
    pageSize: pageSizeQuerySchema,
    q: searchQuerySchema,
    status: optionalQueryList(hourRequestStatusSchema, 6),
    categoryId: uuidQuerySchema,
    schoolYearId: uuidQuerySchema,
    memberMembershipId: uuidQuerySchema,
    requestedApproverMembershipId: uuidQuerySchema,
    actualReviewerMembershipId: uuidQuerySchema,
    assignedToMe: booleanQuerySchema,
    serviceFrom: isoDateQuerySchema,
    serviceTo: isoDateQuerySchema,
    sortBy: optionalQueryScalar(requestSortFieldSchema).default("submitted_at"),
    direction: optionalQueryScalar(sortDirectionSchema).default("desc"),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.serviceFrom !== undefined &&
      value.serviceTo !== undefined &&
      value.serviceFrom > value.serviceTo
    ) {
      context.addIssue({
        code: "custom",
        path: ["serviceTo"],
        message: "The end of the service-date range must not precede its start.",
      });
    }
  });

export const memberRosterQuerySchema = z
  .object({
    page: pageQuerySchema,
    pageSize: pageSizeQuerySchema,
    q: searchQuerySchema,
    role: optionalQueryList(schoolYearRoleSchema, 4),
    progressState: optionalQueryList(progressStateSchema, 4),
    requestStatus: optionalQueryList(hourRequestStatusSchema, 6),
    membershipStatus: optionalQueryList(membershipStatusSchema, 4),
    categoryId: uuidQuerySchema,
    schoolYearId: uuidQuerySchema,
    requestedApproverMembershipId: uuidQuerySchema,
    actualReviewerMembershipId: uuidQuerySchema,
    sortBy: optionalQueryScalar(memberSortFieldSchema).default("name"),
    direction: optionalQueryScalar(sortDirectionSchema).default("asc"),
  })
  .strict();

export type HourRequestQuery = z.infer<typeof hourRequestQuerySchema>;
export type MemberRosterQuery = z.infer<typeof memberRosterQuerySchema>;

export interface PaginationWindow {
  page: number;
  pageSize: number;
  offset: number;
  limit: number;
}

export function querySourceToRecord(source: QuerySource): Record<string, QueryValue> {
  if (!(source instanceof URLSearchParams)) {
    return { ...source };
  }

  const result: Record<string, QueryValue> = {};
  for (const key of new Set(source.keys())) {
    const values = source.getAll(key);
    result[key] = values.length === 1 ? values[0] : values;
  }

  return result;
}

export function parseHourRequestQuery(source: QuerySource): HourRequestQuery {
  return hourRequestQuerySchema.parse(querySourceToRecord(source));
}

export function parseMemberRosterQuery(source: QuerySource): MemberRosterQuery {
  return memberRosterQuerySchema.parse(querySourceToRecord(source));
}

export function paginationWindow(input: { page: number; pageSize: number }): PaginationWindow {
  const pagination = z
    .object({
      page: z.number().int().min(1).max(MAX_PAGE_NUMBER),
      pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE),
    })
    .strict()
    .parse(input);

  return {
    ...pagination,
    offset: (pagination.page - 1) * pagination.pageSize,
    limit: pagination.pageSize,
  };
}
