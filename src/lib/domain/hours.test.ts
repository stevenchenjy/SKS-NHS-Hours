import { describe, expect, it } from "vitest";

import {
  MAX_DATABASE_HOURS,
  minutesToQuarterHourUnits,
  normalizeHours,
  parseQuarterHourUnits,
  parseRequestHours,
  parseTargetHours,
  quarterHourUnitsToDecimal,
  quarterHourUnitsToHours,
  quarterHourUnitsToMinutes,
  sumQuarterHourUnits,
} from "./hours";

describe("quarter-hour normalization", () => {
  it.each([
    ["0", 0],
    ["0.00", 0],
    ["0.25", 1],
    ["1.5", 6],
    ["12.50", 50],
    [23.75, 95],
    [24, 96],
    [`${MAX_DATABASE_HOURS}`, 399_999],
  ])("parses %p into exact units", (input, expectedUnits) => {
    expect(parseQuarterHourUnits(input)).toBe(expectedUnits);
  });

  it.each(["0.1", "1.20", "2.99", 1.1, 0.1 + 0.2])(
    "rejects a non-quarter-hour value %p",
    (input) => {
      expect(() => parseQuarterHourUnits(input)).toThrow();
    },
  );

  it.each([
    "",
    " ",
    ".25",
    "01.25",
    "+1.25",
    "-0.25",
    "1e2",
    "1.250",
    "NaN",
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("rejects malformed or non-finite input %p", (input) => {
    expect(() => parseQuarterHourUnits(input)).toThrow();
  });

  it("normalizes one value into DB, UI, and duration forms", () => {
    expect(normalizeHours("2.75")).toEqual({
      units: 11,
      decimal: "2.75",
      hours: 2.75,
      minutes: 165,
    });
  });

  it("formats each possible quarter exactly", () => {
    expect(quarterHourUnitsToDecimal(4)).toBe("1.00");
    expect(quarterHourUnitsToDecimal(5)).toBe("1.25");
    expect(quarterHourUnitsToDecimal(6)).toBe("1.50");
    expect(quarterHourUnitsToDecimal(7)).toBe("1.75");
    expect(quarterHourUnitsToHours(7)).toBe(1.75);
    expect(quarterHourUnitsToMinutes(7)).toBe(105);
  });

  it("converts only whole 15-minute durations", () => {
    expect(minutesToQuarterHourUnits(0)).toBe(0);
    expect(minutesToQuarterHourUnits(90)).toBe(6);
    expect(() => minutesToQuarterHourUnits(16)).toThrow(/15-minute/);
    expect(() => minutesToQuarterHourUnits(-15)).toThrow();
  });

  it("sums integer units without floating-point drift", () => {
    expect(sumQuarterHourUnits([1, 1, 1, 1])).toBe(4);
    expect(quarterHourUnitsToHours(sumQuarterHourUnits([1, 2, 3]))).toBe(1.5);
  });
});

describe("request and target limits", () => {
  it("accepts the quarter-hour minimum and 24-hour maximum request", () => {
    expect(parseRequestHours("0.25")).toBe(1);
    expect(parseRequestHours("24.00")).toBe(96);
  });

  it.each(["0", 0, "24.25", "999.00"])("rejects invalid single-date request hours %p", (input) => {
    expect(() => parseRequestHours(input)).toThrow();
  });

  it("allows a zero target so progress can handle it explicitly", () => {
    expect(parseTargetHours("0.00")).toBe(0);
  });
});
