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
const DRAFT_SCHOOL_YEAR_ID = "10000000-0000-4000-8000-000000000002";
const DRAFT_MEMBERSHIP_ID = "20000000-0000-4000-8000-000000000002";

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

const draftMembership = {
  ...membership,
  id: DRAFT_MEMBERSHIP_ID,
  school_year_id: DRAFT_SCHOOL_YEAR_ID,
  expiration_date: "2028-06-30",
  created_at: "2026-08-29T00:00:00.000Z",
  school_years: {
    ...membership.school_years,
    id: DRAFT_SCHOOL_YEAR_ID,
    label: "2027-2028",
    start_date: "2027-07-01",
    end_date: "2028-06-30",
    status: "draft",
    created_at: "2026-08-29T00:00:00.000Z",
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

function viewerClient(
  roleResult: { data: unknown; error: { message: string } | null },
  accessResult: { data: unknown; error: { message: string } | null } = {
    data: null,
    error: null,
  },
  membershipResult: { data: unknown; error: { message: string } | null } = {
    data: [membership],
    error: null,
  },
) {
  const profileQuery = query({ data: profile, error: null });
  const membershipQuery = query(membershipResult);
  const roleQuery = query(roleResult);
  const accessQuery = query(accessResult);
  const from = vi.fn((table: string) => {
    if (table === "profiles") return profileQuery;
    if (table === "school_year_memberships") return membershipQuery;
    if (table === "membership_roles") return roleQuery;
    if (table === "platform_access_grants") return accessQuery;
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
    from,
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

  it("maps a platform owner independently of school-year membership", async () => {
    const { client, from } = viewerClient(
      { data: [], error: null },
      { data: { access_level: "platform_owner" }, error: null },
      { data: [], error: null },
    );
    createSupabaseServerClientMock.mockResolvedValue(client);

    await expect(getViewer()).resolves.toMatchObject({
      roles: [],
      globalAccessLevel: "platform_owner",
      isMember: false,
      canReview: true,
      isTeacherAdmin: true,
      isPlatformOwner: true,
      activeMembership: null,
      memberships: [],
    });
    expect(from).not.toHaveBeenCalledWith("membership_roles");
  });

  it("maps a global teacher administrator without granting platform-owner authority", async () => {
    const { client } = viewerClient(
      { data: [], error: null },
      { data: { access_level: "teacher_admin" }, error: null },
      { data: [], error: null },
    );
    createSupabaseServerClientMock.mockResolvedValue(client);

    await expect(getViewer()).resolves.toMatchObject({
      roles: [],
      globalAccessLevel: "teacher_admin",
      isMember: false,
      canReview: true,
      isTeacherAdmin: true,
      isPlatformOwner: false,
      activeMembership: null,
    });
  });

  it("keeps a global administrator anchored to the active year when a newer draft exists", async () => {
    const { client } = viewerClient(
      {
        data: [
          { membership_id: DRAFT_MEMBERSHIP_ID, roles: { role_key: "teacher_admin" } },
          { membership_id: MEMBERSHIP_ID, roles: { role_key: "teacher_admin" } },
        ],
        error: null,
      },
      { data: { access_level: "teacher_admin" }, error: null },
      { data: [draftMembership, membership], error: null },
    );
    createSupabaseServerClientMock.mockResolvedValue(client);

    await expect(getViewer()).resolves.toMatchObject({
      activeMembership: { id: MEMBERSHIP_ID, school_year_id: SCHOOL_YEAR_ID },
      isMember: false,
      isTeacherAdmin: true,
    });
  });

  it("keeps combined president and vice-president leadership school-year-bound", async () => {
    const { client } = viewerClient({
      data: [
        { membership_id: MEMBERSHIP_ID, roles: { role_key: "member" } },
        {
          membership_id: MEMBERSHIP_ID,
          roles: [{ role_key: "president_vice_president" }],
        },
      ],
      error: null,
    });
    createSupabaseServerClientMock.mockResolvedValue(client);

    await expect(getViewer()).resolves.toMatchObject({
      roles: ["member", "president_vice_president"],
      globalAccessLevel: null,
      isMember: true,
      canReview: true,
      isTeacherAdmin: false,
      isPlatformOwner: false,
    });
  });
});
