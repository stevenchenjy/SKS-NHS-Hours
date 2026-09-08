begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(48);

select extensions.is(
  (
    select array_to_string(procedure.proargnames, ',')
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'prepare_invitation_send'
      and procedure.proargtypes = '2950'::oidvector
  ),
  'p_invitation_id,invitation_id,email,full_name',
  'send preparation exposes only the invitation ID, email, and full name'
);
select extensions.ok(
  (
    select
      position('for update' in lower(pg_get_functiondef(procedure.oid))) > 0
      and position('for update' in lower(pg_get_functiondef(procedure.oid)))
        < position(
          'send_accepted_at := clock_timestamp()'
          in lower(pg_get_functiondef(procedure.oid))
        )
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'record_invitation_send_success'
      and procedure.proargtypes = '2950 2950 1184'::oidvector
  ),
  'provider acknowledgement locks the invitation before capturing its send timestamp'
);
select extensions.ok(
  has_function_privilege(
    'authenticated', 'public.prepare_invitation_send(uuid)', 'execute'
  ),
  'authenticated callers can invoke send preparation subject to teacher-admin checks'
);
select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.record_invitation_send_success(uuid,uuid,timestamp with time zone)',
    'execute'
  ),
  'authenticated callers can record provider success subject to teacher-admin checks'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.prepare_invitation_send(uuid)', 'execute'),
  'anonymous callers cannot prepare an invitation send'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.record_invitation_send_success(uuid,uuid,timestamp with time zone)',
    'execute'
  ),
  'anonymous callers cannot record invitation delivery success'
);

select extensions.throws_ok(
  $$
    update public.invitations
    set send_count = -1
    where id = '50000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'new row for relation "invitations" violates check constraint "invitations_send_count_nonnegative"',
  'negative invitation send counts are rejected'
);
select extensions.throws_ok(
  $$
    update public.invitations
    set send_count = 1, sent_at = null
    where id = '50000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'new row for relation "invitations" violates check constraint "invitations_send_metadata_consistent"',
  'a positive send count requires a provider-accepted timestamp'
);

-- An expired pending invitation remains eligible for a resend preparation; only
-- a later provider-success acknowledgement may extend its expiration.
update public.invitations
set expires_at = statement_timestamp() - interval '1 day'
where id = '50000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001","role":"authenticated","email":"admin@example.edu"}',
  true
);

select extensions.lives_ok(
  $$
    select public.create_invitation(
      p_email => 'delivery-integrity@example.edu',
      p_full_name => 'Delivery Integrity',
      p_school_year_id => '10000000-0000-4000-8000-000000000001',
      p_role_keys => array['member', 'committee_head'],
      p_expires_at => statement_timestamp() + interval '1 day'
    )
  $$,
  'teacher administrator can create pending invitation metadata'
);

select set_config(
  'test.invitation_id',
  (
    select id::text from public.invitations
    where email = 'delivery-integrity@example.edu'
  ),
  true
);
select set_config(
  'test.initial_expiry',
  (
    select expires_at::text from public.invitations
    where id = current_setting('test.invitation_id')::uuid
  ),
  true
);
select set_config(
  'test.first_send_expiry',
  (statement_timestamp() + interval '6 days')::text,
  true
);
select set_config(
  'test.second_send_expiry',
  (statement_timestamp() + interval '7 days')::text,
  true
);

select extensions.is(
  (
    select send_count from public.invitations
    where id = current_setting('test.invitation_id')::uuid
  ),
  0,
  'a newly created invitation has no provider-accepted sends'
);
select extensions.ok(
  (
    select sent_at is null from public.invitations
    where id = current_setting('test.invitation_id')::uuid
  ),
  'a newly created invitation has no send timestamp'
);
select extensions.ok(
  exists (
    select 1 from public.audit_events
    where action = 'invitation.created'
      and entity_id = current_setting('test.invitation_id')
  ),
  'invitation creation has its own audit event'
);
select extensions.is(
  (
    select count(*) from public.audit_events
    where entity_type = 'invitation'
      and entity_id = current_setting('test.invitation_id')
      and action in ('invitation.sent', 'invitation.resent')
  ),
  0::bigint,
  'creation does not claim that the Auth provider accepted a send'
);
select extensions.results_eq(
  $$
    select invitation_id::text, email, full_name
    from public.prepare_invitation_send(current_setting('test.invitation_id')::uuid)
  $$,
  $$
    select current_setting('test.invitation_id'),
           'delivery-integrity@example.edu'::text,
           'Delivery Integrity'::text
  $$,
  'send preparation returns the minimal provider payload'
);
select extensions.is(
  (
    select send_count from public.invitations
    where id = current_setting('test.invitation_id')::uuid
  ),
  0,
  'preparing the provider call does not increment the send count'
);
select extensions.is(
  (
    select expires_at from public.invitations
    where id = current_setting('test.invitation_id')::uuid
  ),
  current_setting('test.initial_expiry')::timestamptz,
  'preparing the provider call does not extend invitation expiry'
);
select extensions.is(
  (
    select count(*) from public.audit_events
    where entity_type = 'invitation'
      and entity_id = current_setting('test.invitation_id')
  ),
  1::bigint,
  'preparing the provider call does not append audit history'
);

select extensions.throws_ok(
  $$
    select public.record_invitation_send_success(
      current_setting('test.invitation_id')::uuid,
      null,
      current_setting('test.first_send_expiry')::timestamptz
    )
  $$,
  '22023',
  'Send idempotency key is required',
  'provider success requires an idempotency key'
);
select extensions.throws_ok(
  $$
    select public.record_invitation_send_success(
      current_setting('test.invitation_id')::uuid,
      '61000000-0000-4000-8000-000000000098',
      statement_timestamp() - interval '1 minute'
    )
  $$,
  '22023',
  'Invitation expiration must be in the future',
  'provider success cannot record an already-expired validity window'
);
select extensions.throws_ok(
  $$
    select public.record_invitation_send_success(
      current_setting('test.invitation_id')::uuid,
      '61000000-0000-4000-8000-000000000099',
      statement_timestamp() + interval '8 days'
    )
  $$,
  '22023',
  'Invitation expiration cannot exceed seven days',
  'provider success cannot extend metadata beyond the seven-day policy window'
);

select extensions.lives_ok(
  $$
    select public.record_invitation_send_success(
      current_setting('test.invitation_id')::uuid,
      '61000000-0000-4000-8000-000000000001',
      current_setting('test.first_send_expiry')::timestamptz
    )
  $$,
  'the first Auth-provider-accepted send can be recorded'
);
select extensions.is(
  (
    select send_count from public.invitations
    where id = current_setting('test.invitation_id')::uuid
  ),
  1,
  'the first accepted provider call increments the send count to one'
);
select extensions.ok(
  (
    select sent_at is not null from public.invitations
    where id = current_setting('test.invitation_id')::uuid
  ),
  'the first accepted provider call records its acknowledgement time'
);
select extensions.is(
  (
    select expires_at from public.invitations
    where id = current_setting('test.invitation_id')::uuid
  ),
  current_setting('test.first_send_expiry')::timestamptz,
  'the first accepted provider call applies the app-supplied expiration exactly'
);
select extensions.ok(
  exists (
    select 1 from public.audit_events
    where action = 'invitation.sent'
      and entity_id = current_setting('test.invitation_id')
  ),
  'the first accepted send appends the canonical invitation.sent audit action'
);
select extensions.ok(
  exists (
    select 1 from public.audit_events
    where action = 'invitation.sent'
      and entity_id = current_setting('test.invitation_id')
      and metadata ->> 'provider' = 'supabase_auth'
      and metadata ->> 'send_idempotency_key' =
        '61000000-0000-4000-8000-000000000001'
  ),
  'the send audit retains a non-secret provider name and idempotency key'
);
select extensions.ok(
  exists (
    select 1 from public.audit_events
    where action = 'invitation.sent'
      and entity_id = current_setting('test.invitation_id')
      and (old_values ->> 'send_count')::integer = 0
      and (new_values ->> 'send_count')::integer = 1
  ),
  'the first send audit records the zero-to-one metadata transition'
);

select extensions.lives_ok(
  $$
    select public.record_invitation_send_success(
      current_setting('test.invitation_id')::uuid,
      '61000000-0000-4000-8000-000000000001',
      current_setting('test.first_send_expiry')::timestamptz
    )
  $$,
  'retrying the same provider acknowledgement is idempotent'
);
select extensions.is(
  (
    select send_count from public.invitations
    where id = current_setting('test.invitation_id')::uuid
  ),
  1,
  'an idempotent acknowledgement retry does not increment the count'
);
select extensions.is(
  (
    select count(*) from public.audit_events
    where entity_type = 'invitation'
      and entity_id = current_setting('test.invitation_id')
      and action in ('invitation.sent', 'invitation.resent')
  ),
  1::bigint,
  'an idempotent acknowledgement retry does not duplicate audit history'
);
select extensions.throws_ok(
  $$
    select public.record_invitation_send_success(
      current_setting('test.invitation_id')::uuid,
      '61000000-0000-4000-8000-000000000001',
      current_setting('test.first_send_expiry')::timestamptz + interval '1 hour'
    )
  $$,
  '22023',
  'Send idempotency key was already used with a different expiration',
  'an idempotency key cannot be reused for different send facts'
);

select extensions.lives_ok(
  $$
    select public.record_invitation_send_success(
      current_setting('test.invitation_id')::uuid,
      '61000000-0000-4000-8000-000000000002',
      current_setting('test.second_send_expiry')::timestamptz
    )
  $$,
  'a distinct accepted provider resend can be recorded'
);
select extensions.is(
  (
    select send_count from public.invitations
    where id = current_setting('test.invitation_id')::uuid
  ),
  2,
  'a distinct accepted resend increments the factual send count'
);
select extensions.is(
  (
    select expires_at from public.invitations
    where id = current_setting('test.invitation_id')::uuid
  ),
  current_setting('test.second_send_expiry')::timestamptz,
  'an accepted resend extends expiry to the second app-supplied timestamp'
);
select extensions.ok(
  exists (
    select 1 from public.audit_events
    where action = 'invitation.resent'
      and entity_id = current_setting('test.invitation_id')
  ),
  'a later accepted send appends the canonical invitation.resent action'
);
select extensions.ok(
  exists (
    select 1 from public.audit_events
    where action = 'invitation.resent'
      and entity_id = current_setting('test.invitation_id')
      and (old_values ->> 'send_count')::integer = 1
      and (new_values ->> 'send_count')::integer = 2
  ),
  'the resend audit records the one-to-two metadata transition'
);
select extensions.is(
  (
    select count(*) from public.audit_events
    where entity_type = 'invitation'
      and entity_id = current_setting('test.invitation_id')
      and action in ('invitation.sent', 'invitation.resent')
  ),
  2::bigint,
  'two distinct accepted provider calls produce exactly two send audit events'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select extensions.throws_ok(
  $$
    select *
    from public.prepare_invitation_send(current_setting('test.invitation_id')::uuid)
  $$,
  '42501',
  'An active teacher administrator is required',
  'a non-administrator reviewer cannot prepare an invitation send'
);
select extensions.throws_ok(
  $$
    select public.record_invitation_send_success(
      current_setting('test.invitation_id')::uuid,
      '61000000-0000-4000-8000-000000000003',
      statement_timestamp() + interval '6 days'
    )
  $$,
  '42501',
  'An active teacher administrator is required',
  'a non-administrator reviewer cannot record provider success'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select extensions.throws_ok(
  $$
    update public.invitations
    set send_count = send_count + 1, sent_at = statement_timestamp()
    where id = current_setting('test.invitation_id')::uuid
  $$,
  '42501',
  'permission denied for table invitations',
  'an ordinary member cannot forge provider-success metadata directly'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select extensions.lives_ok(
  $$
    select public.revoke_invitation(current_setting('test.invitation_id')::uuid)
  $$,
  'teacher administrator can revoke the test invitation'
);
select extensions.throws_ok(
  $$
    select *
    from public.prepare_invitation_send(current_setting('test.invitation_id')::uuid)
  $$,
  '55000',
  'Only a pending invitation for an open school year can be sent',
  'a revoked invitation cannot be prepared for a new send'
);
select extensions.throws_ok(
  $$
    select public.record_invitation_send_success(
      current_setting('test.invitation_id')::uuid,
      '61000000-0000-4000-8000-000000000004',
      statement_timestamp() + interval '6 days'
    )
  $$,
  '55000',
  'Only pending invitations can record a successful send',
  'a revoked invitation cannot record a distinct new send acknowledgement'
);
select extensions.lives_ok(
  $$
    select public.record_invitation_send_success(
      current_setting('test.invitation_id')::uuid,
      '61000000-0000-4000-8000-000000000001',
      current_setting('test.first_send_expiry')::timestamptz
    )
  $$,
  'an exact acknowledgement retry remains idempotent after later revocation'
);
select extensions.is(
  (
    select send_count from public.invitations
    where id = current_setting('test.invitation_id')::uuid
  ),
  2,
  'the post-revocation idempotent retry leaves send metadata unchanged'
);
select extensions.results_eq(
  $$
    select invitation_id::text, email, full_name
    from public.prepare_invitation_send('50000000-0000-4000-8000-000000000001')
  $$,
  $$
    values (
      '50000000-0000-4000-8000-000000000001'::text,
      'invited@example.edu'::text,
      'Ivy Invited'::text
    )
  $$,
  'an expired but still-pending invitation can be prepared for a resend'
);
select extensions.ok(
  (
    select send_count = 0 and sent_at is null
    from public.invitations
    where id = '50000000-0000-4000-8000-000000000001'
  ),
  'preparing an expired pending invitation still does not claim provider acceptance'
);

reset role;
set local role anon;
select extensions.throws_ok(
  $$
    select *
    from public.prepare_invitation_send('50000000-0000-4000-8000-000000000001')
  $$,
  '42501',
  'permission denied for function prepare_invitation_send',
  'anonymous callers cannot execute send preparation'
);

select * from extensions.finish();
rollback;
