begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(37);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb010',
  'authenticated', 'authenticated', 'unprovisioned@example.edu', '', statement_timestamp(),
  '{"provider":"google","providers":["google"]}', '{}',
  statement_timestamp(), statement_timestamp(), '', '', '', ''
);

set local role anon;
select extensions.throws_ok(
  $$ select * from public.service_categories $$,
  '42501',
  'permission denied for table service_categories',
  'anonymous callers have no domain-table privileges'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb010', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb010","role":"authenticated","email":"unprovisioned@example.edu"}',
  true
);
select extensions.is(
  (select count(*) from public.profiles), 0::bigint,
  'authenticated but unprovisioned user cannot read profiles'
);
select extensions.is(
  (select count(*) from public.service_categories), 0::bigint,
  'authenticated but unprovisioned user cannot read categories'
);
select extensions.is(
  (select count(*) from public.pending_review_queue), 0::bigint,
  'authenticated but unprovisioned user cannot read the review queue'
);
select extensions.is(
  (select count(*) from public.invitations), 0::bigint,
  'authenticated but unprovisioned user cannot read invitations'
);
select extensions.is(
  (select count(*) from public.school_year_summary), 0::bigint,
  'authenticated but unprovisioned user cannot read admin summaries'
);
select extensions.is(
  (select count(*) from public.export_service_records), 0::bigint,
  'authenticated but unprovisioned user cannot read exports'
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
  (select count(*) from public.invitations), 0::bigint,
  'ordinary member cannot read invitation administration records'
);
select extensions.is(
  (select count(*) from public.school_year_summary), 0::bigint,
  'ordinary member cannot read aggregate admin summaries'
);
select extensions.is(
  (select count(*) from public.export_service_records), 0::bigint,
  'ordinary member cannot read CSV export rows'
);

-- A teacher administrator may process any pending request, including one
-- assigned to a committee head.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001","role":"authenticated","email":"admin@example.edu"}',
  true
);
select extensions.lives_ok(
  $$ select public.review_hour_request('40000000-0000-4000-8000-000000000002', 'approve') $$,
  'a teacher administrator can process an item assigned to another reviewer'
);
select extensions.is(
  (
    select requested_approver_membership_id
    from public.hour_requests where id = '40000000-0000-4000-8000-000000000002'
  ),
  '20000000-0000-4000-8000-000000000002'::uuid,
  'requested approver remains the original assignment'
);
select extensions.is(
  (
    select actual_reviewer_membership_id
    from public.hour_requests where id = '40000000-0000-4000-8000-000000000002'
  ),
  '20000000-0000-4000-8000-000000000001'::uuid,
  'actual reviewer records the teacher administrator who acted'
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
select extensions.lives_ok(
  $$
    select public.correct_approved_request(
      p_request_id => '40000000-0000-4000-8000-000000000001',
      p_title => 'Library Setup Corrected',
      p_description => 'Prepared books and tables for the school library event.',
      p_category_id => '30000000-0000-4000-8000-000000000001',
      p_service_date => '2026-08-05',
      p_hours => 11.50,
      p_reason => 'Corrected a one-hour transcription error.'
    )
  $$,
  'teacher administrator can correct an approved request'
);
select extensions.is(
  (
    select count(*) from public.hour_request_corrections
    where hour_request_id = '40000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'approved correction creates an immutable correction record'
);
select extensions.is(
  (
    select (before_values ->> 'hours')::numeric
    from public.hour_request_corrections
    where hour_request_id = '40000000-0000-4000-8000-000000000001'
  ),
  12.50::numeric,
  'correction records the prior approved hours'
);
select extensions.is(
  (
    select (after_values ->> 'hours')::numeric
    from public.hour_request_corrections
    where hour_request_id = '40000000-0000-4000-8000-000000000001'
  ),
  11.50::numeric,
  'correction records the corrected approved hours'
);
select extensions.ok(
  exists (
    select 1 from public.audit_events
    where action = 'hour_request.corrected'
      and entity_id = '40000000-0000-4000-8000-000000000001'
  ),
  'approved correction is audited with actor attribution'
);
select extensions.is(
  (
    select approved_hours from public.member_progress
    where membership_id = '20000000-0000-4000-8000-000000000003'
  ),
  14.75::numeric,
  'progress reflects corrected approved totals and the cross-reviewer approval'
);

select extensions.lives_ok(
  $$ select public.create_school_year('2027-2028', '2027-07-01', '2028-06-30', 20.00) $$,
  'teacher administrator can create a fixed-target school year as a draft'
);
select extensions.throws_ok(
  $$
    select public.set_school_year_target(
      (select id from public.school_years where label = '2027-2028'), 22.50
    )
  $$,
  '23514',
  'The annual service target is fixed at 20 approved hours',
  'school-year target mutation is rejected by the compatibility RPC'
);
select extensions.is(
  (select default_target_hours from public.school_years where label = '2027-2028'),
  20.00::numeric,
  'new school years always retain the fixed 20-hour target'
);
select extensions.throws_ok(
  $$
    select * from public.renew_memberships(
      (select id from public.school_years where label = '2027-2028'),
      '[{
        "profile_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001",
        "role_keys":["member"]
      }]'::jsonb
    )
  $$,
  '23514',
  'Global teacher administrators cannot receive school-year member access',
  'destination access rejects global teacher-administrator profiles'
);
select extensions.lives_ok(
  $$
    select * from public.renew_memberships(
      (select id from public.school_years where label = '2027-2028'),
      '[
        {
          "profile_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003",
          "expiration_date":"2027-08-01",
          "target_hours_override":5,
          "role_keys":["president_vice_president"]
        }
      ]'::jsonb
    )
  $$,
  'destination access adds an existing ordinary account to the selected year'
);
select extensions.is(
  (
    select count(*)
    from public.school_year_memberships membership
    join public.school_years school_year on school_year.id = membership.school_year_id
    where school_year.label = '2027-2028'
  ),
  2::bigint,
  'the destination year contains one member plus the automatic admin anchor'
);
select extensions.results_eq(
  $$
    select role.role_key
    from public.school_year_memberships membership
    join public.school_years school_year on school_year.id = membership.school_year_id
    join public.membership_roles membership_role on membership_role.membership_id = membership.id
    join public.roles role on role.id = membership_role.role_id
    where school_year.label = '2027-2028'
      and membership.profile_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001'
    order by role.display_order
  $$,
  $$ values ('teacher_admin'::text) $$,
  'new school years automatically receive a teacher-only administrator anchor'
);
select extensions.ok(
  exists (
    select 1
    from public.school_year_memberships membership
    join public.school_years school_year on school_year.id = membership.school_year_id
    where school_year.label = '2027-2028'
      and membership.profile_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003'
      and membership.expiration_date = school_year.end_date
      and membership.target_hours_override is null
      and membership.renewed_from_membership_id =
        '20000000-0000-4000-8000-000000000003'
  ),
  'destination access forces year-end expiration, no override, and preserves history'
);
select extensions.results_eq(
  $$
    select role.role_key
    from public.school_year_memberships membership
    join public.school_years school_year on school_year.id = membership.school_year_id
    join public.membership_roles assignment on assignment.membership_id = membership.id
    join public.roles role on role.id = assignment.role_id
    where school_year.label = '2027-2028'
      and membership.profile_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003'
    order by role.display_order
  $$,
  $$ values ('member'::text), ('president_vice_president'::text) $$,
  'combined leadership destination access is normalized to include member'
);
select extensions.lives_ok(
  $$
    select * from public.renew_memberships(
      (select id from public.school_years where label = '2027-2028'),
      '[{
        "profile_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003",
        "role_keys":["committee_head"]
      }]'::jsonb
    )
  $$,
  'destination access can replace the selected school-year access level'
);
select extensions.results_eq(
  $$
    select role.role_key
    from public.school_year_memberships membership
    join public.school_years school_year on school_year.id = membership.school_year_id
    join public.membership_roles assignment on assignment.membership_id = membership.id
    join public.roles role on role.id = assignment.role_id
    where school_year.label = '2027-2028'
      and membership.profile_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003'
    order by role.display_order
  $$,
  $$ values ('member'::text), ('committee_head'::text) $$,
  'destination access replaces prior roles instead of accumulating them'
);
select extensions.lives_ok(
  $$
    select public.activate_school_year(
      (select id from public.school_years where label = '2027-2028')
    )
  $$,
  'next school year activates only after an administrator is assigned'
);
select extensions.is(
  (select status from public.school_years where label = '2027-2028'),
  'active'::text,
  'rollover year is active after activation'
);
select extensions.is(
  (
    select count(*) from public.school_year_memberships
    where profile_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003'
  ),
  2::bigint,
  'renewal preserves the member previous-year membership as history'
);
select extensions.ok(
  pg_get_functiondef(
    'public.review_hour_request(uuid,text,text)'::regprocedure
  ) ilike '%for update%'
  and pg_get_functiondef(
    'public.review_hour_request(uuid,text,text)'::regprocedure
  ) ilike '%and status = ''pending''%',
  'review RPC serializes on the request row and rechecks pending status'
);
select extensions.lives_ok(
  $$ select public.close_school_year('10000000-0000-4000-8000-000000000001') $$,
  'teacher administrator can close the prior school year'
);
select extensions.is(
  (select status from public.school_years where id = '10000000-0000-4000-8000-000000000001'),
  'closed'::text,
  'prior school year is frozen as closed'
);

reset role;
select extensions.is(
  (
    select count(*) from public.hour_requests
    where school_year_id = '10000000-0000-4000-8000-000000000001'
  ),
  5::bigint,
  'closing a school year preserves all historical request records'
);

select * from extensions.finish();
rollback;
