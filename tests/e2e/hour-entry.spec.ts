import { expect, test } from "@playwright/test";

import { syntheticAccounts } from "./synthetic-accounts";

test("member saves, edits and submits half an hour without a description", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("School email").fill(syntheticAccounts.member.email);
  await page.getByLabel("Password").fill(process.env.E2E_PASSWORD ?? "LocalOnly123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/dashboard(?:\?|$)/);
  await page.goto("/hours/new");

  const title = `Half-hour service ${Date.now()}`;
  const hours = page.getByLabel("Hours", { exact: true });
  await expect(hours).toHaveAttribute("min", "0.5");
  await expect(hours).toHaveAttribute("step", "0.5");
  await expect(hours).toHaveAttribute("inputmode", "decimal");
  await expect(page.locator("#hours-hint")).toHaveCount(0);
  await page.getByLabel("Activity title").fill(title);
  await page.getByLabel("Service category").click();
  await page.getByRole("option", { name: "Green Team", exact: true }).click();
  await page.getByLabel("Service date").fill("2026-08-28");
  await page.getByLabel("Committee head", { exact: true }).click();
  await page
    .getByRole("option", { name: new RegExp(syntheticAccounts.committeeHead.fullName) })
    .click();

  await hours.fill("1.25");
  await page.getByRole("button", { name: "Submit request", exact: true }).click();
  await expect(page.getByText("Check the highlighted fields.", { exact: true })).toBeVisible();
  await expect(page.getByText("Use 0.5-hour increments.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Activity title")).toHaveValue(title);

  await hours.fill(".5");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.waitForURL(/\/hours\/[0-9a-f-]+\/edit\?notice=draft-saved/);
  await page.reload();
  await expect(hours).toHaveValue("0.5");
  await expect(page.getByLabel("Description (optional)")).toHaveValue("");

  await hours.fill("1.5");
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/edit"),
    ),
    page.getByRole("button", { name: "Save draft", exact: true }).click(),
  ]);
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeEnabled();
  await expect(hours).toHaveValue("1.5");
  await page.reload();
  await expect(hours).toHaveValue("1.5");

  await hours.fill(".5");
  await page.getByRole("button", { name: "Submit request", exact: true }).click();
  await page.waitForURL(/\/hours\/[0-9a-f-]+\?notice=submitted/);
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Request submitted.");
  await expect(page.getByText("0.5", { exact: true })).toBeVisible();
});
