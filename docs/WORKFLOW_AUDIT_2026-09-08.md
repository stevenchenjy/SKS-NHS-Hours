# Workflow audit — September 8, 2026

## Scope and conclusion

Reviewed the five server-action modules, their form and notice components, authentication callbacks, data-access queries, export route, migration definitions, and existing workflow tests. Compared the repository with the linked production Supabase project using read-only queries.

The verified failures come from mismatched application/provider states, stale form state after partial success, and misleading or missing feedback. No evidence supports deleting application tables as a remedy. An Auth account and an accepted application invitation are different states: Auth can know an email before the application has created its profile and school-year access.

## Findings and fixes

| Workflow                      | Failure mechanism                                                                                                                                                                  | Change                                                                                                                                                                                                                |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invitation resend             | Supabase returned `422 email_exists` at 2026-09-08 14:09:42 UTC for a pending invitation whose Auth account already existed.                                                       | Fall back to the existing recovery flow only for existing-account errors. The callback still verifies email ownership and calls the database invitation-claim checks. Record delivery only after provider acceptance. |
| Invitation feedback           | Provider errors were discarded and every account notice looked successful.                                                                                                         | Record sanitized provider code/status and invitation ID; render failures as actionable error alerts. Explain recovery delivery separately.                                                                            |
| Roster import                 | The shared delivery coordinator's recovery-success outcome was not counted as success. Row failures also appeared inside a green message.                                          | Count recovery delivery as success, and separate successful counts from row-error feedback.                                                                                                                           |
| Hour submission retry         | Saving a draft increments its revision before the separate submit RPC. If submit fails, the form retained the old revision or had no saved ID, so a retry could target stale data. | Return the saved ID/revision on submission failure, use it in the form's hidden fields, and preserve it through subsequent validation errors. Explain that the draft saved but submission failed.                     |
| Approved-hour corrections     | Correction validation still required a three-character title and twenty-character description after submissions were relaxed. Most correction field errors were not rendered.      | Accept a one-character title and optional description, within database limits. Show all correction validation errors.                                                                                                 |
| Withdrawal feedback           | `withdraw-failed` rendered a generic successful status update.                                                                                                                     | Display an error that explains the request may already have been reviewed and asks the member to refresh.                                                                                                             |
| Event signup feedback         | A missing/unrecognized signup response defaulted to “confirmed”; permission failures used success styling.                                                                         | Require an explicit confirmed/waitlisted result, and show uncertain results and permission failures as errors.                                                                                                        |
| School-year activation        | The action returned an error through the URL, but the settings page never read it. A closed year could also appear current.                                                        | Display activation outcomes and label closed years explicitly.                                                                                                                                                        |
| Review queue                  | Any `notice` value produced a successful-decision message.                                                                                                                         | Display that success only for the recognized decision-recorded notice.                                                                                                                                                |
| Existing application accounts | Inviting an already provisioned person returned a vague duplicate-record error.                                                                                                    | Direct the administrator to add the existing account to the school year.                                                                                                                                              |

## Database and contract checks

- All nine local migrations are recorded as applied remotely.
- Compared 85 live function bodies against their latest local definitions, accounting for overloaded private function signatures. No body differences were found.
- All 33 distinct RPC names called by application source exist in the live database. No overloaded public RPC names were found.
- Every statically named `.from(...)` source exists. The five reporting views are `category_totals`, `export_service_records`, `member_progress`, `pending_review_queue`, and `school_year_summary`.
- All 17 public application tables have row-level security enabled. This is a configuration check, not a substitute for role-by-role integration tests.
- Inspected the event signup row lock, duplicate-signup handling, capacity selection, withdrawal, and waitlist-promotion transaction.
- Inspected request revision checks, ownership checks, the two approval stages, correction history, invitation eligibility, and export auditing/pagination.
- Production consistency counts: one pending invitation with an already verified Auth account; zero approved requests missing committee-head approval or a final reviewer; zero pending requests without an assigned reviewer; zero active global administrators without an attribution membership; zero events with confirmed registrations above capacity.

## Tables and older functions

The 17 tables support configuration, profiles/global access, school-year memberships/roles, invitations/roles, categories/availability, hour requests/reviews/corrections, events/registrations, and audit history. These relationships are used by authorization, reporting, or active workflows.

Five public functions have no direct call from current application source:

| Function                  | Reason to retain                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `bootstrap_teacher_admin` | Administrative bootstrap path, not an everyday form.                                              |
| `set_app_setting`         | Operational configuration path.                                                                   |
| `close_school_year`       | Administrative lifecycle operation; ordinary access follows dates without requiring a close form. |
| `set_school_year_target`  | Compatibility guard enforcing the fixed 20-hour policy.                                           |
| `set_membership_target`   | Compatibility guard rejecting individual target overrides.                                        |

No table, function, invitation, account, role, or audit record was deleted. No database migration was required for these application fixes.

## Validation and limits

- 256 unit, action, and server-rendering tests pass, including provider fallback, roster outcomes, partial-submit retry, correction validation, event response handling, and notice rendering.
- TypeScript and ESLint pass. The initial invitation fix passed a Vercel production build and was assigned to `https://sks-nhs-hours.vercel.app`; the follow-up audit fixes are published through the same production build pipeline.
- Provider calls in regression tests are mocked. No invitation/recovery emails were sent to real users as part of this audit, and recipient inbox delivery was not verified.
- Production database inspection was read-only. The SQL/pgTAP and authenticated browser suites were not run because this machine has no Docker-backed local Supabase test stack. Concurrent live actions and every combination of roles/data were not exercised.
- The hour save/submit sequence remains two database calls. The tested returned-error path now preserves the saved draft; an entirely lost HTTP response or a simultaneous edit in another session can still require reopening the saved draft. Existing optimistic revision checks remain in force.

This is a source/contract audit with targeted regressions, not a claim that every possible production workflow failure has been eliminated.
