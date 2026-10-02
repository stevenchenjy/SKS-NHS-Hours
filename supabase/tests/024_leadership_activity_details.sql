begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(11);

insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009', 'teacher@example.edu', 'authenticated', 'authenticated', statement_timestamp()),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa010', 'admin-two@example.edu', 'authenticated', 'authenticated', statement_timestamp());
insert into public.profiles (id, email, full_name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009', 'teacher@example.edu', 'Terry Teacher'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa010', 'admin-two@example.edu', 'Alex Admin');
insert into public.platform_access_grants (profile_id, access_level, granted_by_profile_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009', 'teacher_admin', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa010', 'admin', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001');

create function pg_temp.act_as(p_profile_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_profile_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_profile_id, 'role', 'authenticated')::text, true);
end;
$$;

set local role authenticated;
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa004');
select extensions.is((select count(*) from public.hour_requests where member_membership_id = '20000000-0000-4000-8000-000000000003'), 4::bigint, 'President reads the complete member log including drafts');
select extensions.is((select title from public.hour_requests where id = '40000000-0000-4000-8000-000000000002'), 'Community Cleanup'::text, 'President can open an unassigned activity detail');
select extensions.ok(exists(select 1 from public.hour_reviews where hour_request_id = '40000000-0000-4000-8000-000000000001'), 'President can read activity review history');
select extensions.is((select requested_approver_name from public.get_hour_request_reviewer_names('40000000-0000-4000-8000-000000000002')), 'Riley Reviewer'::text, 'President can read reviewer names');
select extensions.throws_ok($$select public.review_hour_request('40000000-0000-4000-8000-000000000002', 'approve')$$, '42501', null, 'read access does not grant President approval rights');

select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa006');
select extensions.is((select count(*) from public.hour_requests where member_membership_id = '20000000-0000-4000-8000-000000000003'), 4::bigint, 'Vice President reads the complete member log');
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009');
select extensions.is((select count(*) from public.hour_requests where member_membership_id = '20000000-0000-4000-8000-000000000003'), 4::bigint, 'Teacher reads the complete member log');
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa010');
select extensions.is((select count(*) from public.hour_requests where member_membership_id = '20000000-0000-4000-8000-000000000003'), 4::bigint, 'Admin reads the complete member log');
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003');
select extensions.is((select count(*) from public.hour_requests where member_membership_id = '20000000-0000-4000-8000-000000000004'), 0::bigint, 'ordinary member cannot read another member activities');

reset role;
-- Expiring the leadership membership must revoke the added access.
update public.school_year_memberships set expiration_date = '2026-08-01'
where id = '20000000-0000-4000-8000-000000000004';
set local role authenticated;
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa004');
select extensions.is((select count(*) from public.hour_requests where member_membership_id = '20000000-0000-4000-8000-000000000003'), 0::bigint, 'expired President loses access to other member activities');
select extensions.ok(not private.can_view_hour_request('ffffffff-ffff-4fff-8fff-ffffffffffff'), 'unknown activity remains inaccessible');
select * from extensions.finish();
rollback;
