begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(9);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.bootstrap_teacher_admin(uuid,text,text,text,date,date,numeric,date)',
    'EXECUTE'
  ),
  'authenticated role cannot execute bootstrap'
);
select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.bootstrap_teacher_admin(uuid,text,text,text,date,date,numeric,date)',
    'EXECUTE'
  ),
  'service role can execute bootstrap'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb020',
  'authenticated', 'authenticated', 'bootstrap-admin@example.edu', '',
  statement_timestamp(), '{"provider":"email","providers":["email"]}', '{}',
  statement_timestamp(), statement_timestamp(), '', '', '', ''
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003","role":"authenticated","email":"member@example.edu"}',
  true
);
select extensions.throws_ok(
  $$
    select public.bootstrap_teacher_admin(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb020',
      'bootstrap-admin@example.edu',
      'Bootstrap Administrator',
      '2026-2027', '2026-07-01', '2027-06-30', 20.00, '2027-06-30'
    )
  $$,
  '42501',
  'permission denied for function bootstrap_teacher_admin',
  'ordinary authenticated caller is denied before bootstrap logic runs'
);

reset role;
alter table public.platform_access_grants disable trigger platform_access_grants_protect_last;
delete from public.platform_access_grants;
alter table public.platform_access_grants enable trigger platform_access_grants_protect_last;
delete from public.membership_roles membership_role
using public.roles role
where membership_role.role_id = role.id and role.role_key = 'teacher_admin';

set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select extensions.lives_ok(
  $$
    select public.bootstrap_teacher_admin(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb020',
      'bootstrap-admin@example.edu',
      'Bootstrap Administrator',
      '2026-2027', '2026-07-01', '2027-06-30', 20.00, '2027-06-30'
    )
  $$,
  'service role can perform the one-time first-admin bootstrap'
);

reset role;
select extensions.is(
  (
    select count(*)
    from public.school_year_memberships membership
    join public.membership_roles membership_role on membership_role.membership_id = membership.id
    join public.roles role on role.id = membership_role.role_id
    where membership.profile_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb020'
      and role.role_key in ('member', 'teacher_admin')
  ),
  1::bigint,
  'bootstrap creates only the teacher-administrator attribution role'
);
select extensions.is(
  (
    select access_level from public.platform_access_grants
    where profile_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb020'
  ),
  'platform_owner'::text,
  'the first bootstrapped global administrator becomes platform owner'
);
select extensions.ok(
  exists (
    select 1 from public.audit_events
    where action = 'teacher_admin.bootstrapped'
      and actor_profile_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb020'
  ),
  'successful bootstrap is audited'
);

set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select extensions.throws_ok(
  $$
    select public.bootstrap_teacher_admin(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb020',
      'bootstrap-admin@example.edu',
      'Bootstrap Administrator',
      '2026-2027', '2026-07-01', '2027-06-30', 20.00, '2027-06-30'
    )
  $$,
  '55000',
  'A global teacher administrator already exists',
  'bootstrap fails closed after the first administrator exists'
);

select extensions.is(
  (
    select count(*)
    from public.membership_roles membership_role
    join public.roles role on role.id = membership_role.role_id
    where role.role_key = 'teacher_admin'
  ),
  1::bigint,
  'second bootstrap attempt does not duplicate administrator assignments'
);

select * from extensions.finish();
rollback;
