import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal/access", () => ({ requireTeacherAdmin: async () => ({}) }));
vi.mock("@/lib/dal/portal", () => ({ listSchoolYears: async () => [] }));

import SchoolYearsSettingsPage from "./page";

describe("school year activation feedback", () => {
  it("displays a failed activation instead of silently dropping its notice", async () => {
    const html = renderToStaticMarkup(
      await SchoolYearsSettingsPage({
        searchParams: Promise.resolve({ notice: "Another school year is already active." }),
      }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Another school year is already active.");
  });
  it("confirms a successful activation", async () => {
    const html = renderToStaticMarkup(
      await SchoolYearsSettingsPage({
        searchParams: Promise.resolve({ notice: "school-year-activated" }),
      }),
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("School year activated.");
  });
});
