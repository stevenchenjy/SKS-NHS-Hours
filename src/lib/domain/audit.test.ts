import { describe, expect, it } from "vitest";

import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_ENTITY,
  auditActionSchema,
  auditEntityTypeForAction,
  auditEventInputSchema,
  parseAuditEvent,
} from "./audit";

const ACTOR_ID = "10000000-0000-4000-8000-000000000001";
const ENTITY_ID = "20000000-0000-4000-8000-000000000001";
const SCHOOL_YEAR_ID = "30000000-0000-4000-8000-000000000001";

function auditEvent(overrides: Record<string, unknown> = {}) {
  return {
    actorProfileId: ACTOR_ID,
    actorMembershipId: ACTOR_ID,
    action: "hour_request.approved",
    entityType: "hour_request",
    entityId: ENTITY_ID,
    schoolYearId: SCHOOL_YEAR_ID,
    occurredAt: "2026-08-28T12:00:00.000Z",
    metadata: { previousStatus: "pending", hours: 1.25 },
    ...overrides,
  };
}

describe("audit action taxonomy", () => {
  it("contains unique actions with a deterministic target type", () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);

    for (const action of AUDIT_ACTIONS) {
      expect(auditActionSchema.parse(action)).toBe(action);
      expect(auditEntityTypeForAction(action)).toBe(AUDIT_ACTION_ENTITY[action]);
    }
  });

  it.each([
    "invitation.created",
    "invitation.sent",
    "profile.status_changed",
    "membership.renewed",
    "role.assigned",
    "school_year.closed",
    "category.updated",
    "school_year.target_updated",
    "membership.target_updated",
    "hour_request.corrected",
    "export.generated",
    "teacher_admin.bootstrapped",
  ] as const)("includes required sensitive action %s", (action) => {
    expect(AUDIT_ACTIONS).toContain(action);
  });
});

describe("audit-event validation", () => {
  it("accepts structured JSON metadata", () => {
    const event = auditEvent({
      oldValues: { status: "pending" },
      newValues: { status: "approved" },
    });
    expect(parseAuditEvent(event)).toEqual(event);
  });

  it("supports system actors and defaults missing metadata", () => {
    const parsed = auditEventInputSchema.parse({
      ...auditEvent(),
      actorProfileId: null,
      actorMembershipId: null,
      metadata: undefined,
    });
    expect(parsed.actorProfileId).toBeNull();
    expect(parsed.actorMembershipId).toBeNull();
    expect(parsed.metadata).toEqual({});
  });

  it("requires the entity type associated with the action", () => {
    expect(() => parseAuditEvent(auditEvent({ entityType: "profile" }))).toThrow(/must target/i);
  });

  it("rejects unknown actions and unexpected fields", () => {
    expect(() => parseAuditEvent(auditEvent({ action: "hour_request.deleted" }))).toThrow();
    expect(() => parseAuditEvent(auditEvent({ mutable: true }))).toThrow();
  });

  it("rejects non-JSON and non-finite metadata", () => {
    expect(() => parseAuditEvent(auditEvent({ metadata: { bad: Number.NaN } }))).toThrow();
    expect(() => parseAuditEvent(auditEvent({ metadata: { bad: undefined } }))).toThrow();
  });

  it("bounds metadata cardinality and serialized size", () => {
    const tooManyEntries = Object.fromEntries(
      Array.from({ length: 51 }, (_, index) => [`key${index}`, index]),
    );
    expect(() => parseAuditEvent(auditEvent({ metadata: tooManyEntries }))).toThrow(
      /50 top-level keys/i,
    );
    expect(() => parseAuditEvent(auditEvent({ metadata: { reason: "x".repeat(33_000) } }))).toThrow(
      /32 KiB/i,
    );
  });

  it("requires stable identifiers and an offset-aware timestamp", () => {
    expect(() => parseAuditEvent(auditEvent({ entityId: " " }))).toThrow();
    expect(() => parseAuditEvent(auditEvent({ occurredAt: "2026-08-28T12:00:00" }))).toThrow();
  });
});
