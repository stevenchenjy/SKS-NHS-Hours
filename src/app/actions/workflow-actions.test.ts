import { File as NodeFile } from "node:buffer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, sendEmail, viewer, revalidate } = vi.hoisted(() => ({
  rpc: vi.fn(),
  sendEmail: vi.fn(),
  viewer: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: revalidate }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/dal/access", () => ({ requireActiveViewer: viewer, requireTeacherAdmin: viewer }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc }) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({}) }));
vi.mock("@/lib/auth/send-invitation-email", () => ({ sendInvitationEmail: sendEmail }));
vi.mock("@/lib/env", () => ({
  getServerEnvironment: () => ({
    allowedEmailDomains: ["example.edu"],
    NEXT_PUBLIC_APP_URL: "https://example.edu",
  }),
}));

import { correctApprovedRequestAction, importRosterAction } from "./admin-actions";
import { saveHourRequestAction } from "./hour-actions";
import { signupForServiceEventAction } from "./event-actions";

const YEAR = "50000000-0000-4000-8000-000000000001";
const ID = "50000000-0000-4000-8000-000000000002";
const CATEGORY = "50000000-0000-4000-8000-000000000003";
const REVIEWER = "50000000-0000-4000-8000-000000000004";
function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
function hours() {
  return form({
    school_year_id: YEAR,
    revision: "0",
    client_submission_key: "stable-client-key",
    category_id: CATEGORY,
    requested_approver_membership_id: REVIEWER,
    title: "Service",
    description: "",
    service_date: "2026-08-30",
    hours: "2",
    intent: "submit",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockReset();
  sendEmail.mockReset();
  vi.stubGlobal("File", NodeFile);
  viewer.mockResolvedValue({
    roles: ["member"],
    activeMembership: { school_year_id: YEAR },
    isPlatformOwner: true,
  });
});

describe("hour submission partial failures", () => {
  it("preserves the saved draft ID and revision so a failed submit can be retried", async () => {
    rpc
      .mockResolvedValueOnce({ data: { id: ID, revision: 2 }, error: null })
      .mockResolvedValueOnce({ error: { message: "Requested approver is not active" } });
    const first = await saveHourRequestAction({}, hours());
    expect(first.savedRequest).toEqual({ id: ID, revision: 2 });
    expect(first.error).toContain("Your draft was saved, but it was not submitted.");
    const retry = hours();
    retry.set("request_id", first.savedRequest!.id);
    retry.set("revision", String(first.savedRequest!.revision));
    rpc
      .mockResolvedValueOnce({ data: { id: ID, revision: 3 }, error: null })
      .mockResolvedValueOnce({ error: null });
    await expect(saveHourRequestAction(first, retry)).rejects.toThrow(
      `REDIRECT:/hours/${ID}?notice=submitted`,
    );
    expect(rpc).toHaveBeenNthCalledWith(
      3,
      "save_hour_request_draft",
      expect.objectContaining({ p_request_id: ID, p_expected_revision: 2 }),
    );
    expect(rpc).toHaveBeenNthCalledWith(4, "submit_hour_request", {
      p_request_id: ID,
      p_expected_revision: 3,
    });
  });

  it("keeps the saved revision through a validation error on the next attempt", async () => {
    const data = hours();
    data.set("hours", "0");
    const savedRequest = { id: ID, revision: 2 };
    const result = await saveHourRequestAction({ savedRequest }, data);
    expect(result.savedRequest).toEqual(savedRequest);
    expect(result.fieldErrors?.hours).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("approved-hour correction", () => {
  it("accepts the same short title and optional description allowed in submitted records", async () => {
    rpc.mockResolvedValue({ error: null });
    const result = await correctApprovedRequestAction(
      {},
      form({
        request_id: ID,
        title: "A",
        description: "",
        category_id: CATEGORY,
        service_date: "2026-08-30",
        hours: "2",
        reason: "Correct the recorded time",
      }),
    );
    expect(result.message).toContain("corrected");
    expect(rpc).toHaveBeenCalledWith(
      "correct_approved_request",
      expect.objectContaining({ p_title: "A", p_description: "" }),
    );
  });
});

describe("roster delivery results", () => {
  function roster() {
    const data = form({ school_year_id: YEAR });
    data.set(
      "roster",
      new File(["email,full_name\nmember@example.edu,Member Example"], "roster.csv", {
        type: "text/csv",
      }),
    );
    return data;
  }
  function prepare() {
    rpc.mockImplementation(async (name: string) => ({
      error: null,
      data:
        name === "create_invitation"
          ? { id: ID }
          : name === "prepare_invitation_send"
            ? { invitation_id: ID, email: "member@example.edu", full_name: "Member Example" }
            : null,
    }));
  }
  it("counts an existing-account recovery email as successful delivery", async () => {
    prepare();
    sendEmail.mockResolvedValue("recovery");
    const result = await importRosterAction({}, roster());
    expect(result.error).toBeUndefined();
    expect(result.message).toBe("1 invitation or account-recovery email sent.");
  });
  it("shows rejected rows as errors rather than a green success message", async () => {
    rpc.mockResolvedValue({ error: { message: "duplicate invitation" }, data: null });
    const result = await importRosterAction({}, roster());
    expect(result.message).toBeUndefined();
    expect(result.error).toContain("1 row(s) need attention");
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("event signup acknowledgement", () => {
  it("does not report a confirmed spot for an empty database response", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(signupForServiceEventAction(ID, "/events")).rejects.toThrow(
      "REDIRECT:/events?notice=signup-unconfirmed",
    );
  });
  it.each(["confirmed", "waitlisted"])("preserves the actual %s result", async (status) => {
    rpc.mockResolvedValue({ data: { status }, error: null });
    await expect(signupForServiceEventAction(ID, "/events")).rejects.toThrow(
      `REDIRECT:/events?notice=${status}`,
    );
  });
});
