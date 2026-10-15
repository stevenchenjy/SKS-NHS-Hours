begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(82);

insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009', 'teacher@example.edu', 'authenticated', 'authenticated', statement_timestamp()),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa010', 'bulk-admin@example.edu', 'authenticated', 'authenticated', statement_timestamp()),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa011', 'second-teacher@example.edu', 'authenticated', 'authenticated', statement_timestamp());
insert into public.profiles (id, email, full_name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009', 'teacher@example.edu', 'Terry Teacher'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa010', 'bulk-admin@example.edu', 'Alex Admin'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa011', 'second-teacher@example.edu', 'Taylor Teacher');
insert into public.platform_access_grants (profile_id, access_level, granted_by_profile_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009', 'teacher_admin', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa010', 'admin', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa011', 'teacher_admin', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001');

-- Independent whole-hour fixtures preserve the historical fractional seed.
select set_config('nhs.allow_hour_request_transition', 'on', true);
insert into public.hour_requests (
  id, member_membership_id, school_year_id, category_id, requested_approver_membership_id,
  committee_head_reviewer_membership_id, committee_head_approved_at,
  title, service_date, hours, status, submitted_at, updated_at
)
select
  ('40000000-0000-4000-8000-' || lpad(number::text, 12, '0'))::uuid,
  '20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000002', '2026-10-14 12:00:00+00',
  'Synthetic bulk approval ' || number, '2026-08-20', 1, 'pending',
  '2026-10-14 11:00:00+00', '2026-10-14 12:00:00.123456+00'
from generate_series(251, 262) number where number <> 260;
update public.hour_requests
set committee_head_reviewer_membership_id = null, committee_head_approved_at = null
where id = '40000000-0000-4000-8000-000000000255';
update public.hour_requests
set status = 'rejected', actual_reviewer_membership_id = '20000000-0000-4000-8000-000000000002',
  decided_at = statement_timestamp()
where id = '40000000-0000-4000-8000-000000000256';
update public.hour_requests set status = 'withdrawn', withdrawn_at = statement_timestamp()
where id = '40000000-0000-4000-8000-000000000257';

-- A real out-of-scope row must behave exactly like an unknown UUID.
insert into public.school_years (id, label, start_date, end_date, status)
values ('10000000-0000-4000-8000-000000000025', '2027-2028', '2027-07-01', '2028-06-30', 'draft');
insert into public.school_year_memberships (id, profile_id, school_year_id, status, expiration_date) values
  ('20000000-0000-4000-8000-000000000252', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002', '10000000-0000-4000-8000-000000000025', 'active', '2028-06-30'),
  ('20000000-0000-4000-8000-000000000253', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003', '10000000-0000-4000-8000-000000000025', 'active', '2028-06-30');
insert into public.school_year_categories (school_year_id, category_id)
values ('10000000-0000-4000-8000-000000000025', '30000000-0000-4000-8000-000000000005')
on conflict do nothing;
insert into public.hour_requests (
  id, member_membership_id, school_year_id, category_id, requested_approver_membership_id,
  committee_head_reviewer_membership_id, committee_head_approved_at,
  title, service_date, hours, status, submitted_at
) values (
  '40000000-0000-4000-8000-000000000260', '20000000-0000-4000-8000-000000000253',
  '10000000-0000-4000-8000-000000000025', '30000000-0000-4000-8000-000000000005',
  '20000000-0000-4000-8000-000000000252', '20000000-0000-4000-8000-000000000252',
  '2027-08-21 12:00:00+00', 'Synthetic other-year request', '2027-08-20', 1, 'pending', '2027-08-20 12:00:00+00'
);

create function pg_temp.act_as(p_profile_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_profile_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_profile_id, 'role', 'authenticated')::text, true);
end;
$$;
create function pg_temp.item(p_id uuid) returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object('requestId', p_id,
    'expectedRevision', coalesce((select revision from public.hour_requests where id = p_id), 1),
    'expectedUpdatedAt', coalesce((select updated_at from public.hour_requests where id = p_id), statement_timestamp()));
$$;
create function pg_temp.batch(p_requests jsonb, p_batch_id uuid default gen_random_uuid()) returns jsonb
language sql as $$
  select public.bulk_approve_teacher_requests('10000000-0000-4000-8000-000000000001', p_batch_id, p_requests);
$$;

select extensions.ok(has_function_privilege('authenticated', 'public.bulk_approve_teacher_requests(uuid,uuid,jsonb)', 'execute'), 'authenticated callers can reach the guarded RPC');
select extensions.ok(not has_function_privilege('anon', 'public.bulk_approve_teacher_requests(uuid,uuid,jsonb)', 'execute'), 'anonymous callers cannot execute bulk approval');
select extensions.ok(not has_function_privilege('service_role', 'public.bulk_approve_teacher_requests(uuid,uuid,jsonb)', 'execute'), 'bulk approval has no service-role bypass grant');
select extensions.ok(not has_table_privilege('authenticated', 'private.teacher_approval_batches', 'SELECT,INSERT,UPDATE,DELETE'), 'authenticated callers have no direct receipt access');
select extensions.ok(not has_table_privilege('anon', 'private.teacher_approval_batches', 'SELECT,INSERT,UPDATE,DELETE'), 'anonymous callers have no receipt access');
select extensions.ok(not has_table_privilege('service_role', 'private.teacher_approval_batches', 'SELECT,INSERT,UPDATE,DELETE'), 'service-role callers have no receipt grant');
select extensions.ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'private.teacher_approval_batches'::regclass), 'receipt table forces row security');
select extensions.ok((select owner_role.rolsuper or owner_role.rolbypassrls from pg_proc rpc join pg_roles owner_role on owner_role.oid = rpc.proowner where rpc.oid = 'public.bulk_approve_teacher_requests(uuid,uuid,jsonb)'::regprocedure), 'security-definer owner can write the receipt while forced RLS denies API roles');

set local role authenticated;
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001');
select extensions.throws_ok($$select pg_temp.batch(jsonb_build_array(pg_temp.item('40000000-0000-4000-8000-000000000251')))$$,
  '42501', 'Teacher approval access is required', 'platform owner cannot bulk approve');
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa010');
select extensions.throws_ok($$select pg_temp.batch(jsonb_build_array(pg_temp.item('40000000-0000-4000-8000-000000000251')))$$,
  '42501', 'Teacher approval access is required', 'Admin cannot bulk approve despite its teacher attribution role');
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002');
select extensions.throws_ok($$select pg_temp.batch(jsonb_build_array(pg_temp.item('40000000-0000-4000-8000-000000000251')))$$,
  '42501', 'Teacher approval access is required', 'committee head cannot bulk approve final decisions');
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003');
select extensions.throws_ok($$select pg_temp.batch(jsonb_build_array(pg_temp.item('40000000-0000-4000-8000-000000000251')))$$,
  '42501', 'Teacher approval access is required', 'member cannot bulk approve');
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009');

select extensions.throws_ok($$select pg_temp.batch(null)$$, '22023', 'Select between 1 and 50 requests', 'null payload is rejected');
select extensions.throws_ok($$select pg_temp.batch('{}')$$, '22023', 'Select between 1 and 50 requests', 'object payload is rejected');
select extensions.throws_ok($$select pg_temp.batch('[]')$$, '22023', 'Select between 1 and 50 requests', 'empty selection is rejected');
select extensions.throws_ok($$select pg_temp.batch((select jsonb_agg(pg_temp.item(('ffffffff-ffff-4fff-8fff-' || lpad(n::text, 12, '0'))::uuid)) from generate_series(1,51) n))$$,
  '22023', 'Select between 1 and 50 requests', '51 selections are rejected');
select extensions.is((pg_temp.batch((select jsonb_agg(pg_temp.item(('ffffffff-ffff-4fff-8fff-' || lpad(n::text, 12, '0'))::uuid)) from generate_series(1,50) n)) ->> 'approvedCount')::integer,
  0, '50 well-formed selections are accepted without approving unknown IDs');
select extensions.throws_ok($$select pg_temp.batch(jsonb_build_array(pg_temp.item('40000000-0000-4000-8000-000000000251'), pg_temp.item('40000000-0000-4000-8000-000000000251')))$$,
  '22023', 'Select each request only once', 'duplicate UUIDs reject the entire batch');
select extensions.throws_ok($$select pg_temp.batch('[null]')$$, '22023', 'Each selected request must include its ID, revision, and timestamp', 'non-object selection is rejected');
select extensions.throws_ok($$select pg_temp.batch('[{}]')$$, '22023', 'Each selected request must include its ID, revision, and timestamp', 'missing selection fields are rejected');
select extensions.throws_ok($$select pg_temp.batch(jsonb_build_array(pg_temp.item('40000000-0000-4000-8000-000000000251') || '{"unexpected":true}'::jsonb))$$,
  '22023', 'Each selected request must include its ID, revision, and timestamp', 'unexpected fields are rejected');
select extensions.throws_ok($$select pg_temp.batch(jsonb_build_array(pg_temp.item('40000000-0000-4000-8000-000000000251') || '{"requestId":"invalid"}'::jsonb))$$,
  '22023', 'A selected request has an invalid ID, revision, or timestamp', 'malformed UUID is rejected');
select extensions.throws_ok($$select pg_temp.batch(jsonb_build_array(pg_temp.item('40000000-0000-4000-8000-000000000251') || '{"expectedRevision":"1"}'::jsonb))$$,
  '22023', 'Each selected request must include its ID, revision, and timestamp', 'revision must be a JSON number');
select extensions.throws_ok($$select pg_temp.batch(jsonb_build_array(pg_temp.item('40000000-0000-4000-8000-000000000251') || '{"expectedRevision":0}'::jsonb))$$,
  '22023', 'A selected request has an invalid ID, revision, or timestamp', 'revision must be positive');
select extensions.throws_ok($$select pg_temp.batch(jsonb_build_array(pg_temp.item('40000000-0000-4000-8000-000000000251') || '{"expectedRevision":1.5}'::jsonb))$$,
  '22023', 'A selected request has an invalid ID, revision, or timestamp', 'revision must be an integer');
select extensions.throws_ok($$select pg_temp.batch(jsonb_build_array(pg_temp.item('40000000-0000-4000-8000-000000000251') || '{"expectedRevision":2147483648}'::jsonb))$$,
  '22023', 'A selected request has an invalid ID, revision, or timestamp', 'overflowing revision is rejected');
select extensions.throws_ok($$select pg_temp.batch(jsonb_build_array(pg_temp.item('40000000-0000-4000-8000-000000000251') || '{"expectedUpdatedAt":"now"}'::jsonb))$$,
  '22023', 'A selected request has an invalid ID, revision, or timestamp', 'relative timestamp is rejected');
select extensions.throws_ok($$select pg_temp.batch(jsonb_build_array(pg_temp.item('40000000-0000-4000-8000-000000000251') || '{"expectedUpdatedAt":"2026-10-14T12:00:00"}'::jsonb))$$,
  '22023', 'A selected request has an invalid ID, revision, or timestamp', 'timezone-less timestamp is rejected');
select extensions.throws_ok($$select pg_temp.batch(jsonb_build_array(pg_temp.item('40000000-0000-4000-8000-000000000251') || '{"expectedUpdatedAt":"2026-99-99T12:00:00Z"}'::jsonb))$$,
  '22023', 'A selected request has an invalid ID, revision, or timestamp', 'impossible timestamp is rejected');
select extensions.throws_ok($$select public.bulk_approve_teacher_requests(null, gen_random_uuid(), jsonb_build_array(pg_temp.item('40000000-0000-4000-8000-000000000251')))$$,
  '22023', 'A school year and batch ID are required', 'null school year is rejected');
select extensions.throws_ok($$select pg_temp.batch(jsonb_build_array(pg_temp.item('40000000-0000-4000-8000-000000000251')), null)$$,
  '22023', 'A school year and batch ID are required', 'null batch ID is rejected');
select extensions.throws_ok($$select public.bulk_approve_teacher_requests('10000000-0000-4000-8000-000000000025', gen_random_uuid(), jsonb_build_array(pg_temp.item('40000000-0000-4000-8000-000000000260')))$$,
  '42501', 'An active school-year teacher membership is required', 'draft school year cannot be bulk approved');
select extensions.throws_ok($$select public.bulk_approve_teacher_requests('ffffffff-ffff-4fff-8fff-ffffffffffff', gen_random_uuid(), jsonb_build_array(pg_temp.item('40000000-0000-4000-8000-000000000251')))$$,
  '42501', 'An active school-year teacher membership is required', 'unknown school year cannot be bulk approved');
select extensions.throws_ok($$select pg_temp.batch(jsonb_build_array(pg_temp.item('40000000-0000-4000-8000-000000000251'), '{}'::jsonb))$$,
  '22023', 'Each selected request must include its ID, revision, and timestamp', 'invalid later row prevents an earlier valid approval');
select extensions.is((select status from public.hour_requests where id = '40000000-0000-4000-8000-000000000251'), 'pending', 'input validation leaves eligible requests unchanged');

-- Capture the exact visible snapshots, including sub-millisecond precision.
reset role;
create temp table bulk_fixture (payload jsonb, result jsonb, approved_before numeric, pending_before numeric);
insert into bulk_fixture (payload, approved_before, pending_before)
select jsonb_build_array(
  pg_temp.item('40000000-0000-4000-8000-000000000252'),
  pg_temp.item('40000000-0000-4000-8000-000000000251'),
  pg_temp.item('40000000-0000-4000-8000-000000000253') || '{"expectedRevision":99}'::jsonb,
  pg_temp.item('40000000-0000-4000-8000-000000000254') || '{"expectedUpdatedAt":"2026-10-14T12:00:00.123455+00:00"}'::jsonb,
  pg_temp.item('40000000-0000-4000-8000-000000000255'),
  pg_temp.item('40000000-0000-4000-8000-000000000256'),
  pg_temp.item('40000000-0000-4000-8000-000000000257'),
  pg_temp.item('40000000-0000-4000-8000-000000000260'),
  pg_temp.item('ffffffff-ffff-4fff-8fff-ffffffffffff'),
  pg_temp.item('40000000-0000-4000-8000-000000000003')
), approved_hours, pending_hours from public.member_progress
where membership_id = '20000000-0000-4000-8000-000000000003';
grant select, update on bulk_fixture to authenticated;
set local role authenticated;
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009');
update bulk_fixture set result = pg_temp.batch(payload, '25000000-0000-4000-8000-000000000001');
select extensions.is((select result ->> 'batchId' from bulk_fixture), '25000000-0000-4000-8000-000000000001', 'result identifies the persisted batch');
select extensions.is((select (result ->> 'approvedCount')::integer from bulk_fixture), 2, 'eligible unchanged teacher-stage selections are approved');
select extensions.is((select jsonb_array_length(result -> 'results') from bulk_fixture), 10, 'every selected ID has one result');
select extensions.is((select result -> 'results' -> 0 ->> 'requestId' from bulk_fixture), '40000000-0000-4000-8000-000000000252', 'results preserve selection order despite sorted lock acquisition');
select extensions.is((select result -> 'results' -> 0 ->> 'outcome' from bulk_fixture), 'approved', 'first eligible request is approved');
select extensions.is((select result -> 'results' -> 1 ->> 'outcome' from bulk_fixture), 'approved', 'original microsecond timestamp matches without truncation');
select extensions.is((select result -> 'results' -> 2 ->> 'outcome' from bulk_fixture), 'changed_since_selection', 'changed revision is skipped explicitly');
select extensions.is((select result -> 'results' -> 3 ->> 'outcome' from bulk_fixture), 'changed_since_selection', 'one-microsecond timestamp change is skipped explicitly');
select extensions.is((select result -> 'results' -> 4 ->> 'outcome' from bulk_fixture), 'not_eligible', 'committee-stage request cannot bypass first approval');
select extensions.is((select result -> 'results' -> 5 ->> 'outcome' from bulk_fixture), 'already_processed', 'rejected request is a known stale selection');
select extensions.is((select result -> 'results' -> 6 ->> 'outcome' from bulk_fixture), 'already_processed', 'withdrawn request is a known stale selection');
select extensions.is((select result -> 'results' -> 7 ->> 'outcome' from bulk_fixture), 'not_eligible', 'other-year request exposes no details');
select extensions.is((select result -> 'results' -> 8 ->> 'outcome' from bulk_fixture), 'not_eligible', 'unknown request has the same generic result');
select extensions.is((select result -> 'results' -> 9 ->> 'outcome' from bulk_fixture), 'not_eligible', 'draft is not a valid bulk selection');
select extensions.is((select count(*) from public.hour_reviews where hour_request_id in ('40000000-0000-4000-8000-000000000251', '40000000-0000-4000-8000-000000000252') and action = 'approved'), 2::bigint, 'each successful selection has one canonical approval history row');
select extensions.is((select count(*) from public.hour_requests request join public.school_year_memberships reviewer on reviewer.id = request.actual_reviewer_membership_id where request.id in ('40000000-0000-4000-8000-000000000251', '40000000-0000-4000-8000-000000000252') and request.status = 'approved' and reviewer.profile_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009' and request.decided_at is not null), 2::bigint, 'final decisions attribute the acting teacher');
select extensions.is((select count(*) from public.pending_review_queue where id in ('40000000-0000-4000-8000-000000000251', '40000000-0000-4000-8000-000000000252')), 0::bigint, 'approved selections leave the shared pending queue');
select extensions.is((select count(*) from public.approved_request_archive where id in ('40000000-0000-4000-8000-000000000251', '40000000-0000-4000-8000-000000000252')), 2::bigint, 'both decisions enter the archive');
select extensions.is((select approved_hours from public.member_progress where membership_id = '20000000-0000-4000-8000-000000000003'), (select approved_before + 2 from bulk_fixture), 'approved progress counts exactly the successful hours');
select extensions.is((select pending_hours from public.member_progress where membership_id = '20000000-0000-4000-8000-000000000003'), (select pending_before - 2 from bulk_fixture), 'pending progress removes exactly the successful hours');
select extensions.is((select pg_temp.batch(payload, '25000000-0000-4000-8000-000000000001') from bulk_fixture), (select result from bulk_fixture), 'retry after a lost response returns the original result');
select extensions.is((select count(*) from public.hour_reviews where hour_request_id in ('40000000-0000-4000-8000-000000000251', '40000000-0000-4000-8000-000000000252') and action = 'approved'), 2::bigint, 'receipt retry cannot duplicate individual histories');
select extensions.throws_ok($$select pg_temp.batch(jsonb_build_array(pg_temp.item('40000000-0000-4000-8000-000000000259')), '25000000-0000-4000-8000-000000000001')$$,
  '22023', 'This batch ID was already used for a different selection', 'same-actor token cannot approve a different payload');
select extensions.is((pg_temp.batch(jsonb_build_array(pg_temp.item('40000000-0000-4000-8000-000000000251'))) -> 'results' -> 0 ->> 'outcome'), 'already_processed', 'new batch detects a request processed by an earlier batch');
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa011');
select extensions.is((select pg_temp.batch(payload, '25000000-0000-4000-8000-000000000001') ->> 'approvedCount' from bulk_fixture), '0', 'another teacher cannot recover the first teacher receipt with the same token');
select extensions.is((select count(*) from public.pending_review_queue where id in ('40000000-0000-4000-8000-000000000251', '40000000-0000-4000-8000-000000000252')), 0::bigint, 'other teacher sees the same completed queue state');

reset role;
select extensions.is((select count(*) from public.audit_events where entity_id in ('40000000-0000-4000-8000-000000000251', '40000000-0000-4000-8000-000000000252') and action = 'hour_request.approved'), 2::bigint, 'each successful selection keeps its canonical audit event');
select extensions.is((select count(*) from public.audit_events where entity_id = '25000000-0000-4000-8000-000000000001' and action = 'hour_request.bulk_approved' and actor_profile_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009' and metadata ->> 'approved_count' = '2'), 1::bigint, 'one batch summary correlates approvals and is not duplicated by retry');
select extensions.is((select count(*) from private.teacher_approval_batches where batch_id = '25000000-0000-4000-8000-000000000001'), 2::bigint, 'batch receipts are scoped to actor and token');
select extensions.is((select count(*) from public.hour_reviews where hour_request_id in ('40000000-0000-4000-8000-000000000253', '40000000-0000-4000-8000-000000000254', '40000000-0000-4000-8000-000000000255', '40000000-0000-4000-8000-000000000256', '40000000-0000-4000-8000-000000000257', '40000000-0000-4000-8000-000000000260')), 0::bigint, 'skipped selections create no review history');

-- Inject a genuine unexpected canonical-review failure on the second item.
-- It must roll back the first approval, all history, and the retry receipt.
create function pg_temp.fail_review() returns trigger language plpgsql as $$
begin
  if new.hour_request_id = '40000000-0000-4000-8000-000000000259' and new.action = 'approved' then
    raise exception 'Synthetic review failure' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger synthetic_bulk_failure before insert on public.hour_reviews
for each row execute function pg_temp.fail_review();
set local role authenticated;
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009');
select extensions.throws_ok($$select pg_temp.batch(jsonb_build_array(pg_temp.item('40000000-0000-4000-8000-000000000258'), pg_temp.item('40000000-0000-4000-8000-000000000259')), '25000000-0000-4000-8000-000000000002')$$,
  '23514', 'Synthetic review failure', 'unexpected canonical failure rejects the whole transaction');
select extensions.is((select count(*) from public.hour_requests where id in ('40000000-0000-4000-8000-000000000258', '40000000-0000-4000-8000-000000000259') and status = 'pending'), 2::bigint, 'unexpected failure rolls back earlier approvals');
select extensions.is((select count(*) from public.hour_reviews where hour_request_id in ('40000000-0000-4000-8000-000000000258', '40000000-0000-4000-8000-000000000259')), 0::bigint, 'unexpected failure rolls back earlier history');
reset role;
select extensions.is((select count(*) from private.teacher_approval_batches where batch_id = '25000000-0000-4000-8000-000000000002'), 0::bigint, 'failed transaction does not persist a receipt');
select extensions.is((select count(*) from public.audit_events where entity_id in ('40000000-0000-4000-8000-000000000258', '40000000-0000-4000-8000-000000000259') and action = 'hour_request.approved'), 0::bigint, 'unexpected failure rolls back earlier audit events');
drop trigger synthetic_bulk_failure on public.hour_reviews;
set local role authenticated;
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009');
select extensions.is((pg_temp.batch(jsonb_build_array(pg_temp.item('40000000-0000-4000-8000-000000000258'), pg_temp.item('40000000-0000-4000-8000-000000000259')), '25000000-0000-4000-8000-000000000002') ->> 'approvedCount')::integer, 2, 'same token can recover after a rolled-back failure');

-- The wrapper must not turn an initial access check into permanent authority:
-- canonical review rechecks access on every eligible decision in the batch.
reset role;
create function pg_temp.cancel_teacher_during_review() returns trigger language plpgsql as $$
begin
  if new.hour_request_id = '40000000-0000-4000-8000-000000000261' and new.action = 'approved' then
    update public.profiles set status = 'inactive', deactivated_at = statement_timestamp()
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009';
  end if;
  return new;
end;
$$;
create trigger synthetic_bulk_access_cancel after insert on public.hour_reviews
for each row execute function pg_temp.cancel_teacher_during_review();
set local role authenticated;
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009');
select extensions.throws_ok($$select pg_temp.batch(jsonb_build_array(pg_temp.item('40000000-0000-4000-8000-000000000261'), pg_temp.item('40000000-0000-4000-8000-000000000262')), '25000000-0000-4000-8000-000000000003')$$,
  '42501', 'An active reviewer membership is required', 'canonical review cancels a batch when teacher access ends during processing');
select extensions.is((select count(*) from public.hour_requests where id in ('40000000-0000-4000-8000-000000000261', '40000000-0000-4000-8000-000000000262') and status = 'pending'), 2::bigint, 'access cancellation rolls back the earlier approval');
select extensions.is((select status from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009'), 'active', 'the cancellation fixture rolled back with the failed batch');
select extensions.is((select count(*) from public.hour_reviews where hour_request_id in ('40000000-0000-4000-8000-000000000261', '40000000-0000-4000-8000-000000000262')), 0::bigint, 'access cancellation leaves no approval history');
reset role;
select extensions.is((select count(*) from private.teacher_approval_batches where batch_id = '25000000-0000-4000-8000-000000000003'), 0::bigint, 'access cancellation leaves no retry receipt');
select extensions.is((select count(*) from public.audit_events where entity_id in ('40000000-0000-4000-8000-000000000261', '40000000-0000-4000-8000-000000000262') and action = 'hour_request.approved'), 0::bigint, 'access cancellation leaves no approval audit events');
drop trigger synthetic_bulk_access_cancel on public.hour_reviews;

reset role;
update public.school_year_memberships set expiration_date = '2026-08-01'
where profile_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009' and school_year_id = '10000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009');
select extensions.throws_ok($$select pg_temp.batch(jsonb_build_array(pg_temp.item('40000000-0000-4000-8000-000000000253')))$$,
  '42501', 'An active school-year teacher membership is required', 'expired annual teacher membership cannot bulk approve');
select extensions.throws_ok($$select pg_temp.batch((select payload from bulk_fixture), '25000000-0000-4000-8000-000000000001')$$,
  '42501', 'An active school-year teacher membership is required', 'expired teacher cannot use retries to bypass current access');
reset role;
update public.profiles set status = 'inactive', deactivated_at = statement_timestamp()
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa011';
set local role authenticated;
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa011');
select extensions.throws_ok($$select pg_temp.batch(jsonb_build_array(pg_temp.item('40000000-0000-4000-8000-000000000253')))$$,
  '42501', 'Teacher approval access is required', 'inactive teacher profile cannot bulk approve');

reset role;
update public.school_year_memberships set expiration_date = '2027-06-30'
where profile_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009' and school_year_id = '10000000-0000-4000-8000-000000000001';
update public.school_years set status = 'closed', closed_at = statement_timestamp(),
  closed_by_profile_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001'
where id = '10000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009');
select extensions.throws_ok($$select pg_temp.batch((select payload from bulk_fixture), '25000000-0000-4000-8000-000000000001')$$,
  '42501', 'An active school-year teacher membership is required', 'closed year prevents receipt replay despite an active global Teacher grant');
select extensions.throws_ok($$select pg_temp.batch(jsonb_build_array(pg_temp.item('40000000-0000-4000-8000-000000000253')))$$,
  '42501', 'An active school-year teacher membership is required', 'closed year prevents new approvals despite an unexpired teacher anchor');

select * from extensions.finish();
rollback;
