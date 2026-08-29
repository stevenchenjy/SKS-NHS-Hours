# Architecture and Product Decisions

This log records decisions that materially affect security, data integrity, operations, or user experience. It will be updated as implementation and verification uncover new constraints.

## D-001 — Extend the initialized Supabase repository with Next.js App Router

**Decision:** Build a strict TypeScript Next.js App Router application at the repository root and retain the existing Supabase CLI project.

**Reason:** The repository contains no competing application stack, and the requested stack supports server rendering, protected route handlers/server actions, Supabase SSR sessions, and Vercel deployment.

## D-002 — Use pnpm consistently

**Decision:** Use pnpm and commit `pnpm-lock.yaml`.

**Reason:** No package manager is established, pnpm is installed locally, and a frozen lockfile gives reproducible CI and deployment installs.

## D-003 — Treat the database as the final authorization and integrity boundary

**Decision:** Put identity-derived, authorization-sensitive transitions in narrowly scoped PostgreSQL functions/RPCs; enable and force RLS on application tables; grant only the required operations; and retain a server-only data-access layer that rechecks permissions before invoking database mutations.

**Reason:** UI hiding and page middleware cannot enforce resource authorization, prevent self-review, or serialize concurrent decisions. Database functions can lock the request row, validate its current state, write immutable history/audit rows, and commit atomically.

## D-004 — Model roles per school-year membership

**Decision:** A persistent `profiles` identity has one `school_year_memberships` row per school year and zero or more `membership_roles` rows. Active access requires both an eligible membership status and the current date to fall within the school year and membership expiration bounds.

**Reason:** This supports multi-role users, automatic leadership expiration, renewal without overwriting history, and read-only prior-year records.

## D-005 — Use exact quarter-hour numeric values

**Decision:** Store hours and targets as `numeric(7,2)` with database checks for positive quarter-hour increments and a 24-hour maximum per request.

**Reason:** Exact numeric arithmetic avoids floating-point accumulation errors while supporting configured targets and quarter-hour entries.

## D-006 — Preserve requested and actual reviewers separately

**Decision:** `hour_requests.requested_approver_membership_id` records assignment; immutable `hour_reviews.reviewer_membership_id` records the actor for each review/reassignment event; final reviewer/timestamp are derived or denormalized only by the transactional review function.

**Reason:** Assignment and decision are different facts and both are required for queueing, reporting, auditability, and reassignment.

## D-007 — Never silently update approved service facts

**Decision:** Approved requests are locked. Teacher-admin corrections create an immutable correction record containing before/after values and reason, append review/audit history, and update the approved record only inside one protected transaction.

**Reason:** School records require a traceable correction procedure without losing the original values.

## D-008 — Derive progress from request records

**Decision:** Secure database views/queries aggregate authoritative requests by status. Only approved requests count toward completion; pending and changes-requested hours remain separate; displayed percent is uncapped while the visual bar caps at 100%; target zero returns a safe, policy-neutral percentage.

**Reason:** A mutable running total can drift or be tampered with. Derived totals remain explainable and auditable.

## D-009 — Disable public registration and require provisioning

**Decision:** Supabase public email signup is disabled. Email/password access is invitation-based, Google OAuth is optional, allowed-domain checks are supplemental, and every authenticated identity still requires a provisioned active membership.

**Reason:** School-domain ownership alone must never grant portal access.

## D-010 — Keep student data and browser code minimal

**Decision:** Store only operational identity/contact fields, do not add third-party analytics, do not persist auth tokens in Web Storage, validate redirect targets, use response security headers, and keep service-role/admin operations in server-only modules.

**Reason:** The portal handles student records and should minimize both data collection and browser-side attack surface.

## D-011 — Export CSV defensively

**Decision:** Generate exports on the server after teacher-admin authorization, audit every export, quote CSV fields correctly, and neutralize cells beginning with spreadsheet formula control characters.

**Reason:** Authorization must not depend on UI state, and otherwise-valid CSV can become a formula-injection vector when opened in spreadsheet software.

## D-012 — No third-party source code is copied by default

**Decision:** The requested open-source repositories are used for workflow and architecture study only unless a clearly licensed, attributable fragment proves necessary.

**Reason:** Conceptual adaptation avoids license ambiguity and makes the portal’s security model internally coherent. Any later reuse will be recorded in `ATTRIBUTIONS.md`.

## D-013 — Use reference repositories as concepts only

**Decision:** Independently reimplement useful concepts from Munus, slobg-track, and volunteer-hub; copy no source or assets.

**Reason:** Munus and slobg-track have no detected license. Volunteer-hub is MIT-licensed, but its stack and incomplete workflow make conceptual study more appropriate than code reuse. The resulting attribution record is explicit about the review and the absence of copied material.

## D-014 — Lock the visual system before application scaffolding

**Decision:** Use the four accepted concepts and `docs/DESIGN_SYSTEM.md` as the visual specification: true-white table-led layouts, a cool-slate rail, forest-green primary actions/approved progress, ink-navy hierarchy, restrained amber pending states, semantic status labels, and mobile-first field/action anatomy.

**Reason:** A shared component/token system keeps the large route surface coherent and provides concrete desktop/mobile comparison targets for browser QA.
