begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(9);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003","role":"authenticated"}', true);
select extensions.throws_ok($$ select public.create_hour_request_draft(
  p_school_year_id => '10000000-0000-4000-8000-000000000001',
  p_hours => 0.25, p_client_submission_key => 'whole-hours-invalid-0.25') $$,
  '22023', 'Hours must be a whole number from 1 to 24', 'draft RPC rejects 0.25 hours');
select extensions.throws_ok($$ select public.create_hour_request_draft(
  p_school_year_id => '10000000-0000-4000-8000-000000000001',
  p_hours => 1.5, p_client_submission_key => 'whole-hours-invalid-1.5') $$,
  '22023', 'Hours must be a whole number from 1 to 24', 'draft RPC rejects 1.5 hours');
select extensions.throws_ok($$ select public.create_hour_request_draft(
  p_school_year_id => '10000000-0000-4000-8000-000000000001',
  p_hours => 1.75, p_client_submission_key => 'whole-hours-invalid-1.75') $$,
  '22023', 'Hours must be a whole number from 1 to 24', 'draft RPC rejects 1.75 hours');
select extensions.throws_ok($$ select public.create_hour_request_draft(
  p_school_year_id => '10000000-0000-4000-8000-000000000001',
  p_hours => 1.001, p_client_submission_key => 'whole-hours-invalid-1.001') $$,
  '22023', 'Hours must be a whole number from 1 to 24', 'draft RPC rejects 1.001 hours');
select extensions.throws_ok($$ select public.create_hour_request_draft(
  p_school_year_id => '10000000-0000-4000-8000-000000000001',
  p_hours => 0, p_client_submission_key => 'whole-hours-invalid-0') $$,
  '22023', 'Hours must be a whole number from 1 to 24', 'draft RPC rejects 0 hours');
select extensions.throws_ok($$ select public.create_hour_request_draft(
  p_school_year_id => '10000000-0000-4000-8000-000000000001',
  p_hours => 25, p_client_submission_key => 'whole-hours-invalid-25') $$,
  '22023', 'Hours must be a whole number from 1 to 24', 'draft RPC rejects 25 hours');
select extensions.lives_ok($$ select public.create_hour_request_draft(
  p_school_year_id => '10000000-0000-4000-8000-000000000001',
  p_hours => 1, p_client_submission_key => 'whole-hours-valid-1') $$,
  'draft RPC accepts 1 whole hours');
select extensions.lives_ok($$ select public.create_hour_request_draft(
  p_school_year_id => '10000000-0000-4000-8000-000000000001',
  p_hours => 24, p_client_submission_key => 'whole-hours-valid-24') $$,
  'draft RPC accepts 24 whole hours');
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001","role":"authenticated"}', true);
select extensions.throws_ok($$ select public.correct_approved_request(
  p_request_id => '40000000-0000-4000-8000-000000000001',
  p_title => 'Library Setup', p_description => 'Correct the recorded hours.',
  p_category_id => '30000000-0000-4000-8000-000000000001',
  p_service_date => '2026-08-05', p_hours => 1.25,
  p_reason => 'Test fractional correction rejection.') $$,
  '22023', 'Hours must be a whole number from 1 to 24', 'teacher correction RPC rejects fractions');
select * from extensions.finish();
rollback;
