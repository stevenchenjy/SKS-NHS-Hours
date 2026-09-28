import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  viewer: vi.fn(),
  pending: vi.fn(),
  awaiting: vi.fn(),
  archive: vi.fn(),
}));
vi.mock("@/components/portal/route-refresh", () => ({ RouteRefresh: () => null }));
vi.mock("@/lib/dal/access", () => ({ requireReviewer: mocks.viewer }));
vi.mock("@/lib/dal/portal", () => ({
  listPendingQueue: mocks.pending,
  listAwaitingTeacherReviews: mocks.awaiting,
  listApprovedReviewArchive: mocks.archive,
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
    expect(mocks.pending).toHaveBeenCalledWith("year", undefined);
    expect(mocks.awaiting).not.toHaveBeenCalled();
    expect(html).not.toContain('href="/admin/requests?view=awaiting-teacher"');
  });
});
