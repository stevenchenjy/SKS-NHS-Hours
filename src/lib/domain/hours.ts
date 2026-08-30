import { z } from "zod";

export const MINUTES_PER_QUARTER_HOUR = 15;
export const QUARTER_HOURS_PER_HOUR = 4;
export const MAX_DATABASE_HOURS = 99_999.75;
export const MAX_REQUEST_HOURS = 24;

declare const quarterHourUnitsBrand: unique symbol;

/** An integer count of 15-minute units. */
export type QuarterHourUnits = number & {
  readonly [quarterHourUnitsBrand]: true;
};

const DECIMAL_HOURS_PATTERN = /^(?:0|[1-9]\d*)(?:\.(\d{1,2}))?$/;

function issue(context: z.RefinementCtx, message: string): typeof z.NEVER {
  context.addIssue({ code: "custom", message });
  return z.NEVER;
}

function decimalInputToUnits(
  value: string | number,
  context: z.RefinementCtx,
): QuarterHourUnits | typeof z.NEVER {
  if (typeof value === "number" && !Number.isFinite(value)) {
    return issue(context, "Hours must be a finite decimal value.");
  }

  const normalized = String(value).trim();
  const match = DECIMAL_HOURS_PATTERN.exec(normalized);

  if (!match) {
    return issue(context, "Hours must be a non-negative decimal with at most two decimal places.");
  }

  const wholeHours = Number(normalized.split(".", 1)[0]);
  const hundredths = Number((match[1] ?? "").padEnd(2, "0") || "0");

  if (!Number.isSafeInteger(wholeHours)) {
    return issue(context, "Hours are outside the supported range.");
  }

  if (![0, 25, 50, 75].includes(hundredths)) {
    return issue(context, "Hours must use 15-minute (0.25 hour) increments.");
  }

  const units = wholeHours * QUARTER_HOURS_PER_HOUR + hundredths / 25;
  const maximumUnits = MAX_DATABASE_HOURS * QUARTER_HOURS_PER_HOUR;

  if (!Number.isSafeInteger(units) || units > maximumUnits) {
    return issue(context, "Hours are outside the supported range.");
  }

  return units as QuarterHourUnits;
}

/**
 * Parses a database/UI decimal into an exact integer number of 15-minute units.
 * Scientific notation, signs, and values with more than two decimal places are
 * deliberately rejected so all accepted values have one canonical meaning.
 */
export const quarterHourInputSchema = z
  .union([z.string(), z.number()])
  .transform(decimalInputToUnits);

export const quarterHourUnitsSchema = z
  .number()
  .int()
  .min(0)
  .max(MAX_DATABASE_HOURS * QUARTER_HOURS_PER_HOUR)
  .transform((value) => value as QuarterHourUnits);

/** Valid service-entry hours: 0.25 through 24.00 inclusive. */
export const requestHoursSchema = quarterHourInputSchema
  .refine((units) => units > 0, "Hours must be greater than zero.")
  .refine(
    (units) => units <= MAX_REQUEST_HOURS * QUARTER_HOURS_PER_HOUR,
    `A single-date request cannot exceed ${MAX_REQUEST_HOURS} hours.`,
  );

/** Valid annual targets. Zero remains supported for historical data safety. */
export const targetHoursSchema = quarterHourInputSchema;

export type HoursInput = z.input<typeof quarterHourInputSchema>;

export interface NormalizedHours {
  units: QuarterHourUnits;
  decimal: string;
  hours: number;
  minutes: number;
}

export function parseQuarterHourUnits(input: HoursInput): QuarterHourUnits {
  return quarterHourInputSchema.parse(input);
}

export function parseRequestHours(input: HoursInput): QuarterHourUnits {
  return requestHoursSchema.parse(input);
}

export function parseTargetHours(input: HoursInput): QuarterHourUnits {
  return targetHoursSchema.parse(input);
}

export function quarterHourUnitsToDecimal(unitsInput: number): string {
  const units = quarterHourUnitsSchema.parse(unitsInput);
  const wholeHours = Math.floor(units / QUARTER_HOURS_PER_HOUR);
  const remainder = units % QUARTER_HOURS_PER_HOUR;
  const hundredths = remainder * 25;

  return `${wholeHours}.${String(hundredths).padStart(2, "0")}`;
}

export function quarterHourUnitsToHours(unitsInput: number): number {
  const units = quarterHourUnitsSchema.parse(unitsInput);
  return units / QUARTER_HOURS_PER_HOUR;
}

export function quarterHourUnitsToMinutes(unitsInput: number): number {
  const units = quarterHourUnitsSchema.parse(unitsInput);
  return units * MINUTES_PER_QUARTER_HOUR;
}

export function minutesToQuarterHourUnits(minutes: number): QuarterHourUnits {
  const normalizedMinutes = z.number().int().nonnegative().parse(minutes);

  if (normalizedMinutes % MINUTES_PER_QUARTER_HOUR !== 0) {
    throw new RangeError("Minutes must use 15-minute increments.");
  }

  return quarterHourUnitsSchema.parse(normalizedMinutes / MINUTES_PER_QUARTER_HOUR);
}

export function normalizeHours(input: HoursInput): NormalizedHours {
  const units = parseQuarterHourUnits(input);

  return {
    units,
    decimal: quarterHourUnitsToDecimal(units),
    hours: quarterHourUnitsToHours(units),
    minutes: quarterHourUnitsToMinutes(units),
  };
}

export function sumQuarterHourUnits(values: readonly number[]): QuarterHourUnits {
  const total = values.reduce((sum, value) => sum + quarterHourUnitsSchema.parse(value), 0);

  return quarterHourUnitsSchema.parse(total);
}
