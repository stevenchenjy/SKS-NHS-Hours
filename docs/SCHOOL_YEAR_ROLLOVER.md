# NHS Service Hours Portal — School-year transition

A school-year transition creates new annual access records without moving or rewriting the prior year's service history. There is no dedicated rollover panel: teacher administrators create the year in Settings and assign the new roster and leadership team from Accounts.

## Invariants

```text
one profile
  ├── prior-year membership → frozen roles, requests, reviews, and audit history
  └── new-year membership   → fixed year-end expiration and deliberately selected access

global administrator grant  → no annual membership requirement, no service target
```

- Every member has a fixed requirement of 20 approved hours.
- Pending hours are displayed separately and never count as approved completion.
- Member and student-leadership access belongs to one school year.
- Committee head and President / Vice President automatically include member access.
- Student leadership never carries forward automatically.
- Teacher-administrator and platform-owner access is global and must not be assigned as annual member access.
- Prior memberships and service records remain attributable and are never repurposed.

## Prepare the transition

Before changing state:

- agree on the new label and inclusive start/end dates;
- confirm the incoming member roster and leadership appointments;
- decide which service categories remain available;
- resolve or document pending requests in the current year;
- test the process with synthetic records in staging; and
- have a second authorized person review the planned roster and dates.

## Create the draft year

In Settings → School years:

1. enter a consecutive label such as `2027-2028`;
2. enter the real inclusive dates whose years match the label;
3. create the year; it starts as `draft` with the fixed 20-hour requirement; and
4. verify that global administrators can still open administration without an annual assignment.

A draft does not accept ordinary member submissions. Only one year may be active.

## Configure categories

In Settings → Categories, choose whether each active category is available for the draft year. Categories are alphabetical; there is no custom ordering, per-category request maximum, or per-member category cap. Availability changes do not rewrite historical requests.

## Assign the new roster and leadership

In Accounts → Add accounts:

1. select the destination draft year;
2. choose an existing active profile or invite/import a new person;
3. select exactly one access level: Member, Committee head, or President / Vice President; and
4. submit and verify the destination-year row in Accounts.

The protected destination-access transaction creates or reactivates the membership, fixes its expiration to the year end, clears target overrides, replaces destination-year roles, and records a prior-membership link when available. Committee head and President / Vice President normalize to `member` plus the selected leadership role.

Do not add a global teacher administrator as a member. If one person genuinely needs staff administration and a member demonstration persona, use separate identities with synthetic data for the latter.

## Verify before activation

Check:

- label and inclusive dates;
- fixed 20-hour requirement;
- expected member count, excluding global administrators;
- one deliberately selected access level per person;
- expected Committee head and President / Vice President reviewers;
- category availability;
- no stale leadership carried into the new year; and
- audit entries for the year, accounts, invitations, and category changes.

Use the platform owner's read-only Role preview for demonstrations. For an interactive submission/review rehearsal, use separate synthetic Member and leader accounts so self-review remains impossible.

## Activate and validate

Activate the draft year only after the review. Then verify:

1. a member can sign in, see the correct year, and submit a quarter-hour request;
2. the member progress line shows approved, then pending, then neutral remainder;
3. a Committee head or President / Vice President can see and decide eligible pending work;
4. a global teacher administrator can administer and review without becoming a member;
5. Members excludes global administrators from progress and requirements;
6. Accounts is the canonical status/role editor and Invitations shows delivery lifecycle only; and
7. exports and audit are scoped to the selected year while administration remains global.

## Close the prior year

After pending work and required exports are handled, close the prior year. Closing prevents ordinary new activity but preserves requests, decisions, corrections, roles, identities, and audit history. Never extend the prior year or mutate historical roles to represent the new team.

## Recovery

If the wrong access was assigned, correct the destination-year row through Accounts. If dates or activation were wrong, use the protected school-year workflow and preserve audit history. Do not repair a transition with direct table updates, deletes, copied requests, or renamed identities.
