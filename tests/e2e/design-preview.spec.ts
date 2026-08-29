import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const previewEnabled = process.env.NHS_DESIGN_PREVIEW === "true";

test("local design previews have no serious accessibility violations or horizontal overflow", async ({
  page,
}) => {
  test.skip(!previewEnabled, "The local-only design preview is disabled.");

  for (const screen of ["dashboard", "admin", "review", "log"] as const) {
    await page.goto(`/design-preview?screen=${screen}`);
    await expect(page.locator("main")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${screen} preview horizontal overflow`).toBeLessThanOrEqual(1);

    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(
      accessibility.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact ?? ""),
      ),
      `${screen} preview serious or critical accessibility violations`,
    ).toEqual([]);
  }
});

test("@mobile member dashboard and hour form previews remain usable without overflow", async ({
  page,
}) => {
  test.skip(!previewEnabled, "The local-only design preview is disabled.");

  for (const screen of ["dashboard", "log"] as const) {
    await page.goto(`/design-preview?screen=${screen}`);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${screen} preview horizontal overflow`).toBeLessThanOrEqual(1);
  }

  await expect(page.getByLabel("Activity title")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save draft" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit request" })).toBeVisible();
});
