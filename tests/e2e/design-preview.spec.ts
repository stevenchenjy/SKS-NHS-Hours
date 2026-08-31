import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const previewEnabled = process.env.NHS_DESIGN_PREVIEW === "true";
const previewCases = [
  ["member dashboard", "/design-preview?screen=dashboard"],
  ["teacher administrator", "/design-preview?screen=admin"],
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
    "14.5 of 20 approved · 3.25 pending · 5.5 approved hours remaining",
  );
  await expect(page.getByText("72.5% approved · 16.25% pending", { exact: true })).toBeVisible();
  await expect(progress.locator('[data-progress-segment="approved"]')).toHaveAttribute(
    "style",
    /width:\s*72\.5%/,
  );
  await expect(progress.locator('[data-progress-segment="pending"]')).toHaveAttribute(
    "style",
    /width:\s*16\.25%/,
  );
  const legend = page.getByLabel("Progress legend");
  await expect(legend.getByText("Approved", { exact: true })).toBeVisible();
  await expect(legend.getByText("Pending", { exact: true })).toBeVisible();

  await page.goto("/design-preview?screen=admin");
  const adminNavigation = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(adminNavigation.getByRole("link", { name: "Dashboard" })).toHaveCount(0);
  await expect(adminNavigation.getByRole("link", { name: "Log Hours" })).toHaveCount(0);
  await expect(adminNavigation.getByRole("link", { name: "My Profile" })).toHaveCount(0);
  await expect(adminNavigation.getByRole("link", { name: "Audit trail" })).toHaveCount(0);
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
  await expect(committeeNavigation.getByRole("link", { name: "Review requests" })).toBeVisible();
  await expect(committeeNavigation.getByRole("link", { name: "Member progress" })).toHaveCount(0);

  const toolbar = page.getByRole("complementary", { name: "Read-only role preview" });
  for (const label of [
    "Member",
    "Committee head",
    "President / Vice President",
    "Teacher administrator",
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
