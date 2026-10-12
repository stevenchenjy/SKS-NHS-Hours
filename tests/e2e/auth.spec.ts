import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { provisionGoogleAccount } from "../../src/lib/auth/provision-google-account";

const fixturePassword = process.env.E2E_PASSWORD ?? "LocalOnly123!";
const yearId = "10000000-0000-4000-8000-000000000001";

function localClients() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (
    !url ||
    !key ||
    !secret ||
    !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)
  )
    throw new Error("Authentication browser tests require local synthetic Supabase credentials.");
  const options = { auth: { autoRefreshToken: false, persistSession: false } };
  return { admin: createClient(url, secret, options), owner: createClient(url, key, options) };
}

test("failed password sign-in retains credentials for correction", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Sign in with school Google" })).toHaveCount(0);
  await page.getByLabel("School email").fill("member@example.edu");
  await page.getByLabel("Password", { exact: true }).fill("incorrect-synthetic-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("incorrect");
  await expect(page.getByLabel("School email")).toHaveValue("member@example.edu");
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue(
    "incorrect-synthetic-password",
  );
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
  await page.getByLabel("Password", { exact: true }).fill(fixturePassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
});

test("scanner preview does not consume an invitation, and a six-character password enters the portal", async ({
  page,
  browser,
}) => {
  const { admin, owner } = localClients();
  const email = `onboarding-${Date.now()}@example.edu`;
  const { error: loginError } = await owner.auth.signInWithPassword({
    email: "admin@example.edu",
    password: fixturePassword,
  });
  if (loginError) throw new Error("Could not sign in the local invitation operator.");
  const { data: invitation, error: invitationError } = await owner.rpc("create_invitation", {
    p_email: email,
    p_full_name: "Synthetic Onboarding Member",
    p_school_year_id: yearId,
    p_role_keys: ["member"],
    p_expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
  });
  if (invitationError)
    throw new Error(`Local invitation creation failed (${invitationError.code}).`);
  const row = Array.isArray(invitation) ? invitation[0] : invitation;
  // Google-ready identities are provisioned without sending email or assigning
  // a password. Their existing invitation/password fallback must still work.
  await provisionGoogleAccount(admin, {
    invitationId: row.id,
    email,
    fullName: "Synthetic Onboarding Member",
  });
  const { data: proof, error: proofError } = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: {
      data: { invitation_id: row.id },
      redirectTo: new URL(
        "/update-password",
        process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
      ).toString(),
    },
  });
  if (proofError || !proof.properties?.hashed_token)
    throw new Error("Could not generate a local synthetic invitation proof.");
  // No real email is sent. The provider proof is used only in this local test.
  const link = `/auth/confirm?type=invite&token_hash=${encodeURIComponent(proof.properties.hashed_token)}`;
  const scanner = await browser.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
  });
  const preview = await scanner.request.get(link);
  expect(preview.ok()).toBe(true);
  const { data: before } = await admin.auth.admin.getUserById(proof.user.id);
  expect(before.user?.email_confirmed_at).toBeFalsy();
  await scanner.close();

  await page.goto(link);
  await page.getByRole("button", { name: "Continue to set password" }).click();
  await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
  const { data: interim, error: interimError } = await owner.rpc("list_account_setup_status", {
    p_school_year_id: yearId,
  });
  expect(interimError).toBeNull();
  expect(interim.find((status: { email: string }) => status.email === email)).toMatchObject({
    password_set: false,
    email_verified_at: expect.any(String),
  });
  await page.getByLabel("New password", { exact: true }).fill("abc123");
  await page.getByLabel("Confirm password", { exact: true }).fill("abc123");
  await page.getByRole("button", { name: "Update password", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\?notice=password-updated/);
  await expect(page.getByRole("heading", { name: "Your service progress" })).toBeVisible();
  await expect(
    page.getByText("Your password is saved. You are signed in and ready to use the portal."),
  ).toBeVisible();
  const { data: complete } = await owner.rpc("list_account_setup_status", {
    p_school_year_id: yearId,
  });
  expect(complete.find((status: { email: string }) => status.email === email).password_set).toBe(
    true,
  );
  await page.goto("/update-password");
  await expect(page).toHaveURL(/password-context-required/);
  await owner.auth.signOut({ scope: "local" });
});

test("password sign-in claims a pending roster invitation for an existing Auth identity", async ({
  page,
}) => {
  const { admin, owner } = localClients();
  const email = `pending-access-${Date.now()}@example.edu`;
  const { error: loginError } = await owner.auth.signInWithPassword({
    email: "admin@example.edu",
    password: fixturePassword,
  });
  if (loginError) throw new Error("Could not sign in the local invitation operator.");
  const { error: invitationError } = await owner.rpc("create_invitation", {
    p_email: email,
    p_full_name: "Synthetic Pending Member",
    p_school_year_id: yearId,
    p_role_keys: ["member"],
    p_expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
  });
  if (invitationError)
    throw new Error(`Local invitation creation failed (${invitationError.code}).`);
  const { error: userError } = await admin.auth.admin.createUser({
    email,
    password: "abc123",
    email_confirm: true,
  });
  if (userError) throw new Error("Could not prepare a local confirmed identity.");
  await page.goto("/login");
  await page.getByLabel("School email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("abc123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "Your service progress" })).toBeVisible();
  await owner.auth.signOut({ scope: "local" });
});
