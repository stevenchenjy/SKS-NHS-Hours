import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { syntheticAccounts } from "./synthetic-accounts";

// These workflows intentionally build on shared seeded state. Retrying a late
// test would replay earlier mutations against the same database.
test.describe.configure({ mode: "serial", retries: 0 });

const password = process.env.E2E_PASSWORD ?? "LocalOnly123!";
const assignedTitle = `E2E Park Inventory ${Date.now()}`;
const concurrentReviewTitle = `E2E Concurrent Review ${Date.now()}`;
const overRequirementTitle = `E2E Over Requirement ${Date.now()}`;
const volunteerEventTitle = `E2E Volunteer Shift ${Date.now()}`;
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
  // Wait for the final role-specific page, not an intermediate dashboard redirect.
  const destination =
    email === syntheticAccounts.platformOwner.email
      ? /\/admin\/members(?:\?|$)/
      : email === syntheticAccounts.expiredMember.email
        ? /\/account-expired(?:\?|$)/
        : /\/dashboard(?:\?|$)/;
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
  await expect(
    page.getByText(
      `${Number(approvedPercentage.toFixed(2))}% approved · ${Number(pendingPercentage.toFixed(2))}% pending`,
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  await expect(progress.locator('[data-progress-segment="approved"]')).toHaveAttribute(
    "style",
    new RegExp(`width:\\s*${String(approvedWidth).replace(".", "\\.")}%`),
  );
  await expect
    .poll(async () => {
      const style = await progress
        .locator('[data-progress-segment="pending"]')
        .getAttribute("style");
      return Number(style?.match(/width:\s*([\d.]+)/)?.[1]);
    })
    .toBeCloseTo(pendingWidth, 3);
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
  hours = "1",
) {
  await page.goto("/hours/new");
  await page.getByLabel("Activity title").fill(title);
  await page
    .getByLabel("Description (optional)")
    .fill("Recorded and organized supplies for a supervised community service activity.");
  await choose(page, "Service category", "Green Team");
  await page.getByLabel("Service date").fill("2026-08-28");
  await page.getByLabel("Hours").fill(hours);
  await choose(page, "Committee head", reviewer);
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
    "12.5 of 35 approved · 3.25 pending · 22.5 approved hours remaining",
    35.71,
    (3.25 / 35) * 100,
  );
  await submitRequest(
    page,
    assignedTitle,
    new RegExp(syntheticAccounts.committeeHead.fullName),
    "3",
  );
  assignedRequestPath = new URL(page.url()).pathname;
  await expect(page.getByText("Request submitted.")).toBeVisible();
  await expect(
    page.getByText("Selected committee head", { exact: true }).locator(".."),
  ).toContainText(syntheticAccounts.committeeHead.fullName);
  await expect(
    page.getByText("Final teacher reviewer", { exact: true }).locator(".."),
  ).toContainText("Not yet reviewed");
  await page.goto("/dashboard");
  await expectProgressSummary(
    page,
    "12.5 of 35 approved · 6.25 pending · 22.5 approved hours remaining",
    35.71,
    (6.25 / 35) * 100,
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

test("selected committee head completes the first approval without approving hours", async ({
  page,
}) => {
  await login(page, syntheticAccounts.committeeHead.email);
  await page.goto(`/admin/requests?scope=assigned&search=${encodeURIComponent(assignedTitle)}`);
  await openQueueRequest(page, assignedTitle);
  await expect(page.getByRole("heading", { name: "Review request" })).toBeVisible();
  await page.getByRole("button", { name: "Approve and send to teachers" }).click();
  await page.waitForURL(/\/admin\/requests\/.+\?notice=decision-recorded/);
  await expect(page.getByRole("status")).toContainText("The committee-head approval was recorded.");

  await login(page, syntheticAccounts.member.email);
  await expectProgressSummary(
    page,
    "12.5 of 35 approved · 6.25 pending · 22.5 approved hours remaining",
    35.71,
    (6.25 / 35) * 100,
  );
  if (!assignedRequestPath) throw new Error("The assigned request path was not captured.");
  await page.goto(assignedRequestPath);
  await expect(
    page.getByText("Committee-head approval", { exact: true }).locator(".."),
  ).toContainText("Approved");
  await expect(
    page.getByText("Final teacher reviewer", { exact: true }).locator(".."),
  ).toContainText("Not yet reviewed");
});

test("a teacher gives final approval from the shared teacher queue", async ({ page }) => {
  await login(page, syntheticAccounts.platformOwner.email);
  await expect(page.getByRole("link", { name: "Open My Profile" })).toBeVisible();
  await page.goto(`/admin/requests?search=${encodeURIComponent(assignedTitle)}`);
  await openQueueRequest(page, assignedTitle);
  await expect(page.getByText(assignedTitle)).toBeVisible();
  await page.getByRole("button", { name: "Give final approval" }).click();
  await page.waitForURL(/decision-recorded/);

  await login(page, syntheticAccounts.member.email);
  await expectProgressSummary(
    page,
    "15.5 of 35 approved · 3.25 pending · 19.5 approved hours remaining",
    44.29,
    (3.25 / 35) * 100,
  );
  if (!assignedRequestPath) throw new Error("The assigned request path was not captured.");
  await page.goto(assignedRequestPath);
  await expect(
    page.getByText("Selected committee head", { exact: true }).locator(".."),
  ).toContainText(syntheticAccounts.committeeHead.fullName);
  await expect(
    page.getByText("Final teacher reviewer", { exact: true }).locator(".."),
  ).toContainText(syntheticAccounts.platformOwner.fullName);
});

test("simultaneous reviewers serialize to one decision", async ({ browser, baseURL, page }) => {
  if (!baseURL) throw new Error("Playwright baseURL is required for the review race test.");

  await login(page, syntheticAccounts.member.email);
  await submitRequest(page, concurrentReviewTitle);
  const requestId = new URL(page.url()).pathname.split("/").at(-1);
  if (!requestId) throw new Error("Submitted request URL did not contain a request ID.");
  const requestPath = `/admin/requests/${requestId}`;

  await login(page, syntheticAccounts.committeeHead.email);
  await page.goto(requestPath);
  await page.getByRole("button", { name: "Approve and send to teachers" }).click();
  await page.waitForURL(/decision-recorded/);

  const firstTeacherContext = await browser.newContext({ baseURL });
  const secondTeacherContext = await browser.newContext({ baseURL });
  try {
    const firstTeacherPage = await firstTeacherContext.newPage();
    const secondTeacherPage = await secondTeacherContext.newPage();
    await Promise.all([
      login(firstTeacherPage, syntheticAccounts.platformOwner.email),
      login(secondTeacherPage, syntheticAccounts.platformOwner.email),
    ]);
    await Promise.all([firstTeacherPage.goto(requestPath), secondTeacherPage.goto(requestPath)]);
    await Promise.all([
      expect(firstTeacherPage.getByText(concurrentReviewTitle)).toBeVisible(),
      expect(secondTeacherPage.getByText(concurrentReviewTitle)).toBeVisible(),
    ]);

    await Promise.all([
      firstTeacherPage.getByRole("button", { name: "Give final approval" }).click(),
      secondTeacherPage.getByRole("button", { name: "Give final approval" }).click(),
    ]);

    const pages = [firstTeacherPage, secondTeacherPage];
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
    await Promise.all([firstTeacherContext.close(), secondTeacherContext.close()]);
  }

  await page.goto(`/hours/${requestId}`);
  const requestHistory = page.getByRole("region", { name: "Request history" });
  await expect(requestHistory.getByText("approved", { exact: true })).toHaveCount(1);
  await expect(
    page.getByText("Final teacher reviewer", { exact: true }).locator(".."),
  ).toContainText(syntheticAccounts.platformOwner.fullName);
});

test("a committee head can approve their own hours before a teacher gives final approval", async ({
  page,
}) => {
  const title = `E2E Committee Self Approval ${Date.now()}`;
  await login(page, syntheticAccounts.committeeHead.email);
  await submitRequest(page, title, new RegExp(syntheticAccounts.committeeHead.fullName), "2");
  const memberPath = new URL(page.url()).pathname;
  await page.getByRole("button", { name: "Review my request", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review request", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reject request", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Request changes", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Approve and send to teachers", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("The committee-head approval was recorded.");
  await expect(page.getByText("Pending teacher approval", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Give final approval", exact: true })).toHaveCount(
    0,
  );
  await page.goto(memberPath);
  await expect(page.getByRole("button", { name: "Review my request", exact: true })).toHaveCount(0);
  await expect(
    page.getByText("Final teacher reviewer", { exact: true }).locator(".."),
  ).toContainText("Not yet reviewed");

  await login(page, syntheticAccounts.platformOwner.email);
  await page.goto(`/admin/requests?search=${encodeURIComponent(title)}`);
  await openQueueRequest(page, title);
  await page.getByRole("button", { name: "Give final approval", exact: true }).click();
  await page.waitForURL(/decision-recorded/);
  await login(page, syntheticAccounts.committeeHead.email);
  await page.goto(memberPath);
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Final teacher reviewer", { exact: true }).locator(".."),
  ).toContainText(syntheticAccounts.platformOwner.fullName);
});

test("president and vice president cannot open the review queue without committee-head access", async ({
  page,
}) => {
  await login(page, syntheticAccounts.leaderMember.email);
  await page.goto("/admin/requests");
  await expect(page).toHaveURL(/\/dashboard\?notice=not-authorized/);
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
    .getByLabel("Description (optional)")
    .fill("Sorted pantry donations after school under the supervision of Community Pantry staff.");
  // Legacy requests can contain fractional hours; edits must use whole hours.
  await expect(page.getByLabel("Hours")).toHaveValue("1.5");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByText("Enter whole hours only (for example, 1, 2, or 3).", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Hours").fill("2");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL(/notice=changes-saved/);
  await expect(page.getByRole("status")).toContainText("Changes saved");
  await expect(page.getByText("Please add the supervising organization.")).toBeVisible();
  await expect(page.getByLabel("Description (optional)")).toHaveValue(
    "Sorted pantry donations after school under the supervision of Community Pantry staff.",
  );
  await page.getByRole("button", { name: "Resubmit request" }).click();
  await page.waitForURL(/notice=submitted/);
  await expect(page.getByText("Pending committee head", { exact: true })).toBeVisible();
});

test("above-target member sees accurate totals while the stacked visual remains capped", async ({
  page,
}) => {
  await login(page, syntheticAccounts.leaderMember.email);
  // This member has only approved seeded hours. Create an explicit pending
  // request so the capped bar is tested while pending hours remain nonzero.
  await submitRequest(page, `E2E Still Pending ${Date.now()}`);
  await submitRequest(
    page,
    overRequirementTitle,
    new RegExp(syntheticAccounts.committeeHead.fullName),
    "24",
  );

  await login(page, syntheticAccounts.committeeHead.email);
  await page.goto(
    `/admin/requests?scope=assigned&search=${encodeURIComponent(overRequirementTitle)}`,
  );
  await openQueueRequest(page, overRequirementTitle);
  await page.getByRole("button", { name: "Approve and send to teachers" }).click();
  await page.waitForURL(/decision-recorded/);

  await login(page, syntheticAccounts.platformOwner.email);
  await page.goto(`/admin/requests?search=${encodeURIComponent(overRequirementTitle)}`);
  await openQueueRequest(page, overRequirementTitle);
  await page.getByRole("button", { name: "Give final approval" }).click();
  await page.waitForURL(/decision-recorded/);

  await login(page, syntheticAccounts.leaderMember.email);
  await expectProgressSummary(
    page,
    "36 of 35 approved · 1 pending · 1 approved hours over requirement",
    100,
    0,
    102.86,
    (1 / 35) * 100,
  );
});

test("committee head publishes an event and the FIFO waitlist promotes after a drop", async ({
  page,
  context,
}) => {
  await login(page, syntheticAccounts.committeeHead.email);
  await page.goto("/events");
  await expect(page.getByRole("heading", { name: "Volunteer events" })).toBeVisible();
  await expect(page.getByText("Fall Festival Setup & Welcome Team")).toBeVisible();
  await page.getByRole("button", { name: "Publish event" }).first().click();
  await page.getByLabel("Event title").fill(volunteerEventTitle);
  await page
    .getByLabel("What help is needed?")
    .fill("Set up donation stations and organize supplies for the community collection.");
  await page.getByLabel("Location").fill("School library");
  const eventDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const signupDate = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);
  await page.getByLabel("Starts").fill(`${eventDate}T15:00`);
  await page.getByLabel("Ends").fill(`${eventDate}T17:00`);
  await page.getByLabel("Signup deadline").fill(`${signupDate}T15:00`);
  await page.getByLabel("People needed").fill("1");
  await page.getByRole("button", { name: "Publish event" }).click();
  await page.waitForURL(/\/events\/[0-9a-f-]+\?notice=created/);
  const eventPath = new URL(page.url()).pathname;
  await expect(page.getByRole("status")).toContainText("visible to everyone");

  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy signup link", exact: true }).click();
  await expect(page.getByRole("button", { name: "Link copied", exact: true })).toBeVisible();
  const signupLink = await page.evaluate(() => navigator.clipboard.readText());
  expect(signupLink).toBe(new URL(eventPath, page.url()).href);

  // Follow the emailed URL with no session, then sign in on the resulting page.
  await context.clearCookies();
  await page.goto(signupLink);
  await expect(page).toHaveURL(/\/login\?next=/);
  expect(new URL(page.url()).searchParams.get("next")).toBe(eventPath);
  await page.getByLabel("School email").fill(syntheticAccounts.member.email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(signupLink);
  await expect(page.getByRole("heading", { name: volunteerEventTitle })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy signup link", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await page.waitForURL(/notice=confirmed/);
  await expect(page.getByText("You’re confirmed", { exact: true })).toBeVisible();

  await login(page, syntheticAccounts.leaderMember.email);
  await page.goto(eventPath);
  await page.getByRole("button", { name: "Join waitlist", exact: true }).click();
  await page.waitForURL(/notice=waitlisted/);
  await expect(page.getByText("Waitlist #1", { exact: true })).toBeVisible();

  await login(page, syntheticAccounts.member.email);
  await page.goto(eventPath);
  await page.getByRole("button", { name: "Drop spot", exact: true }).click();
  await page.waitForURL(/notice=dropped/);

  await login(page, syntheticAccounts.leaderMember.email);
  await page.goto(eventPath);
  await expect(page.getByText("You’re confirmed", { exact: true })).toBeVisible();

  await login(page, syntheticAccounts.committeeHead.email);
  await page.goto(eventPath);
  const promotedMember = page.getByRole("row").filter({
    hasText: syntheticAccounts.leaderMember.fullName,
  });
  await expect(promotedMember).toContainText("Confirmed");

  await page.getByRole("button", { name: "Edit event", exact: true }).click();
  await page.getByLabel("Location", { exact: true }).fill("Main gym");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.waitForURL(/notice=updated/);
  await expect(page.getByText("Main gym", { exact: true })).toBeVisible();

  await login(page, syntheticAccounts.leaderMember.email);
  await page.goto("/notifications");
  const eventUpdate = page
    .locator('[data-slot="card"]')
    .filter({ hasText: volunteerEventTitle })
    .filter({ hasText: "Event updated" });
  await expect(eventUpdate).toContainText("Before: School library");
  await expect(eventUpdate).toContainText("Now: Main gym");
  await eventUpdate.getByRole("button", { name: "Mark as read", exact: true }).click();
  await expect(eventUpdate.getByText("Unread", { exact: true })).toHaveCount(0);

  await login(page, syntheticAccounts.committeeHead.email);
  await page.goto(`${eventPath}/edit`);
  await page.getByLabel("Signup deadline").fill("2026-08-01T12:00");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.waitForURL(/notice=updated/);
  await login(page, syntheticAccounts.member.email);
  await page.goto(eventPath);
  await expect(page.getByRole("button", { name: "Signups closed", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Sign up", exact: true })).toHaveCount(0);

  await login(page, syntheticAccounts.committeeHead.email);
  await page.goto(eventPath);
  await page.getByRole("button", { name: "End event", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "End event", exact: true })
    .click();
  await page.waitForURL(/view=past&notice=ended/);
  await expect(page.getByText(volunteerEventTitle, { exact: true })).toBeVisible();
  await page.goto(eventPath);
  await expect(page.getByRole("button", { name: "Edit event", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Delete event", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete event", exact: true })
    .click();
  await page.waitForURL(/notice=deleted/);
  await expect(page.getByText(volunteerEventTitle, { exact: true })).toHaveCount(0);

  await login(page, syntheticAccounts.leaderMember.email);
  await page.goto("/notifications");
  const deletion = page
    .locator('[data-slot="card"]')
    .filter({ hasText: volunteerEventTitle })
    .filter({ hasText: "Event deleted" });
  await expect(deletion).toContainText("Your signup has been cancelled");
  await expect(deletion.getByRole("button", { name: "View event", exact: true })).toHaveCount(0);

  await page.goto("/events?view=past");
  await expect(page.getByText("Freshman Orientation Guides")).toBeVisible();
});

test("platform owner receives global admin navigation and opens a member profile", async ({
  page,
}) => {
  await login(page, syntheticAccounts.platformOwner.email);
  await expect(page).toHaveURL(/\/admin\/members(?:\?|$)/);
  await expect(page.getByRole("link", { name: "Open My Profile" })).toBeVisible();
  await expect(page.getByText("All school years", { exact: true })).toHaveCount(0);
  const primaryNavigation = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(primaryNavigation.getByRole("link", { name: "Dashboard" })).toHaveCount(0);
  await expect(primaryNavigation.getByRole("link", { name: "Log Hours" })).toHaveCount(0);
  await expect(primaryNavigation.getByRole("link", { name: "Events" })).toBeVisible();
  await expect(primaryNavigation.getByRole("link", { name: "My Profile" })).toHaveCount(0);
  await expect(primaryNavigation.getByRole("link", { name: "Member progress" })).toBeVisible();
  await expect(primaryNavigation.getByRole("link", { name: "Audit trail" })).toBeVisible();
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
  await expect(
    page.locator("header").getByText(syntheticAccounts.platformOwner.fullName, { exact: true }),
  ).toBeVisible();
  await page.goto("/admin/settings/school-years");
  const createYear = page.getByRole("region", { name: "Create the next school year" });
  await createYear.getByLabel("Label").fill(rolloverLabel);
  await createYear.getByLabel("Start date").fill("2027-07-01");
  await createYear.getByLabel("End date").fill("2028-06-30");
  await createYear.getByRole("button", { name: "Create draft school year" }).click();
  await expect(
    page.getByText("Draft school year created with the fixed 35-hour member requirement."),
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
  await submitRequest(page, mobileTitle, new RegExp(syntheticAccounts.committeeHead.fullName), "1");
  await expect(page.getByText("Request submitted.")).toBeVisible();

  await login(page, syntheticAccounts.committeeHead.email);
  await page.goto(`/admin/requests?scope=assigned&search=${encodeURIComponent(mobileTitle)}`);
  await openQueueRequest(page, mobileTitle);
  const approveButton = page.getByRole("button", { name: "Approve and send to teachers" });
  await approveButton.scrollIntoViewIfNeeded();
  await expect(approveButton).toBeInViewport();
  await approveButton.click();
  await page.waitForURL(/decision-recorded/);
});
