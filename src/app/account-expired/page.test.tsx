import { beforeEach, describe, expect, it, vi } from "vitest";

const { getViewerMock, redirectMock } = vi.hoisted(() => ({
  getViewerMock: vi.fn(),
  redirectMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal/access", () => ({ getViewer: getViewerMock }));

import AccountExpiredPage from "./page";

describe("AccountExpiredPage", () => {
  beforeEach(() => {
    getViewerMock.mockReset();
    redirectMock.mockReset();
  });

  it("redirects a member whose school-year access is active", async () => {
    getViewerMock.mockResolvedValue({
      activeMembership: { id: "membership-1" },
      isMember: true,
      isTeacherAdmin: false,
      memberships: [],
    });

    await AccountExpiredPage();

    expect(redirectMock).toHaveBeenCalledWith("/dashboard");
  });

  it("redirects an active teacher administrator to administration", async () => {
    getViewerMock.mockResolvedValue({
      activeMembership: { id: "membership-1" },
      isMember: false,
      isTeacherAdmin: true,
      memberships: [],
    });

    await AccountExpiredPage();

    expect(redirectMock).toHaveBeenCalledWith("/admin");
  });

  it("keeps inactive members on the limited account screen", async () => {
    getViewerMock.mockResolvedValue({
      activeMembership: null,
      isMember: false,
      isTeacherAdmin: false,
      memberships: [],
    });

    const page = await AccountExpiredPage();

    expect(redirectMock).not.toHaveBeenCalled();
    expect(page).toBeTruthy();
  });
});
