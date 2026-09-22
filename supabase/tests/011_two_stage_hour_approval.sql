begin;

-- A real teacher is distinct from the platform owner used for administration.
insert into auth.users (id, email, aud, role, email_confirmed_at)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009', 'teacher@example.edu',
  'authenticated', 'authenticated', statement_timestamp());
insert into public.profiles (id, email, full_name)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009', 'teacher@example.edu', 'Terry Teacher');
insert into public.platform_access_grants (profile_id, access_level, granted_by_profile_id)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009', 'teacher_admin', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001');


create extension if not exists pgtap with schema extensions;
select extensions.plan(17);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
  'authenticated', 'authenticated', 'second-teacher@example.edu', '',
  statement_timestamp(), '{"provider":"email","providers":["email"]}', '{}',
  statement_timestamp(), statement_timestamp(), '', '', '', ''
);

insert into public.profiles (id, email, full_name)
values (
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
  'second-teacher@example.edu',
  'Taylor Teacher'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001","role":"authenticated","email":"admin@example.edu"}',
  true
);

select extensions.lives_ok(
  $$ select public.grant_teacher_admin('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1') $$,
  'the owner can provision a second teacher for the shared final queue'
);
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009', true);
select extensions.is(
  (
    select count(*)
    from public.pending_review_queue
    where id = '40000000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'teachers cannot see a request before committee-head approval'
);
select extensions.throws_ok(
  $$ select public.review_hour_request('40000000-0000-4000-8000-000000000002', 'approve') $$,
  '42501',
  'The selected committee head must complete the first approval',
  'a teacher cannot bypass the first approval'
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

select extensions.lives_ok(
  $$ select public.review_hour_request('40000000-0000-4000-8000-000000000002', 'approve') $$,
  'the selected committee head completes the first approval'
);
select extensions.ok(
  (
    select status = 'pending'
      and committee_head_reviewer_membership_id = requested_approver_membership_id
      and committee_head_approved_at is not null
      and actual_reviewer_membership_id is null
    from public.hour_requests
    where id = '40000000-0000-4000-8000-000000000002'
  ),
  'the first approval records the head without approving the hours'
);
select extensions.is(
  (
    select count(*)
    from public.pending_review_queue
    where id = '40000000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'the request leaves the committee head queue after first approval'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select extensions.ok(
  exists (
    select 1
    from public.pending_review_queue
    where id = '40000000-0000-4000-8000-000000000002'
      and approval_stage = 'teacher'
  ),
  'the original teacher sees the shared final-approval request'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1","role":"authenticated","email":"second-teacher@example.edu"}',
  true
);

select extensions.ok(
  exists (
    select 1
    from public.pending_review_queue
    where id = '40000000-0000-4000-8000-000000000002'
      and approval_stage = 'teacher'
  ),
  'a second teacher sees the same shared final-approval request'
);
select extensions.lives_ok(
  $$ select public.review_hour_request('40000000-0000-4000-8000-000000000002', 'approve') $$,
  'either teacher can complete the final approval'
);
select extensions.ok(
  exists (
    select 1
    from public.hour_requests request
    join public.school_year_memberships reviewer
      on reviewer.id = request.actual_reviewer_membership_id
    where request.id = '40000000-0000-4000-8000-000000000002'
      and request.status = 'approved'
      and reviewer.profile_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'
      and request.decided_at is not null
  ),
  'the final decision records the teacher who acted'
);

select extensions.is((select count(*) from public.pending_review_queue where id = '40000000-0000-4000-8000-000000000002'), 0::bigint,
  'the approving teacher no longer sees the request in Pending');
select extensions.is((select count(*) from public.approved_request_archive where id = '40000000-0000-4000-8000-000000000002'), 1::bigint,
  'the approving teacher sees the request once in Archive');
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009","role":"authenticated"}', true);
select extensions.is((select count(*) from public.pending_review_queue where id = '40000000-0000-4000-8000-000000000002'), 0::bigint,
  'the other teacher also loses the completed request from Pending');
select extensions.is((select actual_reviewer_name from public.approved_request_archive where id = '40000000-0000-4000-8000-000000000002'), 'Taylor Teacher',
  'the other teacher sees the completed decision in Archive');
select extensions.throws_ok($$ select public.review_hour_request('40000000-0000-4000-8000-000000000002', 'approve') $$,
  '40001', 'Request is no longer pending', 'a stale second teacher approval cannot duplicate approval');
select extensions.throws_ok($$ select public.review_hour_request('40000000-0000-4000-8000-000000000002', 'reject', 'Stale review') $$,
  '40001', 'Request is no longer pending', 'a stale second teacher decision cannot override approval');
select extensions.is((select count(*) from public.hour_reviews where hour_request_id = '40000000-0000-4000-8000-000000000002' and action = 'approved'), 1::bigint,
  'only one final approval is recorded in history');

select * from extensions.finish();
rollback;
