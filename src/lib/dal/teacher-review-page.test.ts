import { beforeEach, describe, expect, it, vi } from "vitest";

const { client } = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: client }));

import { listTeacherReviewPage } from "./portal";

const YEAR = "50000000-0000-4000-8000-000000000001";
const CATEGORY = "50000000-0000-4000-8000-000000000002";
const HEAD = "50000000-0000-4000-8000-000000000003";
const TIMESTAMP = "2026-10-15T14:27:19.123456+00:00";

function makeQuery(result: { data: unknown; error: unknown; count: number | null }) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  for (const method of [builder.select, builder.eq, builder.or, builder.order, builder.range]) {
    method.mockReturnValue(builder);
  }
  const from = vi.fn().mockReturnValue(builder);
  client.mockResolvedValue({ from });
  return { builder, from };
}

beforeEach(() => vi.clearAllMocks());

describe("teacher review database pagination", () => {
  it("filters and counts before the 50-row range and orders by the oldest stage wait", async () => {
    const { builder, from } = makeQuery({ data: [], error: null, count: 1234 });
    await expect(
      listTeacherReviewPage(YEAR, {
        search: "Food drive",
        categoryId: CATEGORY,
        committeeHeadId: HEAD,
        page: 21,
      }),
    ).resolves.toEqual({ requests: [], totalCount: 1234, page: 21, pageSize: 50 });
    expect(from).toHaveBeenCalledWith("pending_review_queue");
    expect(builder.select).toHaveBeenCalledWith(expect.stringContaining("description"), {
      count: "exact",
    });
    const selected = builder.select.mock.calls[0]![0] as string;
    for (const field of [
      "revision",
      "updated_at",
      "committee_head_approved_at",
      "approval_stage",
      "waiting_since",
    ]) {
      expect(selected.split(",")).toContain(field);
    }
    expect(builder.eq).toHaveBeenCalledWith("school_year_id", YEAR);
    expect(builder.eq).toHaveBeenCalledWith("category_id", CATEGORY);
    expect(builder.eq).toHaveBeenCalledWith("requested_approver_membership_id", HEAD);
    expect(builder.or).toHaveBeenCalledWith(
      "member_name.ilike.%Food drive%,title.ilike.%Food drive%,category_name.ilike.%Food drive%",
    );
    expect(builder.order).toHaveBeenNthCalledWith(1, "waiting_since", { ascending: true });
    expect(builder.order).toHaveBeenNthCalledWith(2, "id", { ascending: true });
    expect(builder.range).toHaveBeenCalledWith(1000, 1049);
    expect(builder.eq.mock.invocationCallOrder.at(-1)).toBeLessThan(
      builder.range.mock.invocationCallOrder[0]!,
    );
    expect(builder.or.mock.invocationCallOrder[0]).toBeLessThan(
      builder.range.mock.invocationCallOrder[0]!,
    );
  });

  it("preserves first-stage attention rows and the exact review snapshot timestamp", async () => {
    const rows = [
      {
        id: "ready",
        revision: 2,
        updated_at: TIMESTAMP,
        approval_stage: "teacher",
        committee_head_approved_at: TIMESTAMP,
        waiting_since: TIMESTAMP,
        days_pending: "3",
      },
      {
        id: "attention",
        revision: 1,
        updated_at: TIMESTAMP,
        approval_stage: "committee_head",
        committee_head_approved_at: null,
        submitted_at: TIMESTAMP,
      },
    ];
    const { builder } = makeQuery({ data: rows, error: null, count: 2 });
    const page = await listTeacherReviewPage(YEAR);
    expect(builder.range).toHaveBeenCalledWith(0, 49);
    expect(builder.eq).not.toHaveBeenCalledWith("approval_stage", "teacher");
    expect(page.requests).toEqual([
      { ...rows[0], waiting_days: 3 },
      { ...rows[1], waiting_since: TIMESTAMP, waiting_days: 0 },
    ]);
  });

  it("neutralizes untrusted PostgREST filter grammar before searching", async () => {
    const { builder } = makeQuery({ data: [], error: null, count: 0 });
    await listTeacherReviewPage(YEAR, { search: 'member),or(status.eq.approved)%_*"' });
    expect(builder.or).toHaveBeenCalledWith(
      "member_name.ilike.%member or status eq approved%,title.ilike.%member or status eq approved%,category_name.ilike.%member or status eq approved%",
    );
  });

  it("does not turn a punctuation-only search into an unrestricted injected filter", async () => {
    const { builder } = makeQuery({ data: [], error: null, count: 0 });
    await listTeacherReviewPage(YEAR, { search: "(),%_*" });
    expect(builder.or).not.toHaveBeenCalled();
  });

  it.each([
    [YEAR, { categoryId: "bad" }],
    [YEAR, { committeeHeadId: "bad" }],
    [YEAR, { page: 0 }],
    [YEAR, { page: 10001 }],
    ["bad", {}],
  ])("rejects invalid year or filters without querying the database %#", async (year, options) => {
    await expect(listTeacherReviewPage(year, options)).rejects.toThrow();
    expect(client).not.toHaveBeenCalled();
  });

  it("reports database errors and missing counts instead of claiming an empty queue", async () => {
    makeQuery({ data: null, error: { message: "denied" }, count: null });
    await expect(listTeacherReviewPage(YEAR)).rejects.toThrow(
      "Unable to load teacher review queue: denied",
    );
    makeQuery({ data: [], error: null, count: null });
    await expect(listTeacherReviewPage(YEAR)).rejects.toThrow("no count returned");
  });
});
