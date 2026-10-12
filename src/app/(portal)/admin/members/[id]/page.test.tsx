import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  getProgress: vi.fn(),
  listRequests: vi.fn(),
  memberships: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal/access", () => ({
  requirePortalViewer: async () => ({
    isAdmin: true,
    roles: [],
    activeMembership: { school_year_id: "current" },
  }),
}));
vi.mock("@/lib/dal/portal", () => ({
  getProgress: mocks.getProgress,
  listMemberRequests: mocks.listRequests,
  listMembershipsForProfile: mocks.memberships,
  getProfileRecord: async () => ({
    id: "member",
    full_name: "Member",
    email: "member@example.edu",
    status: "active",
  }),
}));
import MemberProfilePage from "./page";
function membership(id: string, label: string, status = "active") {
  return {
    id,
    school_year_id: id,
    status: "active",
    expiration_date: `${label.slice(5)}-09-01`,
    roles: ["member"],
    school_year: {
      id,
      label,
      status,
      start_date: `${label.slice(0, 4)}-08-29`,
      end_date: `${label.slice(5)}-09-01`,
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProgress.mockResolvedValue({ approved_hours: 0, pending_hours: 0, target_hours: 35 });
  mocks.listRequests.mockResolvedValue([]);
  mocks.memberships.mockResolvedValue([
    membership("past", "2025-2026", "closed"),
    membership("current", "2026-2027"),
  ]);
});
describe("member profile school-year context", () => {
  it("uses the active portal year when membership timestamps are tied or out of order", async () => {
    await MemberProfilePage({
      params: Promise.resolve({ id: "member" }),
      searchParams: Promise.resolve({}),
    });
    expect(mocks.getProgress).toHaveBeenCalledWith("current");
    expect(mocks.listRequests).toHaveBeenCalledWith(["past", "current"], "current");
  });
  it("still lets a reviewer explicitly open historical records", async () => {
    await MemberProfilePage({
      params: Promise.resolve({ id: "member" }),
      searchParams: Promise.resolve({ year: "past" }),
    });
    expect(mocks.getProgress).toHaveBeenCalledWith("past");
  });
});
