begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(50);

insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009', 'teacher@example.edu', 'authenticated', 'authenticated', statement_timestamp()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb026', 'other-year-member@example.edu', 'authenticated', 'authenticated', statement_timestamp());
insert into public.profiles (id, email, full_name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009', 'teacher@example.edu', 'Terry Teacher'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb026', 'other-year-member@example.edu', 'Other Year Member');
insert into public.platform_access_grants (profile_id, access_level, granted_by_profile_id)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009', 'teacher_admin', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001');
insert into public.school_years (id, label, start_date, end_date, status)
values ('10000000-0000-4000-8000-000000000026', '2027-2028', '2027-07-01', '2028-06-30', 'draft');
insert into public.school_year_memberships (id, profile_id, school_year_id, status, expiration_date)
values ('20000000-0000-4000-8000-000000000026', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb026', '10000000-0000-4000-8000-000000000026', 'active', '2028-06-30');
insert into public.membership_roles (membership_id, role_id)
select '20000000-0000-4000-8000-000000000026', id from public.roles where role_key = 'member';

create function pg_temp.act_as(p_profile_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_profile_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_profile_id, 'role', 'authenticated')::text, true);
end;
$$;

set local role authenticated;
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa004');

-- Exercise the rows and joins used by getProfileRecord,
-- listMembershipsForProfile, getProgress, and listMemberRequests. A helper-only
-- request test missed this regression because the joined profile was hidden.
select extensions.is((select full_name from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003'), 'Morgan Member', 'President can load the member profile record');
select extensions.is((
  select count(*) from public.school_year_memberships membership
  join public.profiles profile on profile.id = membership.profile_id
  join public.school_years school_year on school_year.id = membership.school_year_id
  where profile.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003'
    and school_year.id = '10000000-0000-4000-8000-000000000001'
), 1::bigint, 'President can load the membership with its required profile and school-year joins');
select extensions.is((
  select array_agg(role.role_key order by role.role_key)
  from public.membership_roles assignment join public.roles role on role.id = assignment.role_id
  where assignment.membership_id = '20000000-0000-4000-8000-000000000003'
), array['member']::text[], 'President can load the role assignments used to normalize the membership');
select extensions.is((select approved_hours from public.member_progress where membership_id = '20000000-0000-4000-8000-000000000003'), 12.5::numeric, 'President progress includes approved hours through the security-invoker view');
select extensions.is((select pending_hours from public.member_progress where membership_id = '20000000-0000-4000-8000-000000000003'), 3.25::numeric, 'President progress includes pending hours');
select extensions.is((select draft_count from public.member_progress where membership_id = '20000000-0000-4000-8000-000000000003'), 1::bigint, 'President progress includes the draft in the complete service log');
select extensions.is((
  select count(*) from public.hour_requests request
  join public.school_year_memberships membership on membership.id = request.member_membership_id
  join public.profiles profile on profile.id = membership.profile_id
  join public.school_year_categories assignment on assignment.school_year_id = request.school_year_id and assignment.category_id = request.category_id
  join public.service_categories category on category.id = assignment.category_id
  where profile.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003'
    and request.school_year_id = '10000000-0000-4000-8000-000000000001'
), 4::bigint, 'President complete service log survives its member profile and category joins');
select extensions.is((select count(*) from public.member_progress where profile_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009'), 0::bigint, 'President member-progress roster does not include staff anchors');
select extensions.is((select count(*) from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009'), 0::bigint, 'leadership profile access does not expose the teacher account');
select extensions.is((select count(*) from public.school_year_memberships where profile_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009'), 0::bigint, 'leadership membership access does not expose teacher anchors');
select extensions.is((select count(*) from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001'), 0::bigint, 'leadership profile access does not expose the owner account');
select extensions.is((select count(*) from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa008'), 0::bigint, 'existing expired-target profile restriction is preserved');
select extensions.is((select count(*) from public.school_year_memberships where id = '20000000-0000-4000-8000-000000000008'), 0::bigint, 'existing expired-target membership restriction is preserved');
select extensions.is((select count(*) from public.profiles where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb026'), 0::bigint, 'President cannot read a profile that belongs only to another school year');
select extensions.is((select count(*) from public.school_year_memberships where id = '20000000-0000-4000-8000-000000000026'), 0::bigint, 'President cannot read another-year membership');
select extensions.is((select count(*) from public.profiles where id = 'ffffffff-ffff-4fff-8fff-ffffffffffff'), 0::bigint, 'unknown profile remains absent');
select extensions.is((select count(*) from public.school_year_memberships where id = 'ffffffff-ffff-4fff-8fff-ffffffffffff'), 0::bigint, 'unknown membership remains absent');
select extensions.throws_ok($$select public.review_hour_request('40000000-0000-4000-8000-000000000002', 'approve')$$,
  '42501', null, 'member-profile visibility does not grant President approval rights');

select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa006');
select extensions.is((select count(*) from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003'), 1::bigint, 'Vice President can read the same member profile');
select extensions.is((
  select count(*) from public.school_year_memberships membership
  join public.profiles profile on profile.id = membership.profile_id
  join public.school_years school_year on school_year.id = membership.school_year_id
  where profile.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003'
), 1::bigint, 'Vice President can load the same joined membership');
select extensions.is((select count(*) from public.membership_roles assignment join public.roles role on role.id = assignment.role_id where assignment.membership_id = '20000000-0000-4000-8000-000000000003' and role.role_key = 'member'), 1::bigint, 'Vice President can read the member role assignment');
select extensions.is((select approved_hours from public.member_progress where membership_id = '20000000-0000-4000-8000-000000000003'), 12.5::numeric, 'Vice President sees the same approved total');

select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003');
select extensions.is((select count(*) from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003'), 1::bigint, 'ordinary member retains own profile access');
select extensions.is((select count(*) from public.school_year_memberships where id = '20000000-0000-4000-8000-000000000003'), 1::bigint, 'ordinary member retains own membership access');
select extensions.is((select count(*) from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa004'), 0::bigint, 'ordinary member does not gain another member profile access');
select extensions.is((select count(*) from public.school_year_memberships where id = '20000000-0000-4000-8000-000000000004'), 0::bigint, 'ordinary member does not gain another member membership access');
select extensions.is((select count(*) from public.member_progress where membership_id = '20000000-0000-4000-8000-000000000004'), 0::bigint, 'ordinary member does not gain another member progress access');

select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002');
select extensions.is((select count(*) from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003'), 1::bigint, 'committee head retains active member profile access');
select extensions.is((select count(*) from public.school_year_memberships where id = '20000000-0000-4000-8000-000000000003'), 1::bigint, 'committee head retains active member membership access');
select extensions.is((select count(*) from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa008'), 0::bigint, 'committee head expired-target restriction remains unchanged');

select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009');
select extensions.is((select count(*) from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa008'), 1::bigint, 'teacher retains global expired member profile access');
select extensions.is((select count(*) from public.school_year_memberships where id = '20000000-0000-4000-8000-000000000008'), 1::bigint, 'teacher retains global expired membership access');
select extensions.is((select count(*) from public.school_year_memberships membership join public.profiles profile on profile.id = membership.profile_id join public.school_years school_year on school_year.id = membership.school_year_id where profile.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003'), 1::bigint, 'teacher retains the member profile page join');
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001');
select extensions.is((select count(*) from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003'), 1::bigint, 'owner retains global member profile access');
select extensions.is((select count(*) from public.school_year_memberships where id = '20000000-0000-4000-8000-000000000008'), 1::bigint, 'owner retains expired membership access');

reset role;
update public.school_year_memberships set expiration_date = '2026-08-01'
where id = '20000000-0000-4000-8000-000000000004';
set local role authenticated;
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa004');
select extensions.is((select count(*) from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003'), 0::bigint, 'expired President loses another member profile access');
select extensions.is((select count(*) from public.school_year_memberships where id = '20000000-0000-4000-8000-000000000003'), 0::bigint, 'expired President loses another member membership access');
select extensions.is((select count(*) from public.membership_roles where membership_id = '20000000-0000-4000-8000-000000000003'), 0::bigint, 'expired President loses another member role-assignment access');
select extensions.is((select count(*) from public.member_progress where membership_id = '20000000-0000-4000-8000-000000000003'), 0::bigint, 'expired President loses another member progress access');
select extensions.is((select count(*) from public.hour_requests request join public.school_year_memberships membership on membership.id = request.member_membership_id join public.profiles profile on profile.id = membership.profile_id where profile.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003'), 0::bigint, 'expired President cannot load another member service log through joins');
select extensions.is((select count(*) from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa004'), 1::bigint, 'expired President retains own profile access');
select extensions.is((select count(*) from public.school_year_memberships where id = '20000000-0000-4000-8000-000000000004'), 1::bigint, 'expired President retains own membership access');

reset role;
delete from public.membership_roles assignment using public.roles role
where assignment.membership_id = '20000000-0000-4000-8000-000000000006'
  and assignment.role_id = role.id and role.role_key = 'president_vice_president';
set local role authenticated;
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa006');
select extensions.is((select count(*) from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003'), 0::bigint, 'removed leadership role revokes another member profile access');
select extensions.is((select count(*) from public.school_year_memberships where id = '20000000-0000-4000-8000-000000000003'), 0::bigint, 'removed leadership role revokes another member membership access');
select extensions.is((select count(*) from public.member_progress where membership_id = '20000000-0000-4000-8000-000000000003'), 0::bigint, 'removed leadership role revokes another member progress access');

reset role;
insert into public.membership_roles (membership_id, role_id)
select '20000000-0000-4000-8000-000000000006', id from public.roles where role_key = 'president_vice_president';
update public.profiles set status = 'inactive', deactivated_at = statement_timestamp()
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa006';
set local role authenticated;
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa006');
select extensions.is((select count(*) from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003'), 0::bigint, 'inactive leader profile cannot read another member profile');
select extensions.is((select count(*) from public.school_year_memberships where id = '20000000-0000-4000-8000-000000000003'), 0::bigint, 'inactive leader profile cannot read another member membership');
select extensions.is((select count(*) from public.member_progress where membership_id = '20000000-0000-4000-8000-000000000003'), 0::bigint, 'inactive leader profile cannot read another member progress');
select extensions.is((select count(*) from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa006'), 1::bigint, 'inactive leader retains prior own profile visibility');
select extensions.is((select count(*) from public.school_year_memberships where id = '20000000-0000-4000-8000-000000000006'), 1::bigint, 'inactive leader retains prior own membership visibility');

select * from extensions.finish();
rollback;
