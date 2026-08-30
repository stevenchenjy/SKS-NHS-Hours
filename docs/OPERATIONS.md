# NHS Service Hours Portal — Operations and deployment

This runbook covers local development, Supabase and Vercel setup, account bootstrap, release, backup, restore, rollback, and routine administration. It deliberately contains no real project references, credentials, student data, or test passwords.

The checked-in sources of truth are:

- `.env.example` for runtime variable names;
- `package.json` and `pnpm-lock.yaml` for commands and dependency versions;
- `supabase/config.toml` for the local Supabase stack and local Auth policy;
- database migrations for schema, grants, policies, functions, and reference data; and
- `docs/SECURITY.md` and `docs/QA.md` for release gates.

## Environment model

Use separate credentials and data stores at every trust level.

| Environment | Application                                            | Database/Auth                             | Allowed data                              |
| ----------- | ------------------------------------------------------ | ----------------------------------------- | ----------------------------------------- |
| Local       | Developer machine on `http://localhost:3000`           | Supabase CLI stack                        | Deterministic synthetic seed only         |
| Preview     | Protected Vercel preview or stable preview alias       | Dedicated non-production Supabase project | Synthetic or deliberately anonymized data |
| Production  | Protected production branch and canonical HTTPS domain | Dedicated production Supabase project     | Real school records                       |

Never put a production Supabase secret in a local or preview environment. Never connect an unprotected preview deployment to production student data.

## Prerequisites

- Node.js 22 is recommended. Next.js requires Node.js 20.9 or newer, but the current Supabase JavaScript client warns that Node.js 20 support is deprecated.
- Corepack and pnpm 11.19.0, as declared in `package.json`.
- Docker Desktop or another Docker-compatible runtime for the Supabase local stack.
- Supabase CLI 2.x. The repository was prepared with 2.116.0.
- A Supabase account and one project per hosted environment.
- A GitHub repository and Vercel account for preview/production delivery.

Do not install dependencies with npm or Yarn; keep `pnpm-lock.yaml` authoritative.

## Runtime variables

Create `.env.local` from `.env.example`. `.env.local` is ignored by Git.

| Variable                               | Exposure             | Required                                   | Meaning                                                                                                  |
| -------------------------------------- | -------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Browser and server   | Yes                                        | Environment-specific Supabase project URL                                                                |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser and server   | Yes                                        | Browser-safe Supabase publishable key; use the local CLI's legacy anon value for local development       |
| `NEXT_PUBLIC_APP_URL`                  | Browser and server   | Yes                                        | Exact public origin for this deployment, with no path or trailing slash                                  |
| `SUPABASE_SECRET_KEY`                  | Server only          | Required for privileged account operations | Elevated Supabase secret key; use the local CLI's legacy service-role value only for local development   |
| `PASSWORD_UPDATE_CONTEXT_SECRET`       | Server only          | Required for password-update proof         | At least 32 random bytes for signing the 30-minute invite/recovery context; use a dedicated hosted value |
| `ALLOWED_EMAIL_DOMAINS`                | Server only          | Recommended                                | Comma-separated lowercase school domains; this supplements invitations and never grants access by itself |
| `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED`      | Browser and server   | Yes                                        | `true` only after Google and Supabase OAuth are configured; otherwise `false`                            |
| `SERVER_ACTION_ALLOWED_ORIGINS`        | Server configuration | Optional                                   | Comma-separated additional trusted origins, without paths; normally empty on a single-origin deployment  |
| `NHS_DESIGN_PREVIEW`                   | Server only          | Optional                                   | Local design-fixture switch; must be `false` or absent in Preview and Production                         |

The environment parser in `src/lib/env.ts` fails closed when required values are absent or malformed. The elevated client in `src/lib/supabase/admin.ts` is server-only. A value prefixed with `NEXT_PUBLIC_` is bundled for browsers, so an elevated key must never be placed in one of those variables.

### Secret handling

- Store hosted values in the Vercel environment-variable UI or an approved secret manager, never in Git, issue text, screenshots, or support logs.
- Scope values separately to Development, Preview, and Production.
- Limit access to the Supabase dashboard and Vercel project to current maintainers, require MFA, and review access at staff turnover.
- Rotate the elevated Supabase credential and password-context signing secret after suspected disclosure or administrator turnover. Redeploy every server environment that used an old value and revoke it only after the replacement is live. Rotating the context secret intentionally invalidates outstanding 30-minute password forms.
- Treat local `supabase status` output as sensitive because it includes privileged development keys.

## Local setup

From the repository root:

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
supabase start
supabase status
```

Copy only the local API URL, browser-safe key, and elevated local key from `supabase status` into `.env.local`. Retain `NEXT_PUBLIC_APP_URL=http://localhost:3000`. Generate a separate local signing value with `openssl rand -hex 32` and store it as `PASSWORD_UPDATE_CONTEXT_SECRET`; do not commit or paste it into chat, CI logs, or documentation. The code can fall back to a sufficiently long elevated key, but hosted environments should use the dedicated secret so the two credentials can rotate independently.

Recreate the database from migrations and the deterministic seed:

```bash
supabase db reset --local
supabase test db
pnpm test:e2e:prepare
pnpm test
pnpm dev
```

Open the application at `http://localhost:3000`. Local Supabase Studio is at `http://127.0.0.1:54323`, and captured development email is at `http://127.0.0.1:54324`, as configured in `supabase/config.toml`. Stop the stack with `supabase stop` when finished.

The seed and synthetic E2E credentials are for local development only. Do not pass `--include-seed` when pushing production migrations, and do not reuse the synthetic password outside the local stack.

### Synthetic local accounts

After `supabase db reset --local`, `supabase/seed.sql` creates these fictional relational fixtures. Run `pnpm test:e2e:prepare` to have the loopback-only Auth admin preparer assign their local-only password `LocalOnly123!`; raw SQL seed hashes are not treated as login credentials. They use the `example.edu` domain. Set local `ALLOWED_EMAIL_DOMAINS=example.edu`; none of these identities may be copied to Preview or Production.

| Email                          | Membership/roles                              | Purpose                      |
| ------------------------------ | --------------------------------------------- | ---------------------------- |
| `admin@example.edu`            | Global `platform_owner`; teacher-only anchors | Administration and review    |
| `reviewer@example.edu`         | Active `member`, `committee_head`             | Assigned-review queue        |
| `member@example.edu`           | Active `member`                               | Ordinary submission/history  |
| `leader@example.edu`           | Active `member`, `president_vice_president`   | Leader roster/review         |
| `vice-president@example.edu`   | Active `member`, `president_vice_president`   | President / VP authorization |
| `multi-role@example.edu`       | Active `member`, both annual leadership roles | Combined-role behavior       |
| `expired-reviewer@example.edu` | Expired `member`, `committee_head`            | Stale-leader denial/history  |
| `expired-member@example.edu`   | Expired `member`                              | Expired-account experience   |

The fixed IDs and credentials are intentionally discoverable because they are synthetic local fixtures. Their presence in any hosted environment is a release failure.

## Invitation and authentication operations

### Access model

Authentication and authorization are separate:

1. Supabase Auth proves an identity.
2. A matching application profile must be provisioned.
3. The profile must be active.
4. A school-year membership must be `active`, within its school-year dates, and not past its membership expiration date.
5. Current membership roles determine member, reviewer, and teacher-administrator capabilities.

A matching email domain alone never satisfies steps 2–5. Public email signup and anonymous sign-in are disabled in `supabase/config.toml`; reproduce those settings in every hosted Supabase project.

### Hosted Auth checklist

In Supabase Dashboard → Authentication:

1. Disable public email signup and anonymous sign-in.
2. Require a minimum 12-character password with lowercase, uppercase, and digits, or a stronger school policy.
3. Enable secure password change/recent reauthentication. The checked-in local setting is enabled, and the application additionally requires a signed, user-bound invite/recovery context; reproduce and test the hosted setting rather than treating the local file as proof.
4. Set the Site URL to the exact canonical application origin.
5. Add exact redirect URLs `https://HOST/auth/callback`, `https://HOST/auth/recovery-callback`, and `https://HOST/update-password` for production and the protected preview environment. Keep localhost URLs only in local development; do not use wildcards.
6. Replace the hosted **Invite User** template with the reviewed equivalent of `supabase/templates/invite.html`. Its action URL must be `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`.
7. Replace the hosted **Reset Password** template with the reviewed equivalent of `supabase/templates/recovery.html`. Its action URL must be `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`. `/auth/recovery-callback` remains a PKCE fallback for a stock recovery template; both paths require fresh Auth proof before password update.
8. Set the hosted email OTP expiration to `604800` seconds so the Auth invite token and the application's seven-day invitation metadata expire together. This shared Auth value also governs recovery and other email links; after a token is verified, the portal's separate password-update context lasts only 30 minutes.
9. Configure a school-controlled SMTP provider before inviting real users. Confirm the From name/address, bounce handling, rate limits, and invitation/password-reset delivery. Disable link tracking that rewrites Auth links and assess the school's email-link prefetching behavior.
10. Set sensible Auth rate limits and review failed-login/email-delivery telemetry.
11. Test first invite, Resend (a fresh Invite User email), provider rejection, provider-accepted/receipt-failed messaging, expired/used/revoked invite behavior, token-hash and PKCE recovery, ordinary/stale-session password-change denial, context expiry, sign-out, and an expired membership before release.

Do not blindly run `supabase config push` against production: the checked-in Auth URLs are local-development values. Either maintain an environment-specific reviewed config or reproduce the production values in the dashboard and record the change.

### Optional Google OAuth

Google sign-in is optional and must remain hidden while `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false`.

1. In Google Cloud, create a Web OAuth client owned by the school.
2. Add Supabase's provider callback URL, shown by the Supabase Google provider screen, as an authorized redirect URI in Google.
3. Add the client ID and secret to Supabase Dashboard → Authentication → Providers → Google.
4. Keep the application callback URL in Supabase's redirect allowlist.
5. Restrict the Google consent screen/client to the school organization if policy requires it.
6. Set `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true` in only the configured Vercel environments and redeploy.
7. Verify that a Google-authenticated but unprovisioned account receives no portal data.

### Invite, resend, deactivate, and assign annual access

Use the teacher-administrator account UI for ordinary lifecycle operations; do not create application membership records manually after initial bootstrap.

- **Invite:** validate the email and allowed domain; create pending application invitation/role metadata with no recorded send; ask Supabase Auth to accept an Invite User message carrying the exact invitation ID; then record the accepted send/count/audit. Claim membership/roles only after token-hash confirmation succeeds.
- **Resend:** use the same pending invitation and call Auth Invite User again. Only a provider-accepted message extends expiry to seven days and increments `send_count`; a provider rejection leaves those facts unchanged. Do not use the ordinary signup-confirmation resend method and do not create a duplicate application invitation/membership. If Auth accepted the email but receipt recording failed, inspect the invitation and audit trail before another send. Preparation, acknowledgement, resend, and revocation for a teacher-admin invitation are platform-owner-only.
- **Deactivate:** make the profile inactive or membership suspended through the protected workflow. Revoking the Auth session is additional defense, not a substitute for membership checks.
- **Add existing account to a year:** create/reactivate a destination-year membership, fix expiration to the year end, link prior access when available, and deliberately choose Member, Committee head, or President / Vice President. Do not extend or overwrite the historical membership.
- **Expire/archive:** retain identity, approved requests, review/correction history, and audit events. Expiration removes active submission/review authority. Expired access and access/roles in closed or archived years are read-only; continued participation uses destination-year access.

Invitation secrets and password-reset tokens must never be stored in application tables or logs.

## School administration procedures

Every procedure below requires an active global `teacher_admin` or `platform_owner` grant unless it is explicitly a student-leader review action. Global administrators do not require in-date annual membership. Use different people for submission and review, and verify the resulting history/audit after consequential changes.

### Invite and manage accounts

1. Open `/admin/accounts`, select the intended school year, and use **Accounts**, **Add accounts**, or **Invitations** for directory state, access creation, or delivery lifecycle respectively.
2. Under **Add accounts**, invite one identity with email, full name, and one initial access choice. Committee head and President / Vice President include member. Teacher administrator is exclusive/global and requires the platform owner. A successful portal result means Auth accepted the send and its receipt was recorded; verify inbox delivery separately.
3. For a roster, use **Import roster** with UTF-8 CSV headers `email,full_name,roles`. Separate combined roles with `|`. The importer accepts at most 250 account rows and 1 MB, rejects unknown/duplicate headers and duplicate emails, and validates the whole file before starting invitations. Provider/state/receipt failures after validation can still produce a partial result; resolve each reported line and use Resend rather than reimporting it blindly.
4. Use **Invitations** to inspect status, expiry, and provider-accepted send count. Resend requests a new Auth message and updates the facts only after acceptance; Revoke prevents the portal invitation from being claimed. Only the platform owner can perform lifecycle actions on a teacher-admin invitation. Verify actual inbox delivery because Auth/SMTP is a separate system.
5. Use **Accounts** actions to suspend/reactivate eligible open-year annual access or deactivate/reactivate a profile. Profile status affects every path; annual status is year-specific. Expired and closed/archived-year access and roles are read-only, so use destination-year access for continued participation. The database protects the final global administrator and requires ownership transfer before owner removal.

### Assign annual and global access

1. In Accounts, select the school year and assign one annual access level: Member, Committee head, or President / Vice President.
2. Leadership automatically includes member and is assigned deliberately each year. Do not create duplicate identities for ordinary student leadership.
3. Every member target is fixed at 20 approved hours. There is no Target settings page or override workflow.
4. Only the platform owner can invite/grant/revoke a teacher administrator or transfer ownership. Staff administration must use a separate identity from any member participation/history.
5. After changes, use synthetic accounts in non-production or have the person refresh/sign in; verify the new capability and audit event rather than relying on navigation alone.

### Create a year and assign the new roster

1. Open `/admin/settings/school-years` and create a draft year with a consecutive label and inclusive dates. The requirement is fixed at 20 approved hours.
2. In Accounts → Add accounts, add selected existing profiles or invite/import new identities into the draft year. Choose each person's annual access deliberately; the destination transaction links prior membership when available and does not rewrite history.
3. Review member/leadership access and category availability, then activate. Global administrators retain access automatically and must not be added as members.
4. Close the prior year when policy says submissions/reviews must stop. Retain it for read-only history.
5. Spot-check an expired ordinary member, expired former leader, newly assigned member, and newly assigned leader. Old leadership must not authorize a current action.

### Manage categories

Open `/admin/settings/categories` to add, rename, describe, activate/deactivate, and set per-year availability. Categories are alphabetical and have no configurable order, per-request category maximum, or per-member approved-hours cap. The universal request sanity limit remains 24 hours in quarter-hour increments. Deactivate or make unavailable instead of deleting a referenced category.

### Process and correct service requests

1. Reviewers use `/admin/requests`; **Assigned to me** is a focus view and **All pending** is the shared eligible queue.
2. Open the request, review member/activity/history/assignment, and approve, request changes, reject, or reassign. Changes/rejection require a useful comment. Self-review is never allowed, including for reviewers with multiple annual student roles and for global teacher administrators.
3. If a request is no longer pending, reload instead of retrying blindly; another reviewer may have completed the serialized transaction.
4. To fix an approved record, a teacher administrator uses the correction form on its request page, enters corrected fields and a specific reason, then verifies the immutable before/after correction, review history, and audit event. Never edit the row directly.

### Read progress, audit, and exports

- Leaders use `/admin/members` and member profiles to inspect authorized progress and complete service history. Approved, pending, changes-requested, remaining, and over-goal values remain distinct; global administrators are excluded from member counts/progress.
- Teacher administrators use `/admin/audit` to review audit events by year/action/actor/entity and investigate unexpected account, role, review, correction, invitation, destination-access, global-grant, or export activity.
- Teacher administrators use `/admin/exports` to generate only the smallest export needed for a defined school purpose. The route pages through the caller-scoped view with deterministic ordering, advances by the number of rows actually returned until an empty page, includes `latest_review_comment` in complete service/archive shapes, records the final row count, and uses private/no-store CSV headers. Verify completeness under the hosted PostgREST row cap at release, store the downloaded file only in approved school storage, and delete it when the purpose/retention period ends.

Audit and export pages/routes are implemented. The prior-schema native RLS suite passed; the updated suite remains an exact-commit CI gate. Production use also remains gated on hosted complete-row export integration under the actual PostgREST row cap, formula-neutralization/browser checks in the school's supported spreadsheet application, and deployed private-cache/header verification; see `docs/SECURITY.md` and `docs/QA.md`.

## First teacher-administrator bootstrap

The first teacher administrator is a break-glass provisioning operation because no existing application owner can authorize it. The migration-defined `bootstrap_teacher_admin` RPC is limited to the service role, serializes competing calls, refuses after any global administrator grant exists, verifies a matching Supabase Auth user, and atomically creates the profile, school year (or checks its dates), `platform_owner` grant, teacher-only attribution anchor, and audit event. It never assigns member access or a service requirement. Perform it with two school staff present and record the operator, user UUID, school year, timestamp, and reason in the private school change log.

Before production launch:

1. Apply the reviewed migrations.
2. Create the initial Auth user from Supabase Dashboard → Authentication → Users using the teacher's school email. Follow the invite/password-reset flow; do not share a temporary password over an insecure channel. Copy the Auth user UUID.
3. From a managed operator machine, invoke the RPC over the project REST endpoint with the elevated key. To keep the key and personal values out of shell history, enter them through silent/environment prompts and let Node construct the JSON:

   ```bash
   read -r NHS_BOOTSTRAP_URL
   read -rs NHS_BOOTSTRAP_KEY
   read -r NHS_BOOTSTRAP_USER_ID
   read -r NHS_BOOTSTRAP_EMAIL
   read -r NHS_BOOTSTRAP_FULL_NAME
   read -r NHS_BOOTSTRAP_YEAR_LABEL
   read -r NHS_BOOTSTRAP_START_DATE
   read -r NHS_BOOTSTRAP_END_DATE
   export NHS_BOOTSTRAP_URL NHS_BOOTSTRAP_KEY NHS_BOOTSTRAP_USER_ID NHS_BOOTSTRAP_EMAIL
   export NHS_BOOTSTRAP_FULL_NAME NHS_BOOTSTRAP_YEAR_LABEL NHS_BOOTSTRAP_START_DATE NHS_BOOTSTRAP_END_DATE
   node --input-type=module -e '
     const v = process.env;
     const response = await fetch(`${v.NHS_BOOTSTRAP_URL.replace(/\/$/, "")}/rest/v1/rpc/bootstrap_teacher_admin`, {
       method: "POST",
       headers: {
         apikey: v.NHS_BOOTSTRAP_KEY,
         "content-type": "application/json",
       },
       body: JSON.stringify({
         p_user_id: v.NHS_BOOTSTRAP_USER_ID,
         p_email: v.NHS_BOOTSTRAP_EMAIL,
         p_full_name: v.NHS_BOOTSTRAP_FULL_NAME,
         p_school_year_label: v.NHS_BOOTSTRAP_YEAR_LABEL,
         p_start_date: v.NHS_BOOTSTRAP_START_DATE,
         p_end_date: v.NHS_BOOTSTRAP_END_DATE,
         p_default_target_hours: 20,
         p_expiration_date: v.NHS_BOOTSTRAP_END_DATE,
       }),
     });
     if (!response.ok) {
       console.error(`Bootstrap failed with HTTP ${response.status}.`);
       process.exit(1);
     }
     console.log("Initial teacher administrator bootstrapped.");
   '
   unset NHS_BOOTSTRAP_URL NHS_BOOTSTRAP_KEY NHS_BOOTSTRAP_USER_ID NHS_BOOTSTRAP_EMAIL
   unset NHS_BOOTSTRAP_FULL_NAME NHS_BOOTSTRAP_YEAR_LABEL NHS_BOOTSTRAP_START_DATE NHS_BOOTSTRAP_END_DATE
   ```

   Enter the environment's Supabase project URL, elevated secret/service-role API key, Auth UUID, normalized email, full name, label such as `2026-2027`, and ISO dates when prompted. The `apikey` header supports current opaque Supabase secret keys; do not also put an `sb_secret_…` value in an `Authorization: Bearer` header because it is not a JWT. Do not place the key in `.env.example`, paste it into a command argument, or retain it in a general terminal profile.

4. Confirm one active profile, one platform-owner grant, and a teacher-only attribution anchor exist; confirm there is no member role/progress; verify dates and the bootstrap audit event.
5. Sign in as that user and use Accounts to invite a separate second teacher administrator. Verify it before transferring ownership or removing access.
6. Verify both accounts can see the audit trail, then revoke any temporary Auth setup credential.
7. Test that an authenticated ordinary account and the browser-safe anon key cannot execute `bootstrap_teacher_admin`, and that a second elevated invocation is rejected.

Do not replace the RPC with ad hoc table inserts. Its prior-schema native allow, deny, and second-call tests passed; require the updated exact-commit database CI pass as well. Production launch remains blocked until the real break-glass bootstrap is performed with two school staff under dual control and the protected application workflow for provisioning and verifying a successor teacher administrator is exercised successfully.

## Supabase project and schema deployment

### One-time hosted project setup

1. Create separate non-production and production Supabase projects in the school's organization and record the owners and region in the private operations inventory.
2. Require MFA for project owners and restrict production database access.
3. From a trusted operator machine, authenticate and link the intended project:

   ```bash
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   ```

4. Confirm the linked project in the CLI output and Supabase dashboard before any push. Do not commit the project reference or access token.
5. Configure hosted Auth, SMTP, redirects, and optional Google OAuth using the preceding checklist.
6. Set and verify backup/PITR coverage appropriate to the chosen Supabase plan.

### Migration-first release

Run the complete local checks first:

```bash
supabase db reset --local
supabase test db
pnpm check
pnpm test:e2e:prepare
pnpm test:e2e
```

Then, from a clean, reviewed production commit:

```bash
supabase db push --linked --dry-run
supabase db push --linked
```

Review the dry-run list by filename and confirm the linked project twice before the real push. Do not use `--include-seed` in Preview or Production. Generate database types, if the repository uses generated types, only from the exact migration state being deployed.

Prefer expand/migrate/contract changes:

1. add backward-compatible columns/functions/policies;
2. deploy code that supports both shapes;
3. migrate data and verify counts/invariants; and
4. remove obsolete objects in a later release.

Never edit an already-applied migration. Add a new forward migration.

## Vercel setup and deployment

### One-time setup

1. Import the GitHub repository into a school-owned Vercel team.
2. Select Next.js and pnpm; Vercel should use the committed lockfile and normal `pnpm build` command.
3. Configure the production branch as the protected repository branch. Require pull-request checks before merge.
4. Add every variable from `.env.example` to the correct Vercel scopes. Use the non-production Supabase values for Preview and production values for Production.
5. Ensure `NHS_DESIGN_PREVIEW=false` and normally leave `SERVER_ACTION_ALLOWED_ORIGINS` empty.
6. Protect preview deployments with Vercel Authentication or equivalent access control.
7. Give Preview a stable HTTPS alias when OAuth is tested there; set `NEXT_PUBLIC_APP_URL` and Supabase's redirect allowlist to that exact origin.

### Release order

For each production release:

1. Confirm CI, database/RLS tests, dependency audit, production build, accessibility checks, and required manual QA pass as described in `docs/QA.md`.
2. Confirm a current recoverable database backup and record its timestamp.
3. Run the migration dry-run, review it, and apply forward-compatible migrations.
4. Merge the reviewed commit to the protected production branch or promote the exact verified Vercel deployment.
5. Watch build/runtime logs for errors without logging student records or tokens.
6. Run the post-deployment checks below.
7. Record the Git commit, Vercel deployment URL/ID, migration filenames, operator, start/end time, and check results in the private release log.

### Custom domain

1. Add the school-owned domain in Vercel Project Settings → Domains.
2. Apply the DNS records Vercel requests and wait for certificate issuance.
3. Make one canonical host redirect to the other; do not serve separate sessions on multiple uncontrolled hosts.
4. Update `NEXT_PUBLIC_APP_URL`, Supabase Site URL, and exact `/auth/callback` allowlist entry.
5. Redeploy, then verify HTTPS, HSTS, sign-in, invite, password reset, callback, sign-out, and cookie behavior on the canonical host.

## Post-deployment verification

Use synthetic accounts and non-sensitive records:

1. Public registration and anonymous access are unavailable.
2. Invite and password-reset messages return only to the canonical allowlisted host.
3. An unprovisioned, inactive, and expired identity receives no protected data.
4. An active member submits a 0.25-hour request to a different active reviewer.
5. The assigned reviewer sees it; another eligible reviewer sees it in all-pending.
6. Self-review fails, while one valid approval succeeds and records the actual reviewer.
7. Approved progress changes; pending does not count toward approved progress.
8. Teacher admin can view roster/audit and produce an authorized CSV; an ordinary member cannot.
9. The export is private/no-store and formula-like test values are neutralized.
10. Security headers are present on HTML responses.
11. Mobile (about 390 px) and desktop critical paths remain usable.
12. No demo users or data exist in production unless unmistakably labelled and approved.

## Backups and recovery

### Policy

- Enable Supabase platform backups and, where the school's recovery-point objective requires it, Point-in-Time Recovery.
- Document the actual plan, retention window, recovery point objective (RPO), and recovery time objective (RTO) in the private operations inventory; capabilities vary by Supabase plan.
- Encrypt any manual dump, store it only in an approved restricted location, test restoration into an isolated non-production project, and delete it according to the school's retention schedule.
- Never download production student data to an unmanaged personal device.
- Test recovery at least once per school year and before major destructive schema changes.

Before a risky database change, verify the platform backup in the Supabase dashboard. If an approved manual logical dump is required, run it only from a managed operator machine and keep the output outside the repository:

```bash
supabase db dump --linked --file /APPROVED/SECURE/PATH/schema.sql
supabase db dump --linked --data-only --use-copy --file /APPROVED/SECURE/PATH/data.sql
```

These files contain sensitive structure and, for the data dump, student records. They are not ordinary build artifacts.
CLI logical dumps are not a substitute for a verified platform backup/PITR restore and may omit Supabase-managed Auth or Storage schemas by design. Account recovery therefore depends on the hosted backup capability unless a separately tested, supported full-backup procedure exists.

### Restore decision

Restoration is destructive and is not the default response to an application regression. An incident lead and data owner must first:

1. stop or restrict writes;
2. preserve logs and determine the last known-good time;
3. compare forward repair with platform/PITR restoration;
4. account for Auth users, database records, and any events created after the restore point;
5. restore into an isolated project first when time permits; and
6. verify row counts, constraints, RLS, roles, progress, audits, and authentication before reopening access.

Follow the current Supabase dashboard restore workflow for the project's plan. Do not paste a production database URL into shell history; use the linked project or an approved secret-injection method.

## Rollback

Application and database rollback are different operations.

### Application rollback

If the database remains backward-compatible, promote the last known-good Vercel deployment in the dashboard. From an authenticated machine with the project linked, the equivalent CLI sequence is:

```bash
pnpm dlx vercel@latest list --prod
pnpm dlx vercel@latest rollback PREVIOUS_GOOD_DEPLOYMENT_URL
pnpm dlx vercel@latest rollback status
```

Omit the URL only when intentionally returning to the immediately previous production deployment. Plan limitations may restrict how far back an instant rollback can go. Record the old/new deployment IDs, then re-run the post-deployment smoke checks. To undo a rollback or make another already-built deployment current, use `pnpm dlx vercel@latest promote DEPLOYMENT_URL` and check `pnpm dlx vercel@latest promote status`.

### Database correction

Do not delete an applied migration and do not assume an application rollback reverses schema. Prefer a new forward migration that restores compatibility or repairs data. Use backup/PITR restoration only through the restore decision process above. After any repair, reconcile migration history and test a fresh local reset from the repository.

## Monitoring and incident response

Monitor Vercel deployment/runtime errors, Supabase Auth failures, database health, backup status, and suspicious repeated account/export actions. Logs should contain stable record IDs and action names where useful, but not passwords, tokens, cookies, raw CSV rows, free-text service descriptions, or full student profiles.

For a suspected incident:

1. record detection time and preserve relevant audit/platform logs;
2. disable or suspend affected membership(s), and revoke sessions/keys when relevant;
3. contain the affected environment without destroying evidence;
4. identify exposed records and the authorization path involved;
5. rotate secrets and redeploy when credential exposure is possible;
6. restore or forward-fix only through the controlled procedures above; and
7. follow school notification, privacy, and records policies.

## Routine operational checklist

- At each school year: create the draft year, verify dates and fixed 20-hour policy, add the member roster, deliberately assign student leadership, review category availability, activate, and retain the old year read-only.
- Monthly during active use: review inactive/expiring accounts, privileged roles, invitation failures, audit events, export activity, Auth errors, and backup status.
- At staff turnover: invite and verify a separate successor teacher administrator, transfer platform ownership when appropriate, then remove predecessor access; rotate shared operational secrets and review GitHub, Vercel, Supabase, SMTP, Google, and domain access.
- At dependency updates: run the full check suite, database/RLS tests, browser workflows, dependency audit, and production build before promotion.
