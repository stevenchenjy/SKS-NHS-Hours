import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { z } from "zod";

export class PortalAccessUnavailableError extends Error {
  constructor() {
    super("Portal access could not be checked. Please retry.");
  }
}

function assertExpectedRejection(error: { code?: string } | null): void {
  if (
    error &&
    !["P0002", "21000", "55000", "42501", "23514", "22023", "P0001"].includes(error.code ?? "")
  ) {
    throw new PortalAccessUnavailableError();
  }
}

/**
 * Claims an exact invitation when Auth metadata supplies one, then falls back to
 * confirming that a returning user is already provisioned. The database performs
 * the authoritative email, expiry, membership, and role checks.
 */
export async function claimInvitationOrConfirmExistingProfile(
  supabase: SupabaseClient,
  user: User,
): Promise<boolean> {
  const invitationId = z.uuid().safeParse(user.user_metadata?.invitation_id);
  const { error: claimError } = await supabase.rpc(
    "claim_invitation",
    invitationId.success ? { p_invitation_id: invitationId.data } : {},
  );
  if (!claimError) return true;
  assertExpectedRejection(claimError);

  // Supabase Auth can retain metadata from an older unconfirmed invite. When that exact
  // invitation is no longer eligible, let the database resolve the sole pending invite for
  // the verified email. It rejects zero or multiple matches instead of guessing.
  if (invitationId.success) {
    const { error: fallbackClaimError } = await supabase.rpc("claim_invitation");
    if (!fallbackClaimError) return true;
    assertExpectedRejection(fallbackClaimError);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) throw new PortalAccessUnavailableError();
  return Boolean(profile);
}
