begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(32);

insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009', 'teacher@example.edu', 'authenticated', 'authenticated', statement_timestamp()),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa010', 'admin-two@example.edu', 'authenticated', 'authenticated', statement_timestamp());
insert into public.profiles (id, email, full_name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009', 'teacher@example.edu', 'Terry Teacher');
insert into public.platform_access_grants (profile_id, access_level, granted_by_profile_id)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009', 'teacher_admin', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001');

create function pg_temp.act_as(p_profile_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_profile_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_profile_id, 'role', 'authenticated')::text, true);
end;
$$;
set local role authenticated;
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001');
select extensions.lives_ok($$select public.create_invitation(
  'admin-two@example.edu', 'Alex Admin', '10000000-0000-4000-8000-000000000001',
  array['teacher_admin'], statement_timestamp() + interval '1 day'
)$$, 'an existing teacher invitation can precede an Admin first login');
reset role;
insert into public.profiles (id, email, full_name)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa010', 'admin-two@example.edu', 'Alex Admin');
set local role authenticated;
select extensions.lives_ok($$select public.grant_admin('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa010')$$, 'owner can provision an additional Admin');
select extensions.ok(private.current_actor_is_admin(), 'owner is an Admin');
select extensions.ok(not private.current_actor_is_teacher_approver(), 'owner is not a teacher approver');
select extensions.is((select count(*) from public.pending_review_queue), 0::bigint, 'owner has no approval queue');
select extensions.throws_ok($$select public.review_hour_request('40000000-0000-4000-8000-000000000002', 'approve')$$, '42501', 'Admin accounts do not approve service hours', 'owner cannot approve via direct RPC');


select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa010');
select extensions.lives_ok($$select public.claim_invitation()$$, 'promoted Admin can accept their original teacher invitation');
select extensions.is((select access_level from public.platform_access_grants where profile_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa010'), 'admin', 'invitation acceptance preserves Admin access');

select extensions.ok(private.current_actor_is_admin(), 'additional Admin has administrative access');
select extensions.ok(not private.current_actor_is_platform_owner(), 'additional Admin does not replace the protected owner');
select extensions.throws_ok($$select public.revoke_teacher_admin('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa010')$$, '23514', 'Admin access cannot be revoked through the teacher action', 'teacher management cannot remove Admin access');
select extensions.ok(not private.current_actor_is_teacher_approver(), 'additional Admin is not a teacher approver');
select extensions.ok(exists(select 1 from public.export_service_records), 'additional Admin can read exports');
select extensions.lives_ok($$select public.list_account_setup_status('10000000-0000-4000-8000-000000000001')$$, 'additional Admin can manage account setup');
select extensions.lives_ok($$select public.set_app_setting('allowed_email_domains', '["example.edu"]'::jsonb)$$, 'additional Admin can manage settings');
select extensions.lives_ok($$select public.grant_teacher_admin('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009')$$, 'additional Admin can manage teacher access');
select extensions.throws_ok($$select public.review_hour_request('40000000-0000-4000-8000-000000000002', 'approve')$$, '42501', 'Admin accounts do not approve service hours', 'additional Admin cannot approve via direct RPC');

select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009');
select extensions.ok(private.current_actor_is_teacher_approver(), 'teacher is a final approver');
select extensions.ok(not private.current_actor_is_admin(), 'teacher is not an Admin');
select extensions.ok(exists(select 1 from public.member_progress), 'teacher keeps member progress access');
select extensions.is((select count(*) from public.export_service_records), 0::bigint, 'teacher cannot use the export view directly');
select extensions.is((select count(*) from public.invitations), 0::bigint, 'teacher cannot read account invitations');
select extensions.throws_ok($$select public.list_account_setup_status('10000000-0000-4000-8000-000000000001')$$, '42501', 'Admin access is required', 'teacher cannot inspect other accounts password setup');
select extensions.throws_ok($$select public.prepare_invitation_send('ffffffff-ffff-4fff-8fff-ffffffffffff')$$, '42501', 'Admin access is required', 'teacher cannot trigger invitation or password-recovery assistance');
select extensions.throws_ok($$select public.set_app_setting('allowed_email_domains', '["example.edu"]'::jsonb)$$, '42501', 'Admin access is required', 'teacher cannot change settings');
select extensions.throws_ok($$select public.grant_teacher_admin('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa010')$$, '42501', 'Admin access is required', 'teacher cannot manage account roles');
select extensions.throws_ok($$select public.grant_admin('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009')$$, '42501', 'The platform owner is required', 'teacher cannot promote themselves to Admin');
select extensions.ok(not exists(
  select 1 from public.list_committee_head_options('10000000-0000-4000-8000-000000000001')
  where profile_id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa010')
), 'neither Admin appears in the approver picker');
select extensions.lives_ok($$select public.create_service_event(
  '10000000-0000-4000-8000-000000000001', 'Teacher event', 'A teacher-managed event',
  'School', 'All members', (current_date + 2)::timestamp, (current_date + 2)::timestamp + interval '1 hour',
  'Terry Teacher', 'teacher@example.edu', 10
)$$, 'teacher retains event creation');

select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002');
select public.review_hour_request('40000000-0000-4000-8000-000000000002', 'approve');
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009');
select extensions.ok(exists(select 1 from public.pending_review_queue where id = '40000000-0000-4000-8000-000000000002'), 'request reaches teacher final-approval queue');
select extensions.lives_ok($$select public.review_hour_request('40000000-0000-4000-8000-000000000002', 'approve')$$, 'teacher can complete final approval');
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa010');
select extensions.is((select count(*) from public.pending_review_queue), 0::bigint, 'additional Admin remains outside the teacher queue');
select * from extensions.finish();
rollback;
