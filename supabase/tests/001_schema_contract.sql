begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(63);

select extensions.has_table('public', 'profiles', 'profiles table exists');
select extensions.has_table(
  'public', 'platform_access_grants', 'global administrator grants table exists'
);
select extensions.has_table('public', 'school_years', 'school_years table exists');
select extensions.has_table(
  'public', 'school_year_memberships', 'school_year_memberships table exists'
);
select extensions.has_table('public', 'roles', 'roles table exists');
select extensions.has_table('public', 'membership_roles', 'membership_roles table exists');
select extensions.has_table('public', 'service_categories', 'service_categories table exists');
select extensions.has_table(
  'public', 'school_year_categories', 'school_year_categories table exists'
);
select extensions.has_table('public', 'invitations', 'invitations table exists');
select extensions.has_table('public', 'invitation_roles', 'invitation_roles table exists');
select extensions.has_table('public', 'hour_requests', 'hour_requests table exists');
select extensions.has_table('public', 'hour_reviews', 'hour_reviews table exists');
select extensions.has_table(
  'public', 'hour_request_corrections', 'hour_request_corrections table exists'
);
select extensions.has_table('public', 'audit_events', 'audit_events table exists');
select extensions.has_table('public', 'app_settings', 'app_settings table exists');

select extensions.has_view('public', 'member_progress', 'member_progress view exists');
select extensions.has_view(
  'public', 'pending_review_queue', 'pending_review_queue view exists'
);
select extensions.has_view('public', 'category_totals', 'category_totals view exists');
select extensions.has_view(
  'public', 'school_year_summary', 'school_year_summary view exists'
);
select extensions.has_view(
  'public', 'export_service_records', 'export_service_records view exists'
);

select extensions.has_function(
  'public', 'create_hour_request_draft',
  array['uuid', 'text', 'text', 'uuid', 'date', 'numeric', 'uuid', 'text'],
  'draft creation RPC has the expected signature'
);
select extensions.has_function(
  'public', 'save_hour_request_draft',
  array['uuid', 'integer', 'text', 'text', 'uuid', 'date', 'numeric', 'uuid'],
  'draft save RPC requires an expected revision'
);
select extensions.has_function(
  'public', 'submit_hour_request', array['uuid', 'integer'],
  'submission RPC has the expected signature'
);
select extensions.has_function(
  'public', 'review_hour_request', array['uuid', 'text', 'text'],
  'review RPC has the expected signature'
);
select extensions.has_function(
  'public', 'reassign_hour_request', array['uuid', 'uuid', 'text'],
  'reassignment RPC has the expected signature'
);
select extensions.has_function(
  'public', 'correct_approved_request',
  array['uuid', 'text', 'text', 'uuid', 'date', 'numeric', 'text'],
  'approved correction RPC has the expected signature'
);
select extensions.has_function(
  'public', 'claim_invitation', array['uuid'],
  'invitation claim RPC supports its optional UUID argument'
);
select extensions.has_function(
  'public', 'prepare_invitation_send', array['uuid'],
  'invitation send preparation RPC has the expected signature'
);
select extensions.has_function(
  'public', 'record_invitation_send_success', array['uuid', 'uuid', 'timestamp with time zone'],
  'provider-accepted invitation send RPC has the expected signature'
);
select extensions.ok(
  not exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'resend_invitation'
  ),
  'the unsafe pre-provider resend RPC is removed'
);
select extensions.has_function(
  'public', 'renew_memberships', array['uuid', 'jsonb'],
  'destination school-year access RPC preserves its deployed signature'
);
select extensions.has_function(
  'public', 'grant_teacher_admin', array['uuid'],
  'global teacher-administrator grant RPC exists'
);
select extensions.has_function(
  'public', 'revoke_teacher_admin', array['uuid'],
  'global teacher-administrator revoke RPC exists'
);
select extensions.has_function(
  'public', 'transfer_platform_owner', array['uuid'],
  'platform-owner transfer RPC exists'
);

select extensions.ok(
  (
    select count(*) = 15
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = any(array[
        'profiles', 'school_years', 'school_year_memberships', 'roles',
        'membership_roles', 'service_categories', 'school_year_categories',
        'invitations', 'invitation_roles', 'hour_requests', 'hour_reviews',
        'hour_request_corrections', 'audit_events', 'app_settings',
        'platform_access_grants'
      ])
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ),
  'all domain tables have forced RLS'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.hour_requests', 'INSERT'),
  'authenticated clients cannot insert hour requests directly'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.hour_requests', 'UPDATE'),
  'authenticated clients cannot update hour requests directly'
);
select extensions.is(
  (select value from public.app_settings where key = 'public_signup_enabled'),
  'false'::jsonb,
  'database defense-in-depth flag disables public signup'
);
select extensions.results_eq(
  $$
    select name::text from public.service_categories order by id
  $$,
  $$
    values
      ('Green Team'::text),
      ('Peer Tutoring'::text),
      ('Concessions'::text),
      ('Fundraising & Events'::text),
      ('Community Service'::text)
  $$,
  'the five initial service categories retain their fixed seed identifiers'
);
select extensions.ok(
  not exists (
    select 1 from public.service_categories
    where display_order <> 0 or default_max_hours_per_request is not null
  ),
  'seeded service categories have neutral ordering and no request caps'
);
select extensions.ok(
  not exists (
    select 1 from public.school_year_categories
    where display_order <> 0
      or max_hours_per_request is not null
      or member_approved_hours_cap is not null
  ),
  'seeded school-year category policy has no ordering or cap values'
);
select extensions.is(
  (
    select count(*)
    from public.service_categories
    where id = any(array[
      '30000000-0000-4000-8000-000000000001'::uuid,
      '30000000-0000-4000-8000-000000000002'::uuid,
      '30000000-0000-4000-8000-000000000003'::uuid,
      '30000000-0000-4000-8000-000000000004'::uuid,
      '30000000-0000-4000-8000-000000000005'::uuid
    ])
      and created_by_profile_id is null
  ),
  5::bigint,
  'production reference categories use fixed IDs without a synthetic creator'
);
select extensions.results_eq(
  $$ select role_key from public.roles order by display_order $$,
  $$
    values
      ('member'::text),
      ('committee_head'::text),
      ('president_vice_president'::text),
      ('teacher_admin'::text)
  $$,
  'the four fixed roles include one combined president and vice-president role'
);
select extensions.is(
  (select count(*) from public.profiles),
  8::bigint,
  'eight deterministic personas cover active, multi-role, and expired cases'
);
select extensions.is(
  (
    select count(*)
    from public.membership_roles membership_role
    join public.roles role on role.id = membership_role.role_id
    where membership_role.membership_id = '20000000-0000-4000-8000-000000000007'
  ),
  3::bigint,
  'multi-role persona has member, committee-head, and combined leadership roles'
);
select extensions.results_eq(
  $$
    select role.role_key
    from public.membership_roles assignment
    join public.roles role on role.id = assignment.role_id
    where assignment.membership_id = '20000000-0000-4000-8000-000000000001'
    order by role.display_order
  $$,
  $$ values ('teacher_admin'::text) $$,
  'the seeded platform owner has only the teacher-administrator anchor role'
);
select extensions.is(
  (
    select access_level from public.platform_access_grants
    where profile_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001'
  ),
  'platform_owner'::text,
  'the deterministic seeded administrator is the sole platform owner'
);
select extensions.ok(
  not exists (
    select 1 from public.member_progress
    where profile_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001'
  ),
  'teacher-administrator attribution anchors are excluded from member progress'
);
select extensions.ok(
  exists (
    select 1
    from public.school_year_memberships membership
    join public.membership_roles membership_role on membership_role.membership_id = membership.id
    join public.roles role on role.id = membership_role.role_id
    where membership.id = '20000000-0000-4000-8000-000000000005'
      and membership.status = 'expired'
      and role.role_key = 'committee_head'
  ),
  'expired former-leader persona retains historical role attribution'
);
select extensions.ok(
  (
    select is_nullable = 'YES'
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'invitations'
      and column_name = 'sent_at'
  ),
  'invitation sent_at is nullable before provider acceptance'
);
select extensions.ok(
  (
    select column_default is null
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'invitations'
      and column_name = 'sent_at'
  ),
  'invitation sent_at has no pre-provider default timestamp'
);
select extensions.ok(
  (
    select column_default in ('0', '0::integer')
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'invitations'
      and column_name = 'send_count'
  ),
  'invitation send_count defaults to zero'
);
select extensions.is(
  (
    select send_count
    from public.invitations
    where id = '50000000-0000-4000-8000-000000000001'
  ),
  0,
  'the seeded unsent invitation starts with zero accepted sends'
);
select extensions.ok(
  (
    select sent_at is null
    from public.invitations
    where id = '50000000-0000-4000-8000-000000000001'
  ),
  'the seeded unsent invitation has no provider-accepted send timestamp'
);
select extensions.col_type_is(
  'public', 'hour_requests', 'hours', 'numeric(7,2)',
  'hours use exact fixed-point numeric storage'
);
select extensions.has_index(
  'public', 'hour_requests', 'hour_requests_member_client_key_unique_idx',
  'idempotency key has a unique partial index'
);
select extensions.has_index(
  'public', 'audit_events', 'audit_events_invitation_send_idempotency_unique_idx',
  'invitation send acknowledgements have a unique idempotency index'
);
select extensions.has_trigger(
  'public', 'audit_events', 'audit_events_immutable',
  'audit log has an immutability trigger'
);
select extensions.has_trigger(
  'public', 'platform_access_grants', 'platform_access_grants_protect_last',
  'global access grants have a last-admin and owner invariant trigger'
);
select extensions.has_trigger(
  'public', 'hour_requests', 'hour_requests_protect',
  'hour requests have a protected-transition trigger'
);
select extensions.ok(
  has_schema_privilege('authenticated', 'private', 'USAGE'),
  'authenticated role can resolve read-only RLS helper functions'
);
select extensions.ok(
  has_function_privilege(
    'authenticated', 'private.can_view_hour_request(uuid)', 'EXECUTE'
  ),
  'authenticated role can execute the request RLS predicate'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'private.write_audit(text,text,text,uuid,uuid,jsonb,jsonb,jsonb)',
    'EXECUTE'
  ),
  'authenticated role cannot call private audit mutation helper directly'
);

select * from extensions.finish();
rollback;
