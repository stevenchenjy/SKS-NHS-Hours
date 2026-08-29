# NHS Service Hours Portal — School-year rollover

Rollover creates new annual authorization records without moving or rewriting the prior year's service history. A teacher administrator should run it before the new year begins, with a second administrator reviewing the plan.

## The rollover invariant

```text
one person/profile
  ├── prior-year membership → prior roles, requests, reviews, corrections, audit
  └── new-year membership   → new expiration, target override, and deliberately selected roles
```

The process does not extend the old membership, copy requests, copy decisions, or make last year's leaders current leaders. Historical rows remain attributable to their original membership and school year.

## Preconditions

Before beginning:

- confirm the new label, inclusive start/end dates, default target, and school-approved membership expiration rule;
- confirm who approves the rollover and who will retain teacher-administrator access;
- confirm the current hosted backup/PITR state and the recovery owner;
- resolve duplicate profiles and uncertain account status before renewal;
- review current profiles, memberships, roles, target overrides, and expiring accounts;
- decide which categories will be available and whether per-request or approved-hours caps change;
- use a protected non-production environment with synthetic data to rehearse the process; and
- keep the prior year open until the renewal results have been reviewed unless policy requires an earlier close.

The application currently renews one selected identity at a time. Plan enough operator time; do not invent a bulk SQL shortcut around the protected function.

## 1. Create the draft year

1. Open `/admin/settings/school-years`.
2. Create a school year with a consecutive label such as `2027-2028`.
3. Enter real ISO dates whose years match the label and set the default target, normally 20 hours.
4. Confirm the record appears with status `draft`.
5. Verify the `school_year.created` audit event.

A draft does not accept ordinary member submissions. The default target can be changed only while the year is draft or active through the protected `set_school_year_target` database operation. The current UI sets the default during creation and does not expose a separate post-creation editor.

## 2. Configure categories

Open `/admin/settings/categories` and review each global category for the destination year:

- available or unavailable;
- display order;
- maximum hours per request; and
- optional approved-hours cap per member/category.

Do not delete a category referenced by history. Global category activation and year-specific availability are separate controls.

Verify the expected five initial names exist where required: Green Team, Peer Tutoring, Concessions, Fundraising & Events, and Community Service.

## 3. Build the renewal list

For each person, decide:

| Decision       | Question                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------ |
| Include        | Is this person an NHS participant in the destination year?                                 |
| Expiration     | What in-year date ends active privileges under school policy?                              |
| Target         | Do they inherit the year default, or have an approved override?                            |
| Roles          | Which destination-year roles are approved? Do not assume prior leadership carries forward. |
| Profile status | Is the identity still active across the portal?                                            |

Include `member` for students who submit service hours. Assign review roles only to approved leaders. Renew at least two teacher administrators where staffing permits so routine turnover does not create a single point of failure.

## 4. Renew each membership

In the **School-year rollover** panel on `/admin/settings/school-years`:

1. choose the existing user;
2. choose the new draft year;
3. enter an expiration date inside the destination year;
4. enter a target override or leave it blank to inherit the default;
5. select every destination-year role;
6. read the summary and tick the confirmation; and
7. choose **Create membership**.

The `renew_memberships` transaction creates or safely reactivates the destination membership, records a renewal link when a source membership exists, replaces the destination role set with the selected roles, and appends audit events. The operation must fail atomically for invalid role, date, status, target, or last-admin conditions.

After each batch of work, reconcile:

- selected people versus created destination memberships;
- expiration dates and target overrides;
- role counts, especially `teacher_admin` and review-capable roles;
- duplicate membership count, which must remain zero; and
- audit events for each renewal/role assignment.

## 5. Validate before activation

Use non-production accounts that represent:

- renewed ordinary member;
- renewed committee head/president/vice president;
- renewed teacher administrator;
- multi-role user;
- person intentionally not renewed;
- expired prior member; and
- expired former leader.

Confirm:

- a renewed member has only the intended destination membership/roles and cannot edit prior-year records;
- a former leader with no destination review role cannot open current leader surfaces or call review functions;
- a renewed leader can see permitted destination-year roster/pending records but cannot self-review;
- the destination target and category settings produce expected progress;
- the teacher administrator can see accounts, settings, audit, and exports;
- old requests, reviews, corrections, requested approvers, actual reviewers, and audits are unchanged; and
- current-year queries do not mix prior-year membership IDs.

Run the database and browser rollover cases in `docs/TESTING.md`; a visual count alone is not sufficient evidence.

## 6. Activate the new year

Activation requires a valid active teacher-administrator membership in the target year.

1. Have the second administrator review memberships, roles, target, dates, and categories.
2. On `/admin/settings/school-years`, activate the draft year.
3. Confirm it is the single active year and verify the activation audit event.
4. Sign out and back in with the test personas so navigation and protected routes are evaluated against the new year.
5. Submit a 0.25-hour synthetic request to a different active reviewer and complete one approval.
6. Confirm pending/approved totals, actual reviewer, and audit events.

If activation fails, read the error and correct the draft data. Do not directly update year status.

## 7. Close the prior year

Close the prior year only after the school-approved submission/review cutoff and reconciliation are complete:

1. export the smallest authorized archival data set required by policy;
2. verify the export row count and audit event;
3. store it only in approved restricted storage;
4. close the year from `/admin/settings/school-years`;
5. verify prior history remains readable to authorized users and no prior-year active mutation succeeds; and
6. record the operator, approver, counts, exceptions, and completion time in the private annual operations record.

Closing is not deletion. Do not archive or anonymize records until the school's approved retention/legal-hold process says to do so.

## Failure and recovery

`renew_memberships` is transactional for the submitted renewal payload. A failed call should create neither a partial membership nor partial role/audit state for that call. The current UI submits one identity per call, so a series of successful renewals followed by a later failure is expected to retain the earlier successful identities.

For an incorrect destination membership:

- correct status, target, or roles through the protected UI/RPC and preserve the audit trail;
- do not delete the membership or edit historical links directly;
- do not restore the whole database for a routine operator mistake; and
- escalate conflicting totals, missing audits, duplicate membership errors, or unexpected authority before activation.

If a new year was activated incorrectly, stop writes and choose a controlled forward correction. Database restoration is reserved for an approved incident decision; application rollback alone does not reverse year or membership changes.

## Completion record

Record outside the repository, without credentials or unnecessary personal data:

- source and destination school-year IDs/labels;
- migration/application release identifiers;
- backup verification time and recovery owner;
- total eligible, renewed, excluded, and exception counts;
- counts by destination role;
- target and category configuration reviewed;
- test-persona results;
- activation and prior-year closure audit IDs/timestamps; and
- operator and independent reviewer approval.
