# NHS Service Hours Portal — Quality assurance

This document defines the automated and manual evidence required before a release. A command appearing here is a procedure, not proof that it passed. Record actual results in the verification ledger at the end of this file and attach CI/deployment evidence to the private release record.

## Test environments and data

- Run unit tests without external services.
- Run database/RLS tests against a freshly reset local Supabase stack.
- Run browser tests against a disposable local or preview environment containing synthetic data only.
- Never point automated tests at production unless the test is an explicitly approved, read-only smoke check.
- Keep passwords and Auth keys in ignored environment files or CI secrets, never in seed SQL, fixtures committed with real identities, screenshots, traces, videos, or test output.

The deterministic seed should cover these personas:

| Persona               | Required characteristics                                            |
| --------------------- | ------------------------------------------------------------------- |
| Ordinary member       | Active membership with only `member`                                |
| Committee head        | Active review role; add `member` when testing combined capabilities |
| President             | Active review role                                                  |
| Vice president        | Active review role                                                  |
| Teacher administrator | Active `teacher_admin`; may also be a member                        |
| Multi-role user       | Two or more roles on one active membership                          |
| Expired member        | Historical member role with no active submit authority              |
| Expired former leader | Historical review role with no current roster/review authority      |

Use two different active users for every approval happy path. Seeded display names, emails, activities, and comments must be obviously fictional.

## Commands

Install reproducibly:

```bash
corepack enable
pnpm install --frozen-lockfile
```

Start and reset the local database:

```bash
supabase start
supabase db reset --local
pnpm test:e2e:prepare
```

Run the application checks:

```bash
pnpm lint
pnpm typecheck
pnpm test
supabase test db
pnpm build
pnpm test:e2e:prepare
pnpm test:e2e
```

`pnpm check` is a convenience command for formatting, lint, typecheck, unit tests, and production build. It does **not** include database tests or Playwright, so those commands remain separate release gates.

For a dependency review:

```bash
pnpm audit --audit-level=high
```

Review every finding in context. A clean command is not a penetration test, and an advisory with no patch must receive an owner, exposure analysis, and time-bounded disposition in `docs/SECURITY.md`.

## Automated test matrix

### Pure domain and validation tests

| Area               | Required cases                                                                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact hours        | Accept 0.25 increments through 24.00; reject zero, negative, non-quarter increments, non-finite/scientific input, and more than 24 hours for one request                    |
| Progress           | Below target, exactly at target, above target, target zero, pending separated from approved, changes-requested/rejected separated, decimal summation without floating drift |
| School year        | Valid/invalid labels and calendar dates, inclusive boundaries, future service date rejection, closed/submission-disabled year                                               |
| Membership         | Active, inactive profile, suspended, expired, archived, expiration boundary, school-year boundary, stale leader                                                             |
| Roles              | Each role, no role, combined roles, reviewer set, teacher-admin-only capabilities                                                                                           |
| Workflow           | Every permitted status transition and every forbidden transition; required reject/change comment; immutable approved state except correction                                |
| Review eligibility | Pending state, same school year, active reviewer, review-capable role, self-review denial, expired reviewer denial                                                          |
| Invitations        | Email normalization, domain matching at the domain boundary, resend/idempotency shape, malformed identifiers and role lists                                                 |
| Password proof     | Signed context round-trip, user binding, invite/recovery purpose, expiry boundary, malformed/tampered token, and minimum secret length                                      |
| Query filters      | Allowlisted status/sort/page values, bounded page size, rejection of arbitrary filter/order fragments                                                                       |
| CSV                | Commas, quotes, CR/LF, empty/null, Unicode, leading spaces, and formula prefixes `=`, `+`, `-`, `@`, tab, and carriage return                                               |
| Audit types        | Sensitive action names are stable and required metadata excludes secrets/raw student payloads                                                                               |

Unit tests demonstrate deterministic business behavior; equivalent database constraints remain necessary because browser/server validation can be bypassed.

### Database, RPC, and RLS tests

Run every policy test as an explicit database role/session, not as the service role.

| Actor/context                    | Allow assertions                                                                                           | Deny assertions                                                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `anon`                           | Auth-required surfaces return no application rows                                                          | Cannot read or mutate any application table/view/function                                                                          |
| Unprovisioned authenticated user | Can establish Auth identity only                                                                           | Cannot read profiles, memberships, requests, roster, invites, audit, or exports                                                    |
| Active member                    | Reads own profile/memberships/requests/progress; drafts/submits/withdraws/resubmits own eligible request   | Cannot read another member's private data; cannot set owner/status/reviewer decision/audit fields; cannot submit to stale reviewer |
| Active reviewer                  | Reads permitted roster/member logs and both pending queues; decides another member's pending request       | Cannot self-review; cannot decide a non-pending request; cannot manage accounts/roles/years/categories without teacher-admin role  |
| Eligible reviewer not assigned   | Can process a request from all-pending and becomes actual reviewer                                         | Assignment does not hide the request or misattribute the decision                                                                  |
| Expired/suspended reviewer       | Historical access only where policy permits                                                                | Cannot view active leader surfaces, review, reassign, or regain authority through stale role rows                                  |
| Teacher administrator            | Manages years/memberships/roles/categories/invites; audits/exports; corrects through protected transaction | Cannot bypass transition/constraint rules or silently overwrite approved/audited history                                           |
| Service role                     | Used only in a narrowly scoped server test for intended Auth administration                                | No browser/client path or general application data path depends on it                                                              |

Required database behaviors:

1. One profile per Auth UUID; one membership per user/year; one role assignment per membership/role.
2. Five unique initial categories; case-insensitive active-name uniqueness; referenced categories cannot be hard-deleted.
3. Exact positive quarter-hour request values up to 24 and safe target values.
4. Requested reviewer belongs to the same school year and has a currently eligible review role.
5. Review RPC locks/rechecks the pending request; two concurrent decisions yield exactly one success and one safe stale-state failure.
6. Requested approver and actual reviewer remain distinct.
7. Change/reject comments are required and every review is immutable.
8. Approved fields cannot change through ordinary table writes; correction records capture actor, reason, before, after, and timestamp atomically.
9. Approved rows alone contribute to completion; pending and changes-requested totals remain separate; target zero never divides by zero.
10. Rollover creates new memberships and preserves prior requests/reviews/corrections/audits.
11. Every account, role, year, category, invitation, review, correction, rollover, and export mutation produces the expected audit event or fails atomically.
12. Invitation preparation does not mutate send facts; provider-accepted acknowledgement sets expiry/count/audit once and remains idempotent on retry.
13. Every exposed view/function remains caller-scoped and cannot bypass underlying RLS.

### Browser end-to-end tests

Automate at least:

1. invited member login → dashboard → new request → reviewer selection → submit → pending total;
2. assigned reviewer login → assigned queue → approve → actual reviewer/history → member approved progress;
3. different eligible reviewer → all-pending → process the same kind of request;
4. self-review attempt denied through the real UI/server/database path;
5. reviewer requests changes with required comment → member edits → resubmits → review succeeds;
6. several approvals exceed the target → uncapped textual percentage and over-goal text, with only the visual bar capped;
7. teacher admin → roster → member profile → complete permitted log/history;
8. teacher admin creates a year or renews a membership with roles and target;
9. expired member login → limited expired-account screen → active actions unavailable and direct URLs denied;
10. ordinary member directly requests leader/admin routes and receives a safe denial/redirect without data leakage;
11. mobile member submission and mobile review, including keyboard operation and error recovery;
12. sign-out, invite/recovery token-hash verification, provider-accepted resend, signed-context password update, ordinary-session password denial, invalid/used invite, and disabled Google-login state;
13. authorized CSV export downloads; ordinary member export attempt fails; dangerous formula-like fixture remains inert;
14. two browser contexts race to review one request and only one terminal decision is recorded.

Tests should assert outcomes and persisted records, not only visible button states. Retain Playwright traces/screenshots only for failed synthetic-data runs; treat any artifact containing real student data as a protected record.

## Manual functional QA

### Authentication and lifecycle

- Public registration has no accessible route and direct Supabase signup is disabled.
- Login has clear invalid-credential, inactive, unprovisioned, and expired states without revealing whether an unrelated email exists.
- Invite and reset callbacks reject off-origin redirect targets.
- Used, revoked, malformed, and expired invitation links fail safely.
- Resending does not duplicate profiles/memberships/roles; provider rejection leaves accepted-send facts unchanged, while a provider-accepted/receipt-failed case is explicit and reconciled before retry.
- `/update-password` requires a fresh invite/recovery proof, a matching signed user-bound context, and its 30-minute lifetime; an ordinary or stale session is denied.
- Deactivation takes effect on the next protected request; renewing creates a separate new-year membership.
- Signing out clears the session; browser Back does not reveal cached private content.
- Google login is absent when disabled and works only for provisioned identities when enabled.

### Member workflow

- Dashboard separately labels approved, pending, changes requested, remaining, and over-goal hours.
- Draft survives ordinary validation errors without changing protected fields.
- Service date, category, hours, reviewer, title, and description show specific inline errors.
- Submitted requests appear in history with requested approver and status.
- A pending eligible request can be withdrawn; forbidden states cannot.
- Changes-requested shows the reviewer comment and permits only the intended edit/resubmit path.
- Approved entries cannot be edited through UI, crafted form data, or direct Data API writes.

### Reviewer and teacher-admin workflow

- Assigned and all-pending queues are distinct, searchable/filterable, correctly sorted, and paginate/bound results.
- Review screen includes member context, activity, requested approver, current status, and immutable review history.
- Reject/change require a comment; approve comment is optional; reassignment preserves history.
- Self-review is denied even for multi-role and teacher-admin users.
- Roster includes every permitted active member; a leader can open full permitted profile/log history.
- Leaders without `teacher_admin` cannot invite, change roles/statuses, manage years/categories/targets, correct records, audit, or export.
- Teacher-admin correction shows before/after/reason and never hides the original approved fact.
- Rollover preview and confirmation create only the selected new memberships and leave the prior year read-only.

### Error and resilience behavior

- Slow responses show a useful pending state and prevent duplicate submissions.
- Double-click/replay/stale-version requests produce one mutation and a recoverable message.
- Supabase/network failure does not fabricate totals or leave a partial review/correction. Invitation provider rejection does not fabricate a send; a provider-accepted/database-receipt split is reported distinctly for audit reconciliation.
- Empty states are informative and not confused with authorization failures.
- Server errors use a correlation-safe message and do not expose stack traces, SQL, keys, tokens, or personal data.

## Accessibility and responsive QA

Run automated axe checks as a baseline, then perform keyboard and screen-reader-oriented manual review. Automated scans cannot prove usability.

Inspect at least these widths, with browser zoom at both 100% and 200% where practical:

| Viewport    | Minimum check                                                                            |
| ----------- | ---------------------------------------------------------------------------------------- |
| 390 × 844   | Login, member dashboard, request form/history, review screen, navigation drawer, dialogs |
| 768 × 1024  | Tablet navigation, form layout, roster/queue transformation, dialogs                     |
| 1440 × 900  | Normal laptop dashboard, full table workflows, settings and audit                        |
| 1920 × 1080 | Wide desktop line lengths, density, alignment, empty/loading/error states                |

Manual accessibility checklist:

- A visible skip link and logical heading hierarchy exist on protected layouts.
- Every control is reachable and operable by keyboard; focus order follows visual order.
- Focus never disappears under sticky headers/dialogs and returns to the trigger after dialog close.
- Dialogs have an accessible name, trap focus, close with Escape when safe, and require explicit confirmation for consequential actions.
- Labels are programmatically associated; required state, help, and validation errors are announced.
- Status, progress, role, and error meaning never rely on color alone; progress includes actual text.
- Text and interactive states meet WCAG 2.2 AA contrast; visible focus meets the focus-appearance requirement.
- Tables have captions or contextual headings and header associations. Mobile cards retain field labels rather than presenting unlabeled values.
- Touch targets and spacing are usable at 390 px without horizontal page scrolling.
- Zoom/reflow at 200% retains content and actions; long names, emails, categories, and comments wrap safely.
- Loading indicators and success/error notices have appropriate live-region behavior without excessive announcements.
- Reduced-motion preferences are respected; no essential information depends on animation.
- Test with a screen reader on at least the login, submission, approval, and error paths.

### Observed static design-fixture evidence — 2026-08-29

The local-only `/design-preview` fixture was checked against `docs/DESIGN_SYSTEM.md` and the four accepted images under `docs/design`. This is visual/component evidence, not an authenticated workflow result.

- A targeted Playwright run of `tests/e2e/design-preview.spec.ts` passed 2/2 tests in Chromium. Desktop (1440×1000) visited dashboard, admin, review, and log fixtures; each had at most 1 px horizontal overflow and zero serious/critical axe violations. Mobile used the iPhone 13 device properties with `browserName: "chromium"`, visited dashboard and log, found the labeled mobile navigation, no overflow, the labeled activity-title field, and visible Save draft/Submit request actions.
- The first automated pass found the destructive button at 4.46:1 contrast. Changing the destructive token from `#c43d3d` to `#b42323` in `src/app/globals.css` corrected it; the complete two-test suite then passed.
- A separate interactive Chrome smoke visited all four fixture states at 390×844, 768×1024, 1440×900, and 1920×1080. Every state produced its expected title, one `h1`, visible main content, no horizontal page overflow, and no current console warning/error. Mobile navigation was visible at 390/768 and absent at desktop widths. The admin search and mobile title field accepted and retained typed values. Keyboard entry focused the visible Skip to content link with a 2 px outline.

| Reference                                     | Fidelity observed                                                                                        | Deliberate/remaining difference                                                                                     |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `docs/design/member-dashboard-desktop-v2.png` | Fixed rail, open white canvas, forest progress/action, attention row, and table-led history              | Synthetic names/totals and the implemented full-history filters differ from concept sample data                     |
| `docs/design/admin-dashboard-desktop-v2.png`  | Metric rail, oldest-request queue, roster table, restrained borders, and leadership navigation hierarchy | Implemented fixture shows five metrics and a simplified table dataset rather than duplicating concept-only samples  |
| `docs/design/review-request-desktop.png`      | Broad request/history column plus narrow member/decision column with amber pending state                 | The fixture leads with the activity title; the authenticated route retains the required `Review request` page title |
| `docs/design/log-hours-mobile.png`            | Single-column labeled form, stacked primary/secondary actions, forest accents, and fixed bottom nav      | Implemented copy/card grouping and sticky action treatment adapt the concept to the complete validated form         |

This comparison supports the intended hierarchy, palette, density, responsive transformation, and primary interaction anatomy. It is not a pixel-diff pass and does not itself prove authenticated workflow behavior. Authenticated data states were exercised separately by the 13/13 passing portal tests in the final local Playwright run; together with the two design-fixture tests, that run passed 15/15 tests in Chromium. The 200% zoom review, other browser engines, dialogs beyond the tested flows, full keyboard order, contrast below axe's serious threshold, and screen-reader announcements remain release checks.

## Security and privacy QA

- Inspect browser bundles/source maps: no elevated key, database password, test password, invitation token, or private environment value appears.
- Check `Set-Cookie` attributes and session refresh/logout behavior on HTTPS.
- Verify CSP, HSTS, frame denial, MIME sniffing protection, referrer policy, and permissions policy on production HTML responses.
- Attempt ID substitution on request, member, membership, reviewer, year, invitation, audit, and export identifiers.
- Attempt extra form fields for owner, role, status, actual reviewer, approved timestamp, audit actor, and target.
- Attempt off-origin redirects and Server Action requests from an untrusted origin.
- Verify authenticated pages, API responses, errors, and CSV use private/no-store caching as appropriate.
- Search logs, traces, error monitoring, and analytics for tokens/cookies/free-text service descriptions/full CSV rows. None should be present.
- Verify CSV quoting and neutralization by opening a synthetic hostile export in the school's supported spreadsheet application.
- Confirm no third-party analytics or tracking receives student records.
- Review dependency advisories and the findings/dispositions in `docs/SECURITY.md`.

## CSV import/export manual cases

Use a synthetic file containing:

- a comma, double quote, CRLF, LF, and Unicode character;
- empty optional cells and whitespace-only required cells;
- duplicate email, duplicate header, unknown header, and missing required header;
- malformed email/date/role/status/target and an email outside the allowlist;
- `=1+1`, `+SUM(A1:A2)`, `-2+3`, `@cmd`, a tab-prefixed value, a CR-prefixed value, and the same prefixes after leading spaces;
- an unexpectedly large field and more rows than the documented import limit; and
- a partial batch containing both valid and invalid rows.

Expected properties:

- import validates the whole file before mutation, reports row-specific errors without echoing sensitive rows into logs, and has an explicit all-or-nothing or clearly documented partial-commit policy;
- export is server-authorized, audited, UTF-8, consistently ordered, correctly quoted, and formula-neutralized;
- export continues after a nonempty short page and stops only on an empty page, so a hosted PostgREST maximum-row cap cannot silently truncate it;
- the response is an attachment with a safe filename and `Cache-Control: private, no-store`; and
- email is present only in exports whose authorized purpose requires it.

## Release evidence and defect policy

Block release for:

- any failed lint, typecheck, unit, database/RLS, required E2E, or production-build gate;
- any Critical or High unresolved security issue;
- cross-user record access, stale-role authority, self-review, mutable approved/audit history, lost audit events, incorrect progress, or unsafe CSV;
- a keyboard trap, inaccessible critical action, missing form label, color-only status, or unusable 390 px critical flow;
- a production/preview credential or data-isolation error; or
- missing backup/rollback ownership and first-admin bootstrap procedure.

Medium issues require a documented owner, compensating control, and due date accepted by the system/data owner. Low issues may be scheduled but remain visible.

## Verification ledger

Update this table only with observed results from the final implementation. Use an ISO timestamp and commit SHA in the private release record.

| Check                             | Status                              | Evidence / notes                                                                                                                                                                                                                                                                                                                        |
| --------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`  | Passed, 2026-08-29                  | Frozen installation completed against the final `pnpm-lock.yaml`                                                                                                                                                                                                                                                                        |
| `pnpm format:check`               | Passed, 2026-08-29                  | Prettier reported that all matched files use its code style                                                                                                                                                                                                                                                                             |
| `pnpm lint`                       | Passed, 2026-08-29                  | ESLint completed with `--max-warnings=0`                                                                                                                                                                                                                                                                                                |
| `pnpm typecheck`                  | Passed, 2026-08-29                  | Full-repository `tsc --noEmit` completed successfully                                                                                                                                                                                                                                                                                   |
| `pnpm test`                       | Passed, 2026-08-29                  | Vitest: 13 files, 204 tests passed                                                                                                                                                                                                                                                                                                      |
| Domain unit tests                 | Passed (partial), 2026-08-29        | Final domain suite: 8 files, 181 tests passed                                                                                                                                                                                                                                                                                           |
| Domain lint                       | Passed (partial), 2026-08-29        | `pnpm exec eslint src/lib/domain --max-warnings=0`                                                                                                                                                                                                                                                                                      |
| Domain isolated strict TypeScript | Passed (partial), 2026-08-29        | All domain implementation and test TypeScript included; superseded for release purposes by the full passing typecheck                                                                                                                                                                                                                   |
| Migration/seed PGlite check       | Historical supplemental, 2026-08-29 | Pre-second-migration evidence only: the then-current migration and seed ran twice in PGlite. This did not exercise the final two-migration schema, Supabase/PostgREST, or native pgTAP and is superseded by the native reset and pgTAP results below.                                                                                   |
| SQL parser check                  | Historical supplemental, 2026-08-29 | Pre-second-migration SQLFluff PostgreSQL parsing evidence only; it is not final-schema runtime evidence and is superseded by the native reset and pgTAP results below                                                                                                                                                                   |
| `supabase db reset --local`       | Passed, 2026-08-29                  | Native local Supabase reset applied both migrations and the deterministic seed successfully                                                                                                                                                                                                                                             |
| `supabase test db`                | Passed, 2026-08-29                  | Native pgTAP: 7 files, 226 assertions passed (plans 54+51+32+8+20+48+13)                                                                                                                                                                                                                                                                |
| `pnpm build`                      | Passed, 2026-08-29                  | Production build completed successfully on Node 22                                                                                                                                                                                                                                                                                      |
| Full `pnpm test:e2e`              | Passed, 2026-08-29                  | Chromium: 15/15 tests passed—13 authenticated portal tests plus 2 local design-fixture tests                                                                                                                                                                                                                                            |
| Design-preview Playwright         | Passed (static fixture), 2026-08-29 | `tests/e2e/design-preview.spec.ts`: 2/2 Chromium tests passed after the destructive-contrast correction; desktop four-screen axe/overflow and mobile dashboard/form checks passed. This visual/component evidence is distinct from the 13/13 authenticated portal tests.                                                                |
| `pnpm audit --audit-level=high`   | Passed, 2026-08-29                  | On Node 22, pnpm reported no known vulnerabilities for the final `pnpm-lock.yaml`                                                                                                                                                                                                                                                       |
| GitHub Actions                    | Passed, 2026-08-29                  | Run `33240848186` passed for commit `e7ae98dd01d4406ab2f282639ab8325131d094c3`                                                                                                                                                                                                                                                          |
| Manual role/authorization QA      | Not recorded                        | Test every persona and direct URL/ID substitution                                                                                                                                                                                                                                                                                       |
| Accessibility + 4 viewports       | Partial, 2026-08-29                 | Static fixtures: Playwright axe/overflow passed as above; interactive Chrome covered all four screens at 390×844, 768×1024, 1440×900, and 1920×1080 with no overflow/current console issue. Authenticated Chromium workflows passed separately; 200% zoom, full keyboard order, other browser engines, and screen-reader review remain. |
| Preview deployment smoke          | Not recorded                        | Requires hosted Supabase/Vercel credentials                                                                                                                                                                                                                                                                                             |
| Production deployment smoke       | Not recorded                        | Required only after authorized production deployment                                                                                                                                                                                                                                                                                    |
