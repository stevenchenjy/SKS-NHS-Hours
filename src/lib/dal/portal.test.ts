import { beforeEach, describe, expect, it, vi } from "vitest";

const { createSupabaseServerClientMock } = vi.hoisted(() => ({
  createSupabaseServerClientMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: createSupabaseServerClientMock,
}));

import { listAccountDirectory } from "./portal";

const PROFILE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003";
const MEMBERSHIP_ID = "20000000-0000-4000-8000-000000000003";
const SCHOOL_YEAR_ID = "10000000-0000-4000-8000-000000000001";

const directoryRow = {
  id: MEMBERSHIP_ID,
  profile_id: PROFILE_ID,
  school_year_id: SCHOOL_YEAR_ID,
  status: "active",
  expiration_date: "2027-06-30",
  target_hours_override: null,
  renewed_from_membership_id: null,
  created_at: "2026-07-01T00:00:00.000Z",
  profiles: {
    id: PROFILE_ID,
    email: "member@example.edu",
    full_name: "Morgan Member",
    status: "active",
    deactivated_at: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
  },
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
    order: vi.fn().mockResolvedValue(result),
    in: vi.fn().mockResolvedValue(result),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  return builder;
}

function directoryClient(
  rows: unknown[],
  roleResult: { data: unknown; error: { message: string } | null },
) {
  const directoryQuery = query({ data: rows, error: null });
  const roleQuery = query(roleResult);
  const from = vi.fn((table: string) => {
    if (table === "school_year_memberships") return directoryQuery;
    if (table === "membership_roles") return roleQuery;
    throw new Error(`Unexpected table: ${table}`);
  });

  return { client: { from }, from };
}

describe("listAccountDirectory role loading", () => {
  beforeEach(() => {
    createSupabaseServerClientMock.mockReset();
  });

  it("fails loudly when the role query fails", async () => {
    const { client } = directoryClient([directoryRow], {
      data: null,
      error: { message: "role lookup failed" },
    });
    createSupabaseServerClientMock.mockResolvedValue(client);

    await expect(listAccountDirectory(SCHOOL_YEAR_ID)).rejects.toThrow(
      "Unable to load account roles: role lookup failed",
    );
  });

  it("maps successful role rows onto directory memberships", async () => {
    const { client } = directoryClient([directoryRow], {
      data: [
        { membership_id: MEMBERSHIP_ID, roles: { role_key: "member" } },
        { membership_id: MEMBERSHIP_ID, roles: [{ role_key: "committee_head" }] },
      ],
      error: null,
    });
    createSupabaseServerClientMock.mockResolvedValue(client);

    await expect(listAccountDirectory(SCHOOL_YEAR_ID)).resolves.toMatchObject([
      {
        profile: { id: PROFILE_ID },
        membership: {
          id: MEMBERSHIP_ID,
          roles: ["member", "committee_head"],
        },
      },
    ]);
  });

  it("returns an empty directory without querying membership roles", async () => {
    const { client, from } = directoryClient([], {
      data: null,
      error: { message: "must not be observed" },
    });
    createSupabaseServerClientMock.mockResolvedValue(client);

    await expect(listAccountDirectory(SCHOOL_YEAR_ID)).resolves.toEqual([]);
    expect(from).not.toHaveBeenCalledWith("membership_roles");
  });
});
