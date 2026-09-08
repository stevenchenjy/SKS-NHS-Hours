import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { coordinateInvitationDelivery } from "./invitation-delivery";
import { sendInvitationEmail } from "./send-invitation-email";

const invitation = { invitationId: "invite-id", email: "member@example.edu", fullName: "Member" };
const appUrl = "https://example.edu";

function setup(inviteError: unknown = null, recoveryError: unknown = null) {
  const inviteUserByEmail = vi.fn().mockResolvedValue({ error: inviteError });
  const resetPasswordForEmail = vi.fn().mockResolvedValue({ error: recoveryError });
  const admin = {
    auth: { admin: { inviteUserByEmail }, resetPasswordForEmail },
  } as unknown as SupabaseClient;
  return { admin, inviteUserByEmail, resetPasswordForEmail };
}

describe("invitation email delivery", () => {
  it("sends a normal invitation without also sending recovery", async () => {
    const client = setup();
    expect(await sendInvitationEmail(client.admin, invitation, "receipt", appUrl)).toBe("invite");
    expect(client.resetPasswordForEmail).not.toHaveBeenCalled();
    expect(client.inviteUserByEmail).toHaveBeenCalledWith(invitation.email, {
      redirectTo: `${appUrl}/update-password`,
      data: { invitation_id: "invite-id", full_name: "Member", invitation_send_id: "receipt" },
    });
  });

  it.each(["email_exists", "user_already_exists"])(
    "recovers an existing Auth account for %s",
    async (code) => {
      const client = setup({ code, status: 422 });
      const acknowledge = vi.fn().mockResolvedValue(true);
      expect(
        await coordinateInvitationDelivery({
          prepare: async () => invitation,
          send: (prepared, key) => sendInvitationEmail(client.admin, prepared, key, appUrl),
          acknowledge,
        }),
      ).toBe("recovery-sent");
      expect(client.resetPasswordForEmail).toHaveBeenCalledExactlyOnceWith(invitation.email, {
        redirectTo: `${appUrl}/auth/recovery-callback`,
      });
      expect(acknowledge).toHaveBeenCalledTimes(1);
    },
  );

  it("does not try recovery for SMTP or rate limit errors", async () => {
    const error = { code: "over_email_send_rate_limit", status: 429 };
    const client = setup(error);
    await expect(sendInvitationEmail(client.admin, invitation, "receipt", appUrl)).rejects.toBe(
      error,
    );
    expect(client.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("does not record a send when recovery fails and reports the error", async () => {
    const error = { code: "unexpected_failure", status: 500 };
    const client = setup({ code: "email_exists" }, error);
    const acknowledge = vi.fn();
    const onProviderError = vi.fn();
    expect(
      await coordinateInvitationDelivery({
        prepare: async () => invitation,
        send: (prepared, key) => sendInvitationEmail(client.admin, prepared, key, appUrl),
        acknowledge,
        onProviderError,
      }),
    ).toBe("provider-failed");
    expect(acknowledge).not.toHaveBeenCalled();
    expect(onProviderError).toHaveBeenCalledWith(error);
  });
});
