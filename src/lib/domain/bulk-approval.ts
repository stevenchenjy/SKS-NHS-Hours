import { z } from "zod";

export const MAX_BULK_APPROVAL_REQUESTS = 50;
export const TEACHER_REVIEW_PAGE_SIZE = 50;

const uuidSchema = z.uuid().transform((value) => value.toLowerCase());

export const bulkApprovalRequestSchema = z
  .object({
    requestId: uuidSchema,
    expectedRevision: z.number().int().positive(),
    // Keep the database's original precision: converting this to a Date would
    // discard the microseconds used to detect edits made since selection.
    expectedUpdatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const bulkApprovalInputSchema = z
  .object({
    schoolYearId: uuidSchema,
    batchId: uuidSchema,
    requests: z.array(bulkApprovalRequestSchema).min(1).max(MAX_BULK_APPROVAL_REQUESTS),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      new Set(input.requests.map((request) => request.requestId)).size !== input.requests.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["requests"],
        message: "Each selected request must appear only once.",
      });
    }
  });

export const bulkApprovalOutcomeSchema = z.enum([
  "approved",
  "already_processed",
  "changed_since_selection",
  "not_eligible",
]);

const bulkApprovalResultSchema = z.object({
  batchId: uuidSchema,
  approvedCount: z.number().int().min(0).max(MAX_BULK_APPROVAL_REQUESTS),
  results: z
    .array(z.object({ requestId: uuidSchema, outcome: bulkApprovalOutcomeSchema }))
    .min(1)
    .max(MAX_BULK_APPROVAL_REQUESTS),
});

export type BulkApprovalInput = z.infer<typeof bulkApprovalInputSchema>;
export type BulkApproveInput = BulkApprovalInput;
export type BulkApprovalOutcome = z.infer<typeof bulkApprovalOutcomeSchema>;
export type BulkApprovalResult = z.infer<typeof bulkApprovalResultSchema>;

/** Only acknowledge a batch when the server returned one outcome per selected request. */
export function parseBulkApprovalResult(
  value: unknown,
  input: BulkApprovalInput,
): BulkApprovalResult | null {
  const parsed = bulkApprovalResultSchema.safeParse(value);
  if (!parsed.success) return null;
  const result = parsed.data;
  const selectedIds = new Set(input.requests.map((request) => request.requestId));
  const returnedIds = new Set(result.results.map((request) => request.requestId));
  if (
    result.batchId !== input.batchId ||
    result.results.length !== input.requests.length ||
    returnedIds.size !== selectedIds.size ||
    result.results.some((request) => !selectedIds.has(request.requestId)) ||
    result.approvedCount !==
      result.results.filter((request) => request.outcome === "approved").length
  ) {
    return null;
  }
  return result;
}

export const teacherReviewPageFiltersSchema = z
  .object({
    search: z.string().trim().max(120).optional(),
    categoryId: uuidSchema.optional(),
    committeeHeadId: uuidSchema.optional(),
    page: z.number().int().min(1).max(10_000).default(1),
  })
  .strict();

export type TeacherReviewPageFilters = z.input<typeof teacherReviewPageFiltersSchema>;

/** PostgREST's OR grammar must never be constructed from unchecked filter syntax. */
export function teacherReviewSearchTerm(search: string | undefined): string {
  return (search ?? "")
    .replace(/[,%_*().\\"\[\]{}:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
