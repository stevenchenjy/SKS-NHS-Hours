# NHS Service Hours Portal — Security and privacy review

## Review scope and assurance boundary

This is a source-based security review of the Next.js/TypeScript application, Supabase configuration and database design, and operational procedures. It focuses on authentication, authorization, data integrity, student privacy, browser risks, CSV handling, deployment, and recovery.

It is not a penetration test, legal opinion, FERPA determination, or verification of settings in a hosted Supabase/Vercel/Google/SMTP account. A local control is not considered effective in production until its production configuration and allow/deny behavior have been observed. `docs/QA.md` is the evidence checklist; `docs/OPERATIONS.md` is the operator runbook.

Review evidence available in the repository includes:

- `src/proxy.ts` for session refresh and the response Content Security Policy;
- `next.config.ts` for global response headers and Server Action origin configuration;
- `src/lib/env.ts` and `.env.example` for validated runtime configuration;
- `src/lib/supabase/server.ts`, `src/lib/supabase/browser.ts`, and `src/lib/supabase/admin.ts` for credential/session boundaries;
- `src/lib/dal/access.ts` for centralized current-viewer and role guards;
- `src/lib/dal/portal.ts` for caller-scoped data access;
- `src/lib/safe-navigation.ts`, `src/app/auth/callback/route.ts`, `src/app/auth/confirm/route.ts`, `src/app/auth/recovery-callback/route.ts`, and `src/lib/auth/claim-invitation.ts` for same-origin navigation, code/token-hash verification, and fail-closed provisioning;
- `src/lib/auth/password-update-context.ts`, `src/lib/auth/invitation-delivery.ts`, and their tests for bounded password proof and provider-before-database invitation delivery ordering;
- `src/app/api/exports/[type]/route.ts` for teacher-admin authorization, deterministic pagination, CSV response headers, and export auditing;
- `src/lib/domain/hours.ts`, `src/lib/domain/roles.ts`, `src/lib/domain/school-year.ts`, and `src/lib/domain/workflow.ts` for deterministic validation and state rules;
- `src/lib/domain/csv.ts`, `src/lib/domain/query.ts`, `src/lib/domain/invitation.ts`, `src/lib/domain/progress.ts`, and `src/lib/domain/audit.ts` for bounded CSV, filters, lifecycle, calculations, and audit shapes;
- `supabase/migrations/20260829030000_initial_nhs_backend.sql` for normalized records, constraints, immutable triggers, caller-derived functions, security-invoker views, grants, and forced RLS;
- `supabase/migrations/20260829040000_hour_request_reviewer_names.sql` for request-scoped reviewer-name attribution without broad profile or membership disclosure;
- `supabase/migrations/20260830010000_global_admin_and_simplified_policy.sql` for global administrator grants and owner succession, combined President / Vice President access, fixed 20-hour targets, neutral category-limit fields, and safe destination-year access;
- `supabase/config.toml` for local Auth defaults;
- `supabase/templates/invite.html` and `supabase/templates/recovery.html` for local token-hash Auth templates;
- `supabase/tests` and `tests/e2e/portal.spec.ts` for authored database/browser assurance cases; and
- `docs/DECISIONS.md` for the intended authorization and integrity model.

Database migrations are the source of truth for grants, RLS, transactional workflow enforcement, audit immutability, and view safety. For the current change, formatting, lint, TypeScript, 209 unit tests, production build, SQL parsing/plan counts, and a linked migration dry-run pass. The new eight-file/301-assertion database suite still requires clean CI/container execution; older native database/browser passes describe the previous schema only. Hosted settings and manual release observations remain separate gates.

## Data classification and security objectives

Treat all authenticated portal data as confidential school records.

| Asset                     | Examples                                                                | Primary objective                                   |
| ------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------- |
| Identity and contact data | Auth UUID, name, email, graduation year                                 | Confidentiality, correctness, minimum collection    |
| Membership and authority  | School year, status, expiration, roles, renewals                        | Integrity and timely revocation                     |
| Service records           | Title, description, date, category, requested/actual reviewer, hours    | Confidentiality, integrity, availability            |
| Decision history          | Reviews, comments, corrections, before/after facts                      | Immutability, attribution, ordering                 |
| Administrative history    | Invitations, account/role/year/category/export audit events             | Completeness, attribution, restricted access        |
| Credentials               | Session cookies, OAuth secrets, SMTP credentials, elevated Supabase key | Secrecy and rotation                                |
| Exports/backups           | CSV files and database snapshots                                        | Confidentiality, access control, deletion/retention |

The core integrity objectives are: no cross-member data access, no self-review, no stale leadership authority, only one valid terminal decision under concurrency, no silent approved-record edits, exact hour totals, and an audit event in the same transaction as each sensitive database change.

## Threat model summary

### Actors and capabilities

- An unauthenticated internet user can send arbitrary HTTP requests and Auth payloads.
- An authenticated but unprovisioned user has a valid identity but no portal authority.
- A member can alter client-side state, IDs, hidden fields, request ordering, and direct Data API calls.
- A leader can legitimately view broad roster/service information and may attempt self-review or administration.
- A teacher administrator has high-impact application authority but should still be constrained by workflow invariants.
- A maintainer or stolen server credential may reach the elevated Supabase client and bypass RLS.
- Spreadsheet software may execute exported cells as formulas.
- Third-party platforms and operators can expose data through misconfiguration, logs, backups, preview deployments, or compromised accounts.

### Trust boundaries

The browser is untrusted. Next.js is a trusted orchestration tier but all request data, cookies, URL parameters, and headers remain untrusted until checked. Supabase Auth authenticates; it does not confer a membership or role. PostgreSQL constraints, grants, RLS, and serialized RPCs are the final record/authorization boundary. The elevated Supabase key crosses a separate highest-privilege boundary. See `docs/ARCHITECTURE.md` for the data-flow diagram.

## Authorization model

Authorization has two mutually exclusive application paths:

```text
member/leader:
  valid server-verified identity + active profile
  + active in-date membership/year + required annual role

teacher administrator/platform owner:
  valid server-verified identity + active profile
  + global platform_access_grant + action-specific checks
```

Member and student-leadership roles are assigned to school-year memberships. Global administration is a database grant, never a browser claim, and is exclusive of member/leadership roles. Teacher-only annual anchors provide same-year review/audit attribution but do not create membership progress. Prohibitions such as self-review still apply.

| Subject                                             | Read                                                                                   | Mutate                                                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Anonymous                                           | Public login/help only                                                                 | Authentication initiation only; no application-table access                                          |
| Authenticated, unprovisioned/inactive               | Account-status response only                                                           | None                                                                                                 |
| Expired/suspended/archived membership               | Limited own historical/account-status data when school policy permits                  | No active-year submission, review, or administration                                                 |
| Active `member`                                     | Own profile, memberships, requests, comments, and progress                             | Own draft/submit/eligible withdraw/edit-after-changes/resubmit actions                               |
| Active `committee_head`, `president_vice_president` | Permitted active roster, member profiles/logs/history, assigned and all-pending queues | Review/reassign another member's eligible pending request                                            |
| Global `teacher_admin`                              | Leader data plus invitations, accounts, years, categories, exports, and complete audit | Protected account/year/role/category/destination-access/correction/export workflows across all years |
| Global `platform_owner`                             | Teacher-admin data plus synthetic read-only role preview and global grant directory    | Grant/revoke teacher admins and atomically transfer ownership                                        |
| Elevated server client                              | Only data/Auth needed by a narrow privileged operation                                 | Never an ordinary request data path; every call requires prior teacher-admin authorization and audit |

UI hiding is not a control. Protected pages, Server Actions/route handlers, caller-scoped queries, database policies, and transactional functions must each reject unauthorized direct requests.

## Security control design

### Authentication and sessions

- Public email signup and anonymous sign-in are disabled locally in `supabase/config.toml`; the same settings are a hosted release gate.
- Email/password is invitation-only. Google OAuth is optional and does not provision access.
- `src/lib/supabase/server.ts` uses cookie-backed Supabase SSR sessions; `src/proxy.ts` refreshes/validates claims on matched requests.
- `src/lib/dal/access.ts` calls the server Auth user API and loads the profile, memberships, and global grant before granting capabilities.
- Invite and recovery emails send a token hash to `/auth/confirm`; the route verifies the matching `invite`/`recovery` type. Invite claims prefer the exact metadata invitation, safely fall back only to the sole eligible verified-email match, and sign out a first-time failed claim. `/auth/recovery-callback` is the verified PKCE fallback for a stock recovery template.
- Successful invite/recovery proof creates a signed, subject-bound, nonce-bearing HTTP-only context with a 30-minute expiry and strict same-site scope. Both the page and mutation reverify it; successful password update deletes it and signs out. An ordinary session without this context is rejected. Local secure password change is enabled; hosted parity remains a deployment gate.
- Tokens are not intentionally copied into Web Storage or application tables.
- Callback destinations must be exact allowlisted origins/paths. `src/lib/safe-navigation.ts` rejects absolute, scheme-relative, backslash-normalized, encoded-backslash, and control-character destinations.
- Error messages should distinguish invalid/inactive/expired experiences for the signed-in user without enabling account enumeration to anonymous users.

### Server and browser boundary

- Only browser-safe Supabase credentials use `NEXT_PUBLIC_` variables.
- `src/lib/supabase/admin.ts` imports `server-only`, disables session persistence/refresh, and requires an elevated server variable.
- Runtime inputs require allowlisted schemas; identity, roles, status, reviewer, decision timestamps, and audit actor are derived server-side or in the database, not accepted as protected client fields.
- Server Action origins default to same-origin; any `SERVER_ACTION_ALLOWED_ORIGINS` value is an exceptional reviewed allowlist, never `*`.
- React's normal text rendering provides contextual escaping; any future HTML injection, raw markup, script URL, or untrusted redirect sink requires a separate security review.

### Database boundary

- Enable and force RLS on every exposed application table and restrict grants before adding narrowly scoped policies.
- Policies derive identity from the database Auth context; caller-supplied user IDs are only filters, never proof of ownership.
- Security-sensitive functions set a controlled `search_path`, re-evaluate the relevant global grant or annual membership/role/date status, lock mutable rows, and expose only required execution grants. Authenticated callers have access only to the read-only private predicates needed to evaluate policies/views. The reviewer-name RPC returns requested/actual display names only when the caller can view that request, without granting direct access to the underlying reviewer profile or membership.
- Views use caller-safe/security-invoker semantics and receive explicit RLS tests.
- Database constraints protect UUID relationships, uniqueness, status enums, school-year alignment, exact hour values, self-review, and immutable records.
- Review, correction, destination-year access, global-grant transfer, invitation acknowledgement, and audit writes are atomic inside PostgreSQL. Invitation email delivery crosses an external provider boundary: preparation does not mutate send facts, and only a provider-accepted call is acknowledged with an idempotent database operation. A provider-accepted/database-receipt split is reported explicitly because the two systems cannot share a transaction.

### Workflow integrity

- Requested approver, assignment history, and actual reviewer are separate facts.
- Members discover approvers through `list_eligible_reviewers`, a minimal same-year RPC that excludes the caller and returns no email; broad profile visibility is not used for the chooser.
- Draft save and submission compare the expected revision to reject stale edits.
- The decision path locks and rechecks a `pending` row so racing reviewers cannot both succeed. A simultaneous two-browser-context test observed one success, one conflict, and exactly one persisted approval.
- Self-review is rejected regardless of assignment, role combination, or teacher-admin status.
- Expired memberships and memberships in closed or archived years are historical records: they cannot be reactivated or have annual roles changed. New participation uses destination-year access instead.
- Teacher-admin invitations, including preparation, send acknowledgement, resend, and revocation, require the platform owner; ordinary teacher administrators manage only member and student-leadership invitations.
- Change-request and rejection require a bounded comment. Approved records are locked; a teacher-admin correction records actor, reason, and before/after values without destroying history.
- Only approved records affect the fixed 20-hour completion requirement. Exact numeric/quarter-hour logic avoids binary floating-point drift. Pending is separately labeled/colored and cannot reduce approved hours remaining.

### Browser response defenses

`src/proxy.ts` creates a per-response nonce and a restrictive Content Security Policy. `next.config.ts` disables the framework banner and sets HSTS, frame denial, MIME-sniffing protection, a strict referrer policy, and a restrictive Permissions Policy. These headers reduce impact but do not replace safe rendering, authorization, or input validation.

Authenticated pages, mutation responses, Auth callbacks, errors, and CSV should remain private and out of shared caches. No service worker should cache them without a new privacy review.

### CSV and bulk data

- Every export is produced server-side after teacher-admin authorization, validates the year UUID, deterministically pages through the Data API row limit, uses private/no-store caching, and appends an audit event containing the final row count.
- CSV serialization quotes structural characters and neutralizes formula-control prefixes, including values whose first meaningful character is `=`, `+`, `-`, `@`, tab, or carriage return.
- Export filename/content disposition is generated by the server and contains no untrusted path syntax.
- Imports use an allowlisted schema, byte/row/field limits, canonical email/date/role values, duplicate detection, row-numbered errors, and a documented atomicity rule.
- Upload MIME type or filename is not trusted as validation. Raw rows and exported files are never logged.

## Privacy, retention, and records handling

### Data minimization

Collect only the fields required to administer NHS hours: operational identity/contact data, school-year membership/roles, service entries, review/correction history, and security/audit metadata. Do not collect addresses, phone numbers, birth dates, government identifiers, medical details, or unrelated demographics. Free-text descriptions and comments should instruct users not to enter sensitive third-party information.

Do not enable third-party analytics, session replay, advertising, or unapproved support widgets on authenticated pages. Platform logs must redact cookies, Auth headers, reset/invite tokens, passwords, service-role keys, CSV contents, and free-text student records.

### Access and disclosure

- Members see only their own records.
- Active leaders receive roster/log access because it is required for the school-year role; access expires with that role.
- Teacher administrators alone see full audit and exports.
- Email belongs only in screens/exports with an authorized administrative purpose.
- CSV/downloads become unmanaged copies after download. Administrators must store them in school-approved restricted storage, share by least privilege, and delete them when the purpose ends.
- Preview/test/support environments use synthetic or approved anonymized data.

### Retention schedule decision

No statutory or school-approved retention duration is encoded in the repository. The school data owner must approve a schedule before production. Record, for each class below, the retention period, deletion/anonymization action, legal-hold rule, owner, and review cadence:

| Record class                                                | Safe default until policy is approved                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Auth identity and profile                                   | Keep while membership/history must remain attributable; deactivate instead of ad hoc deletion    |
| Memberships, approved requests, reviews, corrections, audit | Preserve archive-safe; do not auto-delete or silently rewrite                                    |
| Draft/rejected/withdrawn requests                           | Retain only as long as the approved school policy requires                                       |
| Invitation metadata                                         | Retain minimal status/audit facts; never store the token                                         |
| Platform logs and failed attempts                           | Keep the shortest period that supports security/operations; no record bodies or secrets          |
| CSV exports                                                 | Application does not retain generated file; administrator deletes downloaded copies under policy |
| Backups                                                     | Match documented Supabase backup/PITR window and securely expire manual dumps                    |
| Test/preview data                                           | Synthetic; reset when no longer needed                                                           |

Until policy is approved, prefer restricted preservation of records required for integrity over irreversible deletion, but do not treat that temporary position as authorization for indefinite retention. Privacy/access requests, corrections, legal holds, and deletion requests go through the school's designated process. Approved service facts are corrected through immutable correction history; they are not silently edited to satisfy a request.

## Security findings and dispositions

Severity reflects impact if the condition reaches production: **Critical** compromises the system broadly; **High** can expose/alter protected records or privileged authority; **Medium** needs pre-release mitigation or explicit time-bounded acceptance; **Low** is hardening/maintenance; **Informational** records assurance context.

| ID      | Severity      | Finding                                                                                                                                                                                                                                                                                                                                         | Evidence                                                                                                                                                          | Disposition                                                                                                                                                                                                                                                                            |
| ------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-002 | Medium        | The one-time bootstrap is serialized and service-role-only. Prior-schema native pgTAP passed the allowed first call, audit creation, non-service-role denial, and second-call denial; the updated assertion file awaits current exact-commit CI. A real dual-control first-admin execution and successor-admin workflow have not been observed. | `supabase/migrations/20260829030000_initial_nhs_backend.sql`, `supabase/tests/004_bootstrap.sql`, `src/lib/supabase/admin.ts`, `docs/OPERATIONS.md`, `docs/QA.md` | **Partially mitigated; test and operational deployment gate.** Require the current database CI pass, then execute the real first-admin bootstrap with dual control, verify its audit, and provision/test a successor teacher administrator through the protected application workflow. |
| SEC-003 | Medium        | A generic elevated Supabase client is exported. `server-only` protects bundling, but any future server import receives broad Auth/database capability and bypasses RLS.                                                                                                                                                                         | `src/lib/supabase/admin.ts`, `src/app/actions/admin-actions.ts`                                                                                                   | **Partially mitigated; hardening open.** Keep call sites few, reauthorize `teacher_admin` immediately before use, prefer narrow services, and audit every import before release.                                                                                                       |
| SEC-004 | Medium        | Request revisions/client keys, invitation acknowledgement idempotency, and bounded Server Action/import sizes address several replay cases, but no application/platform throttling evidence exists for repeated invitations, roster delivery, exports, or password resets.                                                                      | `src/app/actions/hour-actions.ts`, `src/lib/auth/invitation-delivery.ts`, `src/app/actions/auth-actions.ts`, `next.config.ts`, `supabase/config.toml`             | **Open.** Configure hosted limits and abuse-appropriate throttling for expensive/email actions; test replay and double-submit behavior.                                                                                                                                                |
| SEC-005 | Medium        | Hosted signup/password policy, secure-password-change, seven-day OTP expiry, Invite User/Reset Password templates, SMTP, Google, redirect allowlists, Preview protection, backups, and environment isolation cannot be verified from local files. Local URLs must not be pushed unchanged.                                                      | `supabase/config.toml`, `supabase/templates/invite.html`, `supabase/templates/recovery.html`, `.env.example`, `docs/DEPLOYMENT.md`                                | **External deployment gate.** Reproduce and record every hosted setting, then test invite/resend/recovery/password/OAuth/expiry/redirect behavior with safe accounts on the deployed origin.                                                                                           |
| SEC-006 | Medium        | The school has not supplied an approved privacy/retention schedule, RPO/RTO, incident owner, or export-storage policy.                                                                                                                                                                                                                          | `docs/SECURITY.md`, `docs/OPERATIONS.md`, `docs/DEPLOYMENT.md`                                                                                                    | **Open owner decision.** The data owner must approve these values before real student data is loaded and keep the private operational record free of credentials.                                                                                                                      |
| SEC-009 | Low           | The environment names now use current Supabase publishable/secret-key terminology while local development remains compatible with the CLI's legacy anon/service-role values.                                                                                                                                                                    | `.env.example`, `src/lib/env.ts`, `src/lib/supabase/admin.ts`                                                                                                     | **Resolved.** Hosted environments use `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`; the elevated value remains server-only.                                                                                                                                        |
| SEC-011 | Informational | `pnpm audit --audit-level=high` reported no known vulnerabilities on 2026-08-29 for the then-current lockfile. This is point-in-time advisory coverage only.                                                                                                                                                                                    | `pnpm-lock.yaml`, `package.json`, `docs/QA.md`                                                                                                                    | **Observed, not permanent.** Rerun on the release commit and review advisories in context.                                                                                                                                                                                             |
| SEC-012 | Informational | Local code includes nonce-based CSP, HSTS, frame denial, MIME-sniffing protection, strict referrer policy, Permissions Policy, and private/no-store CSV responses, but deployed delivery and compatibility have not been browser-tested.                                                                                                        | `src/proxy.ts`, `next.config.ts`, `src/app/api/exports/[type]/route.ts`                                                                                           | **Pending verification.** Inspect production HTML/CSV responses and complete critical browser flows without weakening CSP globally.                                                                                                                                                    |

### Controls corrected during review

The following controls were corrected or verified while this review was active. Open hosted and manual gates still apply where identified:

- **Prior SEC-001 evidence:** the previous schema passed a clean native reset, seven pgTAP files/226 assertions, and 13 authenticated portal workflows including a simultaneous review race. The current global-access migration adds an eighth file and 301 total assertions; it remains pending clean CI/container execution before the finding can be considered resolved for this release (`supabase/tests`, `tests/e2e/portal.spec.ts`, `playwright.config.ts`, `docs/QA.md`).
- PostgREST request relationships now use the actual composite foreign-key paths, including the year/category mapping (`src/lib/dal/portal.ts`).
- The leader overview no longer asks non-admin reviewers to read the teacher-admin-only summary/directory (`src/app/(portal)/admin/page.tsx`).
- Save and submit now send an expected revision, and the SQL rejects stale revisions (`src/app/actions/hour-actions.ts`, `supabase/migrations/20260829030000_initial_nhs_backend.sql`).
- Same-origin navigation rejects backslashes and other URL-normalization tricks, with unit coverage (`src/lib/safe-navigation.ts`, `src/lib/safe-navigation.test.ts`).
- Invite verification now uses a server-side token-hash endpoint, exact invitation metadata, and a safe sole-pending fallback for stale unconfirmed-user metadata (`src/app/auth/confirm/route.ts`, `src/lib/auth/claim-invitation.ts`, `supabase/templates/invite.html`).
- **Resolved SEC-007 (source/unit assurance; current database execution pending):** invitation delivery now prepares without mutating send facts, calls Auth first, and acknowledges only provider acceptance with an idempotent UUID carried as non-secret Auth metadata for reconciliation. Provider failure never acknowledges; a lost acknowledgement response retries with the same UUID without resending. The coordinator's five current unit tests pass; prior-schema native pgTAP invitation-integrity coverage passed, while the updated database assertions await exact-commit CI. Actual hosted email-provider acceptance, rejection, and resend behavior remain an external gate under SEC-005 (`src/lib/auth/invitation-delivery.ts`, `src/lib/auth/invitation-delivery.test.ts`, `src/app/actions/admin-actions.ts`, `supabase/tests/006_invitation_send_integrity.sql`, `docs/QA.md`).
- **Resolved SEC-008 (source/unit inspection):** password update now requires verified invite/recovery proof and a signed, subject-bound, nonce-bearing, 30-minute HTTP-only context; both page and action recheck it, success deletes it and signs out, and local secure password change is enabled. Four context unit tests passed; hosted recovery/reauthentication remains under SEC-005 (`src/lib/auth/password-update-context.ts`, `src/lib/auth/password-update-context.test.ts`, `src/app/auth/confirm/route.ts`, `src/app/auth/recovery-callback/route.ts`, `src/app/(auth)/update-password/page.tsx`, `src/app/actions/auth-actions.ts`, `supabase/config.toml`).
- Members now obtain a minimal eligible-reviewer list without broad profile/email disclosure (`src/lib/dal/portal.ts`, `supabase/tests/005_reviewer_directory.sql`).
- **Resolved export-pagination residual (source inspection):** CSV exports validate year IDs, advance by the rows actually returned until an empty page (so a lower hosted row cap is not mistaken for end-of-data), include the latest non-null review comment, fail closed if export auditing fails, and set private/no-store headers (`src/app/api/exports/[type]/route.ts`).
- **Resolved SEC-010 (source inspection):** the unused school-year summary mapper with fields absent from the SQL view was removed, eliminating the silent-zero future path (`src/lib/dal/portal.ts`).
- In the prior design-fixture suite, the destructive color failed the first automated contrast pass at 4.46:1; `#b42323` replaced it and the then-current two-test Playwright run passed with no serious/critical axe findings. The updated fixture suite remains an exact-commit CI gate (`src/app/globals.css`, `tests/e2e/design-preview.spec.ts`, `docs/QA.md`).
- Authenticated RLS evaluation has narrowly granted access to only the required private policy/view predicates, with current authored privilege assertions awaiting exact-commit database CI (`supabase/migrations/20260829030000_initial_nhs_backend.sql`, `supabase/tests/001_schema_contract.sql`).

No issue is closed merely because a design document describes a control. Update a disposition to **Resolved** only when the relevant implementation exists and the associated allow/deny test or deployment observation passes.

## Pre-release security gate

1. Reconcile the authorization matrix with final routes, server actions, grants, policies, views, and functions.
2. Run the full database/RLS suite from a clean reset, including direct Data API deny attempts, reviewer-directory behavior as an ordinary member, and a concurrent review race.
3. Audit every import of the elevated admin client and every mutation/export call site.
4. Run lint, typecheck, unit tests, database tests, E2E, production build, and dependency audit on the release commit.
5. Search the repository/build output for secrets, test passwords, real student data, unsafe HTML/URL sinks, client token storage, and sensitive logging.
6. Verify hosted signup, token-hash Invite User and Reset Password templates, seven-day OTP expiry, provider-accepted resend facts, 30-minute password context, secure password change, redirects, SMTP, Google state, preview protection, environment separation, and backup restore ownership.
7. Verify security headers, private caching, cookie behavior, invite/reset/sign-out, CSV safety, and four responsive viewports on the deployed origin.
8. Resolve all Critical/High findings and obtain documented owner acceptance for any remaining Medium finding.

## Reporting a vulnerability

Do not include student data, credentials, invitation/reset URLs, cookies, or exploit payloads containing real records in a public issue. Notify the designated school system owner through the approved private incident channel, include the affected environment and stable record IDs only when needed, and follow the containment steps in `docs/OPERATIONS.md`.
