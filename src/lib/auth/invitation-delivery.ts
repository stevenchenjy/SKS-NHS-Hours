export interface PreparedInvitationDelivery {
  invitationId: string;
  email: string;
  fullName: string;
}

export type InvitationDeliveryOutcome =
  "sent" | "recovery-sent" | "not-sendable" | "provider-failed" | "record-failed";

export interface InvitationDeliveryCoordinator {
  prepare: () => Promise<PreparedInvitationDelivery | null>;
  send: (
    invitation: PreparedInvitationDelivery,
    idempotencyKey: string,
  ) => Promise<void | "invite" | "recovery">;
  acknowledge: (idempotencyKey: string) => Promise<boolean>;
  createIdempotencyKey?: () => string;
  onProviderError?: (error: unknown) => void;
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
  let delivery: void | "invite" | "recovery";
  try {
    delivery = await coordinator.send(invitation, idempotencyKey);
  } catch (error) {
    coordinator.onProviderError?.(error);
    return "provider-failed";
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      if (await coordinator.acknowledge(idempotencyKey))
        return delivery === "recovery" ? "recovery-sent" : "sent";
    } catch {
      // Retry once with the same key; the database receipt makes this idempotent.
    }
  }
  return "record-failed";
}
