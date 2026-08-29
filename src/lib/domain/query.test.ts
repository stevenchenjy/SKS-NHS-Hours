import { describe, expect, it } from "vitest";

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_NUMBER,
  parseHourRequestQuery,
  parseMemberRosterQuery,
  paginationWindow,
  querySourceToRecord,
} from "./query";

const CATEGORY_ID = "a0000000-0000-4000-8000-000000000001";
const SCHOOL_YEAR_ID = "b0000000-0000-4000-8000-000000000001";
const REVIEWER_ID = "c0000000-0000-4000-8000-000000000001";

describe("hour-request query parsing", () => {
  it("provides bounded, deterministic defaults", () => {
    expect(parseHourRequestQuery({})).toEqual({
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      sortBy: "submitted_at",
      direction: "desc",
    });
  });

  it("parses URLSearchParams, repeated lists, comma lists, booleans, and IDs", () => {
    const params = new URLSearchParams();
    params.append("status", "pending,changes_requested");
    params.append("status", "pending");
    params.set("page", "2");
    params.set("pageSize", "50");
    params.set("q", "  Avery Smith  ");
    params.set("categoryId", CATEGORY_ID);
    params.set("schoolYearId", SCHOOL_YEAR_ID);
    params.set("requestedApproverMembershipId", REVIEWER_ID);
    params.set("assignedToMe", "1");
    params.set("serviceFrom", "2026-08-01");
    params.set("serviceTo", "2027-06-30");
    params.set("sortBy", "service_date");
    params.set("direction", "asc");

    expect(parseHourRequestQuery(params)).toEqual({
      page: 2,
      pageSize: 50,
      q: "Avery Smith",
      status: ["pending", "changes_requested"],
      categoryId: CATEGORY_ID,
      schoolYearId: SCHOOL_YEAR_ID,
      requestedApproverMembershipId: REVIEWER_ID,
      assignedToMe: true,
      serviceFrom: "2026-08-01",
      serviceTo: "2027-06-30",
      sortBy: "service_date",
      direction: "asc",
    });
  });

  it.each([
    [{ page: "0" }, "zero page"],
    [{ page: "01" }, "noncanonical page"],
    [{ page: String(MAX_PAGE_NUMBER + 1) }, "excessive page"],
    [{ pageSize: "101" }, "excessive page size"],
    [{ assignedToMe: "yes" }, "ambiguous boolean"],
    [{ categoryId: "not-a-uuid" }, "invalid identifier"],
    [{ serviceFrom: "2026-02-30" }, "impossible date"],
    [{ status: "not_a_status" }, "unknown status"],
    [{ sortBy: "DROP TABLE" }, "unknown sort"],
    [{ unexpected: "value" }, "unknown parameter"],
  ] as const)("rejects %j (%s)", (query, _description) => {
    void _description;
    expect(() => parseHourRequestQuery(query)).toThrow();
  });

  it("rejects scalar parameter pollution", () => {
    expect(() => parseHourRequestQuery({ page: ["1", "2"] })).toThrow();
  });

  it("rejects a reversed service-date range", () => {
    expect(() =>
      parseHourRequestQuery({
        serviceFrom: "2027-06-30",
        serviceTo: "2026-08-01",
      }),
    ).toThrow(/must not precede/i);
  });

  it("normalizes empty optional filters away", () => {
    expect(parseHourRequestQuery({ q: " ", status: "" })).toEqual({
      page: 1,
      pageSize: 25,
      sortBy: "submitted_at",
      direction: "desc",
    });
  });
});

describe("member-roster query parsing", () => {
  it("parses and deduplicates all supported filter families", () => {
    expect(
      parseMemberRosterQuery({
        q: " Rivera ",
        role: ["member,committee_head", "member"],
        progressState: "below_goal,over_goal",
        requestStatus: ["pending", "rejected"],
        membershipStatus: "active,expired",
        categoryId: CATEGORY_ID,
        schoolYearId: SCHOOL_YEAR_ID,
        actualReviewerMembershipId: REVIEWER_ID,
        page: "3",
        pageSize: "10",
        sortBy: "approved_hours",
        direction: "desc",
      }),
    ).toEqual({
      q: "Rivera",
      role: ["member", "committee_head"],
      progressState: ["below_goal", "over_goal"],
      requestStatus: ["pending", "rejected"],
      membershipStatus: ["active", "expired"],
      categoryId: CATEGORY_ID,
      schoolYearId: SCHOOL_YEAR_ID,
      actualReviewerMembershipId: REVIEWER_ID,
      page: 3,
      pageSize: 10,
      sortBy: "approved_hours",
      direction: "desc",
    });
  });

  it("rejects invalid roles, statuses, and sort fields", () => {
    expect(() => parseMemberRosterQuery({ role: "principal" })).toThrow();
    expect(() => parseMemberRosterQuery({ membershipStatus: "deleted" })).toThrow();
    expect(() => parseMemberRosterQuery({ sortBy: "email" })).toThrow();
  });
});

describe("query and pagination helpers", () => {
  it("retains repeated URL values for schema-level validation", () => {
    const params = new URLSearchParams("page=1&page=2&status=pending");
    expect(querySourceToRecord(params)).toEqual({
      page: ["1", "2"],
      status: "pending",
    });
  });

  it("calculates a safe offset and limit", () => {
    expect(paginationWindow({ page: 3, pageSize: 25 })).toEqual({
      page: 3,
      pageSize: 25,
      offset: 50,
      limit: 25,
    });
  });

  it("rejects unbounded pagination inputs", () => {
    expect(() => paginationWindow({ page: 0, pageSize: 25 })).toThrow();
    expect(() => paginationWindow({ page: 1, pageSize: 101 })).toThrow();
  });
});
