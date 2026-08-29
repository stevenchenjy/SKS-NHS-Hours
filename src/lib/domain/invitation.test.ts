import { describe, expect, it } from "vitest";

import {
  deriveInvitationStatus,
  emailDomain,
  invitationEmailSchema,
  isEmailDomainAllowed,
  parseAllowedEmailDomains,
  validateInvitation,
} from "./invitation";

const SCHOOL_YEAR_ID = "b0000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-28T12:00:00.000Z");

function invitation(overrides: Record<string, unknown> = {}) {
  return {
    email: "student@school.edu",
    fullName: "Student Example",
    schoolYearId: SCHOOL_YEAR_ID,
    roles: ["member"],
    expiresAt: "2026-09-04T12:00:00.000Z",
    ...overrides,
  };
}

describe("email and domain normalization", () => {
  it("trims and lowercases invitation email addresses", () => {
    expect(invitationEmailSchema.parse(" Student@School.EDU ")).toBe("student@school.edu");
    expect(emailDomain("Student@School.EDU")).toBe("school.edu");
  });

  it("parses comma-separated domains, trims, lowercases, and deduplicates", () => {
    expect(parseAllowedEmailDomains(" school.edu, Students.School.edu,school.edu ")).toEqual([
      "school.edu",
      "students.school.edu",
    ]);
  });

  it("uses exact domain matches rather than unsafe suffix matches", () => {
    expect(isEmailDomainAllowed("member@school.edu", ["school.edu"])).toBe(true);
    expect(isEmailDomainAllowed("member@students.school.edu", ["school.edu"])).toBe(false);
    expect(isEmailDomainAllowed("member@evilschool.edu", ["school.edu"])).toBe(false);
  });

  it("treats an empty allowlist as optional domain restriction", () => {
    expect(isEmailDomainAllowed("member@example.org", [])).toBe(true);
  });

  it.each(["school", "@school.edu", "*.school.edu", "-bad.school.edu"])(
    "rejects invalid allowed domain %s",
    (domain) => {
      expect(() => parseAllowedEmailDomains([domain])).toThrow();
    },
  );
});

describe("invitation validation", () => {
  const policy = {
    allowedEmailDomains: ["school.edu"],
    now: NOW,
    maximumValidityDays: 14,
  } as const;

  it("accepts and normalizes a future school-domain invitation", () => {
    expect(
      validateInvitation(
        invitation({
          email: " STUDENT@SCHOOL.EDU ",
          fullName: " Student Example ",
          roles: ["member", "president"],
        }),
        policy,
      ),
    ).toEqual(
      invitation({
        email: "student@school.edu",
        roles: ["member", "president"],
      }),
    );
  });

  it("rejects an otherwise valid email outside the allowlist", () => {
    expect(() => validateInvitation(invitation({ email: "student@example.org" }), policy)).toThrow(
      /domain is not permitted/i,
    );
  });

  it("rejects expired and excessively long-lived invitations", () => {
    expect(() =>
      validateInvitation(invitation({ expiresAt: "2026-08-28T11:59:59.000Z" }), policy),
    ).toThrow(/future/i);
    expect(() =>
      validateInvitation(invitation({ expiresAt: "2026-09-30T12:00:00.000Z" }), policy),
    ).toThrow(/14 days/i);
  });

  it("rejects duplicate, empty, or unknown role assignments", () => {
    expect(() => validateInvitation(invitation({ roles: ["member", "member"] }), policy)).toThrow(
      /same role/i,
    );
    expect(() => validateInvitation(invitation({ roles: [] }), policy)).toThrow();
    expect(() => validateInvitation(invitation({ roles: ["principal"] }), policy)).toThrow();
  });

  it("requires a bounded full name", () => {
    expect(() => validateInvitation(invitation({ fullName: " " }), policy)).toThrow(/full name/i);
    expect(() => validateInvitation(invitation({ fullName: "x".repeat(201) }), policy)).toThrow();
  });

  it("rejects malformed identifiers, timestamps, and unknown properties", () => {
    expect(() => validateInvitation(invitation({ schoolYearId: "not-a-uuid" }), policy)).toThrow();
    expect(() => validateInvitation(invitation({ expiresAt: "next Friday" }), policy)).toThrow();
    expect(() => validateInvitation(invitation({ privileged: true }), policy)).toThrow();
  });
});

describe("invitation lifecycle", () => {
  it("derives expiration only for pending invitations", () => {
    expect(deriveInvitationStatus("pending", "2026-08-28T11:59:59.000Z", NOW)).toBe("expired");
    expect(deriveInvitationStatus("pending", "2026-08-28T12:00:01.000Z", NOW)).toBe("pending");
  });

  it.each(["accepted", "revoked", "expired"] as const)(
    "does not overwrite terminal status %s",
    (status) => {
      expect(deriveInvitationStatus(status, "2026-01-01T00:00:00.000Z", NOW)).toBe(status);
    },
  );
});
