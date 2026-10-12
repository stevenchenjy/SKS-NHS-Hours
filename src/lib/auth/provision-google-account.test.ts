import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { provisionGoogleAccount } from "./provision-google-account";
const invitation = {
  invitationId: "approved-invitation",
  email: "member@example.edu",
  fullName: "Member",
};
describe("email-independent Google account provisioning", () => {
  it("creates only the approved unconfirmed identity without a password or mail", async () => {
    const createUser = vi.fn().mockResolvedValue({ error: null });
    await provisionGoogleAccount(
      { auth: { admin: { createUser } } } as unknown as SupabaseClient,
      invitation,
    );
    expect(createUser).toHaveBeenCalledExactlyOnceWith({
      email: invitation.email,
      email_confirm: false,
      user_metadata: { invitation_id: invitation.invitationId, full_name: invitation.fullName },
    });
  });
  it.each(["email_exists", "user_already_exists"])(
    "keeps existing identities untouched for %s",
    async (code) => {
      const createUser = vi.fn().mockResolvedValue({ error: { code } });
      await expect(
        provisionGoogleAccount(
          { auth: { admin: { createUser } } } as unknown as SupabaseClient,
          invitation,
        ),
      ).resolves.toBeUndefined();
    },
  );
  it("does not claim readiness when Auth provisioning fails", async () => {
    const error = { code: "unexpected_failure" };
    const createUser = vi.fn().mockResolvedValue({ error });
    await expect(
      provisionGoogleAccount(
        { auth: { admin: { createUser } } } as unknown as SupabaseClient,
        invitation,
      ),
    ).rejects.toBe(error);
  });
});
