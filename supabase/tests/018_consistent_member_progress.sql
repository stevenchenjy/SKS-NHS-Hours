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
select extensions.plan(22);

-- Reproduce three requests totaling six hours assigned to a different head.
select set_config('nhs.allow_hour_request_transition', 'on', true);
update public.hour_requests set hours = 4
where id = '40000000-0000-4000-8000-000000000002';
insert into public.hour_requests (
  id, member_membership_id, school_year_id, category_id,
  requested_approver_membership_id, title, description, service_date,
  hours, status, client_submission_key, submitted_at
)
select
  fixture.id, request.member_membership_id, request.school_year_id,
  request.category_id, request.requested_approver_membership_id,
  'Progress regression', 'Synthetic one-hour request', request.service_date,
  1, 'pending', fixture.id::text, request.submitted_at
from public.hour_requests request
cross join (values
  ('40000000-0000-4000-8000-000000000018'::uuid),
  ('40000000-0000-4000-8000-000000000019'::uuid)
) fixture(id)
where request.id = '40000000-0000-4000-8000-000000000002';

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa007', true);
select extensions.is((select pending_hours from public.member_progress where membership_id = '20000000-0000-4000-8000-000000000003'), 6::numeric, 'unassigned leader sees all six pending hours');
select extensions.is((select pending_count from public.member_progress where membership_id = '20000000-0000-4000-8000-000000000003'), 3::bigint, 'unassigned leader sees all three pending requests in the count');
select extensions.is((select approved_hours from public.member_progress where membership_id = '20000000-0000-4000-8000-000000000003'), 12.5::numeric, 'approved totals also include requests reviewed by other people');
select extensions.is((select remaining_hours from public.member_progress where membership_id = '20000000-0000-4000-8000-000000000003'), 22.5::numeric, 'pending totals do not count toward the requirement');
select extensions.is((select count(*) from public.hour_requests where member_membership_id = '20000000-0000-4000-8000-000000000003'), 0::bigint, 'complete totals do not expose individual request details');
select extensions.is((select count(*) from public.pending_review_queue where member_membership_id = '20000000-0000-4000-8000-000000000003'), 0::bigint, 'complete totals do not add another head work to the queue');
select extensions.throws_ok($$ select public.review_hour_request('40000000-0000-4000-8000-000000000002', 'approve') $$, '42501', null, 'unassigned leader still cannot approve the request');

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002', true);
select extensions.is((select pending_hours from public.member_progress where membership_id = '20000000-0000-4000-8000-000000000003'), 6::numeric, 'assigned head sees the same pending total');
select public.review_hour_request(id, 'approve') from public.hour_requests
where member_membership_id = '20000000-0000-4000-8000-000000000003' and status = 'pending';
select extensions.is((select pending_hours from public.member_progress where membership_id = '20000000-0000-4000-8000-000000000003'), 6::numeric, 'head approval leaves all six hours pending');

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa007', true);
select extensions.is((select pending_hours from public.member_progress where membership_id = '20000000-0000-4000-8000-000000000003'), 6::numeric, 'unassigned leader retains the same total after head approval');

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009', true);
select extensions.is((select pending_hours from public.member_progress where membership_id = '20000000-0000-4000-8000-000000000003'), 6::numeric, 'teacher sees the same total');
select extensions.is((select count(*) from public.pending_review_queue where member_membership_id = '20000000-0000-4000-8000-000000000003'), 3::bigint, 'all three requests enter the teacher queue after head approval');
select public.review_hour_request('40000000-0000-4000-8000-000000000002', 'approve');

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa007', true);
select extensions.is((select pending_hours from public.member_progress where membership_id = '20000000-0000-4000-8000-000000000003'), 2::numeric, 'teacher approval removes four hours from every leader pending total');
select extensions.is((select approved_hours from public.member_progress where membership_id = '20000000-0000-4000-8000-000000000003'), 16.5::numeric, 'teacher approval adds four hours to every leader approved total');

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003', true);
select extensions.is((select pending_hours from public.member_progress where membership_id = '20000000-0000-4000-8000-000000000003'), 2::numeric, 'member sees the same updated total');
select extensions.is((select count(*) from private.member_request_summary('20000000-0000-4000-8000-000000000004')), 0::bigint, 'ordinary member cannot call helper for another membership');
select extensions.is((select count(*) from public.member_progress where membership_id = '20000000-0000-4000-8000-000000000004'), 0::bigint, 'ordinary member cannot read another member progress');
select extensions.is((select count(*) from private.member_request_summary('ffffffff-ffff-4fff-8fff-ffffffffffff')), 0::bigint, 'unknown membership exposes no aggregate');

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa005', true);
select extensions.is((select count(*) from private.member_request_summary('20000000-0000-4000-8000-000000000003')), 0::bigint, 'expired reviewer cannot bypass annual access through helper');

reset role;
select extensions.ok(not has_function_privilege('anon', 'private.member_request_summary(uuid)', 'execute'), 'anonymous callers cannot execute helper');
select extensions.ok(not has_function_privilege('service_role', 'private.member_request_summary(uuid)', 'execute'), 'helper has no unnecessary service-role grant');
select extensions.ok((select 'security_invoker=true' = any(reloptions) from pg_class where oid = 'public.member_progress'::regclass), 'roster view still enforces caller row permissions');
select * from extensions.finish();
rollback;
