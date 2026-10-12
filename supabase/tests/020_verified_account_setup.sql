begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(9);

-- Simulate Auth's invitation confirmation with a temporary random password.
update auth.users set email_confirmed_at = null, encrypted_password = null
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003';
delete from private.account_auth_milestones where auth_user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003';
update auth.users set encrypted_password = 'temporary-auth-password', email_confirmed_at = statement_timestamp()
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001', true);
select extensions.is((select password_set from public.list_account_setup_status('10000000-0000-4000-8000-000000000001') where email = 'member@example.edu'), false, 'invitation verification does not imply a chosen password');
select extensions.ok((select email_verified_at is not null from public.list_account_setup_status('10000000-0000-4000-8000-000000000001') where email = 'member@example.edu'), 'email verification is recorded independently');
reset role;

-- A later verified password save establishes the durable milestone.
update auth.users set encrypted_password = 'chosen-password-proof'
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003';
select extensions.is((select count(*) from private.account_auth_milestones where auth_user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003'), 1::bigint, 'verified password change records completion');
create temporary table milestone_snapshot as select * from private.account_auth_milestones;
update auth.users set encrypted_password = 'another-chosen-password'
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003';
select extensions.results_eq($$ select * from private.account_auth_milestones $$, $$ select * from milestone_snapshot $$, 'later password changes preserve the first completion timestamp');

-- Recovery and Google sessions cannot manufacture a password sign-in milestone.
delete from private.account_auth_milestones where auth_user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003","amr":[{"method":"oauth","timestamp":1791741600}]}', true);
select extensions.throws_ok($$ select public.record_password_sign_in() $$, '42501', 'A verified password sign-in is required', 'OAuth alone cannot claim password completion');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003","amr":[{"method":"password","timestamp":1791741600}]}', true);
select extensions.lives_ok($$ select public.record_password_sign_in() $$, 'a signed password AMR can confirm password usability');
reset role;
select extensions.is((select count(*) from private.account_auth_milestones where auth_user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003'), 1::bigint, 'sign-in changes only the authenticated account');
select extensions.ok(not has_table_privilege('authenticated', 'private.account_auth_milestones', 'INSERT'), 'clients cannot insert fabricated setup milestones');
select extensions.ok(not has_function_privilege('anon', 'public.record_password_sign_in()', 'EXECUTE'), 'anonymous callers cannot record password sign-in');

select * from extensions.finish();
rollback;
