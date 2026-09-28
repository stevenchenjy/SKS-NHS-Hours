begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(10);

insert into auth.users (id, email, aud, role, email_confirmed_at)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb030', 'teacher-reset@example.edu', 'authenticated', 'authenticated', now());
insert into public.profiles (id, email, full_name)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb030', 'teacher-reset@example.edu', 'Teacher Recovery');
insert into public.platform_access_grants (profile_id, access_level, granted_by_profile_id)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb030', 'teacher_admin', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001');

insert into auth.users (id, email, aud, role, email_confirmed_at)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb031', 'second-teacher@example.edu', 'authenticated', 'authenticated', now());
insert into public.profiles (id, email, full_name)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb031', 'second-teacher@example.edu', 'Second Teacher');
insert into public.platform_access_grants (profile_id, access_level, granted_by_profile_id)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb031', 'teacher_admin', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001');

create function pg_temp.act_as(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end;
$$;
set local role authenticated;
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001');
select extensions.is(
  (select recipient_email from public.reserve_member_recovery_link('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb030')),
  'teacher-reset@example.edu', 'owner can recover an active teacher with no annual membership'
);
select extensions.throws_ok(
  $$select * from public.reserve_member_recovery_link('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb030')$$,
  'P0001', 'A reset link was requested recently. Wait 15 minutes before generating another.',
  'teacher targets retain the cooldown'
);
reset role;
select extensions.ok(exists (
  select 1 from public.audit_events where action = 'account.recovery_link_requested'
  and entity_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb030'
  and actor_profile_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001'
), 'teacher request is audited with its Admin actor');
update public.profiles set status = 'inactive', deactivated_at = now()
where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb030';
set local role authenticated;
select extensions.throws_ok(
  $$select * from public.reserve_member_recovery_link('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb030')$$,
  '22023', 'An active member or teacher account is required', 'inactive teacher is excluded'
);
reset role;
update public.profiles set status = 'active', deactivated_at = null where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb030';
update auth.users set email_confirmed_at = null where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb030';
set local role authenticated;
select extensions.throws_ok(
  $$select * from public.reserve_member_recovery_link('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb030')$$,
  '22023', 'An active member or teacher account is required', 'unverified teacher is excluded'
);
reset role;
update auth.users set email_confirmed_at = now(), email = 'different@example.edu' where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb030';
set local role authenticated;
select extensions.throws_ok(
  $$select * from public.reserve_member_recovery_link('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb030')$$,
  '22023', 'An active member or teacher account is required', 'mismatched teacher email is excluded'
);
reset role;
update auth.users set email = 'teacher-reset@example.edu' where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb030';
set local role authenticated;
select pg_temp.act_as('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb030');
select extensions.throws_ok(
  $$select * from public.reserve_member_recovery_link('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb030')$$,
  '42501', 'Admin access is required', 'teacher cannot generate even their own link'
);
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001');
reset role;
-- Model a legacy member attribution on an Admin without relaxing grant_admin.
insert into public.platform_access_grants (profile_id, access_level, granted_by_profile_id)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa004', 'admin', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001');
set local role authenticated;
select extensions.throws_ok(
  $$select * from public.reserve_member_recovery_link('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa004')$$,
  '22023', 'An active member or teacher account is required', 'Admin target is excluded despite its member role'
);
select extensions.throws_ok(
  $$select * from public.reserve_member_recovery_link('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001')$$,
  '22023', 'An active member or teacher account is required', 'owner target is excluded'
);
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa004');
select extensions.is(
  (select recipient_email from public.reserve_member_recovery_link('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb031')),
  'second-teacher@example.edu', 'ordinary Admin can also recover a teacher'
);
reset role;
select * from extensions.finish();
rollback;
