begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(51);

select extensions.throws_ok(
  $$
    update public.hour_requests
    set hours = 11.00
    where id = '40000000-0000-4000-8000-000000000001'
  $$,
  '55000',
  'Approved hour requests require the correction procedure',
  'approved requests cannot be edited outside the correction RPC'
);
select extensions.throws_ok(
  $$ update public.hour_reviews set comment = 'changed' where id = -1002 $$,
  '55000',
  'hour_reviews records are immutable',
  'review history is append-only'
);

-- Invitation-claim Auth fixtures are transaction-local to this test.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  ('00000000-0000-0000-0000-000000000000',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb001', 'authenticated', 'authenticated',
   'invited@example.edu', '', statement_timestamp(),
   '{"provider":"google","providers":["google"]}', '{}',
   statement_timestamp(), statement_timestamp(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb002', 'authenticated', 'authenticated',
   'expired-claim@example.edu', '', statement_timestamp(),
   '{"provider":"google","providers":["google"]}', '{}',
   statement_timestamp(), statement_timestamp(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb003', 'authenticated', 'authenticated',
   'ambiguous-claim@example.edu', '', statement_timestamp(),
   '{"provider":"google","providers":["google"]}', '{}',
   statement_timestamp(), statement_timestamp(), '', '', '', '');

insert into public.school_years (
  id, label, start_date, end_date, default_target_hours, status, created_by_profile_id
)
values (
  '10000000-0000-4000-8000-000000000002', '2027-2028', '2027-07-01', '2028-06-30',
  20.00, 'draft', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001'
);

insert into public.invitations (
  id, email, full_name, school_year_id, status, expires_at, invited_by_membership_id
)
values
  ('51000000-0000-4000-8000-000000000001', 'expired-claim@example.edu',
   'Expired Claim', '10000000-0000-4000-8000-000000000001', 'pending',
   statement_timestamp() - interval '1 day', '20000000-0000-4000-8000-000000000001'),
  ('51000000-0000-4000-8000-000000000002', 'ambiguous-claim@example.edu',
   'Ambiguous Claim', '10000000-0000-4000-8000-000000000001', 'pending',
   statement_timestamp() + interval '7 days', '20000000-0000-4000-8000-000000000001'),
  ('51000000-0000-4000-8000-000000000003', 'ambiguous-claim@example.edu',
   'Ambiguous Claim', '10000000-0000-4000-8000-000000000002', 'pending',
   statement_timestamp() + interval '7 days', '20000000-0000-4000-8000-000000000001');

insert into public.invitation_roles (invitation_id, role_id)
select invitation_id, role.id
from unnest(array[
  '51000000-0000-4000-8000-000000000001'::uuid,
  '51000000-0000-4000-8000-000000000002'::uuid,
  '51000000-0000-4000-8000-000000000003'::uuid
]) invitation_id
cross join public.roles role
where role.role_key = 'member';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003","role":"authenticated","email":"member@example.edu"}',
  true
);

select extensions.is(
  (select count(*) from public.hour_requests),
  4::bigint,
  'ordinary member sees only their own seeded requests through RLS'
);
select extensions.is(
  (
    select count(*) from public.hour_requests
    where member_membership_id = '20000000-0000-4000-8000-000000000004'
  ),
  0::bigint,
  'ordinary member cannot see another member request'
);
select extensions.is(
  (
    select approved_hours from public.member_progress
    where membership_id = '20000000-0000-4000-8000-000000000003'
  ),
  12.50::numeric,
  'progress counts only approved hours'
);
select extensions.is(
  (
    select approved_count from public.member_progress
    where membership_id = '20000000-0000-4000-8000-000000000003'
  ),
  1::bigint,
  'progress exposes approved request count'
);
select extensions.is(
  (select count(*) from public.pending_review_queue),
  0::bigint,
  'member cannot read the reviewer queue'
);
select extensions.throws_ok(
  $$
    insert into public.hour_requests (member_membership_id, school_year_id)
    values (
      '20000000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  'permission denied for table hour_requests',
  'authenticated users cannot bypass server-derived request ownership'
);
select extensions.lives_ok(
  $$
    select public.create_hour_request_draft(
      p_school_year_id => '10000000-0000-4000-8000-000000000001',
      p_title => 'Idempotent Draft',
      p_description => 'A deterministic draft created by the workflow test.',
      p_category_id => '30000000-0000-4000-8000-000000000002',
      p_service_date => '2026-08-24',
      p_hours => 1.25,
      p_requested_approver_membership_id => '20000000-0000-4000-8000-000000000002',
      p_client_submission_key => 'workflow-idempotency-key'
    )
  $$,
  'member can create a draft through the RPC'
);
select extensions.lives_ok(
  $$
    select public.create_hour_request_draft(
      p_school_year_id => '10000000-0000-4000-8000-000000000001',
      p_title => 'Duplicate Transport Retry',
      p_description => 'This transport retry must return the original record.',
      p_category_id => '30000000-0000-4000-8000-000000000002',
      p_service_date => '2026-08-24',
      p_hours => 1.25,
      p_requested_approver_membership_id => '20000000-0000-4000-8000-000000000002',
      p_client_submission_key => 'workflow-idempotency-key'
    )
  $$,
  'a duplicate client key is handled idempotently'
);
select extensions.is(
  (
    select count(*) from public.hour_requests
    where client_submission_key = 'workflow-idempotency-key'
  ),
  1::bigint,
  'idempotency creates exactly one request'
);
select extensions.is(
  (
    select member_membership_id from public.hour_requests
    where client_submission_key = 'workflow-idempotency-key'
  ),
  '20000000-0000-4000-8000-000000000003'::uuid,
  'draft ownership is derived from the authenticated membership'
);
select extensions.throws_ok(
  $$
    select public.create_hour_request_draft(
      p_school_year_id => '10000000-0000-4000-8000-000000000001',
      p_title => 'Invalid Decimal',
      p_description => 'Invalid decimal precision must be rejected.',
      p_category_id => '30000000-0000-4000-8000-000000000002',
      p_service_date => '2026-08-24',
      p_hours => 1.10,
      p_requested_approver_membership_id => '20000000-0000-4000-8000-000000000002',
      p_client_submission_key => 'invalid-quarter-hour'
    )
  $$,
  '22023',
  'Hours must be a positive quarter-hour value no greater than 24',
  'non-quarter-hour values are rejected'
);
select extensions.throws_ok(
  $$
    select public.save_hour_request_draft(
      p_request_id => (
        select id from public.hour_requests
        where client_submission_key = 'workflow-idempotency-key'
      ),
      p_expected_revision => 0,
      p_title => 'Stale Save',
      p_description => 'A stale browser tab must not overwrite this request.',
      p_category_id => '30000000-0000-4000-8000-000000000002',
      p_service_date => '2026-08-24',
      p_hours => 1.25,
      p_requested_approver_membership_id => '20000000-0000-4000-8000-000000000002'
    )
  $$,
  '40001',
  'Request revision is stale',
  'draft save rejects a stale expected revision'
);
select extensions.throws_ok(
  $$
    select public.submit_hour_request(
      (select id from public.hour_requests where client_submission_key = 'workflow-idempotency-key'),
      0
    )
  $$,
  '40001',
  'Request revision is stale',
  'submission rejects a stale expected revision'
);
select extensions.lives_ok(
  $$
    select public.submit_hour_request(
      (select id from public.hour_requests where client_submission_key = 'workflow-idempotency-key'),
      1
    )
  $$,
  'member can submit a complete draft'
);
select extensions.is(
  (
    select status from public.hour_requests
    where client_submission_key = 'workflow-idempotency-key'
  ),
  'pending'::text,
  'submission moves the draft to pending'
);
select extensions.lives_ok(
  $$
    select public.withdraw_hour_request(
      (select id from public.hour_requests where client_submission_key = 'workflow-idempotency-key'),
      'Entered for workflow testing.'
    )
  $$,
  'member can withdraw a pending request'
);
select extensions.is(
  (
    select status from public.hour_requests
    where client_submission_key = 'workflow-idempotency-key'
  ),
  'withdrawn'::text,
  'withdrawal is persisted'
);
select extensions.lives_ok(
  $$
    select public.save_hour_request_draft(
      p_request_id => '40000000-0000-4000-8000-000000000004',
      p_expected_revision => 1,
      p_title => 'Food Pantry Updated',
      p_description => 'Sorted pantry donations with the supervising organization.',
      p_category_id => '30000000-0000-4000-8000-000000000005',
      p_service_date => '2026-08-12',
      p_hours => 1.50,
      p_requested_approver_membership_id => '20000000-0000-4000-8000-000000000002'
    )
  $$,
  'member can edit a changes-requested entry'
);
select extensions.lives_ok(
  $$ select public.submit_hour_request('40000000-0000-4000-8000-000000000004', 2) $$,
  'member can resubmit after changes'
);
select extensions.is(
  (select revision from public.hour_requests where id = '40000000-0000-4000-8000-000000000004'),
  3,
  'save and resubmission each increment the request revision'
);
select extensions.lives_ok(
  $$
    select public.create_hour_request_draft(
      p_school_year_id => '10000000-0000-4000-8000-000000000001',
      p_title => 'Uncapped Category Request',
      p_description => 'Confirms that categories no longer impose a separate approved-hour cap.',
      p_category_id => '30000000-0000-4000-8000-000000000001',
      p_service_date => '2026-08-25',
      p_hours => 8.00,
      p_requested_approver_membership_id => '20000000-0000-4000-8000-000000000002',
      p_client_submission_key => 'uncapped-category-request'
    )
  $$,
  'member can draft a category request within the universal 24-hour sanity limit'
);
select extensions.lives_ok(
  $$
    select public.submit_hour_request(
      (select id from public.hour_requests where client_submission_key = 'uncapped-category-request'),
      1
    )
  $$,
  'uncapped category request can enter the pending queue'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002","role":"authenticated","email":"reviewer@example.edu"}',
  true
);

select extensions.ok(
  (select count(*) >= 2 from public.pending_review_queue),
  'active reviewer sees their assigned pending queue'
);
select extensions.ok(
  (select bool_and(assigned_to_current_user) from public.pending_review_queue),
  'queue exposes whether requests are assigned to the current reviewer'
);
select extensions.lives_ok(
  $$ select public.review_hour_request('40000000-0000-4000-8000-000000000002', 'approve') $$,
  'the selected committee head can complete the first approval'
);
select extensions.ok(
  exists (
    select 1 from public.hour_requests
    where id = '40000000-0000-4000-8000-000000000002'
      and status = 'pending'
      and committee_head_reviewer_membership_id = '20000000-0000-4000-8000-000000000002'
      and committee_head_approved_at is not null
      and actual_reviewer_membership_id is null
  ),
  'committee-head approval keeps hours pending and opens the teacher stage'
);
select extensions.throws_ok(
  $$ select public.review_hour_request('40000000-0000-4000-8000-000000000002', 'approve') $$,
  '42501',
  'An active teacher administrator must complete the final approval',
  'a committee head cannot complete the teacher stage'
);
select extensions.lives_ok(
  $$
    select public.review_hour_request(
      (select id from public.hour_requests where client_submission_key = 'uncapped-category-request'),
      'approve'
    )
  $$,
  'committee-head approval is not blocked by a retired per-category cap'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa004', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa004","role":"authenticated","email":"leader@example.edu"}',
  true
);
select extensions.lives_ok(
  $$
    select public.create_hour_request_draft(
      p_school_year_id => '10000000-0000-4000-8000-000000000001',
      p_title => 'Leader Owned Request',
      p_description => 'A president or vice president may still submit service hours.',
      p_category_id => '30000000-0000-4000-8000-000000000005',
      p_service_date => '2026-08-25',
      p_hours => 1.00,
      p_requested_approver_membership_id => '20000000-0000-4000-8000-000000000002',
      p_client_submission_key => 'leader-self-review'
    )
  $$,
  'president or vice president can create their own draft as a member'
);
select extensions.lives_ok(
  $$
    select public.submit_hour_request(
      (select id from public.hour_requests where client_submission_key = 'leader-self-review'),
      1
    )
  $$,
  'president or vice president can submit their own request'
);
select set_config(
  'test.leader_self_review_request_id',
  (
    select id::text
    from public.hour_requests
    where client_submission_key = 'leader-self-review'
  ),
  true
);
select extensions.throws_ok(
  $$
    select public.review_hour_request(
      (select id from public.hour_requests where client_submission_key = 'leader-self-review'),
      'approve'
    )
  $$,
  '42501',
  'An active review-capable role is required',
  'a president or vice president without the committee-head role cannot approve hours'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa005', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa005","role":"authenticated","email":"expired-reviewer@example.edu"}',
  true
);
select extensions.throws_ok(
  $$
    select public.review_hour_request(
      current_setting('test.leader_self_review_request_id')::uuid,
      'approve'
    )
  $$,
  '42501',
  'An active review-capable role is required',
  'expired former leaders cannot review requests'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001","role":"authenticated","email":"admin@example.edu"}',
  true
);
select extensions.throws_ok(
  $$
    select public.remove_membership_role(
      '20000000-0000-4000-8000-000000000001', 'teacher_admin'
    )
  $$,
  '23514',
  'Teacher-administrator access is global; use the global administrator workflow',
  'teacher-administrator access cannot be removed through a school-year role RPC'
);
select extensions.throws_ok(
  $$ select public.set_app_setting('public_signup_enabled', 'true'::jsonb) $$,
  '42501',
  'Public signup cannot be enabled through the application database',
  'database setting cannot enable public signup'
);
select extensions.lives_ok(
  $$ select public.record_export('10000000-0000-4000-8000-000000000001', 'csv', 5) $$,
  'teacher administrator can record a CSV export'
);
select extensions.ok(
  exists (
    select 1 from public.audit_events
    where action = 'export.generated'
      and entity_type = 'export'
      and school_year_id = '10000000-0000-4000-8000-000000000001'
  ),
  'export action is written to the audit log'
);
select extensions.ok(
  (select count(*) > 0 from public.export_service_records),
  'teacher administrator can read export rows'
);
select extensions.is(
  (
    select actual_percentage from public.member_progress
    where membership_id = '20000000-0000-4000-8000-000000000004'
  ),
  60.00::numeric,
  'actual percentage uses the fixed 20-hour goal'
);
select extensions.is(
  (
    select over_goal_hours from public.member_progress
    where membership_id = '20000000-0000-4000-8000-000000000004'
  ),
  0.00::numeric,
  'twelve approved hours do not exceed the fixed 20-hour goal'
);
select extensions.is(
  (select count(*) from public.school_year_summary),
  2::bigint,
  'teacher administrator can read school-year summaries'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003","role":"authenticated","email":"member@example.edu"}',
  true
);
select extensions.is(
  (select count(*) from public.audit_events),
  0::bigint,
  'ordinary member cannot read audit events'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002","role":"authenticated","email":"reviewer@example.edu"}',
  true
);
select extensions.ok(
  (select count(*) >= 6 from public.hour_requests where member_membership_id =
    '20000000-0000-4000-8000-000000000003'),
  'active reviewer can read member records for their school year'
);
select extensions.ok(
  exists (
    select 1 from public.member_progress
    where membership_id = '20000000-0000-4000-8000-000000000007'
      and role_keys @> array[
        'member', 'committee_head', 'president_vice_president'
      ]::text[]
  ),
  'roster progress aggregates multi-role assignments without N+1 queries'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb002","role":"authenticated","email":"expired-claim@example.edu"}',
  true
);
select extensions.throws_ok(
  $$ select public.claim_invitation('51000000-0000-4000-8000-000000000001') $$,
  '55000',
  'Invitation is no longer valid',
  'expired invitation cannot be claimed explicitly'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb003","role":"authenticated","email":"ambiguous-claim@example.edu"}',
  true
);
select extensions.throws_ok(
  $$ select public.claim_invitation() $$,
  '21000',
  'Multiple eligible invitations exist; an invitation ID is required',
  'no-argument invitation claim fails closed when multiple invitations match'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb001","role":"authenticated","email":"invited@example.edu"}',
  true
);
select extensions.lives_ok(
  $$ select public.claim_invitation() $$,
  'an invited OAuth user can claim the single matching invitation without an ID'
);
select extensions.ok(
  exists (
    select 1 from public.school_year_memberships membership
    where membership.profile_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb001'
      and membership.school_year_id = '10000000-0000-4000-8000-000000000001'
      and membership.status = 'active'
  ),
  'invitation claim provisions an active school-year membership'
);
select extensions.throws_ok(
  $$ select public.claim_invitation() $$,
  'P0002',
  'No eligible invitation was found for the authenticated email',
  'an already-used invitation cannot be claimed again'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001","role":"authenticated","email":"admin@example.edu"}',
  true
);
select extensions.ok(
  exists (
    select 1 from public.audit_events
    where action = 'invitation.accepted'
      and actor_profile_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb001'
  ),
  'invitation acceptance is audited'
);

select * from extensions.finish();
rollback;
