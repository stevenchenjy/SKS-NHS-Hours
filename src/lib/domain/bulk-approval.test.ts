import { describe, expect, it } from "vitest";

import {
  bulkApprovalInputSchema,
  parseBulkApprovalResult,
  teacherReviewPageFiltersSchema,
  teacherReviewSearchTerm,
  type BulkApprovalInput,
} from "./bulk-approval";

const YEAR = "50000000-0000-4000-8000-000000000001";
const BATCH = "50000000-0000-4000-8000-000000000002";
const REQUEST = "50000000-0000-4000-8000-000000000003";
const OTHER = "50000000-0000-4000-8000-000000000004";
const TIMESTAMP = "2026-10-15T14:27:19.123456+00:00";
const selectedRequest = { requestId: REQUEST, expectedRevision: 2, expectedUpdatedAt: TIMESTAMP };
const input: BulkApprovalInput = {
  schoolYearId: YEAR,
  batchId: BATCH,
  requests: [selectedRequest],
};

describe("bulk approval input", () => {
  it("retains database timestamp precision and accepts the 50-request boundary", () => {
    const requests = Array.from({ length: 50 }, (_, index) => ({
      ...selectedRequest,
      requestId: `50000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    }));
    expect(bulkApprovalInputSchema.parse({ ...input, requests }).requests).toEqual(requests);
  });

  it.each([
    { ...input, schoolYearId: "bad" },
    { ...input, batchId: "bad" },
    { ...input, requests: [] },
    { ...input, requests: Array.from({ length: 51 }, () => selectedRequest) },
    { ...input, requests: [selectedRequest, selectedRequest] },
    { ...input, requests: [{ ...selectedRequest, expectedRevision: 0 }] },
    { ...input, requests: [{ ...selectedRequest, expectedRevision: 1.5 }] },
    { ...input, requests: [{ ...selectedRequest, expectedUpdatedAt: "2026-02-30T00:00:00Z" }] },
    { ...input, requests: [{ ...selectedRequest, expectedUpdatedAt: "2026-10-15T14:00:00" }] },
    { ...input, untrusted: true },
  ])("rejects invalid or ambiguous selections %#", (invalid) => {
    expect(bulkApprovalInputSchema.safeParse(invalid).success).toBe(false);
  });

  it("recognizes differently cased UUIDs as the same selected request", () => {
    const request = { ...selectedRequest, requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
    expect(
      bulkApprovalInputSchema.safeParse({
        ...input,
        requests: [request, { ...request, requestId: request.requestId.toUpperCase() }],
      }).success,
    ).toBe(false);
  });
});

describe("batch result confirmation", () => {
  it("returns only validated result fields", () => {
    expect(
      parseBulkApprovalResult(
        {
          batchId: BATCH,
          approvedCount: 1,
          results: [{ requestId: REQUEST, outcome: "approved", private: "discarded" }],
          private: "discarded",
        },
        input,
      ),
    ).toEqual({
      batchId: BATCH,
      approvedCount: 1,
      results: [{ requestId: REQUEST, outcome: "approved" }],
    });
  });

  it.each([
    null,
    { batchId: OTHER, approvedCount: 1, results: [{ requestId: REQUEST, outcome: "approved" }] },
    { batchId: BATCH, approvedCount: 1, results: [] },
    { batchId: BATCH, approvedCount: 0, results: [{ requestId: REQUEST, outcome: "approved" }] },
    { batchId: BATCH, approvedCount: 1, results: [{ requestId: OTHER, outcome: "approved" }] },
    { batchId: BATCH, approvedCount: 0, results: [{ requestId: REQUEST, outcome: "unknown" }] },
    {
      batchId: BATCH,
      approvedCount: 2,
      results: [
        { requestId: REQUEST, outcome: "approved" },
        { requestId: REQUEST, outcome: "approved" },
      ],
    },
  ])("does not acknowledge malformed or mismatched results %#", (result) => {
    expect(parseBulkApprovalResult(result, input)).toBeNull();
  });

  it("accepts conflicts without claiming they were approved", () => {
    const results = [
      { requestId: REQUEST, outcome: "changed_since_selection" },
      { requestId: OTHER, outcome: "already_processed" },
    ];
    expect(
      parseBulkApprovalResult(
        { batchId: BATCH, approvedCount: 0, results },
        { ...input, requests: [...input.requests, { ...selectedRequest, requestId: OTHER }] },
      ),
    ).toEqual({ batchId: BATCH, approvedCount: 0, results });
  });
});

describe("teacher queue filters", () => {
  it("defaults to the first page and rejects invalid IDs or unbounded offsets", () => {
    expect(teacherReviewPageFiltersSchema.parse({})).toEqual({ page: 1 });
    for (const invalid of [
      { categoryId: "bad" },
      { committeeHeadId: "bad" },
      { page: 0 },
      { page: 10001 },
    ]) {
      expect(teacherReviewPageFiltersSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("removes OR grammar and wildcard operators from untrusted search", () => {
    expect(teacherReviewSearchTerm("  O'Neil, (title.eq.secret) \\\"%_* ")).toBe(
      "O'Neil title eq secret",
    );
    expect(teacherReviewSearchTerm("[%_*](.)")).toBe("");
    expect(teacherReviewSearchTerm("Élodie food-drive")).toBe("Élodie food-drive");
  });
});
