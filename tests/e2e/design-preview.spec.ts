import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const previewEnabled = process.env.NHS_DESIGN_PREVIEW === "true";
const previewCases = [
  ["member dashboard", "/design-preview?screen=dashboard"],
  ["admin", "/design-preview?screen=admin"],
  ["teacher", "/design-preview?role=teacher_admin&section=member-progress"],
  ["committee head", "/design-preview?screen=review&role=committee_head"],
  ["president / vice president", "/design-preview?screen=review&role=president_vice_president"],
  ["log hours", "/design-preview?screen=log"],
] as const;

test("local design previews have no serious accessibility violations or horizontal overflow", async ({
  page,
}) => {
  test.skip(!previewEnabled, "The local-only design preview is disabled.");

  for (const [name, href] of previewCases) {
    await page.goto(href);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Read-only role preview" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${name} preview horizontal overflow`).toBeLessThanOrEqual(1);

    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(
      accessibility.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact ?? ""),
      ),
      `${name} preview serious or critical accessibility violations`,
    ).toEqual([]);
  }

  await page.goto("/design-preview?screen=dashboard");
  const progress = page.getByRole("progressbar", { name: "Approved service-hour progress" });
  await expect(progress).toHaveAttribute(
    "aria-valuetext",
    "14.5 of 35 approved · 3.25 pending · 20.5 approved hours remaining",
  );
  await expect(page.getByText("41.43% approved · 9.29% pending", { exact: true })).toBeVisible();
  await expect(progress.locator('[data-progress-segment="approved"]')).toHaveAttribute(
    "style",
    /width:\s*41\.43%/,
  );
  await expect(progress.locator('[data-progress-segment="pending"]')).toHaveAttribute(
    "style",
    /width:\s*9\.2857/,
  );
  const legend = page.getByLabel("Progress legend");
  await expect(legend.getByText("Approved", { exact: true })).toBeVisible();
  await expect(legend.getByText("Pending", { exact: true })).toBeVisible();

  await page.goto("/design-preview?screen=admin");
  const adminNavigation = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(adminNavigation.getByRole("link", { name: "Dashboard" })).toHaveCount(0);
  await expect(adminNavigation.getByRole("link", { name: "Log Hours" })).toHaveCount(0);
  await expect(adminNavigation.getByRole("link", { name: "My Profile" })).toHaveCount(0);
  await expect(adminNavigation.getByRole("link", { name: "Audit trail" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open My Profile" })).toBeVisible();
  await expect(page.getByText("All school years", { exact: true })).toHaveCount(0);

  await page.goto("/design-preview?screen=review&role=president_vice_president");
  const leaderNavigation = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(leaderNavigation.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(leaderNavigation.getByRole("link", { name: "Log Hours" })).toBeVisible();
  await expect(leaderNavigation.getByRole("link", { name: "Review requests" })).toHaveCount(0);
  await expect(leaderNavigation.getByRole("link", { name: "Member progress" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open My Profile" })).toBeVisible();

  await page.goto("/design-preview?screen=review&role=committee_head");
  const committeeNavigation = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(
    committeeNavigation.getByRole("link", { name: "Review requests", exact: true }),
  ).toBeVisible();
  await expect(committeeNavigation.getByRole("link", { name: "Member progress" })).toHaveCount(0);

  await page.goto("/design-preview?role=teacher_admin&section=member-progress");
  const teacherNavigation = page.getByRole("navigation", { name: "Primary navigation" });
  for (const name of ["Accounts", "Exports", "Settings", "Audit trail", "Role preview"]) {
    await expect(teacherNavigation.getByRole("link", { name, exact: true })).toHaveCount(0);
  }
  await expect(teacherNavigation.getByRole("link", { name: "Events", exact: true })).toBeVisible();
  await teacherNavigation.getByRole("link", { name: "Review requests", exact: true }).click();
  await expect(page).toHaveURL(/role=teacher_admin&section=review-requests/);

  await page.goto("/design-preview?role=platform_owner&section=member-progress");
  const previewNavigation = page.getByRole("navigation", { name: "Primary navigation" });
  await previewNavigation.getByRole("link", { name: "Accounts" }).click();
  await expect(page).toHaveURL(/\/design-preview\?role=platform_owner&section=accounts/);
  await expect(page.getByRole("heading", { name: "Accounts", exact: true })).toBeVisible();
  await expect(previewNavigation.getByRole("link", { name: "Accounts" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await previewNavigation.getByRole("link", { name: "Exports" }).click();
  await expect(page).toHaveURL(/\/design-preview\?role=platform_owner&section=exports/);
  await expect(page.getByRole("heading", { name: "Exports", exact: true })).toBeVisible();

  await page.goto("/design-preview?role=committee_head&section=dashboard");
  const committeePreviewNavigation = page.getByRole("navigation", { name: "Primary navigation" });
  await committeePreviewNavigation.getByRole("link", { name: "Review requests" }).click();
  await expect(page).toHaveURL(/\/design-preview\?role=committee_head&section=review-requests/);
  await expect(page.getByRole("heading", { name: "Review requests", exact: true })).toBeVisible();

  const toolbar = page.getByRole("complementary", { name: "Read-only role preview" });
  for (const label of [
    "Member",
    "Committee head",
    "President / Vice President",
    "Teacher",
    "Admin",
    "Back to administration",
  ]) {
    await expect(toolbar.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
});

test("@mobile member dashboard and hour form previews remain usable without overflow", async ({
  page,
}) => {
  test.skip(!previewEnabled, "The local-only design preview is disabled.");

  for (const screen of ["dashboard", "log"] as const) {
    await page.goto(`/design-preview?screen=${screen}`);
    await expect(page.locator("main")).toBeVisible();
    const previewToolbar = page.getByRole("complementary", {
      name: "Read-only role preview",
    });
    await expect(previewToolbar).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${screen} preview horizontal overflow`).toBeLessThanOrEqual(1);

    const heading = page.getByRole("heading", {
      name: screen === "dashboard" ? "Your service progress" : "Log service hours",
    });
    const [toolbarBox, headingBox] = await Promise.all([
      previewToolbar.boundingBox(),
      heading.boundingBox(),
    ]);
    expect(toolbarBox, `${screen} preview toolbar bounds`).not.toBeNull();
    expect(headingBox, `${screen} page heading bounds`).not.toBeNull();
    expect(
      headingBox!.y,
      `${screen} page heading should clear the fixed preview toolbar`,
    ).toBeGreaterThanOrEqual(toolbarBox!.y + toolbarBox!.height);
  }

  await expect(page.getByLabel("Activity title")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save draft" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit request" })).toBeVisible();
});
