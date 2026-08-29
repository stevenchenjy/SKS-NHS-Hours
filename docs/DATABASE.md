# NHS Service Hours Portal — Database guide

This guide is the operational entry point for the Supabase/PostgreSQL layer. The ordered SQL in `supabase/migrations` is the executable source of truth; `docs/DATA_MODEL.md` contains the full entity catalogue and relationship diagrams.

## What the database owns

The database is the final boundary for record integrity and authorization. Application validation and hidden controls improve usability, but must not be the only protection for student records.

The current migration defines:

- 14 application tables for profiles, annual memberships and roles, categories, invitations, service requests, reviews, corrections, audit events, and settings;
- five caller-scoped reporting views;
- transactional member, reviewer, administrator, invitation, rollover, correction, export-audit, and bootstrap functions;
- exact numeric and same-school-year constraints;
- immutable review, correction, and audit history;
- forced Row Level Security on every application table; and
- explicit table, view, function, schema, and helper-function privileges.

## Schema at a glance

```text
auth.users 1──1 profiles 1──* school_year_memberships *──1 school_years
                              │              │
                              │              └──* school_year_categories *──1 service_categories
                              ├──* membership_roles *──1 roles
                              └──* hour_requests
                                      ├──* hour_reviews
                                      └──* hour_request_corrections

school_years ──* invitations ──* invitation_roles *── roles
profiles/memberships ──* audit_events
```

IDs are UUIDs except for append-only event/history identifiers where the migration chooses an identity value. Roles belong to a school-year membership, not to the profile globally. Service requests store membership-scoped owner, requested approver, and actual reviewer references so their school-year alignment can be enforced.

## Integrity invariants

- A Supabase Auth UUID maps to at most one profile.
- A profile has at most one membership in a given school year.
- Membership status, expiration, profile status, school-year status/dates, and membership roles all participate in authorization.
- Hours and targets use exact `numeric` values. Request hours are positive quarter-hour increments and cannot exceed 24 hours.
- Requested approver and actual reviewer are separate. Both references must align with the request's school year.
- Self-review is rejected even when the user has several roles or is a teacher administrator.
- Review and reassignment lock and recheck the pending request. A stale second decision fails.
- Approved rows cannot use the ordinary edit path. `correct_approved_request` records reason and before/after facts.
- `hour_reviews`, `hour_request_corrections`, and `audit_events` are append-only.
- Pending hours never count as approved completion. Category-approved caps are applied transactionally.
- School-year rollover creates a new membership and preserves the previous membership and all historical records.

## Transactional API

Normal writes go through these public RPCs; direct table writes are intentionally not granted to authenticated callers.

| Area                  | Functions                                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Member requests       | `create_hour_request_draft`, `save_hour_request_draft`, `submit_hour_request`, `withdraw_hour_request`                                          |
| Review                | `review_hour_request`, `reassign_hour_request`                                                                                                  |
| Approved corrections  | `correct_approved_request`                                                                                                                      |
| School years          | `create_school_year`, `activate_school_year`, `close_school_year`, `set_school_year_target`                                                     |
| Memberships and roles | `renew_memberships`, `set_membership_status`, `set_membership_target`, `set_profile_status`, `assign_membership_role`, `remove_membership_role` |
| Invitations           | `create_invitation`, `prepare_invitation_send`, `record_invitation_send_success`, `revoke_invitation`, `claim_invitation`                       |
| Categories/settings   | `upsert_service_category`, `set_school_year_category`, `set_app_setting`                                                                        |
| Reporting             | `record_export`                                                                                                                                 |
| Reviewer discovery    | `list_eligible_reviewers` returns only eligible IDs, full name, and role keys to an active same-year member; it excludes the caller and email   |
| Initial access        | `bootstrap_teacher_admin` (service role only, one time)                                                                                         |

The invitation transport boundary is explicitly two phase. `prepare_invitation_send(uuid)` returns only `(invitation_id uuid, email text, full_name text)` and writes no send fact. After Auth accepts the email, `record_invitation_send_success(uuid, uuid, timestamptz)` returns the updated invitation, advances expiry/count/time once per idempotency UUID, and audits `invitation.sent` or `invitation.resent`. The migration asserts that the former pre-provider `resend_invitation` RPC is absent.

`set_school_year_target` accepts a nonnegative quarter-hour value, locks the year, permits only draft/active years, and records `school_year.target_updated`. The current application sets the default target when creating a year and uses member overrides in `/admin/settings/targets`; do not bypass the RPC with direct SQL if a later default-target editing surface is added.

Function arguments are untrusted data, not proof of authority. Except for the first-admin bootstrap, security-definer functions derive the actor from `auth.uid()` and recheck current database eligibility.

## Reporting views

Every view is declared `security_invoker`, so its underlying table policies still apply.

| View                     | Authorized purpose                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `member_progress`        | Effective target; role keys; counts and totals for each request status; remaining/over-goal values; uncapped actual percentage |
| `pending_review_queue`   | Eligible pending service rows, requested assignment, age, and member/category context                                          |
| `category_totals`        | Approved and pending hours plus remaining configured category allowance                                                        |
| `school_year_summary`    | Teacher-admin aggregate membership/request totals for one year                                                                 |
| `export_service_records` | Teacher-admin service-record export shape, including `latest_review_comment` from the newest non-null reviewer comment         |

Application queries must still bound and paginate result sets. A PostgREST response limit is not a safe export-completeness mechanism.

## Roles, grants, and RLS

- `anon` has no application-table/view/function privileges.
- `authenticated` receives `SELECT` only on the listed application tables and views and `EXECUTE` only on explicitly listed RPCs.
- All 14 application tables have RLS enabled and forced.
- Policies authorize ownership, currently eligible review capability, or active teacher-administrator capability as appropriate.
- The `private` schema is not an exposed application API. Authenticated callers receive only the schema usage and exact read-only helper execution privileges needed to evaluate RLS/view predicates; other private functions remain unavailable.
- `service_role` can execute the first-admin bootstrap and must never reach a browser or an ordinary data path.

Because RLS policies execute during caller queries, changes to private-helper privileges can break every authenticated read even when the policy text itself is correct. Keep the privilege assertions in the pgTAP schema contract.

## Local reset and tests

Docker Desktop or a compatible container runtime must be running.

```bash
supabase start
supabase db reset --local
supabase test db
```

`supabase db reset --local` destroys and recreates only the linked local database, applies the ordered migration chain, and then loads `supabase/seed.sql`. Never run a destructive reset against a hosted environment. The seed contains fictional `example.edu` personas and the intentionally local-only password documented in `docs/OPERATIONS.md`; never deploy it with `--include-seed`.

The database suite currently lives in:

- `supabase/tests/001_schema_contract.sql`
- `supabase/tests/002_workflows_and_rls.sql`
- `supabase/tests/003_admin_lifecycle_and_authorization.sql`
- `supabase/tests/004_bootstrap.sql`
- `supabase/tests/005_reviewer_directory.sql`
- `supabase/tests/006_invitation_send_integrity.sql`

Together they declare 213 pgTAP assertions (plans 54 + 51 + 32 + 8 + 20 + 48). That number describes committed test intent, not an observed native pass. The verification ledger in `docs/QA.md` is the only place that records whether a clean reset and database run actually succeeded.

## Migration procedure

1. Add a new timestamped SQL file under `supabase/migrations`; never edit a migration already applied to a shared project.
2. Prefer expand/migrate/contract changes so the old and new application can coexist during deployment.
3. Add constraints, indexes, grants, policies, and both allow/deny tests in the same change.
4. Run a clean local reset and pgTAP suite.
5. Reconcile PostgREST relationship hints, selected column names, RPC argument names, generated types, and all database documentation.
6. Inspect the linked hosted project, then run:

   ```bash
   supabase db push --linked --dry-run
   supabase db push --linked
   ```

7. Do not use `--include-seed` for Preview or Production.
8. Record the exact migration filenames and verification evidence in the private release record.

## Backup and rollback boundary

An application rollback does not undo a database migration. Keep migrations backward-compatible where possible and repair an applied schema with a new forward migration. Before a risky change, verify the hosted backup/PITR state and recovery owner. Restoration is an incident decision, not a routine deployment step; see `docs/DEPLOYMENT.md` and `docs/OPERATIONS.md`.

## Current verification boundary

At the time this guide was updated, the exact migration and seed ran twice successfully in an isolated PGlite harness, and SQLFluff parsed the migration and final invitation-integrity test cleanly. That supplemental evidence does not execute native Supabase Auth/PostgREST/pgTAP behavior. The local container stack was unavailable, so no clean-reset or native pass is claimed for the 213 assertions. A true simultaneous two-connection review race also remains a browser/integration obligation even though the SQL uses row locking and the pgTAP suite checks stale sequential decisions.
