begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(17);

insert into auth.users (id, email, aud, role, email_confirmed_at)
values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb029',
  'reset-teacher@example.edu', 'authenticated', 'authenticated', statement_timestamp()
);
insert into public.profiles (id, email, full_name)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb029', 'reset-teacher@example.edu', 'Reset Teacher');
insert into public.platform_access_grants (profile_id, access_level, granted_by_profile_id)
values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb029', 'teacher_admin',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001'
);

create function pg_temp.act_as(p_profile_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_profile_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_profile_id, 'role', 'authenticated')::text,
    true
  );
end;
$$;

select extensions.ok(
  has_function_privilege('authenticated', 'public.reserve_member_recovery_link(uuid)', 'EXECUTE'),
  'authenticated users may call the guarded reservation function'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.reserve_member_recovery_link(uuid)', 'EXECUTE'),
  'anonymous users cannot reserve a recovery link'
);
select extensions.ok(
  not has_function_privilege('authenticated', 'public.complete_member_recovery_link(bigint,boolean)', 'EXECUTE'),
  'browser sessions cannot report a generated link'
);
select extensions.ok(
  has_function_privilege('service_role', 'public.complete_member_recovery_link(bigint,boolean)', 'EXECUTE'),
  'the secret-key client can record the outcome'
);

set local role authenticated;
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003');
select extensions.throws_ok(
  $$select * from public.reserve_member_recovery_link('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa004')$$,
  '42501', 'Admin access is required',
  'a member cannot generate links for other members'
);
select pg_temp.act_as('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb029');
select extensions.throws_ok(
  $$select * from public.reserve_member_recovery_link('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003')$$,
  '42501', 'Admin access is required',
  'a teacher cannot generate member reset links'
);

select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001');
select extensions.throws_ok(
  $$select * from public.reserve_member_recovery_link('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001')$$,
  '22023', 'An active member account is required',
  'an admin account is not an eligible target'
);
select extensions.throws_ok(
  $$select * from public.reserve_member_recovery_link('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa008')$$,
  '22023', 'An active member account is required',
  'an expired member is not an eligible target'
);
select extensions.is(
  (select recipient_email from public.reserve_member_recovery_link('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003')),
  'member@example.edu',
  'an admin receives the member email from the database'
);
reset role;

select extensions.ok(
  exists (
    select 1 from public.audit_events
    where action = 'account.recovery_link_requested'
      and actor_profile_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001'
      and entity_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003'
  ),
  'the reservation records the admin and member'
);

set local role authenticated;
select extensions.throws_ok(
  $$select * from public.reserve_member_recovery_link('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003')$$,
  'P0001',
  'A reset link was requested recently. Wait 15 minutes before generating another.',
  'a second request for the same member is limited'
);
reset role;
select set_config(
  'nhs.test_recovery_attempt_id',
  (select id::text from public.audit_events where action = 'account.recovery_link_requested' limit 1),
  true
);

set local role service_role;
select extensions.lives_ok(
  format(
    'select public.complete_member_recovery_link(%s, true)',
    current_setting('nhs.test_recovery_attempt_id')
  ),
  'the server can record successful generation'
);
reset role;

select extensions.ok(
  exists (
    select 1 from public.audit_events
    where action = 'account.recovery_link_generated'
      and actor_profile_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001'
      and entity_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003'
      and metadata ->> 'attempt_id' is not null
  ),
  'completion preserves the admin attribution and target'
);
select extensions.ok(
  not exists (
    select 1 from public.audit_events
    where action like 'account.recovery_link_%'
      and (
        metadata::text ilike '%token%'
        or coalesce(old_values::text, '') ilike '%token%'
        or coalesce(new_values::text, '') ilike '%token%'
      )
  ),
  'recovery audit records contain no tokens'
);

set local role service_role;
select extensions.throws_ok(
  format(
    'select public.complete_member_recovery_link(%s, true)',
    current_setting('nhs.test_recovery_attempt_id')
  ),
  '23505', 'Recovery attempt already completed',
  'the same attempt cannot be marked complete twice'
);
reset role;

insert into public.audit_events (actor_profile_id, action, entity_type, entity_id)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001', 'account.recovery_link_requested',
       'profile', ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))
from generate_series(1, 9) n;
set local role authenticated;
select extensions.throws_ok(
  $$select * from public.reserve_member_recovery_link('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa004')$$,
  'P0001', 'The hourly reset-link limit was reached. Try again later.',
  'a single admin cannot generate more than ten links in an hour'
);
reset role;

select extensions.ok(
  not has_function_privilege('anon', 'public.complete_member_recovery_link(bigint,boolean)', 'EXECUTE'),
  'anonymous users cannot complete a recovery attempt'
);

select * from extensions.finish();
rollback;
