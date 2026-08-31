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
| President / VP        | Active `member` plus `president_vice_president` review role         |
| Teacher administrator | Global `teacher_admin`, teacher-only anchors, no member progress    |
| Platform owner        | Sole global owner with read-only synthetic role preview             |
| Multi-role user       | `member` plus both annual leadership capabilities                   |
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

| Area               | Required cases                                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact hours        | Accept 0.25 increments through 24.00; reject zero, negative, non-quarter increments, non-finite/scientific input, and more than 24 hours for one request          |
| Progress           | Below/exact/above fixed 20-hour target; approved then pending stacked/capped visually; approved/pending/remaining/over-goal text; decimal summation without drift |
| School year        | Valid/invalid labels and calendar dates, inclusive boundaries, future service date rejection, closed/submission-disabled year                                     |
| Membership         | Active, inactive profile, suspended, expired, archived, expiration boundary, school-year boundary, stale leader                                                   |
| Roles              | Member, Committee head, combined President / Vice President, exclusive global teacher admin, sole owner, stale annual leadership                                  |
| Workflow           | Every permitted status transition and every forbidden transition; required reject/change comment; immutable approved state except correction                      |
| Review eligibility | Pending state, same school year, active reviewer, review-capable role, self-review denial, expired reviewer denial                                                |
| Invitations        | Email normalization, domain matching at the domain boundary, resend/idempotency shape, malformed identifiers and role lists                                       |
| Password proof     | Signed context round-trip, user binding, invite/recovery purpose, expiry boundary, malformed/tampered token, and minimum secret length                            |
| Query filters      | Allowlisted status/sort/page values, bounded page size, rejection of arbitrary filter/order fragments                                                             |
| CSV                | Commas, quotes, CR/LF, empty/null, Unicode, leading spaces, and formula prefixes `=`, `+`, `-`, `@`, tab, and carriage return                                     |
| Audit types        | Sensitive action names are stable and required metadata excludes secrets/raw student payloads                                                                     |

Unit tests demonstrate deterministic business behavior; equivalent database constraints remain necessary because browser/server validation can be bypassed.

### Database, RPC, and RLS tests

Run every policy test as an explicit database role/session, not as the service role.

| Actor/context                    | Allow assertions                                                                                         | Deny assertions                                                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `anon`                           | Auth-required surfaces return no application rows                                                        | Cannot read or mutate any application table/view/function                                                                          |
| Unprovisioned authenticated user | Can establish Auth identity only                                                                         | Cannot read profiles, memberships, requests, roster, invites, audit, or exports                                                    |
| Active member                    | Reads own profile/memberships/requests/progress; drafts/submits/withdraws/resubmits own eligible request | Cannot read another member's private data; cannot set owner/status/reviewer decision/audit fields; cannot submit to stale reviewer |
| Active committee head            | Sees requests explicitly assigned to them and completes the first approval                               | Cannot act on another head's request or complete the teacher stage                                                                 |
| Expired/suspended reviewer       | Historical access only where policy permits                                                              | Cannot view active leader surfaces, review, reassign, or regain authority through stale role rows                                  |
| Global teacher administrator     | Sees every committee-head-approved request, gives the final decision, and manages administration         | Cannot bypass the committee-head stage; has no member progress/target; cannot manage owner-only grants                             |
| Platform owner                   | Teacher-admin abilities plus grant/revoke/transfer and synthetic role preview                            | Cannot impersonate a real user, combine global/member access, remove final admin, or leave no owner                                |
| Service role                     | Used only in a narrowly scoped server test for intended Auth administration                              | No browser/client path or general application data path depends on it                                                              |

Required database behaviors:

1. One profile per Auth UUID; one membership per user/year; one role assignment per membership/role.
2. Five unique initial categories; alphabetical/cap-free policy; case-insensitive active-name uniqueness; referenced categories cannot be hard-deleted.
3. Exact positive quarter-hour request values up to 24 and a fixed 20-hour target with null membership overrides.
4. The member-selected first approver belongs to the same school year and has an active committee-head role; teachers never appear in that picker.
5. Committee-head approval keeps the request pending and exposes it to all teachers; only a teacher approval grants hour credit.
6. Review RPC locks/rechecks the pending request; two concurrent final decisions yield exactly one success and one safe stale-state failure.
7. Change/reject comments are required and every review is immutable.
8. Approved fields cannot change through ordinary table writes; correction records capture actor, reason, before, after, and timestamp atomically.
9. Approved rows alone contribute to completion; pending and changes-requested totals remain separate; global admins never appear in member progress/counts.
10. Destination-year access creates/reactivates a fixed-policy membership and preserves prior requests/reviews/corrections/audits without carrying stale leadership.
11. Every account, role, global grant/transfer, year, category, invitation, review, correction, destination-access, and export mutation audits or fails atomically.
12. Invitation preparation does not mutate send facts; provider-accepted acknowledgement sets expiry/count/audit once and remains idempotent on retry.
13. Every exposed view/function remains caller-scoped and cannot bypass underlying RLS.

### Browser end-to-end tests

Automate at least:

1. invited member login → dashboard → new request → committee-head selection → submit → pending total;
2. selected committee head → first approval → request remains pending and enters the teacher queue;
3. any teacher → shared queue → final approval → final reviewer/history → member approved progress;
4. self-review attempt denied through the real UI/server/database path;
5. reviewer requests changes with required comment → member edits → resubmits → review succeeds;
6. approved/pending values produce adjacent colored segments and neutral remainder; several approvals exceed 20 → uncapped text and capped visual;
7. teacher admin → roster → member profile → complete permitted log/history;
8. teacher admin creates a year and adds destination-year member/leadership access; global admin remains year-independent and excluded from progress;
9. expired member login → limited expired-account screen → active actions unavailable and direct URLs denied;
10. ordinary member directly requests leader/admin routes and receives a safe denial/redirect without data leakage;
11. mobile member submission and mobile review, including keyboard operation and error recovery;
12. sign-out, invite/recovery token-hash verification, provider-accepted resend, signed-context password update, ordinary-session password denial, invalid/used invite, and disabled Google-login state;
13. authorized CSV export downloads; ordinary member export attempt fails; dangerous formula-like fixture remains inert;
14. two browser contexts race to review one request and only one terminal decision is recorded.
15. platform owner opens all four synthetic role previews; hosted fixture content is read-only and non-owner access fails.

Tests should assert outcomes and persisted records, not only visible button states. Retain Playwright traces/screenshots only for failed synthetic-data runs; treat any artifact containing real student data as a protected record.

## Manual functional QA

### Authentication and lifecycle

- Public registration has no accessible route and direct Supabase signup is disabled.
- Login has clear invalid-credential, inactive, unprovisioned, and expired states without revealing whether an unrelated email exists.
- Invite and reset callbacks reject off-origin redirect targets.
- Used, revoked, malformed, and expired invitation links fail safely.
- Resending does not duplicate profiles/memberships/roles; provider rejection leaves accepted-send facts unchanged, while a provider-accepted/receipt-failed case is explicit and reconciled before retry.
- `/update-password` requires a fresh invite/recovery proof, a matching signed user-bound context, and its 30-minute lifetime; an ordinary or stale session is denied.
- Deactivation takes effect on the next protected request; adding destination-year access creates a separate membership without changing prior history.
- Signing out clears the session; browser Back does not reveal cached private content.
- Google login is absent when disabled and works only for provisioned identities when enabled.

### Member workflow

- Dashboard separately labels approved, pending, changes requested, remaining, and over-goal hours.
- Draft survives ordinary validation errors without changing protected fields.
- Service date, category, hours, committee head, title, and description show specific inline errors.
- Submitted requests appear in history with selected committee head and approval stage.
- A pending eligible request can be withdrawn; forbidden states cannot.
- Changes-requested shows the reviewer comment and permits only the intended edit/resubmit path.
- Approved entries cannot be edited through UI, crafted form data, or direct Data API writes.

### Reviewer and teacher-admin workflow

- Committee heads see only their assigned first-stage queue; every teacher sees the shared final-stage queue.
- Review screen includes member context, activity, selected committee head, current stage, and immutable review history.
- Reject/change require a comment; approve comment is optional; reassignment preserves history.
- Self-review is denied even for multi-role and teacher-admin users.
- Roster includes every permitted active member; a leader can open full permitted profile/log history.
- Leaders without `teacher_admin` cannot invite, change roles/statuses, manage years/categories, alter the fixed 20-hour policy, correct records, audit, or export.
- Teacher-admin correction shows before/after/reason and never hides the original approved fact.
- Assigning destination-year access creates only the selected new membership, preserves the prior year as read-only history, and never carries leadership forward implicitly.

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

### Historical static design-fixture evidence — 2026-08-29

The local-only `/design-preview` fixture was checked against `docs/DESIGN_SYSTEM.md` and the four accepted images under `docs/design`. This is visual/component evidence, not an authenticated workflow result.

- A targeted Playwright run of `tests/e2e/design-preview.spec.ts` passed 2/2 tests in Chromium. Desktop (1440×1000) visited dashboard, admin, review, and log fixtures; each had at most 1 px horizontal overflow and zero serious/critical axe violations. Mobile used the iPhone 13 device properties with `browserName: "chromium"`, visited dashboard and log, found the labeled mobile navigation, no overflow, the labeled activity-title field, and visible Save draft/Submit request actions.
- The first automated pass found the destructive button at 4.46:1 contrast. Changing the destructive token from `#c43d3d` to `#b42323` in `src/app/globals.css` corrected it; the complete two-test suite then passed.
- A separate interactive Chrome smoke visited all four fixture states at 390×844, 768×1024, 1440×900, and 1920×1080. Every state produced its expected title, one `h1`, visible main content, no horizontal page overflow, and no current console warning/error. Mobile navigation was visible at 390/768 and absent at desktop widths. The admin search and mobile title field accepted and retained typed values. Keyboard entry focused the visible Skip to content link with a 2 px outline.

### Current in-app design-fixture evidence — 2026-08-30

- On 2026-08-30, an in-app browser smoke verified the new Member, combined President / Vice President, and global Teacher administrator fixtures. The progress track rendered 72.5% approved followed by 16.25% pending with neutral remainder. A 390×844 check exposed and then verified a correction for the fixed preview switcher covering the page heading; the corrected page had zero horizontal overflow, no heading overlap, labeled mobile navigation, and no console warnings/errors.

| Reference                                     | Fidelity observed                                                                                        | Deliberate/remaining difference                                                                                     |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `docs/design/member-dashboard-desktop-v2.png` | Fixed rail, open white canvas, forest progress/action, attention row, and table-led history              | Synthetic names/totals and the implemented full-history filters differ from concept sample data                     |
| `docs/design/admin-dashboard-desktop-v2.png`  | Metric rail, oldest-request queue, roster table, restrained borders, and leadership navigation hierarchy | Implemented fixture shows five metrics and a simplified table dataset rather than duplicating concept-only samples  |
| `docs/design/review-request-desktop.png`      | Broad request/history column plus narrow member/decision column with amber pending state                 | The fixture leads with the activity title; the authenticated route retains the required `Review request` page title |
| `docs/design/log-hours-mobile.png`            | Single-column labeled form, stacked primary/secondary actions, forest accents, and fixed bottom nav      | Implemented copy/card grouping and sticky action treatment adapt the concept to the complete validated form         |

This comparison supports the intended hierarchy, palette, density, responsive transformation, and primary interaction anatomy. It is not a pixel-diff pass and does not itself prove authenticated workflow behavior. The previous schema's local Playwright run exercised 13/13 authenticated portal tests and 2/2 design-fixture tests; both specs have changed for this release and their current versions require exact-commit CI. The 200% zoom review, other browser engines, dialogs beyond the tested flows, full keyboard order, contrast below axe's serious threshold, and screen-reader announcements remain release checks.

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
- malformed email/role, disallowed extra headers, and an email outside the allowlist;
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

## Verification evidence

Use an ISO timestamp and commit SHA in the private release record. Current evidence and prior-schema evidence are deliberately separated below.

### Current release ledger — 2026-08-30

| Check                            | Status                     | Evidence / notes                                                                                                                                                                     |
| -------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Frozen dependency installation   | Passed                     | Clean temporary workspace installed the current lockfile with the bundled Node runtime                                                                                               |
| Formatting                       | Passed                     | Prettier reported all matched files use its style                                                                                                                                    |
| Lint                             | Passed                     | ESLint completed with `--max-warnings=0`                                                                                                                                             |
| TypeScript                       | Passed                     | Full-repository `tsc --noEmit` completed successfully                                                                                                                                |
| Unit tests                       | Passed                     | Vitest: 14 files, 209 tests                                                                                                                                                          |
| Production build                 | Passed                     | Next.js 16.3.3 production build completed with validated placeholder build-time environment values                                                                                   |
| SQL parse and pgTAP plan counts  | Passed (static)            | Migration dialect parsing passed; eight pgTAP files declare and contain 301 assertions (63 + 51 + 37 + 9 + 20 + 48 + 13 + 60)                                                        |
| Linked Supabase migration review | Passed (read-only)         | `db push --linked --dry-run` reported only `20260830010000_global_admin_and_simplified_policy.sql`, with no seed, role, or other migration                                           |
| Native reset / pgTAP             | Pending exact-commit CI    | No local Docker-compatible runtime is installed; the clean CI database job is the release gate                                                                                       |
| Authenticated Playwright         | Pending exact-commit CI    | Current test discovery loads 15 tests; local execution requires the unavailable local Supabase stack                                                                                 |
| Design-preview Playwright        | Pending exact-commit CI    | Current two-test spec includes stacked-progress and mobile toolbar/heading clearance assertions; the local Playwright package lacks its matching Chromium binary                     |
| In-app browser responsive smoke  | Passed (synthetic fixture) | Member, combined leadership, and global-admin previews; stacked progress; desktop/mobile placement; 390×844 no-overflow/no-heading-overlap check; no current console warnings/errors |
| Hosted staging smoke             | Pending                    | Perform against the ready unique deployment after the migration and before alias promotion                                                                                           |

### Historical prior-schema ledger — 2026-08-29

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
