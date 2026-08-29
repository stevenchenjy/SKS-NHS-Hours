import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// These workflows intentionally build on shared seeded state. Retrying a late
// test would replay earlier mutations against the same database.
test.describe.configure({ mode: "serial", retries: 0 });

const password = process.env.E2E_PASSWORD ?? "LocalOnly123!";
const assignedTitle = `E2E Park Inventory ${Date.now()}`;
const openQueueTitle = `E2E Food Drive ${Date.now()}`;
const concurrentReviewTitle = `E2E Concurrent Review ${Date.now()}`;
const selfReviewTitle = `E2E Leader Service ${Date.now()}`;
const rolloverLabel = "2027-2028";
const activeSchoolYearId = "10000000-0000-4000-8000-000000000001";
let assignedRequestPath = "";

function requireLoopbackUrl(value: string | undefined, label: string): string {
  if (!value) throw new Error(`${label} is required for portal E2E tests.`);
  const host = new URL(value).hostname;
  if (!["127.0.0.1", "localhost", "[::1]"].includes(host)) {
    throw new Error(`${label} must point to a loopback instance for portal E2E tests.`);
  }
  return value;
}

test.beforeAll(() => {
  requireLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
  requireLoopbackUrl(
    process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    "PLAYWRIGHT_BASE_URL",
  );
});

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("School email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  const renderedError = page.getByRole("alert").filter({ hasText: /\S/ });
  await Promise.race([
    page.waitForURL(/\/(dashboard|account-expired)/),
    renderedError.waitFor({ state: "visible" }).then(async () => {
      const message = await renderedError.textContent();
      throw new Error(`Synthetic sign-in failed for ${email}: ${message?.trim()}`);
    }),
  ]);
}

async function choose(page: Page, label: string, option: RegExp | string) {
  await page.getByLabel(label).click();
  await page.getByRole("option", { name: option }).click();
}

async function openQueueRequest(page: Page, title: string) {
  const resultRow = page.getByRole("row").filter({ hasText: title });
  await expect(resultRow).toHaveCount(1);
  await resultRow.getByRole("button", { name: "Review", exact: true }).click();
}

async function createPartialDraft(): Promise<string> {
  const supabaseUrl = requireLoopbackUrl(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    "NEXT_PUBLIC_SUPABASE_URL",
  );
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is required for E2E tests.");
  }

  const client = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({
    email: "member@example.edu",
    password,
  });
  if (signInError) {
    throw new Error(`Could not authenticate the partial-draft fixture: ${signInError.message}`);
  }

  try {
    const { data, error } = await client.rpc("create_hour_request_draft", {
      p_school_year_id: activeSchoolYearId,
      p_title: null,
      p_description: null,
      p_category_id: null,
      p_service_date: null,
      p_hours: null,
      p_requested_approver_membership_id: null,
      p_client_submission_key: `e2e-partial-${crypto.randomUUID()}`,
    });
    if (error) throw new Error(`Could not create the partial-draft fixture: ${error.message}`);
    const draft = Array.isArray(data) ? data[0] : data;
    if (!draft || typeof draft !== "object" || !("id" in draft) || typeof draft.id !== "string") {
      throw new Error("The partial-draft fixture did not return a request ID.");
    }
    return draft.id;
  } finally {
    await client.auth.signOut();
  }
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
  assignedRequestPath = new URL(page.url()).pathname;
  await expect(page.getByText("Request submitted.")).toBeVisible();
  await expect(page.getByText("Requested approver", { exact: true }).locator("..")).toContainText(
    "Riley Reviewer",
  );
  await expect(page.getByText("Actual reviewer", { exact: true }).locator("..")).toContainText(
    "Not yet reviewed",
  );
  await page.goto("/dashboard");
  const assignedRow = page.getByRole("row").filter({ hasText: assignedTitle });
  await expect(assignedRow).toHaveCount(1);
  await expect(assignedRow).toContainText("Pending");
});

test("member dashboard renders and edits an intentionally partial draft", async ({ page }) => {
  const draftId = await createPartialDraft();
  await login(page, "member@example.edu");
  await page.goto("/dashboard?status=draft");

  const editLink = page.locator(`a[href="/hours/${draftId}/edit"]`);
  const draftRow = page.getByRole("row").filter({ has: editLink });
  await expect(draftRow).toHaveCount(1);
  await expect(draftRow).toContainText("Untitled draft");
  await expect(draftRow.getByRole("cell").nth(1)).toHaveText("Uncategorized");
  await expect(draftRow.getByRole("cell").nth(2)).toHaveText("—");
  await expect(draftRow.getByRole("cell").nth(3)).toHaveText("—");

  await draftRow.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/hours/${draftId}/edit`));
  await expect(page.getByLabel("Activity title")).toHaveValue("");
  await expect(page.getByLabel("Service date")).toHaveValue("");
  await expect(page.getByLabel("Hours")).toHaveValue("");
  await page.getByLabel("Activity title").fill("Partially saved service draft");
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.waitForURL(new RegExp(`/hours/${draftId}/edit\\?notice=draft-saved`));
  await expect(page.getByLabel("Activity title")).toHaveValue("Partially saved service draft");
  await expect(page.getByLabel("Service date")).toHaveValue("");
  await expect(page.getByLabel("Hours")).toHaveValue("");
});

test("requested leader processes the assigned request and progress updates", async ({ page }) => {
  await login(page, "reviewer@example.edu");
  await page.goto(`/admin/requests?scope=assigned&search=${encodeURIComponent(assignedTitle)}`);
  await openQueueRequest(page, assignedTitle);
  await expect(page.getByRole("heading", { name: "Review request" })).toBeVisible();
  await page.getByRole("button", { name: "Approve request" }).click();
  await page.waitForURL(/\/admin\/requests\?notice=decision-recorded/);

  await login(page, "member@example.edu");
  await expect(page.getByText(/15\.75 of 20 approved/)).toBeVisible();
  if (!assignedRequestPath) throw new Error("The assigned request path was not captured.");
  await page.goto(assignedRequestPath);
  await expect(page.getByText("Actual reviewer", { exact: true }).locator("..")).toContainText(
    "Riley Reviewer",
  );
});

test("a different eligible leader processes a request from all pending", async ({ page }) => {
  await login(page, "member@example.edu");
  await submitRequest(page, openQueueTitle);
  const openQueueRequestPath = new URL(page.url()).pathname;
  await login(page, "vice-president@example.edu");
  await page.goto(`/admin/requests?scope=all&search=${encodeURIComponent(openQueueTitle)}`);
  await openQueueRequest(page, openQueueTitle);
  await expect(page.getByText(openQueueTitle)).toBeVisible();
  await page.getByRole("button", { name: "Approve request" }).click();
  await page.waitForURL(/decision-recorded/);

  await login(page, "member@example.edu");
  await page.goto(openQueueRequestPath);
  await expect(page.getByText("Requested approver", { exact: true }).locator("..")).toContainText(
    "Riley Reviewer",
  );
  await expect(page.getByText("Actual reviewer", { exact: true }).locator("..")).toContainText(
    "Val Vice President",
  );
});

test("simultaneous reviewers serialize to one decision", async ({ browser, baseURL, page }) => {
  if (!baseURL) throw new Error("Playwright baseURL is required for the review race test.");

  await login(page, "member@example.edu");
  await submitRequest(page, concurrentReviewTitle);
  const requestId = new URL(page.url()).pathname.split("/").at(-1);
  if (!requestId) throw new Error("Submitted request URL did not contain a request ID.");
  const requestPath = `/admin/requests/${requestId}`;

  const reviewerContext = await browser.newContext({ baseURL });
  const leaderContext = await browser.newContext({ baseURL });
  try {
    const reviewerPage = await reviewerContext.newPage();
    const leaderPage = await leaderContext.newPage();
    await Promise.all([
      login(reviewerPage, "reviewer@example.edu"),
      login(leaderPage, "vice-president@example.edu"),
    ]);
    await Promise.all([reviewerPage.goto(requestPath), leaderPage.goto(requestPath)]);
    await Promise.all([
      expect(reviewerPage.getByText(concurrentReviewTitle)).toBeVisible(),
      expect(leaderPage.getByText(concurrentReviewTitle)).toBeVisible(),
    ]);

    await Promise.all([
      reviewerPage.getByRole("button", { name: "Approve request" }).click(),
      leaderPage.getByRole("button", { name: "Approve request" }).click(),
    ]);

    const pages = [reviewerPage, leaderPage];
    await expect
      .poll(() => pages.filter((candidate) => candidate.url().includes("decision-recorded")).length)
      .toBe(1);
    await expect
      .poll(async () => {
        const conflicts = await Promise.all(
          pages.map((candidate) =>
            candidate
              .getByRole("alert")
              .filter({ hasText: "This request is no longer pending" })
              .isVisible()
              .catch(() => false),
          ),
        );
        return conflicts.filter(Boolean).length;
      })
      .toBe(1);
  } finally {
    await Promise.all([reviewerContext.close(), leaderContext.close()]);
  }

  await page.goto(`/hours/${requestId}`);
  const requestHistory = page.getByRole("region", { name: "Request history" });
  await expect(requestHistory.getByText("approved", { exact: true })).toHaveCount(1);
  await expect(page.getByText("Actual reviewer", { exact: true }).locator("..")).toContainText(
    /Riley Reviewer|Val Vice President/,
  );
});

test("self-review controls are denied for a leader's own request", async ({ page }) => {
  await login(page, "leader@example.edu");
  await submitRequest(page, selfReviewTitle);
  await page.goto(`/admin/requests?scope=all&search=${encodeURIComponent(selfReviewTitle)}`);
  await openQueueRequest(page, selfReviewTitle);
  await expect(page.getByRole("heading", { name: "Self-review is prohibited" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve request" })).toHaveCount(0);
});

test("changes-requested activity returns to the member for editing and resubmission", async ({
  page,
}) => {
  await login(page, "member@example.edu");
  await page.goto("/hours/40000000-0000-4000-8000-000000000004/edit");
  await expect(page.getByRole("heading", { name: "Update and resubmit" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reviewer feedback" })).toBeVisible();
  await expect(page.getByText("Please add the supervising organization.")).toBeVisible();
  await page
    .getByLabel("What service did you perform?")
    .fill("Sorted pantry donations after school under the supervision of Community Pantry staff.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL(/notice=changes-saved/);
  await expect(page.getByRole("status")).toContainText("Changes saved");
  await expect(page.getByText("Please add the supervising organization.")).toBeVisible();
  await expect(page.getByLabel("What service did you perform?")).toHaveValue(
    "Sorted pantry donations after school under the supervision of Community Pantry staff.",
  );
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
  await page.getByRole("button", { name: "Open", exact: true }).click();
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
  await openQueueRequest(page, mobileTitle);
  await expect(page.getByRole("button", { name: "Approve request" })).toBeInViewport();
  await page.getByRole("button", { name: "Approve request" }).click();
  await page.waitForURL(/decision-recorded/);
});
