# NHS Service Hours Portal — Testing guide

This is the contributor-facing test guide. `docs/QA.md` contains the complete manual, security, CSV, accessibility, responsive, and release matrices plus the authoritative observed-results ledger.

## Test layers

| Layer            | Command                         | What it proves                                                                        | What it does not prove                                          |
| ---------------- | ------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Formatting       | `pnpm format:check`             | Tracked source matches repository formatting rules                                    | Correctness or accessibility                                    |
| Lint             | `pnpm lint`                     | Static ESLint rules pass without warnings                                             | Runtime authorization                                           |
| TypeScript       | `pnpm typecheck`                | Repository TypeScript compiles without emitting                                       | Database schema/query compatibility at runtime                  |
| Domain unit      | `pnpm test`                     | Pure hours, dates, roles, workflow, progress, invitation, query, CSV, and audit rules | RLS, Auth, PostgREST relationships, browser behavior            |
| Database/RLS     | `supabase test db`              | pgTAP schema, privileges, functions, workflow, reporting, and actor allow/deny cases  | Hosted configuration or true browser behavior                   |
| Browser          | `pnpm test:e2e`                 | Real UI/server/Auth/database flows at desktop/mobile widths                           | Every manual accessibility/security case or production settings |
| Production build | `pnpm build`                    | Next.js can compile and prerender with valid environment shape                        | Hosted runtime success                                          |
| Dependency audit | `pnpm audit --audit-level=high` | Known advisories in the resolved lockfile at that time                                | Unknown vulnerabilities or application design flaws             |

`pnpm check` runs formatting, lint, typecheck, unit tests, and production build. It intentionally excludes database and Playwright tests; run those as separate release gates.

## Install and local environment

Use the pinned package manager and a container runtime:

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
supabase start
supabase status
```

Copy the local API URL, browser-safe key, and elevated local key into `.env.local`. Generate a separate `PASSWORD_UPDATE_CONTEXT_SECRET` of at least 32 random bytes, for example with `openssl rand -hex 32`. Keep `NEXT_PUBLIC_APP_URL=http://localhost:3000`, `ALLOWED_EMAIL_DOMAINS=example.edu`, Google disabled, and design preview disabled for authenticated workflow tests. Never publish `supabase status` or secret-generator output.

Reset to deterministic test data before database/browser runs:

```bash
supabase db reset --local
supabase test db
```

`supabase/seed.sql` supplies eight fictional personas, five categories, requests in representative statuses, and the shared local-only password documented in `docs/OPERATIONS.md`. It must never be pushed to a hosted environment.

## Unit tests

Run:

```bash
pnpm test
```

The current unit suite under `src/lib/domain` covers:

- exact quarter-hour parsing/validation and request/target boundaries;
- real ISO school-year dates and active-year/membership eligibility;
- role and review-capability rules;
- allowed/forbidden request workflow transitions, self-review, and actual-reviewer invariants;
- approved/pending/category-cap progress, target zero, and over-goal percentages;
- strict allowlisted filters, pagination, and parameter-pollution rejection;
- invitation email/domain/role/expiry validation;
- CSV quoting, line endings, Unicode, and spreadsheet-formula neutralization; and
- typed bounded audit event shapes.

The pure domain subset contains eight files and 181 tests, including the final invitation send audit taxonomy. The repository unit run also includes nine same-origin navigation tests, four signed password-update-context tests, and five invitation-delivery coordinator tests, for a current total of eleven files and 199 tests. Record the actual count/output from the release commit rather than assuming those numbers still apply.

## Database and RLS tests

The pgTAP files are:

- `supabase/tests/001_schema_contract.sql` — tables/views/functions, RLS/forced-RLS, grants, constraints, indexes, and policy-helper privilege contract;
- `supabase/tests/002_workflows_and_rls.sql` — request lifecycle, eligibility, reviews, self-review, progress, invitations, audits, and direct caller behavior;
- `supabase/tests/003_admin_lifecycle_and_authorization.sql` — anonymous/unprovisioned/member/reviewer/admin boundaries, different eligible reviewer, corrections, targets, renewal/rollover/history, and export visibility;
- `supabase/tests/004_bootstrap.sql` — service-role-only one-time first-admin behavior, roles, audit, and second-call denial;
- `supabase/tests/005_reviewer_directory.sql` — ordinary-member minimal reviewer discovery plus self/inactive/expired/suspended/non-review/other-year exclusions and anonymous/unprovisioned/expired denial; and
- `supabase/tests/006_invitation_send_integrity.sql` — two-phase delivery privileges/state checks, provider-accepted send facts/audits, idempotent acknowledgement, resend behavior, and unauthorized denial.

They currently declare 213 assertions in total (plans 54 + 51 + 32 + 8 + 20 + 48). Run them only after a clean reset:

```bash
supabase db reset --local
supabase test db
```

For every actor test, set an explicit PostgreSQL role and Auth claim context. Test both allowed and denied operations through tables, views, and functions; a service-role query bypasses the control under test.

Critical cases include:

1. anonymous and unprovisioned callers receive no application rows;
2. a member sees only their records and cannot directly set protected fields;
3. requested and different eligible reviewers can process another user's pending request;
4. self-review and expired/stale leadership fail;
5. a terminal second decision fails and only one actual reviewer is recorded;
6. approved records require an audited immutable correction;
7. pending/changes-requested hours do not count as approved progress;
8. target zero and over-goal progress are exact;
9. school-year/category/reviewer composite references cannot cross years;
10. rollover preserves prior membership/history and does not preserve stale authority;
11. account/role/year/category/invitation/review/correction/rollover/export actions append audit events; and
12. invitation provider rejection cannot fabricate send facts, while accepted acknowledgements are idempotent; and
13. authenticated policy predicates have only the exact helper privileges needed to evaluate forced RLS.

PostgreSQL row locks are used for review concurrency, and the SQL suite checks a stale sequential second action. Before release, also run a true simultaneous two-session or two-browser-context race and prove exactly one decision persists.

## Playwright end-to-end tests

The configuration is `playwright.config.ts`; authenticated workflows are in `tests/e2e/portal.spec.ts`, and local visual/accessibility fixtures are in `tests/e2e/design-preview.spec.ts`. Both projects use Chromium: desktop at 1440×1000 and mobile with the iPhone 13 viewport/device properties plus an explicit Chromium browser override.

Install Chromium once, reset the database, and run:

```bash
pnpm exec playwright install chromium
supabase db reset --local
pnpm test:e2e
```

By default Playwright starts `pnpm dev` at `http://127.0.0.1:3000`. Set `PLAYWRIGHT_BASE_URL` to a safe alternate origin. Set `PLAYWRIGHT_SKIP_WEBSERVER=1` only when that exact server is already managed externally. `E2E_PASSWORD` may override the local-only fixture password; keep it in ignored/CI secret storage.

The committed browser suite covers the eleven specification workflows:

1. member login/dashboard/submission/approver/pending status;
2. requested reviewer approval and member progress;
3. a different eligible reviewer using all-pending;
4. self-review denial;
5. changes requested, edit, and resubmit;
6. actual percentage above target and over-goal text;
7. teacher-admin roster/member history plus one serious/critical axe scan;
8. year creation and expired-membership renewal;
9. expired-account experience;
10. ordinary member denied an admin route; and
11. mobile submission and approval.

The design-preview suite is deliberately independent of Supabase data. With `NHS_DESIGN_PREVIEW=true`, it checks all four fixture screens on desktop for horizontal overflow and serious/critical axe violations, then checks the member dashboard and hour form on mobile for visible mobile navigation, no overflow, a labeled title field, and visible Save/Submit actions. Run only that non-authenticated layer with:

```bash
NHS_DESIGN_PREVIEW=true pnpm exec playwright test tests/e2e/design-preview.spec.ts
```

That command proves rendered fixture structure only. It cannot substitute for the seeded login/role/workflow suite or a manual screen-reader/zoom review.

Add assertions for invite/reset/sign-out, callback failure, CSV completeness/authorization, hostile CSV fixtures, a true review race, keyboard-only workflows, and broader axe coverage before treating the browser layer as complete assurance.

Playwright traces, screenshots, videos, and HTML reports can contain page data. Retain them only for failed synthetic runs, keep them out of Git, and handle any real-record artifact as a protected student record.

## Production build

The environment parser intentionally fails closed when required public settings are absent. Configure `.env.local`, or for a build-only shape check use non-secret syntactically valid placeholders equivalent to CI:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=example-anon-key-that-is-long-enough-for-build \
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000 \
PASSWORD_UPDATE_CONTEXT_SECRET=build-only-password-context-secret-000000000000 \
ALLOWED_EMAIL_DOMAINS=example.edu \
NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false \
NHS_DESIGN_PREVIEW=false \
pnpm build
```

A placeholder build proves compilation only. It does not prove connectivity, Auth, RLS, or data rendering. Use Node.js 22 in CI/deployment to avoid the Supabase JavaScript client's Node 20 deprecation warning.

## CI

`.github/workflows/ci.yml` runs on pull requests and pushes to `main` with read-only repository permission and cancellation of obsolete runs:

- **application:** install, format, lint, typecheck, unit, audit, and production build on Node 22;
- **database:** start Supabase and run pgTAP; and
- **browser:** wait for application/database jobs, start/reset the local Supabase stack, export local keys to job environment, install Chromium, and run Playwright.

Require the relevant checks through branch protection. A workflow definition in Git is not a passing run; inspect job output from the exact commit. Do not print exported Supabase environment files or secret values.

## Manual release testing

Automated checks do not replace these manual groups in `docs/QA.md`:

- invite/recovery token-hash confirmation, exact invitation claim, seven-day expiry, 30-minute user-bound password context, provider-accepted send receipt, fresh Invite User resend, PKCE recovery fallback, invalid/expired/used/revoked invite, ordinary-session password denial, Google disabled/enabled, and sign-out lifecycle;
- every role and direct URL/ID substitution, including expired former leaders;
- draft/submit/withdraw/change/resubmit/review/reassign/correct flows;
- queue filters, pagination, empty/loading/network/stale/double-submit states;
- CSV import validation, partial-delivery messaging, export completeness, formula safety, attachment/private-cache headers, and audit event;
- privacy/log/source-map/secret/header/cookie checks;
- 390×844, 768×1024, 1440×900, and 1920×1080 at 100% and 200% zoom; and
- keyboard, focus, forms/errors, dialogs, status/progress equivalents, contrast, reflow, reduced motion, and screen-reader paths.

Release blocks on any failed required check; Critical/High security issue; cross-user access; stale-role/self-review authority; mutable approved/audit history; incorrect totals; incomplete/unsafe CSV; inaccessible critical path; environment isolation error; or missing backup/bootstrap ownership.

## Current observed status

Do not duplicate a stale pass/fail list here. `docs/QA.md` records time-stamped observations. At this guide's update, the targeted two-test design-preview Playwright suite and a separate four-viewport static-fixture browser smoke had been observed, but the native database suite and authenticated portal Playwright suite remained blocked by the unavailable local Supabase/PostgreSQL stack. No hosted smoke, 200% zoom, or screen-reader run was observed. Those are release gaps, not documentation gaps.
