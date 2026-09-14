import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, viewer, getEvent, revalidate } = vi.hoisted(() => ({
  rpc: vi.fn(),
  viewer: vi.fn(),
  getEvent: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: revalidate }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/dal/access", () => ({ requirePortalViewer: viewer, requireActiveViewer: viewer }));
vi.mock("@/lib/dal/events", () => ({ getServiceEvent: getEvent }));
vi.mock("@/lib/dal/notifications", () => ({ unreadNotificationCount: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc }) }));

import {
  createServiceEventAction,
  updateServiceEventAction,
  closeServiceEventAction,
  signupForServiceEventAction,
} from "./event-actions";
import { markNotificationsReadAction } from "./notification-actions";

const id = "10000000-0000-4000-8000-000000000002";
const year = "10000000-0000-4000-8000-000000000001";
const version = "2026-09-13T15:00:00.123456+00:00";
function form() {
  const result = new FormData();
  Object.entries({
    event_id: id,
    updated_at: version,
    school_year_id: year,
    title: "Library helpers",
    description: "Sort books",
    location: "Library",
    volunteer_audience: "NHS members",
    starts_at: "2026-10-20T15:00",
    ends_at: "2026-10-20T17:00",
    signup_deadline: "2026-10-19T15:00",
    contact_name: "Riley",
    contact_email: "reviewer@example.edu",
    capacity: "2",
  }).forEach(([key, value]) => result.set(key, value));
  return result;
}
beforeEach(() => {
  vi.clearAllMocks();
  viewer.mockResolvedValue({
    roles: ["member", "committee_head"],
    isTeacherAdmin: false,
    activeMembership: { school_year_id: year },
  });
  getEvent.mockResolvedValue({ id, can_manage: true, school_year_id: year });
  rpc.mockResolvedValue({ data: { id }, error: null });
});

describe("event management actions", () => {
  it("sends the deadline on publish", async () => {
    await expect(createServiceEventAction({}, form())).rejects.toThrow(
      `REDIRECT:/events/${id}?notice=created`,
    );
    expect(rpc).toHaveBeenCalledWith(
      "create_service_event",
      expect.objectContaining({ p_signup_deadline: "2026-10-19T15:00" }),
    );
  });
  it("rejects editing another organizer's event before calling the mutation", async () => {
    getEvent.mockResolvedValue({ id, can_manage: false, school_year_id: year });
    expect((await updateServiceEventAction({}, form())).error).toMatch(/permission/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("retains user input and explains a stale edit", async () => {
    rpc.mockResolvedValue({ error: { code: "40001", message: "changed" } });
    const result = await updateServiceEventAction({}, form());
    expect(result.error).toMatch(/Reload/);
    expect(result.values?.title).toBe("Library helpers");
    expect(rpc).toHaveBeenCalledWith(
      "update_service_event",
      expect.objectContaining({ p_expected_updated_at: version }),
    );
  });
  it("validates the deadline before saving", async () => {
    const data = form();
    data.set("signup_deadline", "2026-10-21T15:00");
    expect((await updateServiceEventAction({}, data)).fieldErrors?.signup_deadline).toHaveLength(1);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("returns ended events to Past", async () => {
    await expect(closeServiceEventAction(id, "end", version)).rejects.toThrow(
      "REDIRECT:/events?view=past&notice=ended",
    );
  });
  it("does not show success when deletion fails", async () => {
    rpc.mockResolvedValue({ error: { code: "42501" } });
    await expect(closeServiceEventAction(id, "delete", version)).rejects.toThrow(
      `REDIRECT:/events/${id}?notice=manage-failed`,
    );
  });
  it("explains signup rejection at the cutoff", async () => {
    rpc.mockResolvedValue({ error: { message: "The signup deadline has passed" } });
    await expect(signupForServiceEventAction(id, "/events")).rejects.toThrow(
      "REDIRECT:/events?notice=signup-closed",
    );
  });
  it("validates notification ids and invalidates the unread count after marking read", async () => {
    await expect(markNotificationsReadAction("invalid")).rejects.toThrow("read-failed");
    expect(rpc).not.toHaveBeenCalled();
    await expect(markNotificationsReadAction(id)).rejects.toThrow(
      "REDIRECT:/notifications?notice=archived",
    );
    expect(rpc).toHaveBeenCalledWith("mark_event_notifications_read", { p_notification_id: id });
    expect(revalidate).toHaveBeenCalledWith("/", "layout");
  });
});
