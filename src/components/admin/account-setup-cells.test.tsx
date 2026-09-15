import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AccountSetupCells } from "./account-setup-cells";

describe("account setup milestones", () => {
  it("does not treat a configured password as evidence of entering the portal", () => {
    const html = renderToStaticMarkup(
      <AccountSetupCells
        status={{ email: "member@example.edu", password_set: true, first_portal_visit_at: null }}
      />,
    );
    expect(html).toContain("Password set");
    expect(html).toContain("No visit recorded");
    expect(html).not.toContain("Entered portal");
  });

  it("shows a recorded visit independently from password setup, with the school timezone", () => {
    const html = renderToStaticMarkup(
      <AccountSetupCells
        status={{
          email: "member@example.edu",
          password_set: false,
          first_portal_visit_at: "2026-09-15T02:00:00.000Z",
        }}
      />,
    );
    expect(html).toContain("Not set");
    expect(html).toContain("Entered portal");
    expect(html).toContain('dateTime="2026-09-15T02:00:00.000Z"');
    expect(html).toContain("Sep 14, 2026, 10:00 PM EDT");
  });

  it("does not label unavailable data as an unfinished account", () => {
    const html = renderToStaticMarkup(<AccountSetupCells status={undefined} />);
    expect(html).toContain("Unavailable");
    expect(html).not.toContain("Not set");
    expect(html).not.toContain("No visit recorded");
  });
});
