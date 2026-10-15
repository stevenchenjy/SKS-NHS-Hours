import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BulkApprovalResult } from "../../src/lib/domain/bulk-approval";
import { syntheticAccounts } from "./synthetic-accounts";

const password = process.env.E2E_PASSWORD ?? "LocalOnly123!";
const schoolYearId = "10000000-0000-4000-8000-000000000001";
const categoryId = "30000000-0000-4000-8000-000000000001";
const headId = "20000000-0000-4000-8000-000000000002";
const memberId = "20000000-0000-4000-8000-000000000003";

function localUrl(value: string | undefined): string {
  if (!value || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(value).hostname)) {
    throw new Error("Bulk approval browser tests require loopback application and Supabase URLs.");
  }
  return value;
}

test.beforeAll(() => {
  localUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  localUrl(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000");
});

async function clientFor(email: string): Promise<SupabaseClient> {
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!key) throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required.");
  const client = createClient(localUrl(process.env.NEXT_PUBLIC_SUPABASE_URL), key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Synthetic sign-in failed: ${error.message}`);
  return client;
}

interface FixtureRequest {
  id: string;
  title: string;
  hours: number;
}

async function createRequests(prefix: string, hours: number[]): Promise<FixtureRequest[]> {
  const member = await clientFor(syntheticAccounts.member.email);
  const head = await clientFor(syntheticAccounts.committeeHead.email);
  try {
    const requests: FixtureRequest[] = [];
    for (const [index, amount] of hours.entries()) {
      const title = `${prefix} activity ${index + 1}`;
      const draft = await member.rpc("create_hour_request_draft", {
        p_school_year_id: schoolYearId,
        p_category_id: categoryId,
        p_requested_approver_membership_id: headId,
        p_title: title,
        p_description: "Fictional supervised service for the local bulk-approval browser test.",
        p_service_date: "2026-08-28",
        p_hours: amount,
        p_client_submission_key: crypto.randomUUID(),
      });
      if (draft.error) throw draft.error;
      const row = (Array.isArray(draft.data) ? draft.data[0] : draft.data) as {
        id: string;
        revision: number;
      };
      const submitted = await member.rpc("submit_hour_request", {
        p_request_id: row.id,
        p_expected_revision: row.revision,
      });
      if (submitted.error) throw submitted.error;
      const approved = await head.rpc("review_hour_request", {
        p_request_id: row.id,
        p_action: "approve",
      });
      if (approved.error) throw approved.error;
      requests.push({ id: row.id, title, hours: amount });
    }
    return requests;
  } finally {
    await Promise.all([member.auth.signOut(), head.auth.signOut()]);
  }
}

async function loginTeacher(page: Page) {
  await page.goto("/login");
  await page.getByLabel("School email").fill(syntheticAccounts.teacher.email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/admin\/members(?:\?|$)/);
  await page.reload();
}

async function snapshots(client: SupabaseClient, requests: FixtureRequest[]) {
  const { data, error } = await client
    .from("hour_requests")
    .select("id,revision,updated_at")
    .in(
      "id",
      requests.map((row) => row.id),
    );
  if (error || data?.length !== requests.length)
    throw error ?? new Error("Missing synthetic request snapshots.");
  return data.map((row) => ({
    requestId: row.id as string,
    expectedRevision: row.revision as number,
    expectedUpdatedAt: row.updated_at as string,
  }));
}

test("@bulk-approval teachers filter, select, confirm, and approve a group without leaving the queue", async ({
  page,
}, testInfo) => {
  const prefix = `E2E Bulk ${crypto.randomUUID().slice(0, 8)}`;
  const requests = await createRequests(prefix, [2, 3]);
  const teacher = await clientFor(syntheticAccounts.teacher.email);
  try {
    const before = await teacher
      .from("member_progress")
      .select("approved_hours")
      .eq("membership_id", memberId)
      .single();
    if (before.error) throw before.error;
    await loginTeacher(page);
    await page.goto("/admin/requests");
    await page.getByLabel("Search requests").fill(prefix);
    await page.getByLabel("Category", { exact: true }).click();
    await page.getByRole("option", { name: "Green Team", exact: true }).click();
    await page.getByLabel("Committee head", { exact: true }).click();
    await page
      .getByRole("option", { name: syntheticAccounts.committeeHead.fullName, exact: true })
      .click();
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page.getByText("Teacher approval queue (2)", { exact: true })).toBeVisible();

    const firstCheckbox = page.getByRole("checkbox", {
      name: `Select Morgan Member: ${requests[0]!.title}`,
    });
    await firstCheckbox.focus();
    await page.keyboard.press("Space");
    await expect(firstCheckbox).toBeChecked();
    await page.getByRole("button", { name: "Select this page" }).click();
    await expect(page.getByText("2 selected · 5 hours", { exact: true })).toBeVisible();
    await page.getByText("Activity details for Morgan Member", { exact: true }).first().click();
    await expect(
      page
        .getByText("Fictional supervised service for the local bulk-approval browser test.")
        .first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Approve selected" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Approve 2 selected requests?" });
    await expect(dialog).toContainText("5 hours");
    for (const row of requests) await expect(dialog).toContainText(row.title);
    await page.screenshot({
      path: testInfo.outputPath("teacher-bulk-approval-confirmation.png"),
      fullPage: true,
    });
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(
      accessibility.violations.filter((item) =>
        ["serious", "critical"].includes(item.impact ?? ""),
      ),
    ).toEqual([]);
    await dialog.getByRole("button", { name: "Give final approval" }).click();
    await expect(page.getByRole("region", { name: "Approval results" })).toContainText(
      "2 of 2 requests approved.",
    );
    expect(new URL(page.url()).pathname).toBe("/admin/requests");
    await page.screenshot({
      path: testInfo.outputPath("teacher-bulk-approval-result.png"),
      fullPage: true,
    });

    const after = await teacher
      .from("member_progress")
      .select("approved_hours")
      .eq("membership_id", memberId)
      .single();
    if (after.error) throw after.error;
    expect(Number(after.data.approved_hours) - Number(before.data.approved_hours)).toBe(5);
    await page.goto(`/admin/requests?view=archive&search=${encodeURIComponent(prefix)}`);
    for (const row of requests)
      await expect(page.getByText(row.title, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve selected" })).toHaveCount(0);
  } finally {
    await teacher.auth.signOut();
  }
});

test("@bulk-approval overlapping reversed batches and a single-review race record one approval per request", async () => {
  const requests = await createRequests(
    `E2E Bulk Race ${crypto.randomUUID().slice(0, 8)}`,
    [1, 1, 1],
  );
  const firstTeacher = await clientFor(syntheticAccounts.teacher.email);
  const secondTeacher = await clientFor(syntheticAccounts.teacher.email);
  try {
    const selected = await snapshots(firstTeacher, requests);
    const overlap = selected.slice(0, 2);
    const firstInput = {
      p_school_year_id: schoolYearId,
      p_batch_id: crypto.randomUUID(),
      p_requests: overlap,
    };
    const [first, second] = await Promise.all([
      firstTeacher.rpc("bulk_approve_teacher_requests", firstInput),
      secondTeacher.rpc("bulk_approve_teacher_requests", {
        p_school_year_id: schoolYearId,
        p_batch_id: crypto.randomUUID(),
        p_requests: [...overlap].reverse(),
      }),
    ]);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    const firstResult = first.data as BulkApprovalResult;
    const secondResult = second.data as BulkApprovalResult;
    expect(firstResult.approvedCount + secondResult.approvedCount).toBe(2);
    const recovered = await firstTeacher.rpc("bulk_approve_teacher_requests", firstInput);
    expect(recovered.error).toBeNull();
    expect(recovered.data).toEqual(first.data);

    const last = selected[2]!;
    const [batch, single] = await Promise.all([
      firstTeacher.rpc("bulk_approve_teacher_requests", {
        p_school_year_id: schoolYearId,
        p_batch_id: crypto.randomUUID(),
        p_requests: [last],
      }),
      secondTeacher.rpc("review_hour_request", {
        p_request_id: last.requestId,
        p_action: "approve",
      }),
    ]);
    expect(batch.error).toBeNull();
    if (single.error) expect(single.error.code).toBe("40001");
    const batchResult = batch.data as BulkApprovalResult;
    expect(batchResult.approvedCount + (single.error ? 0 : 1)).toBe(1);
    const history = await firstTeacher
      .from("hour_reviews")
      .select("hour_request_id")
      .in(
        "hour_request_id",
        requests.map((row) => row.id),
      )
      .eq("action", "approved");
    if (history.error) throw history.error;
    for (const row of requests)
      expect(history.data.filter((item) => item.hour_request_id === row.id)).toHaveLength(1);
  } finally {
    await Promise.all([firstTeacher.auth.signOut(), secondTeacher.auth.signOut()]);
  }
});

test("@bulk-approval @mobile teacher selection and confirmation fit the viewport", async ({
  page,
}, testInfo) => {
  const prefix = `E2E Bulk Mobile ${crypto.randomUUID().slice(0, 8)}`;
  await createRequests(prefix, [2]);
  await loginTeacher(page);
  await page.goto(`/admin/requests?search=${encodeURIComponent(prefix)}`);
  await page.getByRole("button", { name: "Select this page" }).click();
  await expect(page.getByText("1 selected · 2 hours")).toBeVisible();
  await page.getByRole("button", { name: "Approve selected" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: testInfo.outputPath("teacher-bulk-approval-mobile-confirmation.png"),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Give final approval" }).click();
  await expect(page.getByRole("region", { name: "Approval results" })).toContainText(
    "1 of 1 requests approved.",
  );
  await page.screenshot({
    path: testInfo.outputPath("teacher-bulk-approval-mobile-result.png"),
    fullPage: true,
  });
});
