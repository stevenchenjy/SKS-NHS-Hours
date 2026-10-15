// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Viewer } from "@/lib/types";

const { signOut, getIndicators } = vi.hoisted(() => ({
  signOut: vi.fn(),
  getIndicators: vi.fn(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/profile" }));
vi.mock("@/app/actions/auth-actions", () => ({ signOutAction: signOut }));
vi.mock("@/app/actions/navigation-indicator-actions", () => ({
  getNavigationIndicatorsAction: getIndicators,
  markNavigationSectionSeenAction: vi.fn(),
}));
vi.mock("@/components/events/notification-bell", () => ({ NotificationBell: () => null }));

import { AppShell } from "./app-shell";

const viewer: Viewer = {
  id: "member-id",
  email: "member@example.edu",
  profile: {
    id: "member-id",
    email: "member@example.edu",
    full_name: "Morgan Member",
    status: "active",
    deactivated_at: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
  },
  activeMembership: null,
  memberships: [],
  roles: ["member"],
  globalAccessLevel: null,
  isMember: true,
  canReview: false,
  isTeacherAdmin: false,
  isAdmin: false,
  isPlatformOwner: false,
};

beforeEach(() => {
  signOut.mockResolvedValue(undefined);
  getIndicators.mockResolvedValue({ events: false, notifications: false });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("app shell mobile account actions", () => {
  it("offers an accessible header sign-out action outside the desktop sidebar", async () => {
    render(<AppShell viewer={viewer}>Profile content</AppShell>);

    const header = screen.getByRole("banner");
    const button = within(header).getByRole("button", { name: "Sign out" });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("type", "submit");
    expect(button.closest("aside")).toBeNull();
    fireEvent.click(button);

    await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
  });

  it("keeps preview account actions disabled instead of signing out a real session", () => {
    render(
      <AppShell viewer={viewer} preview={{ role: "member", section: "profile" }}>
        Preview content
      </AppShell>,
    );

    const button = within(screen.getByRole("banner")).getByRole("button", {
      name: "Sign out",
    });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(signOut).not.toHaveBeenCalled();
    expect(getIndicators).not.toHaveBeenCalled();
  });
});
