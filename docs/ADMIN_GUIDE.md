# NHS Service Hours Portal — Administrator guide

This guide is for teacher administrators who manage accounts, service records, reporting, and annual leadership changes. Technical setup and break-glass procedures are in `docs/DEPLOYMENT.md` and `docs/OPERATIONS.md`.

## Understand the access model

Never share accounts. A successful sign-in proves identity; the database separately decides what that identity may do.

| Access                     | Scope               | Main capability                                                                                        |
| -------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------ |
| Member                     | One school year     | Submit and track the person's own service hours toward the fixed 20-hour requirement                   |
| Committee head             | One school year     | Member access plus eligible review and roster context                                                  |
| President / Vice President | One school year     | Member access plus eligible review and roster context                                                  |
| Teacher administrator      | Global              | Review and administer accounts, years, categories, corrections, audit, and exports across all years    |
| Platform owner             | Global, exactly one | Teacher-administrator access plus administrator grants, ownership transfer, and read-only role preview |

Student leadership is deliberately reassigned for each school year. Teacher administrators are not members, do not accumulate hours, have no annual requirement, and do not need an annual role assignment. Use a separate identity when someone truly needs both a staff-administration account and a student/member persona.

## Use Accounts as the canonical workflow

`/admin/accounts` is the single place to manage identity status, school-year access, student leadership, global administrator access, invitations, and roster imports. The three views have different jobs:

- **Accounts** is the directory and current state. Search here, change an identity's global status, change one year's access status, assign or remove student leadership, and inspect global access.
- **Add accounts** starts access. Invite one new identity, import a CSV roster, or add an existing profile to the selected school year.
- **Invitations** is the delivery/lifecycle queue. Check whether an invite is pending, accepted, expired, or revoked; inspect expiry and accepted send count; resend or revoke pending invitations.

The Members area is intentionally read-only progress/history, not a second account-status editor. Settings no longer has a separate Roles page workflow.

## Invite one account

1. Open `/admin/accounts`, select the intended school year, and choose **Add accounts**.
2. Enter the normalized email and full name.
3. Choose one initial access option: Member, Committee head, President / Vice President, or Teacher administrator.
4. Submit once and read the result.
5. Open **Invitations** to confirm the pending record, seven-day expiry, and accepted send count.
6. Verify delivery through the configured Auth/SMTP provider. A portal success message confirms provider acceptance, not inbox delivery.

Committee head and President / Vice President automatically include member access. Teacher administrator is exclusive, global, and can only be invited by the platform owner. Give staff a distinct administration identity if their existing profile has member participation or service history.

Use **Resend** for an existing pending invitation instead of creating a duplicate. After provider acceptance it issues a new invite message, extends the portal invitation to seven days, and increments the send count. Provider failure leaves the count unchanged. If provider acceptance succeeds but the database receipt fails, inspect Invitations and Audit trail before retrying because the two systems cannot share one transaction. Use **Revoke** when the invitation must no longer be claimed. Only the platform owner can resend or revoke a teacher-administrator invitation; ordinary teacher administrators manage the lifecycle of member and student-leadership invitations.

Invite and recovery links are one-time credentials. The hosted templates send token hashes to `/auth/confirm`; successful verification creates a user-bound password-update context lasting 30 minutes. If a link expires, create/resend an approved invitation or ask the user to request another reset. Never forward an invite or reset URL through an unapproved channel.

## Import a roster

Under **Add accounts**, upload a UTF-8 CSV with:

```csv
email,full_name,roles
student@example.edu,Maya Chen,member
leader@example.edu,Noah Williams,president_vice_president
```

The importer accepts up to 250 rows and 1 MB. Supported CSV role values are `member`, `committee_head`, and `president_vice_president`. Teacher administrators must be invited individually by the platform owner. The portal rejects unknown or duplicate headers, missing required values, duplicate emails, invalid roles, and disallowed email domains before delivery begins.

The file is validated before sending, but email delivery can still partially fail. Resolve the named rows, inspect any provider-accepted/receipt-failed record, and use Invitations → Resend. Do not upload the entire roster again blindly. Use synthetic data for rehearsals and keep student CSV files in school-approved restricted storage.

## Add an existing person to a new school year

There is no separate rollover panel. Under **Add accounts**, choose an existing active profile, the selected destination year, and one access level. The operation creates or safely reactivates that year's membership, fixes expiration to the year end, replaces stale destination-year roles, and preserves any link to prior-year history.

Do this deliberately for the new member and leadership roster. No student leadership automatically carries forward. Global teacher administrators already have access and must not be added as members.

## Change statuses and roles

In the Accounts directory:

- identity status applies across the whole portal;
- school-year access status applies only to the selected year;
- Committee head and President / Vice President are annual leadership access;
- teacher-administrator and platform-owner badges are global access.

Deactivate a profile when the identity should lose all access. Suspend or archive school-year access when only annual participation changes. Expired access and access in a closed or archived year are read-only history: do not reactivate them or change their annual roles; assign destination-year access instead. Never hard-delete a profile, membership, request, review, or audit history.

The member role is the baseline for student leadership and cannot be removed separately. Assign only the annual leadership access each student actually needs; the account workflow can represent both leadership capabilities when school policy requires it. Only the platform owner can grant or revoke teacher-administrator access. Ownership must be transferred to another active teacher administrator before the owner's access can be removed or deactivated; the database also protects the final active global administrator.

## Create and operate school years

1. Open Settings → School years.
2. Create a consecutive label and inclusive start/end dates. Every year uses the fixed 20-approved-hour requirement.
3. The new year starts as a draft.
4. Add members and assign the new leadership team from Accounts → Add accounts.
5. Configure which categories are available.
6. Review the planned roster, then activate the year.
7. Close the prior year only after pending work and required exports are handled.

Only one school year may be active. Global administrators retain access automatically, so activation does not require an annual admin assignment. Closing preserves the year for history and reporting.

## Manage categories

Settings → Categories can create, rename, describe, activate, or deactivate a category and make it available or unavailable for a school year. Categories are shown alphabetically. They have no custom display order, per-request maximum, or per-member approved-hour cap. A universal 24-hour sanity limit still applies to one service request, and hours remain positive quarter-hour increments.

Deactivate or make a category unavailable instead of deleting one referenced by history. The initial reference set is Green Team, Peer Tutoring, Concessions, Fundraising & Events, and Community Service.

## Review service requests

Review-capable users work in `/admin/requests`:

1. **Assigned to me** focuses the requested assignment; **All pending** is the eligible shared queue.
2. Verify the member, service facts, requested approver, current status, and history.
3. Approve, request changes, reject, or reassign. Changes requested and rejection require a useful comment.
4. Never process your own request. Self-review is enforced in the database.
5. If a request is no longer pending, reload; another eligible reviewer may have completed the locked transaction.

The actual reviewer is recorded separately from the requested approver. Teacher administrators can review through a technical attribution anchor, but that anchor never makes them a member or gives them progress.

## Read progress correctly

Only approved hours count toward the fixed 20-hour requirement. Pending hours are informational and do not reduce the approved-hours remainder.

The progress bar is one stacked line: approved occupies the left segment, pending connects after it in another color, and the rest is neutral. The visual segments stop at the 20-hour width, while text preserves true approved values and over-goal amounts. A summary such as `5 of 20 approved · 2 pending · 15 approved hours remaining` always means the remainder is based on approved hours only.

`/admin/members` and each member detail page are the canonical roster-progress/history views. They intentionally exclude global administrators.

## Correct, audit, and export

Approved records are not ordinarily editable. A teacher administrator can open the request, use the correction form, enter corrected allowed fields and a specific reason, and then verify the before/after correction, review history, progress, and audit entry. Never edit an approved row directly.

Use `/admin/audit` for sensitive activity and `/admin/exports` for purpose-limited CSV downloads. Verify the selected year, row count, and `export.generated` audit event. Store exports only in approved restricted storage and remove them under the school's retention policy.

## Use role preview safely

The platform owner sees **Role preview** in navigation. It provides fixed, synthetic, read-only screens for Member, Committee head, President / Vice President, and Teacher administrator perspectives. It does not impersonate another user, expose a real person's data, or change permissions. Use it for training and demonstrations; use dedicated synthetic test accounts only when a real interactive end-to-end session is required.

## Transfer platform ownership

1. Invite or grant a separate active teacher-administrator identity and have that person sign in successfully.
2. Verify administration, review, audit, export, Supabase, Vercel, GitHub, SMTP, domain, incident, privacy, and backup responsibilities as appropriate.
3. Transfer platform ownership through the protected Accounts workflow.
4. Verify the successor can use Role preview and manage administrators.
5. Revoke or deactivate the predecessor only after successor verification; retain all historical actions under the original identity.
6. Revoke sessions and rotate operational credentials the departing person could access.

The one-time bootstrap is not a routine transfer mechanism and refuses once global administration exists.

## Safe operating habits

- Check the selected year before account, role, export, and category changes.
- Use different people for submission and review.
- Read the result and audit event; do not infer success from a button state.
- Keep free text factual and avoid unnecessary personal or third-party details.
- Never paste tokens, cookies, service keys, CSV rows, student descriptions, or invite/reset URLs into tickets or logs.
- Report unexpected access, export activity, missing audit events, or conflicting totals through the school's private incident channel.
