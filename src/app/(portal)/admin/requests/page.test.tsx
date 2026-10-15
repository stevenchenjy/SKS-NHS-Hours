import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  viewer: vi.fn(),
  pending: vi.fn(),
  awaiting: vi.fn(),
  archive: vi.fn(),
  teacherPage: vi.fn(),
  categories: vi.fn(),
  heads: vi.fn(),
  teacherQueue: vi.fn(),
}));
vi.mock("@/components/review/teacher-approval-queue", () => ({
  TeacherApprovalQueue: mocks.teacherQueue,
}));
vi.mock("@/components/portal/route-refresh", () => ({ RouteRefresh: () => null }));
vi.mock("@/lib/dal/access", () => ({ requireReviewer: mocks.viewer }));
vi.mock("@/lib/dal/portal", () => ({
  listPendingQueue: mocks.pending,
  listAwaitingTeacherReviews: mocks.awaiting,
  listApprovedReviewArchive: mocks.archive,
  listTeacherReviewPage: mocks.teacherPage,
  listCategories: mocks.categories,
  listActiveCommitteeHeads: mocks.heads,
}));
import ReviewQueuePage from "./page";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.viewer.mockResolvedValue({
    isTeacherAdmin: false,
    activeMembership: {
      id: "reviewer",
      school_year_id: "year",
      school_year: { label: "2026–2027" },
    },
  });
  mocks.pending.mockResolvedValue([]);
  mocks.awaiting.mockResolvedValue([]);
  mocks.archive.mockResolvedValue([]);
  mocks.teacherPage.mockResolvedValue({ requests: [], totalCount: 0, page: 1, pageSize: 50 });
  mocks.categories.mockResolvedValue([]);
  mocks.heads.mockResolvedValue([]);
  mocks.teacherQueue.mockReturnValue(null);
});
describe("review tracking views", () => {
  it("shows a committee-approved request while keeping it pending for a teacher", async () => {
    mocks.awaiting.mockResolvedValue([
      {
        id: "request",
        member_name: "Test Member",
        title: "Concession",
        category_name: "Concessions",
        service_date: "2026-09-28",
        hours: 2,
        status: "pending",
        approval_stage: "teacher",
        requested_approver_name: "Test Reviewer",
        waiting_days: 0,
      },
    ]);
    const html = renderToStaticMarkup(
      await ReviewQueuePage({
        searchParams: Promise.resolve({ view: "awaiting-teacher", search: "Concession" }),
      }),
    );
    expect(mocks.awaiting).toHaveBeenCalledWith("year", "reviewer");
    expect(mocks.pending).not.toHaveBeenCalled();
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(html).toContain("Test Member");
    expect(html).toContain("Pending teacher approval");
    expect(html).toContain("View history");
    expect(html).toContain('value="awaiting-teacher"');
    expect(html).toContain('href="/admin/requests/request"');
  });
  it("retains the committee head's actionable pending queue", async () => {
    const html = renderToStaticMarkup(await ReviewQueuePage({ searchParams: Promise.resolve({}) }));
    expect(mocks.pending).toHaveBeenCalledWith("year", "reviewer");
    expect(html).toContain("Awaiting teacher");
    expect(mocks.awaiting).not.toHaveBeenCalled();
  });
  it("keeps Archive restricted to completed approvals", async () => {
    await ReviewQueuePage({ searchParams: Promise.resolve({ view: "archive" }) });
    expect(mocks.archive).toHaveBeenCalledWith("year", "reviewer");
    expect(mocks.awaiting).not.toHaveBeenCalled();
  });
  it("keeps teachers on their shared actionable queue", async () => {
    mocks.viewer.mockResolvedValue({
      isTeacherAdmin: true,
      activeMembership: {
        id: "teacher",
        school_year_id: "year",
        school_year: { label: "2026–2027" },
      },
    });
    const html = renderToStaticMarkup(
      await ReviewQueuePage({ searchParams: Promise.resolve({ view: "awaiting-teacher" }) }),
    );
    expect(mocks.teacherPage).toHaveBeenCalledWith("year", {
      search: "",
      categoryId: undefined,
      committeeHeadId: undefined,
      page: 1,
    });
    expect(mocks.pending).not.toHaveBeenCalled();
    expect(mocks.awaiting).not.toHaveBeenCalled();
    expect(html).not.toContain('href="/admin/requests?view=awaiting-teacher"');
  });
  it("queries teacher filters on the server and preserves them in pagination", async () => {
    mocks.viewer.mockResolvedValue({
      isTeacherAdmin: true,
      activeMembership: {
        id: "teacher",
        school_year_id: "year",
        school_year: { label: "2026–2027" },
      },
    });
    mocks.teacherPage.mockResolvedValue({ requests: [], totalCount: 1_051, page: 2, pageSize: 50 });
    const categoryId = "30000000-0000-4000-8000-000000000001";
    const committeeHeadId = "20000000-0000-4000-8000-000000000002";
    const html = renderToStaticMarkup(
      await ReviewQueuePage({
        searchParams: Promise.resolve({ search: "Garden", categoryId, committeeHeadId, page: "2" }),
      }),
    );
    expect(mocks.teacherPage).toHaveBeenCalledWith("year", {
      search: "Garden",
      categoryId,
      committeeHeadId,
      page: 2,
    });
    expect(html).toContain("Teacher approval queue (1051)");
    expect(html).toContain("Page 2 of 22");
    expect(html).toContain(
      `search=Garden&amp;categoryId=${categoryId}&amp;committeeHeadId=${committeeHeadId}&amp;page=3`,
    );
    expect(mocks.teacherQueue.mock.calls[0]![0]).toMatchObject({
      schoolYearId: "year",
      selectionScope: JSON.stringify(["year", "Garden", categoryId, committeeHeadId, 2]),
    });
  });
  it("normalizes the all-filter sentinel and invalid page before querying", async () => {
    mocks.viewer.mockResolvedValue({
      isTeacherAdmin: true,
      activeMembership: {
        id: "teacher",
        school_year_id: "year",
        school_year: { label: "2026–2027" },
      },
    });
    await ReviewQueuePage({
      searchParams: Promise.resolve({ categoryId: "all", committeeHeadId: "all", page: "-4" }),
    });
    expect(mocks.teacherPage).toHaveBeenCalledWith("year", {
      search: "",
      categoryId: undefined,
      committeeHeadId: undefined,
      page: 1,
    });
  });
  it("returns to the last available page after approvals empty the current page", async () => {
    mocks.viewer.mockResolvedValue({
      isTeacherAdmin: true,
      activeMembership: {
        id: "teacher",
        school_year_id: "year",
        school_year: { label: "2026–2027" },
      },
    });
    mocks.teacherPage
      .mockResolvedValueOnce({ requests: [], totalCount: 49, page: 2, pageSize: 50 })
      .mockResolvedValueOnce({ requests: [], totalCount: 49, page: 1, pageSize: 50 });
    const html = renderToStaticMarkup(
      await ReviewQueuePage({ searchParams: Promise.resolve({ page: "2" }) }),
    );
    expect(mocks.teacherPage).toHaveBeenLastCalledWith("year", {
      search: "",
      categoryId: undefined,
      committeeHeadId: undefined,
      page: 1,
    });
    expect(html).toContain("Page 1 of 1");
    expect(mocks.teacherQueue.mock.calls[0]![0].selectionScope).toBe(
      JSON.stringify(["year", "", undefined, undefined, 2]),
    );
  });
  it("keeps the teacher Archive outside selection and the pending page query", async () => {
    mocks.viewer.mockResolvedValue({
      isTeacherAdmin: true,
      activeMembership: {
        id: "teacher",
        school_year_id: "year",
        school_year: { label: "2026–2027" },
      },
    });
    await ReviewQueuePage({ searchParams: Promise.resolve({ view: "archive" }) });
    expect(mocks.archive).toHaveBeenCalledWith("year", undefined);
    expect(mocks.teacherPage).not.toHaveBeenCalled();
    expect(mocks.teacherQueue).not.toHaveBeenCalled();
  });
});
