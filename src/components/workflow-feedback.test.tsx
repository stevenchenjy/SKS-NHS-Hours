import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { state } = vi.hoisted(() => ({ state: { current: {} as Record<string, unknown> } }));
vi.mock("server-only", () => ({}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useActionState: () => [state.current, () => {}, false],
}));

import { HourRequestForm } from "./hours/hour-request-form";
import { CorrectionForm } from "./admin/correction-form";
import { EventNotice } from "./events/event-notice";
import type { HourRequest } from "@/lib/types";

beforeEach(() => {
  state.current = {};
});

describe("workflow feedback", () => {
  it("posts the latest saved ID and revision after submission fails", () => {
    state.current = {
      savedRequest: { id: "saved-id", revision: 3 },
      error: "Draft saved, submission failed",
    };
    const html = renderToStaticMarkup(
      <HourRequestForm
        schoolYearId="year"
        schoolYearLabel="2026-2027"
        categories={[]}
        reviewers={[]}
        submissionKey="key"
      />,
    );
    expect(html).toContain('name="request_id" value="saved-id"');
    expect(html).toContain('name="revision" value="3"');
    expect(html).toContain("Draft saved, submission failed");
  });

  it("shows correction validation errors for fields other than the reason", () => {
    state.current = { fieldErrors: { hours: ["Use quarter hours"], title: ["Enter a title"] } };
    const html = renderToStaticMarkup(
      <CorrectionForm request={{ id: "id" } as HourRequest} categories={[]} />,
    );
    expect(html).toContain("Use quarter hours");
    expect(html).toContain("Enter a title");
    expect(html).toContain("Description (optional)");
    expect(html).not.toMatch(/<textarea[^>]*name="description"[^>]*required/);
  });

  it.each([
    "signup-failed",
    "signup-unconfirmed",
    "drop-failed",
    "not-authorized",
    "publisher-required",
    "invalid-event",
  ])("shows %s as an error", (notice) => {
    expect(renderToStaticMarkup(<EventNotice notice={notice} />)).toContain('role="alert"');
  });

  it.each(["confirmed", "waitlisted", "dropped"])("shows %s as a successful status", (notice) => {
    expect(renderToStaticMarkup(<EventNotice notice={notice} />)).toContain('role="status"');
  });
});
