import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/components/portal/route-refresh", () => ({ RouteRefresh: () => null }));
vi.mock("@/lib/dal/access", () => ({
  requireAdmin: async () => ({ activeMembership: null, isAdmin: true, isPlatformOwner: true }),
}));
vi.mock("@/lib/dal/portal", () => ({
  listSchoolYears: async () => [],
  listAccountDirectory: async () => [],
  listInvitations: async () => [],
}));

import AccountsPage from "./page";

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
