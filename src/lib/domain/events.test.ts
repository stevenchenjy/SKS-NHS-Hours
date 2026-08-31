import { describe, expect, it } from "vitest";

import { canPublishServiceEvents, formatServiceEventSchedule } from "@/lib/domain/events";

describe("service event domain", () => {
  it("allows committee heads and teacher administrators to publish", () => {
    expect(canPublishServiceEvents({ isTeacherAdmin: false, roles: ["committee_head"] })).toBe(
      true,
    );
    expect(canPublishServiceEvents({ isTeacherAdmin: true, roles: [] })).toBe(true);
    expect(canPublishServiceEvents({ isTeacherAdmin: false, roles: ["member"] })).toBe(false);
  });

  it("formats school-local event timestamps without applying a browser time-zone shift", () => {
    const schedule = formatServiceEventSchedule("2026-09-15T15:00:00", "2026-09-15T17:30:00");
    expect(schedule.date).toBe("Tue, Sep 15, 2026");
    expect(schedule.time).toMatch(/^3:00.+5:30.+PM$/);
  });

  it("shows both dates for an event spanning more than one day", () => {
    expect(formatServiceEventSchedule("2026-09-15T15:00:00", "2026-09-16T10:00:00")).toEqual({
      date: "Tue, Sep 15, 2026 – Wed, Sep 16, 2026",
      time: "3:00 PM – 10:00 AM",
    });
  });
});
