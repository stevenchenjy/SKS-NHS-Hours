begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(10);

-- The seed's invited users have no password, including accepted profiles.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001', true);
select extensions.is(
  (select password_set from public.list_account_setup_status('10000000-0000-4000-8000-000000000001')
   where email = 'member@example.edu'),
  false,
  'an accepted profile without a password is still incomplete'
);
select extensions.is(
  (select first_portal_visit_at from public.list_account_setup_status('10000000-0000-4000-8000-000000000001')
   where email = 'member@example.edu'),
  null::timestamptz,
  'an accepted invitation does not establish a portal visit'
);

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003', true);
select extensions.throws_ok(
  $$ select * from public.list_account_setup_status('10000000-0000-4000-8000-000000000001') $$,
  '42501', 'Admin access is required',
  'members cannot inspect other accounts setup status'
);
select extensions.lives_ok($$ select public.record_portal_visit() $$,
  'active members can record their own portal visit');

reset role;
select extensions.is(
  (select count(*) from private.account_portal_visits), 1::bigint,
  'recording a visit affects only the authenticated member'
);
create temporary table first_visit_snapshot as
select * from private.account_portal_visits;
set local role authenticated;
select public.record_portal_visit();
reset role;
select extensions.results_eq(
  $$ select * from private.account_portal_visits $$,
  $$ select * from first_visit_snapshot $$,
  'repeat visits preserve the original timestamp'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'private.account_portal_visits', 'INSERT'),
  'clients cannot insert fabricated visits directly'
);

-- Change only a synthetic fixture within this rollback-only transaction.
update auth.users set encrypted_password = 'synthetic-nonempty-password-marker'
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001', true);
select extensions.ok(
  (select password_set and first_portal_visit_at is not null
   from public.list_account_setup_status('10000000-0000-4000-8000-000000000001')
   where email = 'member@example.edu'),
  'administrators see both completed milestones'
);

select set_config('request.jwt.claim.sub', '', true);
select extensions.throws_ok($$ select public.record_portal_visit() $$,
  '42501', 'Active portal access is required', 'an unauthenticated request cannot record a visit');
reset role;
select extensions.ok(
  not has_function_privilege('anon', 'public.list_account_setup_status(uuid)', 'EXECUTE'),
  'anonymous callers cannot inspect setup status'
);

select * from extensions.finish();
rollback;
