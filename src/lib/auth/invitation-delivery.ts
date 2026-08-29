export interface PreparedInvitationDelivery {
  invitationId: string;
  email: string;
  fullName: string;
}

export type InvitationDeliveryOutcome =
  "sent" | "not-sendable" | "provider-failed" | "record-failed";

export interface InvitationDeliveryCoordinator {
  prepare: () => Promise<PreparedInvitationDelivery | null>;
  send: (invitation: PreparedInvitationDelivery, idempotencyKey: string) => Promise<void>;
  acknowledge: (idempotencyKey: string) => Promise<boolean>;
  createIdempotencyKey?: () => string;
}

/**
 * Coordinates the intentionally non-transactional Auth-provider/database saga.
 * Database acknowledgement always follows provider acceptance, and a lost
 * acknowledgement response is retried with the same durable idempotency key.
 */
export async function coordinateInvitationDelivery(
  coordinator: InvitationDeliveryCoordinator,
): Promise<InvitationDeliveryOutcome> {
  const invitation = await coordinator.prepare();
  if (!invitation) return "not-sendable";

  const idempotencyKey = (coordinator.createIdempotencyKey ?? (() => crypto.randomUUID()))();
  try {
    await coordinator.send(invitation, idempotencyKey);
  } catch {
    return "provider-failed";
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      if (await coordinator.acknowledge(idempotencyKey)) return "sent";
    } catch {
      // Retry once with the same key; the database receipt makes this idempotent.
    }
  }
  return "record-failed";
}
