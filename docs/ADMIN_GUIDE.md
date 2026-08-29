# NHS Service Hours Portal — Administrator guide

This guide is for the teacher administrators responsible for annual membership, service records, reporting, and handoff. It assumes the portal has already been deployed and the first teacher administrator has been bootstrapped. Technical setup and break-glass instructions are in `docs/DEPLOYMENT.md` and `docs/OPERATIONS.md`.

## Before administering records

Use a currently active `teacher_admin` account on the canonical school portal. Never share accounts. Confirm the school year shown in the page header before making a change, especially when prior years remain visible.

Roles are annual and combinable:

| Role             | Main capability                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| `member`         | Submit and track the person's own service hours                                                          |
| `committee_head` | Review eligible requests and see the permitted roster/log context                                        |
| `president`      | Same review-capable leader boundary                                                                      |
| `vice_president` | Same review-capable leader boundary                                                                      |
| `teacher_admin`  | Account, role, year, category, target, correction, audit, and export administration; also review capable |

An account needs an active profile, an active in-date membership, an active in-date school year, and the required membership role. A matching email domain or successful Google sign-in does not grant access.

## Invite one account

1. Open `/admin/accounts` and choose the intended school year.
2. Under **Invite one**, enter the normalized school email and full name.
3. Select at least one role. Include `member` for students who will submit hours; combined leadership roles belong on the same membership.
4. Submit once and read the result. The portal creates a pending invitation with no recorded send, asks Supabase Auth to accept delivery, and only then records the provider-accepted send.
5. Confirm the pending invitation, seven-day expiry, and accepted send count in the Invitations section.
6. Verify delivery through the configured school SMTP/Auth provider. A portal success message cannot prove that the external email arrived.

Use **Resend** on an existing pending invitation instead of creating a duplicate. It requests a fresh Supabase Invite User email carrying the same invitation ID and, after provider acceptance, extends that invitation to seven days and increments its send count. Provider rejection leaves the count unchanged. If the portal says Auth accepted the email but its receipt could not be recorded, check the invitation and audit trail before retrying; the systems cannot roll back one another. Use **Revoke** when an invitation should no longer be claimable. Never forward an invitation or password-reset URL through an unapproved channel; those URLs are credentials.

If one email has more than one pending invitation, the callback must identify the intended invitation. Treat an ambiguous-claim error as an administration issue: revoke obsolete invitations and resend the intended one rather than guessing.

Invite and recovery links are one-time credentials. The hosted templates must send their token hash to `/auth/confirm` with `type=invite` or `type=recovery`. Successful verification creates a user-bound password-update context that lasts 30 minutes; an ordinary existing session cannot use the password form. If a link is expired or the context is missing, have the person request a fresh approved invite/reset instead of attempting a manual password change.

## Import a roster

On `/admin/accounts`, upload a UTF-8 CSV with headers:

```csv
email,full_name,roles
```

Separate multiple roles with `|`, for example `member|committee_head`. The current importer accepts no more than 250 account rows and 1 MB. It rejects unknown or duplicate headers, missing email/name headers, duplicate email rows, invalid values, and email domains outside the configured allowlist before it begins delivery.

The portal validates the full file before starting, but the Auth email system and application database are two systems. A later provider rejection, invitation-state change, or receipt-recording failure can leave a clearly reported partial batch. Resolve the named rows, inspect any provider-accepted/receipt-failed row before another send, and use the existing invitation's Resend action; do not blindly upload the whole file again.

Use synthetic data for rehearsal. Do not place student records in issue attachments, chat, screenshots, or general-purpose storage.

## Change account or membership status

The Directory on `/admin/accounts` distinguishes two scopes:

- profile status applies to the identity across all school years;
- membership status applies to one school year.

Suspend or archive a membership when only the annual participation changes. Deactivate the profile when the identity should lose portal access across years. Access is re-evaluated on protected requests; a separately revoked Auth session is useful defense but is not a substitute for the database status check.

Never hard-delete a profile or historical membership. The database protects the final active teacher administrator from removal/deactivation.

## Assign or remove roles

1. Open `/admin/settings/roles`.
2. Select the correct school-year membership.
3. Add or remove only the roles approved for that year.
4. Keep one account per person; add combined roles to the membership rather than creating another identity.
5. Verify the audit entry and, in non-production, test the affected route with the persona.

The database protects the baseline member role and the final active teacher administrator. Old leadership rows do not grant current-year authority after expiration or rollover.

## Set targets

- A new year's default target is set when the draft year is created, normally 20 hours.
- `/admin/settings/targets` manages exceptional membership-specific overrides. Leaving the override blank inherits the school-year default.
- Targets must be nonnegative quarter-hour values.
- The database also provides the protected `set_school_year_target` operation for changing a draft/active default with an audit event. The current UI does not expose a separate post-creation default-target editor; do not work around that boundary with direct table SQL.

Changing a target does not rewrite service records. Check the member's true percentage, remaining hours, and over-goal text afterward.

## Create a school year

1. Open `/admin/settings/school-years`.
2. Create the new year with a consecutive label such as `2027-2028`, inclusive start/end dates, and default target.
3. The new year starts as `draft`.
4. Renew at least one teacher administrator into it before activation.
5. Configure roles, membership expirations/targets, and year-specific category availability/caps.
6. Review the rollover checklist in `docs/SCHOOL_YEAR_ROLLOVER.md` before activating or closing anything.

Only one school year may be active. Closing a year stops active operations and preserves it for history.

## Renew memberships

In the **School-year rollover** panel on `/admin/settings/school-years`:

1. Choose the existing person.
2. Choose the destination draft year.
3. Set an expiration date inside that year's date range.
4. Set a target override only when needed.
5. choose all destination-year roles; roles are not assumed to carry over;
6. read the summary, tick the confirmation, and create the membership.

Renewal creates or reactivates a destination-year membership, links it to the prior membership when applicable, assigns the selected roles, and appends audit events. It never extends the old membership or moves prior requests.

## Manage categories

Open `/admin/settings/categories` to:

- create, rename, describe, reorder, activate, or deactivate a global category;
- make a category available or unavailable for one school year;
- set a year-specific maximum per request; and
- set an optional approved-hours cap per member/category.

Active names are case-insensitively unique. Deactivate or make a category unavailable instead of deleting one referenced by history. A member/category cap is enforced during approval, so review the resulting error rather than attempting a direct override.

The initial reference set is Green Team, Peer Tutoring, Concessions, Fundraising & Events, and Community Service. Verify those five names after a fresh environment is initialized; do not load the local synthetic user seed into hosted environments.

## Process requests

Review-capable leaders use `/admin/requests`:

1. **Assigned to me** focuses the requested assignment; **All pending** is the shared eligible queue.
2. Open a request and verify the member, service facts, requested approver, current status, and history.
3. Approve, request changes, reject, or reassign. Changes requested and rejection require a useful comment.
4. Never process your own request. Self-review is blocked even for multi-role teacher administrators.
5. If the request is no longer pending, reload. Another eligible reviewer may have completed the locked transaction.

The actual reviewer is recorded separately from the requested approver. Do not infer who made the decision from the assignment alone.

## Correct an approved record

Ordinary editing ends at approval. When a genuine approved fact is wrong:

1. Sign in as a teacher administrator and open the request detail.
2. Use the correction form to enter only the corrected allowed fields and a specific reason.
3. Confirm the resulting approved record, before/after correction history, review history, and audit event.
4. If the correction changes hours/category, verify the affected member and category totals.

Never update the database row manually. Correction history exists so the original fact remains attributable.

## Read progress and history

- `/admin` shows the current overview and oldest pending work.
- `/admin/members` provides the authorized current roster.
- `/admin/members/[id]` shows a member's memberships, roles, progress, and complete permitted service history.
- `/admin/audit` is teacher-admin-only and shows append-only sensitive actions for the current year.

Approved, pending, changes-requested, rejected, remaining, and over-goal values have different meanings. Only approved hours count toward the requirement. The progress bar may stop at 100%, but the text must preserve the actual percentage and over-goal hours.

## Export records

1. Open `/admin/exports` and select the school year.
2. Choose the smallest export that meets the approved purpose: progress, hours, pending, approved, categories, directory, or archive.
3. Verify the downloaded row count and corresponding `export.generated` audit event.
4. Store the file only in school-approved restricted storage, share by least privilege, and delete it under the approved retention policy.

The server uses CSV quoting and formula neutralization, an attachment filename, and private/no-store headers. The release owner must still verify exports over the configured row limit are complete; never accept an apparently successful but truncated file.

## Handle an expired account

An expired membership should sign in only to the limited account-expired experience and should not see submission, roster, review, or admin actions. To restore current-year access, renew or reactivate the correct annual membership through the protected workflow. Do not extend an old year or create a duplicate Auth identity.

If an account is unexpectedly expired:

1. confirm the profile status;
2. confirm the current year's status and date range;
3. confirm membership status and expiration date;
4. confirm the intended annual roles; and
5. inspect the audit trail before changing anything.

## Transfer administration

Complete handoff before a teacher or student leader leaves:

1. Provision and verify at least two current teacher administrators.
2. Renew the successors into the next year with deliberately selected roles and expiration dates.
3. Have each successor sign in and verify account, year, role, category, audit, export, backup-status, Supabase, Vercel, GitHub, SMTP, Google, and domain responsibilities appropriate to them.
4. Record who owns incident response, privacy/retention decisions, backup restore, release approval, and exported-record storage.
5. Remove the predecessor's annual roles or deactivate the profile only after successor access works. The database will reject removal of the last active teacher administrator.
6. Revoke sessions and rotate any operational credentials the departing person could access. Do not share a successor's login or transfer a personal account.
7. Retain historical actions under the original identity; do not rename one person's account into another person's account.

The one-time bootstrap is not a routine transfer mechanism and will refuse once a teacher administrator exists.

## Safe operating habits

- Use two different people for submission and review.
- Check the selected year before every role, target, export, and rollover action.
- Read the result and audit event; do not judge success from a disabled button alone.
- Keep free text factual and avoid unnecessary personal or third-party details.
- Do not paste tokens, cookies, service keys, CSV rows, or student descriptions into tickets or logs.
- Report unexpected access, export activity, missing audit events, or conflicting totals through the school's private incident channel.
