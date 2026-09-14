import { describe, expect, it } from "vitest";

import {
  canPublishServiceEvents,
  formatServiceEventSchedule,
  serviceEventSchema,
} from "@/lib/domain/events";

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

describe("event deadline validation", () => {
  const event = {
    school_year_id: "10000000-0000-4000-8000-000000000001",
    title: "Library helpers",
    description: "Sort books",
    location: "Library",
    volunteer_audience: "NHS members",
    starts_at: "2026-10-20T15:00",
    ends_at: "2026-10-20T17:00",
    signup_deadline: "2026-10-19T15:00",
    contact_name: "Riley",
    contact_email: "reviewer@example.edu",
    capacity: "2",
  };
  it("accepts a cutoff exactly at the event start", () => {
    expect(
      serviceEventSchema.safeParse({ ...event, signup_deadline: event.starts_at }).success,
    ).toBe(true);
  });
  it("rejects cutoffs after the event starts", () => {
    const result = serviceEventSchema.safeParse({ ...event, signup_deadline: "2026-10-20T15:01" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors.signup_deadline).toHaveLength(1);
  });
  it("requires a cutoff and rejects impossible dates", () => {
    expect(serviceEventSchema.safeParse({ ...event, signup_deadline: "" }).success).toBe(false);
    expect(serviceEventSchema.safeParse({ ...event, starts_at: "2026-02-30T15:00" }).success).toBe(
      false,
    );
  });
  it("rejects a zero duration and fractional capacity", () => {
    expect(serviceEventSchema.safeParse({ ...event, ends_at: event.starts_at }).success).toBe(
      false,
    );
    expect(serviceEventSchema.safeParse({ ...event, capacity: "1.5" }).success).toBe(false);
  });
});
