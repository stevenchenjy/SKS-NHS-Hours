import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { syntheticAccounts } from "./synthetic-accounts";

// These workflows intentionally build on shared seeded state. Retrying a late
// test would replay earlier mutations against the same database.
test.describe.configure({ mode: "serial", retries: 0 });

const password = process.env.E2E_PASSWORD ?? "LocalOnly123!";
const assignedTitle = `E2E Park Inventory ${Date.now()}`;
const openQueueTitle = `E2E Food Drive ${Date.now()}`;
const concurrentReviewTitle = `E2E Concurrent Review ${Date.now()}`;
const selfReviewTitle = `E2E Leader Service ${Date.now()}`;
const overRequirementTitle = `E2E Over Requirement ${Date.now()}`;
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
  const destination = /\/(dashboard|admin|account-expired)/;
  await page.goto("/login");
  await page.getByLabel("School email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  const renderedError = page.getByRole("alert").filter({ hasText: /\S/ });
  await Promise.race([
    page.waitForURL(destination),
    renderedError.waitFor({ state: "visible" }).then(async () => {
      const message = await renderedError.textContent();
      throw new Error(`Synthetic sign-in failed for ${email}: ${message?.trim()}`);
    }),
  ]);
  // A full request confirms the server can read the cookie set by the login
  // action before the test interacts with the destination page.
  await page.reload();
  await page.waitForURL(destination);
}

async function expectProgressSummary(
  page: Page,
  summary: string,
  approvedWidth: number,
  pendingWidth: number,
  approvedPercentage = approvedWidth,
  pendingPercentage = pendingWidth,
) {
  const progress = page.getByRole("progressbar", { name: "Approved service-hour progress" });
  await expect(progress).toHaveAttribute("aria-valuetext", summary);
  await expect(page.getByText(summary, { exact: true })).toBeVisible();
  await expect(
    page.getByText(`${approvedPercentage}% approved · ${pendingPercentage}% pending`, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(progress.locator('[data-progress-segment="approved"]')).toHaveAttribute(
    "style",
    new RegExp(`width:\\s*${String(approvedWidth).replace(".", "\\.")}%`),
  );
  await expect(progress.locator('[data-progress-segment="pending"]')).toHaveAttribute(
    "style",
    new RegExp(`width:\\s*${String(pendingWidth).replace(".", "\\.")}%`),
  );
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
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!publishableKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required for E2E tests.");
  }

  const client = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({
    email: syntheticAccounts.member.email,
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
  reviewer: RegExp = new RegExp(syntheticAccounts.committeeHead.fullName),
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
  await login(page, syntheticAccounts.member.email);
  await expect(page.getByRole("heading", { name: "Your service progress" })).toBeVisible();
  await expectProgressSummary(
    page,
    "12.5 of 20 approved · 3.25 pending · 7.5 approved hours remaining",
    62.5,
    16.25,
  );
  await submitRequest(
    page,
    assignedTitle,
    new RegExp(syntheticAccounts.committeeHead.fullName),
    "3.25",
  );
  assignedRequestPath = new URL(page.url()).pathname;
  await expect(page.getByText("Request submitted.")).toBeVisible();
  await expect(page.getByText("Requested approver", { exact: true }).locator("..")).toContainText(
    syntheticAccounts.committeeHead.fullName,
  );
  await expect(page.getByText("Actual reviewer", { exact: true }).locator("..")).toContainText(
    "Not yet reviewed",
  );
  await page.goto("/dashboard");
  await expectProgressSummary(
    page,
    "12.5 of 20 approved · 6.5 pending · 7.5 approved hours remaining",
    62.5,
    32.5,
  );
  const assignedRow = page.getByRole("row").filter({ hasText: assignedTitle });
  await expect(assignedRow).toHaveCount(1);
  await expect(assignedRow).toContainText("Pending");
});

test("member dashboard renders and edits an intentionally partial draft", async ({ page }) => {
  const draftId = await createPartialDraft();
  await login(page, syntheticAccounts.member.email);
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
  await login(page, syntheticAccounts.committeeHead.email);
  await page.goto(`/admin/requests?scope=assigned&search=${encodeURIComponent(assignedTitle)}`);
  await openQueueRequest(page, assignedTitle);
  await expect(page.getByRole("heading", { name: "Review request" })).toBeVisible();
  await page.getByRole("button", { name: "Approve request" }).click();
  await page.waitForURL(/\/admin\/requests\?notice=decision-recorded/);

  await login(page, syntheticAccounts.member.email);
  await expectProgressSummary(
    page,
    "15.75 of 20 approved · 3.25 pending · 4.25 approved hours remaining",
    78.75,
    16.25,
  );
  if (!assignedRequestPath) throw new Error("The assigned request path was not captured.");
  await page.goto(assignedRequestPath);
  await expect(page.getByText("Actual reviewer", { exact: true }).locator("..")).toContainText(
    syntheticAccounts.committeeHead.fullName,
  );
});

test("a different eligible leader processes a request from all pending", async ({ page }) => {
  await login(page, syntheticAccounts.member.email);
  await submitRequest(page, openQueueTitle);
  const openQueueRequestPath = new URL(page.url()).pathname;
  await login(page, syntheticAccounts.presidentVicePresident.email);
  await expect(page.locator("header").getByText("President / Vice President")).toBeVisible();
  await page.goto(`/admin/requests?scope=all&search=${encodeURIComponent(openQueueTitle)}`);
  await openQueueRequest(page, openQueueTitle);
  await expect(page.getByText(openQueueTitle)).toBeVisible();
  await page.getByRole("button", { name: "Approve request" }).click();
  await page.waitForURL(/decision-recorded/);

  await login(page, syntheticAccounts.member.email);
  await page.goto(openQueueRequestPath);
  await expect(page.getByText("Requested approver", { exact: true }).locator("..")).toContainText(
    syntheticAccounts.committeeHead.fullName,
  );
  await expect(page.getByText("Actual reviewer", { exact: true }).locator("..")).toContainText(
    syntheticAccounts.presidentVicePresident.fullName,
  );
});

test("simultaneous reviewers serialize to one decision", async ({ browser, baseURL, page }) => {
  if (!baseURL) throw new Error("Playwright baseURL is required for the review race test.");

  await login(page, syntheticAccounts.member.email);
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
      login(reviewerPage, syntheticAccounts.committeeHead.email),
      login(leaderPage, syntheticAccounts.presidentVicePresident.email),
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
    new RegExp(
      `${syntheticAccounts.committeeHead.fullName}|${syntheticAccounts.presidentVicePresident.fullName}`,
    ),
  );
});

test("self-review controls are denied for a leader's own request", async ({ page }) => {
  await login(page, syntheticAccounts.leaderMember.email);
  await submitRequest(page, selfReviewTitle);
  await page.goto(`/admin/requests?scope=all&search=${encodeURIComponent(selfReviewTitle)}`);
  await openQueueRequest(page, selfReviewTitle);
  await expect(page.getByRole("heading", { name: "Self-review is prohibited" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve request" })).toHaveCount(0);
});

test("changes-requested activity returns to the member for editing and resubmission", async ({
  page,
}) => {
  await login(page, syntheticAccounts.member.email);
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

test("above-target member sees accurate totals while the stacked visual remains capped", async ({
  page,
}) => {
  await login(page, syntheticAccounts.leaderMember.email);
  await submitRequest(
    page,
    overRequirementTitle,
    new RegExp(syntheticAccounts.committeeHead.fullName),
    "9",
  );

  await login(page, syntheticAccounts.committeeHead.email);
  await page.goto(
    `/admin/requests?scope=assigned&search=${encodeURIComponent(overRequirementTitle)}`,
  );
  await openQueueRequest(page, overRequirementTitle);
  await page.getByRole("button", { name: "Approve request" }).click();
  await page.waitForURL(/decision-recorded/);

  await login(page, syntheticAccounts.leaderMember.email);
  await expectProgressSummary(
    page,
    "21 of 20 approved · 1.25 pending · 1 approved hours over requirement",
    100,
    0,
    105,
    6.25,
  );
});

test("platform owner receives global admin navigation and opens a member profile", async ({
  page,
}) => {
  await login(page, syntheticAccounts.platformOwner.email);
  await expect(page).toHaveURL(/\/admin\/members(?:\?|$)/);
  await expect(page.locator("header").getByText("Platform owner", { exact: true })).toBeVisible();
  await expect(page.getByText("All school years", { exact: true })).toBeVisible();
  const primaryNavigation = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(primaryNavigation.getByRole("link", { name: "Dashboard" })).toHaveCount(0);
  await expect(primaryNavigation.getByRole("link", { name: "Log Hours" })).toHaveCount(0);
  await expect(primaryNavigation.getByRole("link", { name: "My Profile" })).toHaveCount(0);
  await expect(primaryNavigation.getByRole("link", { name: "Member progress" })).toBeVisible();
  await expect(primaryNavigation.getByRole("link", { name: "Role preview" })).toBeVisible();

  await page.goto("/admin/members?search=Morgan+Member");
  await expect(page.getByText(syntheticAccounts.member.fullName).first()).toBeVisible();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: syntheticAccounts.member.fullName }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Complete service log" })).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);

  await page.goto("/admin/accounts?view=invitations");
  await expect(page.getByRole("heading", { name: "Invitation activity" })).toBeVisible();
  await expect(
    page.getByText(/Invitations are for people who have not activated an account/),
  ).toBeVisible();

  await page.goto("/admin/settings/roles");
  await expect(page).toHaveURL(/\/admin\/accounts\?view=directory/);
  await page.goto("/admin/settings/targets");
  await expect(page).toHaveURL(/\/admin\/accounts\?view=directory/);
});

test("platform owner creates a year and assigns the next leadership team", async ({ page }) => {
  await login(page, syntheticAccounts.platformOwner.email);
  await expect(page.locator("header").getByText("Platform owner", { exact: true })).toBeVisible();
  await page.goto("/admin/settings/school-years");
  const createYear = page.getByRole("region", { name: "Create the next school year" });
  await createYear.getByLabel("Label").fill(rolloverLabel);
  await createYear.getByLabel("Start date").fill("2027-07-01");
  await createYear.getByLabel("End date").fill("2028-06-30");
  await createYear.getByRole("button", { name: "Create draft school year" }).click();
  await expect(
    page.getByText("Draft school year created with the fixed 20-hour member requirement."),
  ).toBeVisible();
  const createdYear = page.getByRole("article").filter({ hasText: rolloverLabel });
  await expect(createdYear.getByRole("button", { name: "Close year" })).toHaveCount(0);
  await createdYear.getByLabel("Start date").fill("2027-08-01");
  await createdYear.getByLabel("End date").fill("2028-07-31");
  await createdYear.getByRole("button", { name: "Save dates" }).click();
  await expect(createdYear.getByText("School-year dates updated.")).toBeVisible();
  await expect(createdYear.getByLabel("Start date")).toHaveValue("2027-08-01");
  await expect(createdYear.getByLabel("End date")).toHaveValue("2028-07-31");

  await page.goto("/admin/accounts?view=add");
  const yearSwitcher = page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "View", exact: true }) });
  await yearSwitcher.getByLabel("School year").selectOption({ label: rolloverLabel });
  await yearSwitcher.getByRole("button", { name: "View", exact: true }).click();

  const existingAccount = page.getByRole("region", {
    name: "Add an existing account to a school year",
  });
  await existingAccount.getByLabel("Existing account").selectOption({
    label: `${syntheticAccounts.expiredMember.fullName} · ${syntheticAccounts.expiredMember.email}`,
  });
  await existingAccount.getByLabel("School-year access").selectOption("president_vice_president");
  await existingAccount.getByRole("button", { name: "Add to school year" }).click();
  await expect(
    existingAccount.getByText("The existing account now has access to the selected school year."),
  ).toBeVisible();
});

test("expired member receives the limited expired-account experience", async ({ page }) => {
  await login(page, syntheticAccounts.expiredMember.email);
  await expect(page).toHaveURL(/\/account-expired/);
  await expect(page.getByRole("heading", { name: /membership is not active/i })).toBeVisible();
  await expect(page.getByText(rolloverLabel)).toBeVisible();
});

test("ordinary member cannot open leader or teacher-admin routes", async ({ page }) => {
  await login(page, syntheticAccounts.member.email);
  await page.goto("/admin/accounts");
  await expect(page).toHaveURL(/\/dashboard\?notice=not-authorized/);
});

test("@mobile member submission and leader approval remain usable", async ({ page }) => {
  const mobileTitle = `E2E Mobile Service ${Date.now()}`;
  await login(page, syntheticAccounts.member.email);
  await submitRequest(
    page,
    mobileTitle,
    new RegExp(syntheticAccounts.committeeHead.fullName),
    "0.25",
  );
  await expect(page.getByText("Request submitted.")).toBeVisible();

  await login(page, syntheticAccounts.committeeHead.email);
  await page.goto(`/admin/requests?scope=assigned&search=${encodeURIComponent(mobileTitle)}`);
  await openQueueRequest(page, mobileTitle);
  const approveButton = page.getByRole("button", { name: "Approve request" });
  await approveButton.scrollIntoViewIfNeeded();
  await expect(approveButton).toBeInViewport();
  await approveButton.click();
  await page.waitForURL(/decision-recorded/);
});
