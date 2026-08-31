begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(13);

select extensions.has_function(
  'public',
  'get_hour_request_reviewer_names',
  array['uuid'],
  'the request-scoped reviewer-name RPC exists'
);
select extensions.is(
  (
    select array_to_string(procedure.proargnames, ',')
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'get_hour_request_reviewer_names'
      and procedure.proargtypes = '2950'::oidvector
  ),
  'p_request_id,requested_approver_name,actual_reviewer_name',
  'the RPC exposes only its request ID input and two display names'
);
select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.get_hour_request_reviewer_names(uuid)',
    'execute'
  ),
  'authenticated callers receive execute permission'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.get_hour_request_reviewer_names(uuid)',
    'execute'
  ),
  'anonymous callers do not receive execute permission'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003","role":"authenticated","email":"member@example.edu"}',
  true
);

select extensions.is(
  (
    select count(*)
    from public.school_year_memberships
    where id = '20000000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'the request owner still cannot read the reviewer membership directly'
);
select extensions.is(
  (
    select count(*)
    from public.profiles
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002'
  ),
  0::bigint,
  'the request owner still cannot read the reviewer profile directly'
);
select extensions.is(
  (
    select requested_approver_name || '|' || actual_reviewer_name
    from public.get_hour_request_reviewer_names(
      '40000000-0000-4000-8000-000000000001'
    )
  ),
  'Riley Reviewer|Ada Administrator',
  'the owner can read requested and actual reviewer names for an approved request'
);
select extensions.is(
  (
    select requested_approver_name
    from public.get_hour_request_reviewer_names(
      '40000000-0000-4000-8000-000000000002'
    )
  ),
  'Riley Reviewer'::text,
  'the owner can read the requested reviewer name for a pending request'
);
select extensions.is(
  (
    select actual_reviewer_name
    from public.get_hour_request_reviewer_names(
      '40000000-0000-4000-8000-000000000002'
    )
  ),
  null::text,
  'a pending request has no actual reviewer name'
);
select extensions.is(
  (
    select count(*)
    from public.get_hour_request_reviewer_names(
      '40000000-0000-4000-8000-000000000005'
    )
  ),
  0::bigint,
  'an ordinary member cannot obtain names for another member request'
);
select extensions.is(
  (
    select count(*)
    from public.get_hour_request_reviewer_names(
      'ffffffff-ffff-4fff-8fff-ffffffffffff'
    )
  ),
  0::bigint,
  'an unknown request is indistinguishable from an unauthorized request'
);

reset role;
update public.school_year_memberships
set expiration_date = current_date - 1
where id = '20000000-0000-4000-8000-000000000002';

set local role authenticated;
select extensions.is(
  (
    select requested_approver_name || '|' || actual_reviewer_name
    from public.get_hour_request_reviewer_names(
      '40000000-0000-4000-8000-000000000001'
    )
  ),
  'Riley Reviewer|Ada Administrator',
  'historical reviewer attribution remains visible after the reviewer expires'
);

reset role;
set local role anon;
select extensions.throws_ok(
  $$
    select *
    from public.get_hour_request_reviewer_names(
      '40000000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  'permission denied for function get_hour_request_reviewer_names',
  'anonymous callers cannot execute the reviewer-name RPC'
);

select * from extensions.finish();
rollback;
