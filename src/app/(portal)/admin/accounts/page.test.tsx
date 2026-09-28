import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ directory: vi.fn(), years: vi.fn() }));
vi.mock("@/components/admin/account-recovery-menu", () => ({
  AccountRecoveryMenu: ({ recoveryTarget }: { recoveryTarget?: { profileId: string } }) =>
    recoveryTarget ? <span data-recovery-target={recoveryTarget.profileId} /> : null,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/components/portal/route-refresh", () => ({ RouteRefresh: () => null }));
vi.mock("@/lib/dal/access", () => ({
  requireAdmin: async () => ({ activeMembership: null, isAdmin: true, isPlatformOwner: true }),
}));
vi.mock("@/lib/dal/account-setup", () => ({ listAccountSetupStatus: async () => [] }));
vi.mock("@/lib/dal/portal", () => ({
  listSchoolYears: mocks.years,
  listAccountDirectory: mocks.directory,
  listInvitations: async () => [],
}));

import AccountsPage from "./page";

beforeEach(() => {
  mocks.years.mockResolvedValue([]);
  mocks.directory.mockResolvedValue([]);
});

describe("teacher recovery eligibility", () => {
  it.each([
    ["teacher_admin", "active", true],
    ["teacher_admin", "inactive", false],
    ["admin", "active", false],
    ["platform_owner", "active", false],
    [null, "active", false],
  ])("role %s with status %s has recovery option: %s", async (level, status, expected) => {
    mocks.years.mockResolvedValue([
      {
        id: "year",
        label: "2026–2027",
        status: "active",
        start_date: "2026-07-01",
        end_date: "2027-06-30",
      },
    ]);
    mocks.directory.mockResolvedValue([
      {
        profile: { id: "target", email: "teacher@example.edu", full_name: "Test Teacher", status },
        membership: null,
        globalAccessLevel: level,
      },
    ]);
    const html = renderToStaticMarkup(await AccountsPage({ searchParams: Promise.resolve({}) }));
    expect(html.includes('data-recovery-target="target"')).toBe(expected);
  });
});

describe("account invitation notices", () => {
  it("renders delivery failure as an actionable error alert", async () => {
    const page = await AccountsPage({
      searchParams: Promise.resolve({ view: "invitations", notice: "resend-email-failed" }),
    });
    const html = renderToStaticMarkup(page);
    expect(html).toContain('role="alert"');
    expect(html).toContain("text-destructive");
    expect(html).toContain("The email service could not send the invitation.");
    expect(html).toContain("The send count and expiration have not changed.");
  });

  it("explains recovery delivery as a successful send", async () => {
    const page = await AccountsPage({
      searchParams: Promise.resolve({ view: "invitations", notice: "invitation-recovery-sent" }),
    });
    const html = renderToStaticMarkup(page);
    expect(html).toContain('role="status"');
    expect(html).not.toContain('role="alert"');
    expect(html).toContain("A password setup/recovery email was sent");
  });
});
