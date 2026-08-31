import type { Viewer } from "@/lib/types";

const localTimestampPattern = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

function asUtcClockDate(value: string): Date {
  const match = localTimestampPattern.exec(value);
  if (!match) return new Date(Number.NaN);
  const [, year, month, day, hour, minute, second = "00"] = match;
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
}

export function canPublishServiceEvents(viewer: Pick<Viewer, "isTeacherAdmin" | "roles">): boolean {
  return viewer.isTeacherAdmin || viewer.roles.includes("committee_head");
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
