// Read-only hosted preflight. Node 22.18+ / 24 supports these erasable TS types.
// Never prints API tokens, SMTP secrets, email lists, or email proof URLs.
import { checkHostedAuthConfig } from "../src/lib/auth/hosted-auth-policy.ts";
import { parseSignInPolicy } from "../src/lib/auth/sign-in-policy.ts";

async function main() {
  const env = process.env;
  if (
    !env.SUPABASE_ACCESS_TOKEN ||
    !env.SUPABASE_PROJECT_REF ||
    !env.NEXT_PUBLIC_APP_URL ||
    !env.NEXT_PUBLIC_SUPABASE_URL
  )
    throw new Error(
      "Set SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF, NEXT_PUBLIC_APP_URL, and NEXT_PUBLIC_SUPABASE_URL for the target environment.",
    );
  if (!/^[a-z0-9]{20}$/.test(env.SUPABASE_PROJECT_REF))
    throw new Error("Invalid Supabase project reference.");
  if (new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname !== `${env.SUPABASE_PROJECT_REF}.supabase.co`)
    throw new Error("The project reference must match the target Supabase URL.");
  const policy = parseSignInPolicy({
    mode: env.AUTH_GOOGLE_MODE,
    googleDomains: env.GOOGLE_AUTH_ALLOWED_DOMAINS,
    betaEmails: env.AUTH_BETA_ALLOWED_EMAILS,
    appUrl: env.NEXT_PUBLIC_APP_URL,
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    productionSupabaseUrl: env.AUTH_PRODUCTION_SUPABASE_URL,
    vercelEnvironment: env.VERCEL_ENV,
    humanBetaApproved: env.AUTH_GOOGLE_BETA_APPROVED === "true",
  });
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/config/auth`,
    {
      headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok)
    throw new Error(`Could not read hosted Auth settings (HTTP ${response.status}).`);
  const minimumEmails = Number(env.AUTH_MINIMUM_EMAILS_PER_HOUR ?? "100");
  if (!Number.isInteger(minimumEmails) || minimumEmails < 1)
    throw new Error("AUTH_MINIMUM_EMAILS_PER_HOUR must be a positive whole number.");
  const failures = checkHostedAuthConfig(await response.json(), {
    appUrl: env.NEXT_PUBLIC_APP_URL,
    googleEnabled: policy.googleAuthMode !== "disabled",
    minimumEmailsPerHour: minimumEmails,
  });
  const database = await fetch(
    `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        read_only: true,
        query:
          "select to_regprocedure('public.record_password_sign_in()') is not null and to_regclass('private.account_auth_milestones') is not null and exists(select 1 from pg_trigger where tgname = 'record_verified_password_change' and tgrelid = 'auth.users'::regclass) as migration_ready",
      }),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!database.ok) throw new Error(`Could not inspect setup migration (HTTP ${database.status}).`);
  const rows = (await database.json()) as { migration_ready: boolean }[];
  if (rows[0]?.migration_ready !== true)
    failures.push(
      "Apply the verified account setup migration to this environment before the application release.",
    );
  if (failures.length) {
    for (const failure of failures) console.error(`FAIL: ${failure}`);
    process.exitCode = 1;
  } else
    console.log(
      "PASS: hosted Auth policy, email templates, delivery configuration, and redirect settings match the release requirements. Real inbox/Google tests are still required.",
    );
}
main().catch(() => {
  console.error(
    "Auth preflight could not run. Check the target environment and Management API access. No hosted settings were changed.",
  );
  process.exitCode = 1;
});
