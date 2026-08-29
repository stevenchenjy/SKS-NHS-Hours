import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createSupabaseServerClientMock } = vi.hoisted(() => ({
  createSupabaseServerClientMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: createSupabaseServerClientMock,
}));

import { getViewer } from "./access";

const PROFILE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001";
const MEMBERSHIP_ID = "20000000-0000-4000-8000-000000000001";
const SCHOOL_YEAR_ID = "10000000-0000-4000-8000-000000000001";

const profile = {
  id: PROFILE_ID,
  email: "admin@example.edu",
  full_name: "Avery Admin",
  status: "active",
  deactivated_at: null,
  created_at: "2026-07-01T00:00:00.000Z",
  updated_at: "2026-07-01T00:00:00.000Z",
};

const membership = {
  id: MEMBERSHIP_ID,
  profile_id: PROFILE_ID,
  school_year_id: SCHOOL_YEAR_ID,
  status: "active",
  expiration_date: "2027-06-30",
  target_hours_override: null,
  renewed_from_membership_id: null,
  created_at: "2026-07-01T00:00:00.000Z",
  school_years: {
    id: SCHOOL_YEAR_ID,
    label: "2026-2027",
    start_date: "2026-07-01",
    end_date: "2027-06-30",
    default_target_hours: 20,
    status: "active",
    created_at: "2026-07-01T00:00:00.000Z",
    closed_at: null,
  },
};

function query(result: { data: unknown; error: { message: string } | null }) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    order: vi.fn().mockResolvedValue(result),
    in: vi.fn().mockResolvedValue(result),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  return builder;
}

function viewerClient(roleResult: { data: unknown; error: { message: string } | null }) {
  const profileQuery = query({ data: profile, error: null });
  const membershipQuery = query({ data: [membership], error: null });
  const roleQuery = query(roleResult);
  const from = vi.fn((table: string) => {
    if (table === "profiles") return profileQuery;
    if (table === "school_year_memberships") return membershipQuery;
    if (table === "membership_roles") return roleQuery;
    throw new Error(`Unexpected table: ${table}`);
  });

  return {
    client: {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: PROFILE_ID, email: profile.email } },
          error: null,
        }),
      },
      from,
    },
  };
}

describe("getViewer role loading", () => {
  beforeEach(() => {
    createSupabaseServerClientMock.mockReset();
    vi.setSystemTime(new Date("2026-08-29T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fails loudly when the role query fails", async () => {
    const { client } = viewerClient({
      data: null,
      error: { message: "role lookup failed" },
    });
    createSupabaseServerClientMock.mockResolvedValue(client);

    await expect(getViewer()).rejects.toThrow("Unable to load viewer roles: role lookup failed");
  });

  it("maps successful role rows into the viewer authorization flags", async () => {
    const { client } = viewerClient({
      data: [
        { membership_id: MEMBERSHIP_ID, roles: { role_key: "member" } },
        { membership_id: MEMBERSHIP_ID, roles: [{ role_key: "teacher_admin" }] },
      ],
      error: null,
    });
    createSupabaseServerClientMock.mockResolvedValue(client);

    await expect(getViewer()).resolves.toMatchObject({
      roles: ["member", "teacher_admin"],
      canReview: true,
      isTeacherAdmin: true,
      activeMembership: {
        id: MEMBERSHIP_ID,
        roles: ["member", "teacher_admin"],
      },
    });
  });
});
