import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  viewer: vi.fn(),
  event: vi.fn(),
  roster: vi.fn(),
}));

vi.mock("@/lib/dal/access", () => ({ requirePortalViewer: mocks.viewer }));
vi.mock("@/lib/dal/events", () => ({
  getServiceEvent: mocks.event,
  listServiceEventRoster: mocks.roster,
}));
vi.mock("@/components/events/event-notice", () => ({ EventNotice: () => null }));
vi.mock("@/components/events/event-management-controls", () => ({
  EventManagementControls: () => <div>Edit event</div>,
}));
vi.mock("@/components/events/service-event-card", () => ({
  ServiceEventCard: ({ event }: { event: { title: string } }) => <div>{event.title}</div>,
}));

import ServiceEventDetailPage from "./page";

const eventId = "9b24c365-1d79-4bbe-b6ac-8681b929c291";
const event = {
  id: eventId,
  title: "Boys JV Soccer Game",
  can_manage: false,
  is_expired: false,
  school_year_id: "current-year",
  spots_remaining: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.event.mockResolvedValue(event);
  mocks.roster.mockResolvedValue([
    {
      registration_id: 1,
      full_name: "Signed Up Student",
      email: "student@example.edu",
      status: "confirmed",
      joined_at: "2026-09-29T16:52:00Z",
    },
  ]);
});

describe("event roster access", () => {
  it("renders current signups for a same-year president without edit controls", async () => {
    mocks.viewer.mockResolvedValue({
      activeMembership: { school_year_id: "current-year" },
      isMember: true,
      roles: ["member", "president_vice_president"],
    });
    const html = renderToStaticMarkup(
      await ServiceEventDetailPage({
        params: Promise.resolve({ id: eventId }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(mocks.roster).toHaveBeenCalledWith(eventId);
    expect(html).toContain("Event roster");
    expect(html).toContain("Signed Up Student");
    expect(html).not.toContain("Edit event");
  });

  it("keeps the roster hidden from an ordinary member", async () => {
    mocks.viewer.mockResolvedValue({
      activeMembership: { school_year_id: "current-year" },
      isMember: true,
      roles: ["member"],
    });
    const html = renderToStaticMarkup(
      await ServiceEventDetailPage({
        params: Promise.resolve({ id: eventId }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(mocks.roster).not.toHaveBeenCalled();
    expect(html).toContain("Event details");
    expect(html).not.toContain("Signed Up Student");
  });
});
