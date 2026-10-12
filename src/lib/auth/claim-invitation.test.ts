import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
import { claimInvitationOrConfirmExistingProfile } from "./claim-invitation";
const user = { id: "member", user_metadata: {} } as User;
function client() {
  const rpc = vi.fn().mockResolvedValue({ error: null });
  const maybeSingle = vi.fn().mockResolvedValue({ data: { id: user.id }, error: null });
  const builder = { select: vi.fn(), eq: vi.fn(), maybeSingle };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  return { rpc, maybeSingle, supabase: { rpc, from: () => builder } as unknown as SupabaseClient };
}
describe("invitation claim and returning-account access", () => {
  it("claims the authorized pending invitation before profile fallback", async () => {
    const c = client();
    expect(await claimInvitationOrConfirmExistingProfile(c.supabase, user)).toBe(true);
    expect(c.rpc).toHaveBeenCalledWith("claim_invitation", {});
    expect(c.maybeSingle).not.toHaveBeenCalled();
  });
  it("keeps returning profiles usable when no pending invitation remains", async () => {
    const c = client();
    c.rpc.mockResolvedValue({ error: { code: "P0002" } });
    expect(await claimInvitationOrConfirmExistingProfile(c.supabase, user)).toBe(true);
  });
  it("does not present a database outage as a missing invitation", async () => {
    const c = client();
    c.rpc.mockResolvedValue({ error: { code: "PGRST000" } });
    await expect(claimInvitationOrConfirmExistingProfile(c.supabase, user)).rejects.toThrow(
      "Please retry",
    );
    expect(c.maybeSingle).not.toHaveBeenCalled();
  });
  it("distinguishes an unavailable profile lookup from an unprovisioned user", async () => {
    const c = client();
    c.rpc.mockResolvedValue({ error: { code: "P0002" } });
    c.maybeSingle.mockResolvedValue({ data: null, error: { code: "PGRST000" } });
    await expect(claimInvitationOrConfirmExistingProfile(c.supabase, user)).rejects.toThrow(
      "Please retry",
    );
  });
});
