import type { Viewer } from "@/lib/types";
import { z } from "zod";

const localDateTimeSchema = z
  .string()
  .trim()
  .refine((value) => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
    const date = new Date(`${value}:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 16) === value;
  }, "Enter a valid date and time.");

export const serviceEventSchema = z
  .object({
    school_year_id: z.uuid(),
    title: z.string().trim().min(1, "Enter an event title.").max(160),
    description: z.string().trim().min(1, "Describe the help that is needed.").max(5_000),
    location: z.string().trim().min(1, "Enter the event location.").max(300),
    volunteer_audience: z.string().trim().min(1, "Explain who should volunteer.").max(500),
    starts_at: localDateTimeSchema,
    ends_at: localDateTimeSchema,
    signup_deadline: localDateTimeSchema,
    contact_name: z.string().trim().min(1, "Enter a contact name.").max(200),
    contact_email: z.string().trim().pipe(z.email("Enter a valid contact email.").max(320)),
    capacity: z.coerce
      .number()
      .int("People needed must be a whole number.")
      .min(1, "At least one person is needed.")
      .max(500, "Capacity cannot exceed 500 people."),
  })
  .refine((values) => values.ends_at > values.starts_at, {
    path: ["ends_at"],
    message: "The end time must be after the start time.",
  })
  .refine((values) => values.signup_deadline <= values.starts_at, {
    path: ["signup_deadline"],
    message: "The signup deadline must be at or before the event starts.",
  });

export function formatServiceEventDeadline(value: string): string {
  const date = asUtcClockDate(value);
  if (Number.isNaN(date.getTime())) return "Deadline unavailable";
  return (
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(date) + " ET"
  );
}

const localTimestampPattern = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

function asUtcClockDate(value: string): Date {
  const match = localTimestampPattern.exec(value);
  if (!match) return new Date(Number.NaN);
  const [, year, month, day, hour, minute, second = "00"] = match;
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
}

export function canPublishServiceEvents(
  viewer: Pick<Viewer, "isTeacherAdmin" | "isAdmin" | "roles">,
): boolean {
  return viewer.isTeacherAdmin || viewer.isAdmin || viewer.roles.includes("committee_head");
}

export function formatServiceEventSchedule(
  startsAt: string,
  endsAt: string,
): { date: string; time: string } {
  const start = asUtcClockDate(startsAt);
  const end = asUtcClockDate(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { date: "Date to be announced", time: "Time to be announced" };
  }

  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
  const sameDay = startsAt.slice(0, 10) === endsAt.slice(0, 10);

  return {
    date: sameDay
      ? dateFormatter.format(start)
      : `${dateFormatter.format(start)} – ${dateFormatter.format(end)}`,
    time: sameDay
      ? timeFormatter.formatRange(start, end)
      : `${timeFormatter.format(start)} – ${timeFormatter.format(end)}`,
  };
}
