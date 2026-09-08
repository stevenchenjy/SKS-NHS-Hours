import type { SupabaseClient } from "@supabase/supabase-js";

import type { PreparedInvitationDelivery } from "./invitation-delivery";

/** Called only after the database authorizes delivery of a pending invitation. */
export async function sendInvitationEmail(
  admin: SupabaseClient,
  invitation: PreparedInvitationDelivery,
  idempotencyKey: string,
  appUrl: string,
): Promise<"invite" | "recovery"> {
  const { error } = await admin.auth.admin.inviteUserByEmail(invitation.email, {
    redirectTo: new URL("/update-password", appUrl).toString(),
    data: {
      invitation_id: invitation.invitationId,
      full_name: invitation.fullName,
      invitation_send_id: idempotencyKey,
    },
  });
  if (!error) return "invite";
  // A verified Auth account can still have an unclaimed application invitation.
  // Recovery proves email ownership; the callback retains the database's claim checks.
  if (error.code !== "email_exists" && error.code !== "user_already_exists") throw error;
  const { error: recoveryError } = await admin.auth.resetPasswordForEmail(invitation.email, {
    redirectTo: new URL("/auth/recovery-callback", appUrl).toString(),
  });
  if (recoveryError) throw recoveryError;
  return "recovery";
}
