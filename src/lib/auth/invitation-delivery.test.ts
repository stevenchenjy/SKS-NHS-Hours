import { describe, expect, it, vi } from "vitest";

import {
  coordinateInvitationDelivery,
  type PreparedInvitationDelivery,
} from "./invitation-delivery";

const prepared: PreparedInvitationDelivery = {
  invitationId: "50000000-0000-4000-8000-000000000001",
  email: "member@example.edu",
  fullName: "Member Example",
};
const KEY = "60000000-0000-4000-8000-000000000001";

describe("invitation delivery coordinator", () => {
  it("stops before provider delivery when preparation rejects the invitation", async () => {
    const send = vi.fn();
    const acknowledge = vi.fn();
    await expect(
      coordinateInvitationDelivery({
        prepare: vi.fn().mockResolvedValue(null),
        send,
        acknowledge,
        createIdempotencyKey: () => KEY,
      }),
    ).resolves.toBe("not-sendable");
    expect(send).not.toHaveBeenCalled();
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it("never acknowledges a provider error", async () => {
    const acknowledge = vi.fn();
    await expect(
      coordinateInvitationDelivery({
        prepare: vi.fn().mockResolvedValue(prepared),
        send: vi.fn().mockRejectedValue(new Error("provider unavailable")),
        acknowledge,
        createIdempotencyKey: () => KEY,
      }),
    ).resolves.toBe("provider-failed");
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it("acknowledges only after provider success", async () => {
    const events: string[] = [];
    await expect(
      coordinateInvitationDelivery({
        prepare: async () => prepared,
        send: async (_invitation, key) => {
          events.push(`provider:${key}`);
        },
        acknowledge: async (key) => {
          events.push(`database:${key}`);
          return true;
        },
        createIdempotencyKey: () => KEY,
      }),
    ).resolves.toBe("sent");
    expect(events).toEqual([`provider:${KEY}`, `database:${KEY}`]);
  });

  it("retries a failed acknowledgement with the same key without resending", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const acknowledge = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await expect(
      coordinateInvitationDelivery({
        prepare: vi.fn().mockResolvedValue(prepared),
        send,
        acknowledge,
        createIdempotencyKey: () => KEY,
      }),
    ).resolves.toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
    expect(acknowledge).toHaveBeenNthCalledWith(1, KEY);
    expect(acknowledge).toHaveBeenNthCalledWith(2, KEY);
  });

  it("reports an unrecorded provider acceptance after bounded retries", async () => {
    const acknowledge = vi.fn().mockRejectedValue(new Error("database unavailable"));
    await expect(
      coordinateInvitationDelivery({
        prepare: vi.fn().mockResolvedValue(prepared),
        send: vi.fn().mockResolvedValue(undefined),
        acknowledge,
        createIdempotencyKey: () => KEY,
      }),
    ).resolves.toBe("record-failed");
    expect(acknowledge).toHaveBeenCalledTimes(2);
  });
});
