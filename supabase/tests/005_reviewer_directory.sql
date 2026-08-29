begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(20);

select extensions.has_function(
  'public',
  'list_eligible_reviewers',
  array['uuid'],
  'the narrowly scoped reviewer-directory RPC exists'
);
select extensions.is(
  (
    select array_to_string(procedure.proargnames, ',')
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'list_eligible_reviewers'
      and procedure.proargtypes = '2950'::oidvector
  ),
  'p_school_year_id,membership_id,profile_id,full_name,role_keys',
  'the RPC exposes exactly the approved input and output fields, with no email'
);
select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.list_eligible_reviewers(uuid)',
    'execute'
  ),
  'authenticated callers receive execute permission'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.list_eligible_reviewers(uuid)', 'execute'),
  'anonymous callers do not receive execute permission'
);

-- Transaction-local edge cases distinguish each exclusion rule from the seeded
-- active reviewers that an ordinary member should see.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    'cccccccc-cccc-4ccc-8ccc-ccccccccc001',
    'authenticated', 'authenticated', 'inactive-reviewer@example.edu', '',
    statement_timestamp(), '{"provider":"email","providers":["email"]}', '{}',
    statement_timestamp(), statement_timestamp(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'cccccccc-cccc-4ccc-8ccc-ccccccccc002',
    'authenticated', 'authenticated', 'suspended-reviewer@example.edu', '',
    statement_timestamp(), '{"provider":"email","providers":["email"]}', '{}',
    statement_timestamp(), statement_timestamp(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'cccccccc-cccc-4ccc-8ccc-ccccccccc003',
    'authenticated', 'authenticated', 'other-year-reviewer@example.edu', '',
    statement_timestamp(), '{"provider":"email","providers":["email"]}', '{}',
    statement_timestamp(), statement_timestamp(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'cccccccc-cccc-4ccc-8ccc-ccccccccc004',
    'authenticated', 'authenticated', 'ordinary-fixture@example.edu', '',
    statement_timestamp(), '{"provider":"email","providers":["email"]}', '{}',
    statement_timestamp(), statement_timestamp(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'cccccccc-cccc-4ccc-8ccc-ccccccccc005',
    'authenticated', 'authenticated', 'unprovisioned-directory@example.edu', '',
    statement_timestamp(), '{"provider":"email","providers":["email"]}', '{}',
    statement_timestamp(), statement_timestamp(), '', '', '', ''
  );

insert into public.profiles (
  id, email, full_name, status, deactivated_at, deactivated_by_profile_id
)
values
  (
    'cccccccc-cccc-4ccc-8ccc-ccccccccc001', 'inactive-reviewer@example.edu',
    'Inactive Reviewer', 'inactive', statement_timestamp(),
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001'
  ),
  (
    'cccccccc-cccc-4ccc-8ccc-ccccccccc002', 'suspended-reviewer@example.edu',
    'Suspended Reviewer', 'active', null, null
  ),
  (
    'cccccccc-cccc-4ccc-8ccc-ccccccccc003', 'other-year-reviewer@example.edu',
    'Other Year Reviewer', 'active', null, null
  ),
  (
    'cccccccc-cccc-4ccc-8ccc-ccccccccc004', 'ordinary-fixture@example.edu',
    'Ordinary Fixture', 'active', null, null
  );

insert into public.school_years (
  id, label, start_date, end_date, default_target_hours, status,
  created_by_profile_id
)
values (
  '11111111-1111-4111-8111-111111111111', '2026-2028',
  current_date - 30, current_date + 335, 20.00, 'active',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001'
);

insert into public.school_year_memberships (
  id, profile_id, school_year_id, status, expiration_date, created_by_profile_id
)
values
  (
    '21111111-1111-4111-8111-111111111001',
    'cccccccc-cccc-4ccc-8ccc-ccccccccc001',
    '10000000-0000-4000-8000-000000000001', 'active', current_date + 300,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001'
  ),
  (
    '21111111-1111-4111-8111-111111111002',
    'cccccccc-cccc-4ccc-8ccc-ccccccccc002',
    '10000000-0000-4000-8000-000000000001', 'suspended', current_date + 300,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001'
  ),
  (
    '21111111-1111-4111-8111-111111111003',
    'cccccccc-cccc-4ccc-8ccc-ccccccccc003',
    '11111111-1111-4111-8111-111111111111', 'active', current_date + 300,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001'
  ),
  (
    '21111111-1111-4111-8111-111111111004',
    'cccccccc-cccc-4ccc-8ccc-ccccccccc004',
    '10000000-0000-4000-8000-000000000001', 'active', current_date + 300,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001'
  );

insert into public.membership_roles (membership_id, role_id, assigned_by_profile_id)
select fixture.membership_id, role.id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001'
from (
  values
    ('21111111-1111-4111-8111-111111111001'::uuid, 'committee_head'),
    ('21111111-1111-4111-8111-111111111002'::uuid, 'president'),
    ('21111111-1111-4111-8111-111111111003'::uuid, 'committee_head'),
    ('21111111-1111-4111-8111-111111111004'::uuid, 'member')
) fixture(membership_id, role_key)
join public.roles role on role.role_key = fixture.role_key;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003","role":"authenticated","email":"member@example.edu"}',
  true
);

select extensions.lives_ok(
  $$
    select *
    from public.list_eligible_reviewers('10000000-0000-4000-8000-000000000001')
  $$,
  'an ordinary active member can list reviewers for their school year'
);
select extensions.is(
  (
    select count(*)
    from public.list_eligible_reviewers('10000000-0000-4000-8000-000000000001')
  ),
  5::bigint,
  'the directory returns each of the five seeded active review-capable memberships'
);
select extensions.is(
  (
    select array_agg(membership_id order by membership_id)
    from public.list_eligible_reviewers('10000000-0000-4000-8000-000000000001')
  ),
  array[
    '20000000-0000-4000-8000-000000000001'::uuid,
    '20000000-0000-4000-8000-000000000002'::uuid,
    '20000000-0000-4000-8000-000000000004'::uuid,
    '20000000-0000-4000-8000-000000000006'::uuid,
    '20000000-0000-4000-8000-000000000007'::uuid
  ],
  'the ordinary member sees exactly the eligible same-year reviewer memberships'
);
select extensions.is(
  (
    select role_keys
    from public.list_eligible_reviewers('10000000-0000-4000-8000-000000000001')
    where membership_id = '20000000-0000-4000-8000-000000000001'
  ),
  array['member', 'teacher_admin']::text[],
  'the directory includes the administrator role keys without exposing email'
);
select extensions.is(
  (
    select role_keys
    from public.list_eligible_reviewers('10000000-0000-4000-8000-000000000001')
    where membership_id = '20000000-0000-4000-8000-000000000007'
  ),
  array['member', 'committee_head', 'president']::text[],
  'the directory preserves all ordered role keys for a multi-role reviewer'
);
select extensions.is(
  (
    select profile_id::text || ':' || full_name
    from public.list_eligible_reviewers('10000000-0000-4000-8000-000000000001')
    where membership_id = '20000000-0000-4000-8000-000000000002'
  ),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002:Riley Reviewer',
  'the directory returns the reviewer profile identifier and display name'
);
select extensions.ok(
  not exists (
    select 1
    from public.list_eligible_reviewers('10000000-0000-4000-8000-000000000001')
    where membership_id = '20000000-0000-4000-8000-000000000005'
  ),
  'an expired review-capable membership is excluded'
);
select extensions.ok(
  not exists (
    select 1
    from public.list_eligible_reviewers('10000000-0000-4000-8000-000000000001')
    where membership_id = '21111111-1111-4111-8111-111111111001'
  ),
  'a reviewer with an inactive profile is excluded'
);
select extensions.ok(
  not exists (
    select 1
    from public.list_eligible_reviewers('10000000-0000-4000-8000-000000000001')
    where membership_id = '21111111-1111-4111-8111-111111111002'
  ),
  'a suspended review-capable membership is excluded'
);
select extensions.ok(
  not exists (
    select 1
    from public.list_eligible_reviewers('10000000-0000-4000-8000-000000000001')
    where membership_id = '21111111-1111-4111-8111-111111111004'
  ),
  'an active membership with only a non-review role is excluded'
);
select extensions.ok(
  not exists (
    select 1
    from public.list_eligible_reviewers('10000000-0000-4000-8000-000000000001')
    where membership_id = '21111111-1111-4111-8111-111111111003'
  ),
  'an active review-capable membership in another school year is excluded'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select extensions.ok(
  not exists (
    select 1
    from public.list_eligible_reviewers('10000000-0000-4000-8000-000000000001')
    where membership_id = '20000000-0000-4000-8000-000000000002'
  ),
  'a review-capable caller is excluded from their own eligible-reviewer list'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa005', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select extensions.throws_ok(
  $$
    select *
    from public.list_eligible_reviewers('10000000-0000-4000-8000-000000000001')
  $$,
  '42501',
  'An active membership in the school year is required',
  'an expired caller cannot use the directory'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'cccccccc-cccc-4ccc-8ccc-ccccccccc003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select extensions.throws_ok(
  $$
    select *
    from public.list_eligible_reviewers('10000000-0000-4000-8000-000000000001')
  $$,
  '42501',
  'An active membership in the school year is required',
  'an active member of another year cannot query this school year'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'cccccccc-cccc-4ccc-8ccc-ccccccccc005', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select extensions.throws_ok(
  $$
    select *
    from public.list_eligible_reviewers('10000000-0000-4000-8000-000000000001')
  $$,
  '42501',
  'An active membership in the school year is required',
  'an authenticated but unprovisioned caller cannot use the directory'
);

reset role;
set local role anon;
select extensions.throws_ok(
  $$
    select *
    from public.list_eligible_reviewers('10000000-0000-4000-8000-000000000001')
  $$,
  '42501',
  'permission denied for function list_eligible_reviewers',
  'an anonymous caller cannot execute the directory RPC'
);

select * from extensions.finish();
rollback;
