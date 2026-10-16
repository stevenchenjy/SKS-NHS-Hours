begin;

insert into auth.users (id, email, aud, role, email_confirmed_at)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009', 'portal-admin@example.edu',
  'authenticated', 'authenticated', statement_timestamp());
insert into public.profiles (id, email, full_name)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009', 'portal-admin@example.edu', 'Alex Administrator');
insert into public.platform_access_grants (profile_id, access_level, granted_by_profile_id)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009', 'admin', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001');

-- Historical quarter-hour values remain valid storage and must never be rounded.
select set_config('nhs.allow_hour_request_transition', 'on', true);
insert into public.hour_requests (
  id, member_membership_id, school_year_id, category_id,
  requested_approver_membership_id, committee_head_reviewer_membership_id,
  committee_head_approved_at, actual_reviewer_membership_id,
  title, description, service_date, hours, status, client_submission_key,
  revision, submitted_at, decided_at
)
select '40000000-0000-4000-8000-000000000015', member_membership_id, school_year_id,
  category_id, requested_approver_membership_id, committee_head_reviewer_membership_id,
  committee_head_approved_at, actual_reviewer_membership_id,
  'Historical quarter-hour entry', description, service_date, 1.25, status,
  'half-hours-historical-quarter', revision, submitted_at, decided_at
from public.hour_requests where id = '40000000-0000-4000-8000-000000000001';

create extension if not exists pgtap with schema extensions;
select extensions.plan(43);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003","role":"authenticated"}', true);

select extensions.throws_ok(
  format($sql$ select public.create_hour_request_draft(
    p_school_year_id => '10000000-0000-4000-8000-000000000001',
    p_hours => %1$L::numeric, p_client_submission_key => %2$L) $sql$,
    value, 'half-hours-invalid-' || value),
  '22023', 'Use 0.5-hour increments from 0.5 to 24.',
  'draft RPC rejects ' || value || ' hours before storage can round them'
)
from (values ('0.25'), ('1.25'), ('1.75'), ('1.001'), ('0'), ('-0.5'),
  ('24.5'), ('25'), ('NaN'), ('Infinity'), ('-Infinity')) invalid(value);

select extensions.lives_ok(
  format($sql$ select public.create_hour_request_draft(
    p_school_year_id => '10000000-0000-4000-8000-000000000001',
    p_title => 'Half-hour service',
    p_category_id => '30000000-0000-4000-8000-000000000001',
    p_service_date => '2026-08-05', p_hours => %1$L::numeric,
    p_requested_approver_membership_id => '20000000-0000-4000-8000-000000000002',
    p_client_submission_key => %2$L) $sql$, value, 'half-hours-valid-' || value),
  'draft RPC accepts ' || value || ' hours without a description'
)
from (values ('0.5'), ('1'), ('1.5'), ('23.5'), ('24')) valid(value);

select extensions.is(
  (select hours from public.hour_requests
    where client_submission_key = 'half-hours-valid-' || value),
  value::numeric, 'draft stores ' || value || ' hours exactly'
)
from (values ('0.5'), ('1'), ('1.5'), ('23.5'), ('24')) valid(value);

select extensions.lives_ok($$ select public.create_hour_request_draft(
  p_school_year_id => '10000000-0000-4000-8000-000000000001',
  p_client_submission_key => 'half-hours-empty-draft') $$,
  'incomplete drafts may still omit hours');

select extensions.lives_ok($$ select public.save_hour_request_draft(
  p_request_id => (select id from public.hour_requests where client_submission_key = 'half-hours-valid-1'),
  p_expected_revision => 1, p_title => 'Edited half-hour service', p_description => null,
  p_category_id => '30000000-0000-4000-8000-000000000001',
  p_service_date => '2026-08-05', p_hours => 1.5,
  p_requested_approver_membership_id => '20000000-0000-4000-8000-000000000002') $$,
  'editing a draft accepts 1.5 hours without a description');

select extensions.throws_ok($$ select public.save_hour_request_draft(
  p_request_id => (select id from public.hour_requests where client_submission_key = 'half-hours-valid-1'),
  p_expected_revision => 2, p_title => 'Edited half-hour service', p_description => null,
  p_category_id => '30000000-0000-4000-8000-000000000001',
  p_service_date => '2026-08-05', p_hours => 1.25,
  p_requested_approver_membership_id => '20000000-0000-4000-8000-000000000002') $$,
  '22023', 'Use 0.5-hour increments from 0.5 to 24.',
  'editing a draft rejects quarter-hour steps');

select extensions.is(
  (select hours from public.hour_requests where client_submission_key = 'half-hours-valid-1'),
  1.5::numeric, 'rejected edit preserves the exact half-hour value');

select extensions.lives_ok($$ select public.submit_hour_request(
  (select id from public.hour_requests where client_submission_key = 'half-hours-valid-0.5'), 1) $$,
  'submission accepts the 0.5-hour minimum');
select extensions.lives_ok($$ select public.submit_hour_request(
  (select id from public.hour_requests where client_submission_key = 'half-hours-valid-1'), 2) $$,
  'submission accepts an edited 1.5-hour request');

select extensions.lives_ok($$ select public.save_hour_request_draft(
  p_request_id => '40000000-0000-4000-8000-000000000004', p_expected_revision => 1,
  p_title => 'Returned half-hour service', p_description => null,
  p_category_id => '30000000-0000-4000-8000-000000000001',
  p_service_date => '2026-08-12', p_hours => 0.5,
  p_requested_approver_membership_id => '20000000-0000-4000-8000-000000000002') $$,
  'returned requests can be changed to 0.5 hours');
select extensions.lives_ok($$ select public.submit_hour_request(
  '40000000-0000-4000-8000-000000000004', 2) $$,
  'returned requests can be resubmitted with 0.5 hours');

select extensions.is(
  (select count(*) from public.hour_requests where status = 'pending' and hours in (0.5, 1.5)),
  3::bigint, 'new, edited, and returned requests keep their half-hour values on submission');
select extensions.is(
  (select hours from public.hour_requests where id = '40000000-0000-4000-8000-000000000002'),
  3.25::numeric, 'the existing pending quarter-hour request is unchanged');
select extensions.is(
  (select pending_hours from public.member_progress where membership_id = '20000000-0000-4000-8000-000000000003'),
  5.75::numeric, 'pending totals combine historical quarter hours and new half hours exactly');
select extensions.is(
  (select hours from public.hour_requests where client_submission_key = 'half-hours-historical-quarter'),
  1.25::numeric, 'the existing approved quarter-hour request remains exact');
select extensions.is(
  (select approved_hours from public.member_progress where membership_id = '20000000-0000-4000-8000-000000000003'),
  13.75::numeric, 'approved totals keep historical quarter hours exactly');

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009","role":"authenticated"}', true);
select extensions.throws_ok(
  format($sql$ select public.correct_approved_request(
    p_request_id => '40000000-0000-4000-8000-000000000001',
    p_title => 'Library Setup', p_description => null,
    p_category_id => '30000000-0000-4000-8000-000000000001',
    p_service_date => '2026-08-05', p_hours => %1$L::numeric,
    p_reason => 'Test invalid correction rejection.') $sql$, value),
  '22023', 'Use 0.5-hour increments from 0.5 to 24.',
  'admin correction RPC rejects ' || value || ' hours'
)
from (values ('0.25'), ('1.25'), ('1.001'), ('24.5')) invalid(value);

select extensions.lives_ok($$ select public.correct_approved_request(
  p_request_id => '40000000-0000-4000-8000-000000000001',
  p_title => 'Library Setup', p_description => null,
  p_category_id => '30000000-0000-4000-8000-000000000001',
  p_service_date => '2026-08-05', p_hours => 0.5,
  p_reason => 'Correct the recorded hours.') $$,
  'admin correction RPC accepts 0.5 hours without a description');
select extensions.is(
  (select hours from public.hour_requests where id = '40000000-0000-4000-8000-000000000001'),
  0.5::numeric, 'admin correction stores the exact 0.5-hour value');
select extensions.is(
  (select approved_hours from public.member_progress where membership_id = '20000000-0000-4000-8000-000000000003'),
  1.75::numeric, 'corrected half hours and historical quarter hours total exactly');
select extensions.is(
  (select (before_values ->> 'hours')::numeric from public.hour_request_corrections
    where hour_request_id = '40000000-0000-4000-8000-000000000001'),
  12.5::numeric, 'correction history retains the original exact value');
select extensions.is(
  (select (after_values ->> 'hours')::numeric from public.hour_request_corrections
    where hour_request_id = '40000000-0000-4000-8000-000000000001'),
  0.5::numeric, 'correction history records the new exact half-hour value');

select * from extensions.finish();
rollback;
