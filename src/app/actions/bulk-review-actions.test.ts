import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, teacher, client, revalidate } = vi.hoisted(() => ({
  rpc: vi.fn(),
  teacher: vi.fn(),
  client: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidate }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/dal/access", () => ({
  requireTeacherAdmin: teacher,
  requireReviewer: vi.fn(),
  requireAdmin: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: client }));

import { bulkApproveTeacherRequestsAction } from "./review-actions";
import type { BulkApprovalInput } from "@/lib/domain/bulk-approval";

const YEAR = "50000000-0000-4000-8000-000000000001";
const BATCH = "50000000-0000-4000-8000-000000000002";
const REQUEST = "50000000-0000-4000-8000-000000000003";
const OTHER = "50000000-0000-4000-8000-000000000004";
const selectedRequest = {
  requestId: REQUEST,
  expectedRevision: 2,
  expectedUpdatedAt: "2026-10-15T14:27:19.123456+00:00",
};
const input: BulkApprovalInput = {
  schoolYearId: YEAR,
  batchId: BATCH,
  requests: [selectedRequest],
};
const viewer = {
  profile: { status: "active" },
  activeMembership: {
    school_year_id: YEAR,
    status: "active",
    school_year: { status: "active" },
  },
};
const result = {
  batchId: BATCH,
  approvedCount: 1,
  results: [{ requestId: REQUEST, outcome: "approved" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  teacher.mockResolvedValue(viewer);
  client.mockResolvedValue({ rpc });
  rpc.mockResolvedValue({ data: result, error: null });
});

describe("bulk teacher approval action", () => {
  it("requires teacher authorization inside the action before creating a database client", async () => {
    teacher.mockRejectedValueOnce(new Error("teacher required"));
    await expect(bulkApproveTeacherRequestsAction(input)).rejects.toThrow("teacher required");
    expect(client).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects malformed or duplicate selections before the RPC", async () => {
    const response = await bulkApproveTeacherRequestsAction({
      ...input,
      requests: [selectedRequest, selectedRequest],
    });
    expect(response.error).toContain("different requests");
    expect(client).not.toHaveBeenCalled();
  });

  it.each([
    { ...viewer, activeMembership: { ...viewer.activeMembership, school_year_id: OTHER } },
    { ...viewer, activeMembership: { ...viewer.activeMembership, status: "expired" } },
    {
      ...viewer,
      activeMembership: { ...viewer.activeMembership, school_year: { status: "draft" } },
    },
    { ...viewer, profile: { status: "inactive" } },
  ])("rejects a school year or role that cannot approve %#", async (invalidViewer) => {
    teacher.mockResolvedValueOnce(invalidViewer);
    expect((await bulkApproveTeacherRequestsAction(input)).error).toContain(
      "active school-year role",
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("uses one session RPC with the exact selected versions and refreshes related views", async () => {
    await expect(bulkApproveTeacherRequestsAction(input)).resolves.toEqual({ result });
    expect(teacher).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledExactlyOnceWith("bulk_approve_teacher_requests", {
      p_school_year_id: YEAR,
      p_batch_id: BATCH,
      p_requests: input.requests,
    });
    for (const path of [
      "/admin/requests",
      "/admin/members",
      "/dashboard",
      "/profile",
      "/hours",
      `/admin/requests/${REQUEST}`,
      `/hours/${REQUEST}`,
    ]) {
      expect(revalidate).toHaveBeenCalledWith(path);
    }
    expect(revalidate).toHaveBeenCalledWith("/admin/members/[id]", "page");
  });

  it.each(["rpc_error", "network_error", "missing_result", "partial_result", "mismatched_batch"])(
    "gives a safe retry result for %s without claiming success",
    async (failure) => {
      if (failure === "rpc_error")
        rpc.mockResolvedValueOnce({ data: null, error: { message: "private SQL detail" } });
      if (failure === "network_error")
        rpc.mockRejectedValueOnce(new Error("private server detail"));
      if (failure === "missing_result") rpc.mockResolvedValueOnce({ data: null, error: null });
      if (failure === "partial_result")
        rpc.mockResolvedValueOnce({ data: { ...result, results: [] }, error: null });
      if (failure === "mismatched_batch")
        rpc.mockResolvedValueOnce({ data: { ...result, batchId: OTHER }, error: null });
      const response = await bulkApproveTeacherRequestsAction(input);
      expect(response.result).toBeUndefined();
      expect(response.error).toContain("Retry this same selection");
      expect(response.error).not.toContain("private");
      expect(revalidate).not.toHaveBeenCalled();
    },
  );

  it("returns individual conflicts and refreshes the affected request details", async () => {
    const conflictingResult = {
      batchId: BATCH,
      approvedCount: 0,
      results: [{ requestId: REQUEST, outcome: "changed_since_selection" }],
    };
    rpc.mockResolvedValueOnce({ data: conflictingResult, error: null });
    await expect(bulkApproveTeacherRequestsAction(input)).resolves.toEqual({
      result: conflictingResult,
    });
    expect(revalidate).toHaveBeenCalledWith(`/admin/requests/${REQUEST}`);
  });

  it("can safely retry the identical batch after an uncertain network response", async () => {
    rpc.mockRejectedValueOnce(new Error("connection lost after commit"));
    expect((await bulkApproveTeacherRequestsAction(input)).error).toBeDefined();
    await expect(bulkApproveTeacherRequestsAction(input)).resolves.toEqual({ result });
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
  });
});
