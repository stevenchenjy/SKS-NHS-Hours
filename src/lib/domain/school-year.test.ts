import { describe, expect, it } from "vitest";

import {
  deriveAnnualAccessStatus,
  evaluateMembershipAccess,
  isDateWithinRange,
  isIsoCalendarDate,
  isMembershipActiveOnDate,
  isServiceDateAllowed,
  parseSchoolYearDateRange,
  schoolYearLabelForDateRange,
  schoolYearLabelSchema,
  schoolYearAcceptsSubmissions,
} from "./school-year";

const SCHOOL_YEAR = {
  label: "2026-2027",
  startDate: "2026-08-15",
  endDate: "2027-06-15",
} as const;

describe("school-year labels", () => {
  it("accepts consecutive four-digit years", () => {
    expect(schoolYearLabelSchema.parse(" 2026-2027 ")).toBe("2026-2027");
  });

  it.each(["2026/2027", "26-27", "2026-2026", "2026-2028", "2026–2027"])(
    "rejects invalid label %s",
    (label) => {
      expect(schoolYearLabelSchema.safeParse(label).success).toBe(false);
    },
  );
});

describe("calendar and range validation", () => {
  it.each(["2024-02-29", "2026-01-01", "2026-12-31"])("accepts real ISO date %s", (date) => {
    expect(isIsoCalendarDate(date)).toBe(true);
  });

  it.each(["2023-02-29", "2026-02-30", "2026-13-01", "2026-1-01", "nope"])(
    "rejects impossible or noncanonical date %s",
    (date) => {
      expect(isIsoCalendarDate(date)).toBe(false);
    },
  );

  it("parses a coherent school-year date range", () => {
    expect(parseSchoolYearDateRange(SCHOOL_YEAR)).toEqual(SCHOOL_YEAR);
  });

  it("requires the dates to match the years in the label", () => {
    expect(() =>
      parseSchoolYearDateRange({
        ...SCHOOL_YEAR,
        startDate: "2025-08-15",
        endDate: "2026-06-15",
      }),
    ).toThrow();
  });

  it("requires the end to follow the start", () => {
    expect(() =>
      parseSchoolYearDateRange({
        label: "2026-2027",
        startDate: "2026-09-01",
        endDate: "2026-08-31",
      }),
    ).toThrow();
  });

  it("treats both range boundaries as inclusive", () => {
    expect(isDateWithinRange("2026-08-15", SCHOOL_YEAR)).toBe(true);
    expect(isDateWithinRange("2027-06-15", SCHOOL_YEAR)).toBe(true);
    expect(isDateWithinRange("2026-08-14", SCHOOL_YEAR)).toBe(false);
    expect(isDateWithinRange("2027-06-16", SCHOOL_YEAR)).toBe(false);
  });

  it("rejects future service while accepting today", () => {
    expect(isServiceDateAllowed("2026-10-01", SCHOOL_YEAR, "2026-10-01")).toBe(true);
    expect(isServiceDateAllowed("2026-10-02", SCHOOL_YEAR, "2026-10-01")).toBe(false);
  });

  it("derives only a valid consecutive-year label", () => {
    expect(schoolYearLabelForDateRange("2026-08-01", "2027-06-30")).toBe("2026-2027");
    expect(() => schoolYearLabelForDateRange("2026-01-01", "2028-01-01")).toThrow();
  });

  it("accepts submissions only for an active year on a date in its range", () => {
    expect(
      schoolYearAcceptsSubmissions({
        status: "active",
        dateRange: SCHOOL_YEAR,
        onDate: "2026-10-01",
      }),
    ).toBe(true);
    expect(
      schoolYearAcceptsSubmissions({
        status: "closed",
        dateRange: SCHOOL_YEAR,
        onDate: "2026-10-01",
      }),
    ).toBe(false);
    expect(
      schoolYearAcceptsSubmissions({
        status: "active",
        dateRange: SCHOOL_YEAR,
        onDate: "2027-07-01",
      }),
    ).toBe(false);
  });
});

describe("school-year membership access", () => {
  const ACTIVE_MEMBERSHIP = {
    membershipStatus: "active",
    membershipExpirationDate: "2027-06-15",
    schoolYear: SCHOOL_YEAR,
    onDate: "2026-10-01",
  } as const;

  it("allows an active, unexpired membership within the school year", () => {
    expect(isMembershipActiveOnDate(ACTIVE_MEMBERSHIP)).toBe(true);
    expect(evaluateMembershipAccess(ACTIVE_MEMBERSHIP)).toEqual({
      active: true,
      reasons: [],
    });
  });

  it("denies access by calendar date even if a stale row still says active", () => {
    expect(
      evaluateMembershipAccess({
        ...ACTIVE_MEMBERSHIP,
        membershipExpirationDate: "2026-09-30",
      }),
    ).toEqual({
      active: false,
      reasons: ["membership_expired_by_date"],
    });
  });

  it("denies an expired role outside its school-year window", () => {
    expect(
      evaluateMembershipAccess({
        ...ACTIVE_MEMBERSHIP,
        membershipStatus: "expired",
        onDate: "2027-07-01",
      }),
    ).toEqual({
      active: false,
      reasons: ["membership_not_active", "outside_school_year", "membership_expired_by_date"],
    });
  });

  it("treats the membership expiration date as inclusive", () => {
    expect(
      isMembershipActiveOnDate({
        ...ACTIVE_MEMBERSHIP,
        onDate: "2027-06-15",
      }),
    ).toBe(true);
  });
});

describe("annual access display status", () => {
  const ACTIVE_ACCESS = {
    profileStatus: "active",
    membershipStatus: "active",
    membershipExpirationDate: "2027-09-01",
    schoolYearStatus: "active",
    schoolYearStartDate: "2026-09-01",
    schoolYearEndDate: "2027-09-01",
    onDate: "2026-10-01",
  } as const;

  it("shows a closed school year as closed even when its membership row is still active", () => {
    expect(
      deriveAnnualAccessStatus({
        ...ACTIVE_ACCESS,
        schoolYearStatus: "closed",
      }),
    ).toBe("closed");
  });

  it("shows calendar-expired access as expired even when its membership row is still active", () => {
    expect(
      deriveAnnualAccessStatus({
        ...ACTIVE_ACCESS,
        membershipExpirationDate: "2026-09-30",
      }),
    ).toBe("expired");
  });
});
