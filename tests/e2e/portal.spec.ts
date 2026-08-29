import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const password = process.env.E2E_PASSWORD ?? "LocalOnly123!";
const assignedTitle = `E2E Park Inventory ${Date.now()}`;
const openQueueTitle = `E2E Food Drive ${Date.now()}`;
const selfReviewTitle = `E2E Leader Service ${Date.now()}`;
const rolloverLabel = "2027-2028";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("School email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(dashboard|account-expired)/);
}

async function choose(page: Page, label: string, option: RegExp | string) {
  await page.getByLabel(label).click();
  await page.getByRole("option", { name: option }).click();
}

async function submitRequest(
  page: Page,
  title: string,
  reviewer: RegExp = /Riley Reviewer/,
  hours = "1.25",
) {
  await page.goto("/hours/new");
  await page.getByLabel("Activity title").fill(title);
  await page
    .getByLabel("What service did you perform?")
    .fill("Recorded and organized supplies for a supervised community service activity.");
  await choose(page, "Service category", "Green Team");
  await page.getByLabel("Service date").fill("2026-08-28");
  await page.getByLabel("Hours").fill(hours);
  await choose(page, "School leader", reviewer);
  await page.getByRole("button", { name: "Submit request" }).click();
  await page.waitForURL(/\/hours\/[0-9a-f-]+\?notice=submitted/);
}

test("member login, dashboard, submission, approver selection, and pending total", async ({
  page,
}) => {
  await login(page, "member@example.edu");
  await expect(page.getByRole("heading", { name: "Your service progress" })).toBeVisible();
  await submitRequest(page, assignedTitle, /Riley Reviewer/, "3.25");
  await expect(page.getByText("Request submitted.")).toBeVisible();
  await page.goto("/dashboard");
  await expect(page.getByText(assignedTitle)).toBeVisible();
  await expect(page.getByText("Pending", { exact: true }).first()).toBeVisible();
});

test("requested leader processes the assigned request and progress updates", async ({ page }) => {
  await login(page, "reviewer@example.edu");
  await page.goto(`/admin/requests?scope=assigned&search=${encodeURIComponent(assignedTitle)}`);
  await page.getByRole("link", { name: "Review" }).click();
  await expect(page.getByRole("heading", { name: "Review request" })).toBeVisible();
  await page.getByRole("button", { name: "Approve request" }).click();
  await page.waitForURL(/\/admin\/requests\?notice=decision-recorded/);

  await login(page, "member@example.edu");
  await expect(page.getByText(/15\.75 of 20 approved/)).toBeVisible();
});

test("a different eligible leader processes a request from all pending", async ({ page }) => {
  await login(page, "member@example.edu");
  await submitRequest(page, openQueueTitle);
  await login(page, "vice-president@example.edu");
  await page.goto(`/admin/requests?scope=all&search=${encodeURIComponent(openQueueTitle)}`);
  await page.getByRole("link", { name: "Review" }).click();
  await expect(page.getByText(openQueueTitle)).toBeVisible();
  await page.getByRole("button", { name: "Approve request" }).click();
  await page.waitForURL(/decision-recorded/);
});

test("self-review controls are denied for a leader's own request", async ({ page }) => {
  await login(page, "leader@example.edu");
  await submitRequest(page, selfReviewTitle);
  await page.goto(`/admin/requests?scope=all&search=${encodeURIComponent(selfReviewTitle)}`);
  await page.getByRole("link", { name: "Review" }).click();
  await expect(page.getByRole("heading", { name: "Self-review is prohibited" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve request" })).toHaveCount(0);
});

test("changes-requested activity returns to the member for editing and resubmission", async ({
  page,
}) => {
  await login(page, "member@example.edu");
  await page.goto("/hours/40000000-0000-4000-8000-000000000004/edit");
  await expect(page.getByRole("heading", { name: "Update and resubmit" })).toBeVisible();
  await page
    .getByLabel("What service did you perform?")
    .fill("Sorted pantry donations after school under the supervision of Community Pantry staff.");
  await page.getByRole("button", { name: "Resubmit request" }).click();
  await page.waitForURL(/notice=submitted/);
  await expect(page.getByText("Pending", { exact: true })).toBeVisible();
});

test("above-target member sees the true percentage and over-goal message", async ({ page }) => {
  await login(page, "leader@example.edu");
  await expect(page.getByText(/120% complete/)).toBeVisible();
  await expect(page.getByText(/2 hours over goal/)).toBeVisible();
});

test("teacher administrator opens the full roster and member profile", async ({ page }) => {
  await login(page, "admin@example.edu");
  await page.goto("/admin/members?search=Morgan+Member");
  await expect(page.getByText("Morgan Member").first()).toBeVisible();
  await page.getByRole("link", { name: "Open" }).click();
  await expect(page.getByRole("heading", { name: "Morgan Member" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Complete service log" })).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
});

test("teacher administrator creates a year and renews an expired membership", async ({ page }) => {
  await login(page, "admin@example.edu");
  await page.goto("/admin/settings/school-years");
  await page.getByLabel("Label").fill(rolloverLabel);
  await page.getByLabel("Start date").fill("2027-07-01");
  await page.getByLabel("End date").fill("2028-06-30");
  await page.getByRole("button", { name: "Create draft school year" }).click();
  await expect(page.getByText(/Draft school year created/)).toBeVisible();
  await page.reload();
  await page
    .getByLabel("User")
    .selectOption({ label: "Emery Expired Member · expired-member@example.edu" });
  await page.getByLabel("New school year").selectOption({ label: `${rolloverLabel} · draft` });
  await page.getByLabel("Expiration date").fill("2028-06-30");
  await page.getByLabel(/4 · Review summary and confirm/).check();
  await page.getByRole("button", { name: "5 · Create membership" }).click();
  await expect(page.getByText(/Membership renewed/)).toBeVisible();
});

test("expired member receives the limited expired-account experience", async ({ page }) => {
  await login(page, "expired-member@example.edu");
  await expect(page).toHaveURL(/\/account-expired/);
  await expect(page.getByRole("heading", { name: /membership is not active/i })).toBeVisible();
  await expect(page.getByText("2026-2027")).toBeVisible();
});

test("ordinary member cannot open leader or teacher-admin routes", async ({ page }) => {
  await login(page, "member@example.edu");
  await page.goto("/admin/accounts");
  await expect(page).toHaveURL(/\/dashboard\?notice=not-authorized/);
});

test("@mobile member submission and leader approval remain usable", async ({ page }) => {
  const mobileTitle = `E2E Mobile Service ${Date.now()}`;
  await login(page, "member@example.edu");
  await submitRequest(page, mobileTitle, /Riley Reviewer/, "0.25");
  await expect(page.getByText("Request submitted.")).toBeVisible();

  await login(page, "reviewer@example.edu");
  await page.goto(`/admin/requests?scope=assigned&search=${encodeURIComponent(mobileTitle)}`);
  await page.getByRole("link", { name: "Review" }).click();
  await expect(page.getByRole("button", { name: "Approve request" })).toBeInViewport();
  await page.getByRole("button", { name: "Approve request" }).click();
  await page.waitForURL(/decision-recorded/);
});
