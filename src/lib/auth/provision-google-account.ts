import type { SupabaseClient } from "@supabase/supabase-js";
import type { PreparedInvitationDelivery } from "./invitation-delivery";

/** Called only after the database authorizes a roster invitation. This Admin
 * API creates an unconfirmed identity without sending mail or choosing a
 * password; Google must still prove ownership and the database must claim the
 * invitation. Public signup remains disabled. Never modify an existing user. */
export async function provisionGoogleAccount(
  admin: SupabaseClient,
  invitation: PreparedInvitationDelivery,
): Promise<void> {
  const { error } = await admin.auth.admin.createUser({
    email: invitation.email,
    email_confirm: false,
    user_metadata: { invitation_id: invitation.invitationId, full_name: invitation.fullName },
  });
  if (error && !["email_exists", "user_already_exists"].includes(error.code ?? "")) throw error;
}
