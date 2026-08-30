begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(60);

-- Transaction-local identities used to exercise global grant, ownership, and
-- teacher-administrator invitation workflows without changing the seed.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    'dddddddd-dddd-4ddd-8ddd-ddddddddd001',
    'authenticated', 'authenticated', 'global-one@example.edu', '',
    statement_timestamp(), '{"provider":"email","providers":["email"]}', '{}',
    statement_timestamp(), statement_timestamp(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'dddddddd-dddd-4ddd-8ddd-ddddddddd002',
    'authenticated', 'authenticated', 'global-two@example.edu', '',
    statement_timestamp(), '{"provider":"email","providers":["email"]}', '{}',
    statement_timestamp(), statement_timestamp(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'dddddddd-dddd-4ddd-8ddd-ddddddddd003',
    'authenticated', 'authenticated', 'invited-global@example.edu', '',
    statement_timestamp(), '{"provider":"email","providers":["email"]}', '{}',
    statement_timestamp(), statement_timestamp(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'dddddddd-dddd-4ddd-8ddd-ddddddddd004',
    'authenticated', 'authenticated', 'invited-leader@example.edu', '',
    statement_timestamp(), '{"provider":"email","providers":["email"]}', '{}',
    statement_timestamp(), statement_timestamp(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'dddddddd-dddd-4ddd-8ddd-ddddddddd005',
    'authenticated', 'authenticated', 'member-before-admin@example.edu', '',
    statement_timestamp(), '{"provider":"email","providers":["email"]}', '{}',
    statement_timestamp(), statement_timestamp(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'dddddddd-dddd-4ddd-8ddd-ddddddddd006',
    'authenticated', 'authenticated', 'closed-year-global@example.edu', '',
    statement_timestamp(), '{"provider":"email","providers":["email"]}', '{}',
    statement_timestamp(), statement_timestamp(), '', '', '', ''
  );

insert into public.profiles (id, email, full_name)
values
  (
    'dddddddd-dddd-4ddd-8ddd-ddddddddd001',
    'global-one@example.edu', 'Global Administrator One'
  ),
  (
    'dddddddd-dddd-4ddd-8ddd-ddddddddd002',
    'global-two@example.edu', 'Global Administrator Two'
  );

select extensions.is(
  (
    select count(*) from public.platform_access_grants
    where access_level = 'platform_owner'
  ),
  1::bigint,
  'the seed has exactly one platform owner'
);
select extensions.is(
  (
    select profile_id from public.platform_access_grants
    where access_level = 'platform_owner'
  ),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001'::uuid,
  'the deterministic seeded administrator owns the platform'
);
select extensions.has_trigger(
  'public', 'platform_access_grants', 'platform_access_grants_serialize_insert',
  'platform-grant inserts serialize before acquiring profile and membership locks'
);
select extensions.has_trigger(
  'public', 'school_years', 'school_years_serialize_platform_access',
  'school-year inserts serialize with concurrent global grants'
);
select extensions.throws_ok(
  $$
    insert into public.platform_access_grants (
      profile_id, access_level, granted_by_profile_id
    ) values (
      'dddddddd-dddd-4ddd-8ddd-ddddddddd002', 'platform_owner',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001'
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "platform_access_grants_single_owner_idx"',
  'the partial unique index prevents a second platform owner'
);
select extensions.throws_ok(
  $$
    update public.school_years
    set default_target_hours = 19.00
    where id = '10000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'The annual service target is fixed at 20 approved hours',
  'direct school-year target mutation is blocked'
);
select extensions.throws_ok(
  $$
    update public.school_year_memberships
    set target_hours_override = 5.00
    where id = '20000000-0000-4000-8000-000000000003'
  $$,
  '23514',
  'Membership target overrides are disabled; the target is 20 approved hours',
  'direct membership target overrides are blocked'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001","role":"authenticated","email":"admin@example.edu"}',
  true
);

select extensions.is(
  (
    select count(*) from public.member_progress
    where profile_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001'
  ),
  0::bigint,
  'the global administrator anchor is absent from member progress'
);
select extensions.is(
  (
    select member_count from public.school_year_summary
    where school_year_id = '10000000-0000-4000-8000-000000000001'
  ),
  7::bigint,
  'school-year summary excludes the administrator anchor from member count'
);
select extensions.is(
  (
    select active_member_count from public.school_year_summary
    where school_year_id = '10000000-0000-4000-8000-000000000001'
  ),
  5::bigint,
  'school-year summary counts only the five active ordinary members'
);
select extensions.throws_ok(
  $$
    select public.set_school_year_target(
      '10000000-0000-4000-8000-000000000001', 21.00
    )
  $$,
  '23514',
  'The annual service target is fixed at 20 approved hours',
  'the deployed school-year target RPC rejects non-20 values'
);
select extensions.throws_ok(
  $$
    select public.set_membership_target(
      '20000000-0000-4000-8000-000000000003', 10.00
    )
  $$,
  '23514',
  'Membership target overrides are disabled; the target is 20 approved hours',
  'the deployed membership target RPC rejects overrides'
);
select extensions.throws_ok(
  $$
    select public.set_membership_status(
      '20000000-0000-4000-8000-000000000008', 'active'
    )
  $$,
  '23514',
  'Historical or expired school-year access is read-only; assign access in an open school year',
  'expired annual access cannot be made deceptively active'
);
select extensions.throws_ok(
  $$
    select public.assign_membership_role(
      '20000000-0000-4000-8000-000000000008', 'committee_head'
    )
  $$,
  '23514',
  'Historical or expired school-year roles are read-only; assign access in an open school year',
  'leadership roles cannot be added to expired annual history'
);
select extensions.throws_ok(
  $$
    select public.remove_membership_role(
      '20000000-0000-4000-8000-000000000005', 'committee_head'
    )
  $$,
  '23514',
  'Historical or expired school-year roles are read-only; assign access in an open school year',
  'leadership roles cannot be removed from expired annual history'
);
select extensions.lives_ok(
  $$
    select public.upsert_service_category(
      p_name => 'Green Team',
      p_description => 'Environmental service projects sponsored by the Green Team.',
      p_display_order => 91,
      p_is_active => true,
      p_default_max_hours_per_request => 1.00,
      p_category_id => '30000000-0000-4000-8000-000000000001'
    )
  $$,
  'category RPC accepts legacy order and cap arguments for signature compatibility'
);
select extensions.ok(
  (
    select display_order = 0 and default_max_hours_per_request is null
    from public.service_categories
    where id = '30000000-0000-4000-8000-000000000001'
  ),
  'category RPC neutralizes legacy order and request-cap arguments'
);
select extensions.lives_ok(
  $$
    select public.set_school_year_category(
      p_school_year_id => '10000000-0000-4000-8000-000000000001',
      p_category_id => '30000000-0000-4000-8000-000000000001',
      p_is_available => true,
      p_display_order => 82,
      p_max_hours_per_request => 2.00,
      p_member_approved_hours_cap => 3.00
    )
  $$,
  'school-year category RPC accepts obsolete policy arguments compatibly'
);
select extensions.ok(
  (
    select display_order = 0
      and max_hours_per_request is null
      and member_approved_hours_cap is null
    from public.school_year_categories
    where school_year_id = '10000000-0000-4000-8000-000000000001'
      and category_id = '30000000-0000-4000-8000-000000000001'
  ),
  'school-year category RPC persists neutral order and no caps'
);

select extensions.throws_ok(
  $$
    select public.create_invitation(
      p_email => 'mixed-global@example.edu',
      p_full_name => 'Mixed Global Invitation',
      p_school_year_id => '10000000-0000-4000-8000-000000000001',
      p_role_keys => array['teacher_admin', 'member'],
      p_expires_at => statement_timestamp() + interval '1 day'
    )
  $$,
  '23514',
  'Teacher administrator must be the invitation''s only role',
  'teacher-administrator invitations reject every mixed-role combination'
);
select extensions.lives_ok(
  $$
    select public.create_invitation(
      p_email => 'invited-global@example.edu',
      p_full_name => 'Invited Global Administrator',
      p_school_year_id => '10000000-0000-4000-8000-000000000001',
      p_role_keys => array['teacher_admin'],
      p_expires_at => statement_timestamp() + interval '1 day'
    )
  $$,
  'the platform owner can create an exclusive teacher-administrator invitation'
);
select set_config(
  'test.global_admin_invitation_id',
  (
    select id::text from public.invitations
    where email = 'invited-global@example.edu'
  ),
  true
);
select extensions.results_eq(
  $$
    select role.role_key
    from public.invitation_roles assignment
    join public.roles role on role.id = assignment.role_id
    where assignment.invitation_id =
      current_setting('test.global_admin_invitation_id')::uuid
    order by role.display_order
  $$,
  $$ values ('teacher_admin'::text) $$,
  'teacher-administrator invitation metadata contains only its global role'
);
select set_config(
  'test.closed_admin_year_id',
  (
    select (public.create_school_year(
      p_label => '2030-2031',
      p_start_date => date '2030-09-01',
      p_end_date => date '2031-09-01',
      p_default_target_hours => 20.00
    )).id::text
  ),
  true
);
select set_config(
  'test.closed_admin_invitation_id',
  (
    select (public.create_invitation(
      p_email => 'closed-year-global@example.edu',
      p_full_name => 'Closed Year Global Administrator',
      p_school_year_id => current_setting('test.closed_admin_year_id')::uuid,
      p_role_keys => array['teacher_admin'],
      p_expires_at => statement_timestamp() + interval '1 day'
    )).id::text
  ),
  true
);
select public.close_school_year(current_setting('test.closed_admin_year_id')::uuid);
select extensions.results_eq(
  $$
    select invitation_id, email, full_name
    from public.prepare_invitation_send(
      current_setting('test.closed_admin_invitation_id')::uuid
    )
  $$,
  $$
    values (
      current_setting('test.closed_admin_invitation_id')::uuid,
      'closed-year-global@example.edu'::text,
      'Closed Year Global Administrator'::text
    )
  $$,
  'the owner can prepare a global invitation after its attribution year closes'
);
select extensions.lives_ok(
  $$
    select public.record_invitation_send_success(
      current_setting('test.closed_admin_invitation_id')::uuid,
      '91000000-0000-4000-8000-000000000001',
      statement_timestamp() + interval '1 day'
    )
  $$,
  'global invitation provider success can be recorded after the attribution year closes'
);
select extensions.lives_ok(
  $$
    select public.create_invitation(
      p_email => 'invited-leader@example.edu',
      p_full_name => 'Invited Combined Leader',
      p_school_year_id => '10000000-0000-4000-8000-000000000001',
      p_role_keys => array['president_vice_president'],
      p_expires_at => statement_timestamp() + interval '1 day'
    )
  $$,
  'ordinary combined-leadership invitation can be created'
);
select extensions.results_eq(
  $$
    select role.role_key
    from public.invitations invitation
    join public.invitation_roles assignment on assignment.invitation_id = invitation.id
    join public.roles role on role.id = assignment.role_id
    where invitation.email = 'invited-leader@example.edu'
    order by role.display_order
  $$,
  $$ values ('member'::text), ('president_vice_president'::text) $$,
  'combined-leadership invitations are normalized to include member'
);

select set_config(
  'test.conflicting_admin_invitation_id',
  (
    select (public.create_invitation(
      p_email => 'member-before-admin@example.edu',
      p_full_name => 'Member Before Administrator',
      p_school_year_id => '10000000-0000-4000-8000-000000000001',
      p_role_keys => array['teacher_admin'],
      p_expires_at => statement_timestamp() + interval '1 day'
    )).id::text
  ),
  true
);

reset role;
insert into public.profiles (id, email, full_name)
values (
  'dddddddd-dddd-4ddd-8ddd-ddddddddd005',
  'member-before-admin@example.edu',
  'Member Before Administrator'
);
insert into public.school_year_memberships (
  id, profile_id, school_year_id, status, expiration_date,
  target_hours_override, created_by_profile_id
)
select
  '90000000-0000-4000-8000-000000000005',
  'dddddddd-dddd-4ddd-8ddd-ddddddddd005',
  school_year.id, 'active', school_year.end_date, null,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001'
from public.school_years school_year
where school_year.id = '10000000-0000-4000-8000-000000000001';
insert into public.membership_roles (membership_id, role_id, assigned_by_profile_id)
select
  '90000000-0000-4000-8000-000000000005', role.id,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001'
from public.roles role
where role.role_key = 'member';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'dddddddd-dddd-4ddd-8ddd-ddddddddd005', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"dddddddd-dddd-4ddd-8ddd-ddddddddd005","role":"authenticated","email":"member-before-admin@example.edu"}',
  true
);
select extensions.throws_ok(
  $$
    select public.claim_invitation(
      current_setting('test.conflicting_admin_invitation_id')::uuid
    )
  $$,
  '23514',
  'Use a separate account for a global teacher administrator',
  'an administrator invitation cannot convert an account with member participation'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'dddddddd-dddd-4ddd-8ddd-ddddddddd003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"dddddddd-dddd-4ddd-8ddd-ddddddddd003","role":"authenticated","email":"invited-global@example.edu"}',
  true
);
select extensions.lives_ok(
  $$
    select public.claim_invitation(
      current_setting('test.global_admin_invitation_id')::uuid
    )
  $$,
  'invited teacher administrator can claim the exclusive invitation'
);
select extensions.is(
  (
    select access_level from public.platform_access_grants
    where profile_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddd003'
  ),
  'teacher_admin'::text,
  'claiming a teacher-administrator invitation creates global access'
);
select extensions.ok(
  not exists (
    select 1
    from public.school_year_memberships membership
    join public.membership_roles assignment on assignment.membership_id = membership.id
    join public.roles role on role.id = assignment.role_id
    where membership.profile_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddd003'
      and role.role_key <> 'teacher_admin'
  ),
  'claimed global administrator anchors contain no member or leadership roles'
);
select extensions.is(
  (
    select count(*) from public.member_progress
    where profile_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddd003'
  ),
  0::bigint,
  'claimed teacher administrator is not exposed as a member'
);
select extensions.throws_ok(
  $$ select public.grant_teacher_admin('dddddddd-dddd-4ddd-8ddd-ddddddddd001') $$,
  '42501',
  'The platform owner is required',
  'a non-owner teacher administrator cannot grant global access'
);
select extensions.throws_ok(
  $$
    select public.create_invitation(
      p_email => 'nonowner-global@example.edu',
      p_full_name => 'Non-owner Global Invitation',
      p_school_year_id => '10000000-0000-4000-8000-000000000001',
      p_role_keys => array['teacher_admin'],
      p_expires_at => statement_timestamp() + interval '1 day'
    )
  $$,
  '42501',
  'The platform owner is required',
  'a non-owner teacher administrator cannot invite another global administrator'
);
select extensions.throws_ok(
  $$
    select *
    from public.prepare_invitation_send(
      current_setting('test.conflicting_admin_invitation_id')::uuid
    )
  $$,
  '42501',
  'The platform owner is required',
  'a non-owner teacher administrator cannot prepare a global invitation resend'
);
select extensions.throws_ok(
  $$
    select public.record_invitation_send_success(
      current_setting('test.conflicting_admin_invitation_id')::uuid,
      '91000000-0000-4000-8000-000000000002',
      statement_timestamp() + interval '1 day'
    )
  $$,
  '42501',
  'The platform owner is required',
  'a non-owner teacher administrator cannot record a global invitation send'
);
select extensions.throws_ok(
  $$
    select public.revoke_invitation(
      current_setting('test.conflicting_admin_invitation_id')::uuid
    )
  $$,
  '42501',
  'The platform owner is required',
  'a non-owner teacher administrator cannot revoke a global invitation'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001","role":"authenticated","email":"admin@example.edu"}',
  true
);
select extensions.lives_ok(
  $$ select public.grant_teacher_admin('dddddddd-dddd-4ddd-8ddd-ddddddddd001') $$,
  'the platform owner can grant global teacher-administrator access'
);
select extensions.is(
  (
    select access_level from public.platform_access_grants
    where profile_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddd001'
  ),
  'teacher_admin'::text,
  'grant RPC records teacher-administrator access without ownership'
);
select extensions.is(
  (
    select count(*) from public.school_year_memberships
    where profile_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddd001'
  ),
  (select count(*) from public.school_years),
  'grant RPC creates one attribution anchor for every school year'
);
select extensions.ok(
  not exists (
    select 1
    from public.school_year_memberships membership
    join public.membership_roles assignment on assignment.membership_id = membership.id
    join public.roles role on role.id = assignment.role_id
    where membership.profile_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddd001'
      and role.role_key <> 'teacher_admin'
  )
  and (
    select count(*)
    from public.school_year_memberships membership
    join public.membership_roles assignment on assignment.membership_id = membership.id
    join public.roles role on role.id = assignment.role_id
    where membership.profile_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddd001'
      and role.role_key = 'teacher_admin'
  ) = (select count(*) from public.school_years),
  'every global grant anchor is teacher-only'
);
select extensions.throws_ok(
  $$
    select public.assign_membership_role(
      (
        select id from public.school_year_memberships
        where profile_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddd001'
        order by created_at limit 1
      ),
      'member'
    )
  $$,
  '23514',
  'Global teacher administrators cannot hold school-year roles',
  'school-year role RPC cannot turn a global administrator into a member'
);
select extensions.lives_ok(
  $$ select public.transfer_platform_owner('dddddddd-dddd-4ddd-8ddd-ddddddddd001') $$,
  'the platform owner can atomically transfer ownership to another active administrator'
);
select extensions.results_eq(
  $$
    select profile_id, access_level
    from public.platform_access_grants
    where profile_id in (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001',
      'dddddddd-dddd-4ddd-8ddd-ddddddddd001'
    )
    order by profile_id
  $$,
  $$
    values
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001'::uuid, 'teacher_admin'::text),
      ('dddddddd-dddd-4ddd-8ddd-ddddddddd001'::uuid, 'platform_owner'::text)
  $$,
  'ownership transfer demotes the prior owner and leaves exactly one successor'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'dddddddd-dddd-4ddd-8ddd-ddddddddd006', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"dddddddd-dddd-4ddd-8ddd-ddddddddd006","role":"authenticated","email":"closed-year-global@example.edu"}',
  true
);
select extensions.lives_ok(
  $$
    select public.claim_invitation(
      current_setting('test.closed_admin_invitation_id')::uuid
    )
  $$,
  'a pending global invitation remains claimable after ownership transfers'
);
select extensions.is(
  (
    select granted_by_profile_id
    from public.platform_access_grants
    where profile_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddd006'
  ),
  'dddddddd-dddd-4ddd-8ddd-ddddddddd001'::uuid,
  'the current owner authorizes and is attributed to the post-transfer claim'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select extensions.throws_ok(
  $$ select public.grant_teacher_admin('dddddddd-dddd-4ddd-8ddd-ddddddddd002') $$,
  '42501',
  'The platform owner is required',
  'a demoted former owner cannot grant teacher-administrator access'
);
select extensions.throws_ok(
  $$ select public.revoke_teacher_admin('dddddddd-dddd-4ddd-8ddd-ddddddddd003') $$,
  '42501',
  'The platform owner is required',
  'a non-owner cannot revoke teacher-administrator access'
);
select extensions.throws_ok(
  $$ select public.transfer_platform_owner('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001') $$,
  '42501',
  'The platform owner is required',
  'a non-owner cannot transfer platform ownership'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'dddddddd-dddd-4ddd-8ddd-ddddddddd001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"dddddddd-dddd-4ddd-8ddd-ddddddddd001","role":"authenticated","email":"global-one@example.edu"}',
  true
);
select extensions.lives_ok(
  $$ select public.grant_teacher_admin('dddddddd-dddd-4ddd-8ddd-ddddddddd002') $$,
  'the successor owner can grant another teacher administrator'
);
select extensions.lives_ok(
  $$ select public.revoke_teacher_admin('dddddddd-dddd-4ddd-8ddd-ddddddddd003') $$,
  'the owner can revoke an invited teacher administrator'
);
select extensions.lives_ok(
  $$ select public.grant_teacher_admin('dddddddd-dddd-4ddd-8ddd-ddddddddd003') $$,
  'the owner can restore a former administrator from its roleless archived anchors'
);
select extensions.lives_ok(
  $$ select public.revoke_teacher_admin('dddddddd-dddd-4ddd-8ddd-ddddddddd003') $$,
  'the restored administrator can be revoked again without becoming a member'
);
select extensions.ok(
  not exists (
    select 1 from public.platform_access_grants
    where profile_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddd003'
  )
  and not exists (
    select 1
    from public.school_year_memberships membership
    join public.membership_roles assignment on assignment.membership_id = membership.id
    join public.roles role on role.id = assignment.role_id
    where membership.profile_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddd003'
      and role.role_key = 'teacher_admin'
  )
  and not exists (
    select 1 from public.school_year_memberships
    where profile_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddd003'
      and status <> 'archived'
  ),
  'revocation removes global access and archives its attribution anchors'
);
select extensions.throws_ok(
  $$ select public.revoke_teacher_admin('dddddddd-dddd-4ddd-8ddd-ddddddddd001') $$,
  '23514',
  'Transfer platform ownership before revoking this account',
  'the current platform owner cannot be revoked'
);
select extensions.lives_ok(
  $$ select public.transfer_platform_owner('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001') $$,
  'ownership can be transferred back to the active original administrator'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001","role":"authenticated","email":"admin@example.edu"}',
  true
);
select extensions.lives_ok(
  $$ select public.revoke_teacher_admin('dddddddd-dddd-4ddd-8ddd-ddddddddd001') $$,
  'the restored owner can revoke the former owner after transfer'
);
select extensions.ok(
  not exists (
    select 1 from public.platform_access_grants
    where profile_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddd001'
  )
  and not exists (
    select 1 from public.school_year_memberships
    where profile_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddd001'
      and status <> 'archived'
  ),
  'revoking the former owner removes access and archives its anchors'
);
select extensions.lives_ok(
  $$ select public.revoke_teacher_admin('dddddddd-dddd-4ddd-8ddd-ddddddddd002') $$,
  'the owner can revoke the remaining test teacher administrator'
);
select extensions.results_eq(
  $$
    select profile_id, access_level
    from public.platform_access_grants
    where access_level = 'platform_owner'
  $$,
  $$
    values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001'::uuid,
      'platform_owner'::text
    )
  $$,
  'grant, revoke, and transfer operations finish with exactly one owner'
);
select extensions.ok(
  exists (select 1 from public.audit_events where action = 'teacher_admin.granted')
  and exists (select 1 from public.audit_events where action = 'teacher_admin.revoked')
  and exists (select 1 from public.audit_events where action = 'platform_owner.transferred'),
  'global grant, revoke, and ownership-transfer operations are audited'
);

select * from extensions.finish();
rollback;
