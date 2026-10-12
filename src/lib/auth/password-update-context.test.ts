import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPasswordUpdateContext,
  PASSWORD_UPDATE_CONTEXT_MAX_AGE_SECONDS,
  verifyPasswordUpdateContext,
} from "./password-update-context";

const SECRET = "test-only-password-update-context-secret-000000000000";
const USER_ID = "10000000-0000-4000-8000-000000000001";

afterEach(() => vi.useRealTimers());

describe("password update context", () => {
  it("round-trips a signed, user-bound recovery context", async () => {
    vi.setSystemTime(new Date("2026-08-29T12:00:00Z"));
    const token = await createPasswordUpdateContext(
      { subject: USER_ID, purpose: "recovery" },
      SECRET,
    );

    await expect(
      verifyPasswordUpdateContext(token, { subject: USER_ID }, SECRET),
    ).resolves.toMatchObject({
      subject: USER_ID,
      purpose: "recovery",
      expiresAt: Math.floor(Date.now() / 1_000) + PASSWORD_UPDATE_CONTEXT_MAX_AGE_SECONDS,
    });
  });

  it("rejects a context for a different user", async () => {
    const token = await createPasswordUpdateContext(
      { subject: USER_ID, purpose: "invite" },
      SECRET,
    );
    await expect(
      verifyPasswordUpdateContext(
        token,
        { subject: "20000000-0000-4000-8000-000000000002" },
        SECRET,
      ),
    ).resolves.toBeNull();
  });

  it.each(["invite", "recovery", "google"] as const)(
    "keeps a new %s context valid for 48 hours and expires it at the boundary",
    async (purpose) => {
      vi.setSystemTime(new Date("2026-10-11T12:00:00Z"));
      const issuedAt = Math.floor(Date.now() / 1_000);
      const token = await createPasswordUpdateContext({ subject: USER_ID, purpose }, SECRET);

      await expect(
        verifyPasswordUpdateContext(token, { subject: USER_ID, now: issuedAt + 172_799 }, SECRET),
      ).resolves.toMatchObject({ subject: USER_ID, purpose, expiresAt: issuedAt + 172_800 });
      await expect(
        verifyPasswordUpdateContext(token, { subject: USER_ID, now: issuedAt + 172_800 }, SECRET),
      ).resolves.toBeNull();
    },
  );

  it("rejects expired, malformed, and tampered contexts", async () => {
    const token = await createPasswordUpdateContext(
      { subject: USER_ID, purpose: "recovery", expiresAt: 100 },
      SECRET,
    );
    await expect(
      verifyPasswordUpdateContext(token, { subject: USER_ID, now: 100 }, SECRET),
    ).resolves.toBeNull();
    await expect(
      verifyPasswordUpdateContext(`${token}x`, { subject: USER_ID, now: 99 }, SECRET),
    ).resolves.toBeNull();
    await expect(
      verifyPasswordUpdateContext("not-a-token", { subject: USER_ID }, SECRET),
    ).resolves.toBeNull();
  });

  it("refuses to sign with a short secret", async () => {
    await expect(
      createPasswordUpdateContext({ subject: USER_ID, purpose: "recovery" }, "too-short"),
    ).rejects.toThrow("too short");
  });
});
