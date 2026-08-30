# NHS Service Hours Portal — Deployment guide

This guide takes a reviewed commit from local verification to Supabase and Vercel. `docs/OPERATIONS.md` is the full runbook for routine operations, incidents, backup decisions, and the exact first-admin bootstrap script.

No hosted credentials were available while this documentation was prepared. The repository is deploy-oriented, but no Preview/Production deployment, hosted migration, Auth delivery, backup restore, or production smoke result is claimed.

## Required ownership

Before creating resources, assign named school owners for:

- GitHub repository and branch protection;
- Vercel project, domains, and deployment approval;
- Supabase projects, Auth, database, backups/PITR, and credential rotation;
- SMTP and optional Google OAuth;
- privacy/retention, incident response, export storage, RPO, and RTO; and
- first-admin bootstrap and successor-administrator approval.

Require MFA and least privilege on every platform. Use school-owned accounts and teams rather than a developer's personal production account.

## Environment separation

| Environment | Vercel/application                                                      | Supabase                         | Data                                  |
| ----------- | ----------------------------------------------------------------------- | -------------------------------- | ------------------------------------- |
| Local       | `http://localhost:3000`                                                 | Supabase CLI                     | Committed synthetic seed only         |
| Preview     | Protected preview/stable alias                                          | Dedicated non-production project | Synthetic or approved anonymized data |
| Production  | Protected main/established production branch and canonical HTTPS domain | Dedicated production project     | Real school records                   |

Never connect an unprotected Preview to Production data. Never reuse the Production elevated key in Local or Preview.

## Prerequisites

- Node.js 22 is recommended for the current Supabase JavaScript client; Next.js itself requires Node.js 20.9 or newer.
- Corepack and pnpm 11.19.0 from `package.json`.
- Docker Desktop or compatible runtime for local Supabase.
- Supabase CLI 2.x.
- School-owned Supabase, GitHub, Vercel, SMTP, and optional Google projects.

Install and prove the local build from the repository root:

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
supabase start
supabase status
supabase db reset --local
supabase test db
pnpm check
pnpm test:e2e:prepare
pnpm test:e2e
```

Copy the local URL/keys from `supabase status` into `.env.local`; never copy the whole output into logs. A clean command list is not evidence—record actual results in `docs/QA.md`.

## Environment variables

Configure every value separately for its environment.

| Variable                               | Scope          | Requirement                                                                                     |
| -------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Browser/server | Exact Supabase project URL                                                                      |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser/server | Browser-safe publishable key; the local CLI's legacy anon value is also supported               |
| `NEXT_PUBLIC_APP_URL`                  | Browser/server | Exact public origin, no path/trailing slash                                                     |
| `SUPABASE_SECRET_KEY`                  | Server only    | Elevated secret key; the local CLI's legacy service-role value is also supported                |
| `PASSWORD_UPDATE_CONTEXT_SECRET`       | Server only    | Dedicated random value of at least 32 bytes for signed invite/recovery password-update contexts |
| `ALLOWED_EMAIL_DOMAINS`                | Server only    | Comma-separated lowercase school domains; does not provision access                             |
| `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED`      | Browser/server | `false` until Google and redirects are fully configured                                         |
| `SERVER_ACTION_ALLOWED_ORIGINS`        | Server config  | Normally empty; reviewed comma-separated additional trusted origins only                        |
| `NHS_DESIGN_PREVIEW`                   | Server only    | `false` or absent in Preview/Production                                                         |

Never put an elevated key in a `NEXT_PUBLIC_` value. Current opaque `sb_secret_…` Supabase keys belong in the `apikey` header when used directly; do not treat them as JWT bearer tokens. Keep actual values in Vercel/environment secret storage, not Git.

## Create and configure Supabase projects

Create separate non-production and production projects in the school organization. Record project owner, region, plan, backup/PITR capability, and recovery contacts in the private inventory.

On a trusted operator machine:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

Confirm the intended project in both CLI output and dashboard before any database push.

### Authentication

For each hosted project:

1. Disable public email signup and anonymous sign-in.
2. Require at least the repository's local password baseline: 12 characters with lower case, upper case, and digits; use stronger school policy where available.
3. Enable secure password change/recent reauthentication. The application also requires a signed, user-bound, 30-minute context produced only after verified invite/recovery proof; reproduce and test the hosted setting.
4. Set the Site URL to that environment's exact `NEXT_PUBLIC_APP_URL`.
5. Allow only the exact redirect URLs the environment needs: `https://HOST/auth/callback`, `https://HOST/auth/recovery-callback`, and `https://HOST/update-password`; do not add wildcards to compensate for configuration errors.
6. Replace the hosted **Invite User** template with the reviewed equivalent of `supabase/templates/invite.html`. Its link must use `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`, which `src/app/auth/confirm/route.ts` verifies before the application claim.
7. Replace the hosted **Reset Password** template with `supabase/templates/recovery.html`. Its link must use `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`; keep `/auth/recovery-callback` allowlisted as the verified PKCE fallback for a stock recovery template.
8. Set the hosted email OTP expiry to `604800` seconds. The application invitation and Auth invite token are intentionally aligned to seven days; this shared setting also governs recovery and other email links, while the post-verification password form lasts 30 minutes.
9. Configure school-approved SMTP and sender identity; verify initial Invite User, fresh Invite User resend, and password-reset delivery with safe accounts. Disable link tracking that rewrites Auth URLs and assess email-security prefetch behavior.
10. Set Auth rate limits appropriate to the environment and review abuse monitoring.
11. Confirm expired, used, revoked, malformed, and ambiguous invitations fail safely; provider rejection does not advance application send facts; ordinary/stale sessions cannot change a password without verified context; and an unprovisioned Auth identity receives no portal data.

Local Auth behavior in `supabase/config.toml` is not proof of hosted settings.

### Optional Google OAuth

Keep `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false` unless Google is fully configured.

1. Create a school-controlled Google OAuth application.
2. Add the callback URI Supabase shows for the environment to Google's exact authorized redirect list.
3. Enable Google in Supabase Auth and enter the client credentials through the dashboard/secret store.
4. Add only the exact application callback origins to the Supabase redirect allowlist.
5. Set the environment's feature variable to `true` and redeploy.
6. Verify a provisioned school identity succeeds, while an unprovisioned or disallowed identity receives no portal authorization.

OAuth authenticates an identity; it never creates a role based only on email domain.

## Apply database migrations

From a clean reviewed commit, after local reset/pgTAP pass:

```bash
supabase db push --linked --dry-run
supabase db push --linked
```

Review every filename in the dry run and confirm the project twice. Never use `--include-seed` in Preview or Production. The committed seed contains local synthetic relational fixtures; login credentials are assigned only by the loopback-restricted E2E Auth preparer.

After the push, verify:

- all 15 application tables have RLS enabled and forced;
- `anon` has no application access;
- authenticated policy helper privileges remain narrowly sufficient for policy evaluation;
- public function execution grants match `docs/DATABASE.md`;
- all five reporting views are `security_invoker` and caller-scoped; and
- schema-contract and direct allow/deny tests pass against the intended environment through an approved safe procedure.

## Bootstrap the first teacher administrator

The initial account is a controlled break-glass operation:

1. Create/invite the intended Auth user in the Supabase dashboard and copy its UUID.
2. Have two authorized school staff invoke the service-role-only `bootstrap_teacher_admin` RPC using the prompt-based Node procedure in `docs/OPERATIONS.md`; never paste the secret into shell history.
3. Verify the active profile, school year dates, global `platform_owner` grant, teacher-only attribution anchor, absence of member progress, fixed 20-hour policy, and bootstrap audit event.
4. Sign in and use Accounts to invite and verify a separate second global teacher administrator.
5. Prove an ordinary authenticated user, browser-safe key, and second bootstrap attempt are rejected.

Do not use ad hoc inserts. Bootstrap is one-time only and not a staff-transfer mechanism.

## Connect Vercel

1. Import the GitHub repository into a school-owned Vercel team.
2. Keep the framework preset as Next.js, package manager as pnpm, and build command as `pnpm build`.
3. Configure the protected main/established branch for Production and enable pull-request Preview deployments.
4. Add all variables from `.env.example` to their exact Development/Preview/Production scopes.
5. Use Preview's Supabase values for Preview and Production's values only for Production.
6. Protect Preview with Vercel Authentication or equivalent control.
7. If OAuth is used in Preview, assign a stable HTTPS alias and use that exact origin in `NEXT_PUBLIC_APP_URL`, Supabase redirect configuration, and Google configuration.

The repository's `.github/workflows/ci.yml` runs formatting, lint, typecheck, unit tests, dependency audit, production build, Supabase tests, and browser tests. Require the relevant checks before merge; inspect an actual GitHub Actions run rather than assuming the workflow file succeeded.

## Production release order

1. Freeze a reviewed commit and record its SHA.
2. Obtain passing application, database/RLS, Playwright, security, accessibility, and production-build evidence from `docs/TESTING.md`.
3. Confirm a current recoverable backup/PITR point and recovery owner.
4. Dry-run and apply backward-compatible production migrations.
5. Deploy or promote the exact verified Vercel build.
6. Watch logs for failures without logging student content or tokens.
7. Complete the smoke checks below.
8. Record commit, Vercel deployment URL/ID, migration filenames, operators, times, backup reference, and results in the private release record.

## Custom domain

1. Add the school-owned domain in Vercel Project Settings → Domains.
2. Apply Vercel's requested DNS records and wait for TLS certificate issuance.
3. Choose one canonical hostname and redirect other approved variants to it.
4. Update `NEXT_PUBLIC_APP_URL`, Supabase Site URL, exact Supabase `/auth/callback`, `/auth/recovery-callback`, and `/update-password` allowlist entries, and Google authorized locations where enabled.
5. Redeploy and verify HTTPS, HSTS, cookies, login, invite, reset, callback, and sign-out on the canonical host.

## Post-deployment verification

Use safe test accounts and non-sensitive records:

1. public signup and anonymous application access are unavailable;
2. the hosted Invite User template targets `/auth/confirm`, verifies an invite token hash, expires at seven days, claims the exact invitation ID, and creates a 30-minute user-bound password context; Resend issues a fresh Invite User message and only provider acceptance advances `sent_at`/`send_count`;
3. the hosted Reset Password template verifies a recovery token hash (and the allowlisted PKCE fallback works), while an ordinary or expired-context session cannot open/submit the password form;
4. OAuth/recovery callbacks return only to exact allowlisted hosts;
5. unprovisioned, inactive, and expired identities receive no protected data;
6. an active member submits a 0.25-hour request to another active user;
7. requested and different eligible reviewers see their respective queue views;
8. self-review fails and one valid approval records the actual reviewer;
9. approved progress changes while pending remains separate;
10. prior-year leadership cannot authorize a current operation;
11. teacher admin can access accounts/audit and download a complete audited CSV while a member cannot;
12. formula-like export fields remain neutralized and responses are private/no-store;
13. export pagination remains complete when the hosted PostgREST row cap is lower than the requested page size;
14. CSP and other security headers arrive on real HTTPS responses;
15. 390 px mobile and desktop critical flows are usable; and
16. no local demo users/data or design-preview fixture is present.

## Backups and restore

Enable the Supabase backup/PITR capability that meets the school's approved RPO/RTO. Record the actual plan and retention because they vary by subscription. Before risky migrations, verify a recovery point in the dashboard.

If an approved logical dump is additionally required, use a managed operator machine and a restricted path outside the repository:

```bash
supabase db dump --linked --file /APPROVED/SECURE/PATH/schema.sql
supabase db dump --linked --data-only --use-copy --file /APPROVED/SECURE/PATH/data.sql
```

The data dump contains student records. Encrypt, restrict, test in isolation, and delete it under policy. Logical dumps can omit Supabase-managed Auth/Storage schemas and do not replace a verified platform restore.

Before restoring, the incident lead and data owner must stop/restrict writes, preserve evidence, choose forward repair versus PITR, account for post-restore events and Auth identities, and test in an isolated project when time permits.

## Rollback

Application and database rollback are separate.

If the database remains backward-compatible:

```bash
pnpm dlx vercel@latest list --prod
pnpm dlx vercel@latest rollback PREVIOUS_GOOD_DEPLOYMENT_URL
pnpm dlx vercel@latest rollback status
```

To make another already-built deployment current:

```bash
pnpm dlx vercel@latest promote DEPLOYMENT_URL
pnpm dlx vercel@latest promote status
```

Do not delete or edit an applied migration. Repair compatibility/data with a reviewed forward migration. Use restore/PITR only through the incident decision above, then reconcile migration history and prove a fresh local reset.

## External actions still required

The release is not complete until authorized operators supply and verify:

- real Supabase/Vercel projects and environment values;
- hosted signup/password/SMTP/redirect/Google settings;
- backup/PITR plan and tested recovery ownership;
- first and successor teacher administrators;
- protected GitHub branch/check configuration and Preview access control;
- custom domain/DNS/TLS when used;
- school privacy, retention, incident, export-storage, RPO, and RTO decisions; and
- Preview and Production smoke/accessibility/security evidence.

## Current Supabase references

- [Inviting users](https://supabase.com/docs/guides/auth/users#inviting-users)
- [Email templates and server-side token-hash confirmation](https://supabase.com/docs/guides/auth/auth-email-templates#redirecting-the-user-to-a-server-side-endpoint)
- [Local Invite User and Reset Password templates](https://supabase.com/docs/guides/local-development/customizing-email-templates)
- [Password security and secure password change](https://supabase.com/docs/guides/auth/password-security#require-reauthentication-when-changing-password)
- [Email OTP expiry configuration](https://supabase.com/docs/guides/local-development/cli/config#authemailotp_expiry)
- [`verifyOtp` JavaScript reference](https://supabase.com/docs/reference/javascript/auth-verifyotp)
