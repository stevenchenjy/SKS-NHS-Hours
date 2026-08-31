begin;

-- These Auth rows are relational fixtures. tests/e2e/prepare-auth.mjs sets
-- their local-only passwords through the running Auth admin API after reset.
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001',
    'authenticated', 'authenticated', 'admin@example.edu',
    null,
    '2026-07-01 12:00:00+00',
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Ada Administrator"}',
    '2026-07-01 12:00:00+00', '2026-07-01 12:00:00+00', '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002',
    'authenticated', 'authenticated', 'reviewer@example.edu',
    null,
    '2026-07-01 12:00:00+00',
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Riley Reviewer"}',
    '2026-07-01 12:00:00+00', '2026-07-01 12:00:00+00', '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003',
    'authenticated', 'authenticated', 'member@example.edu',
    null,
    '2026-07-01 12:00:00+00',
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Morgan Member"}',
    '2026-07-01 12:00:00+00', '2026-07-01 12:00:00+00', '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa004',
    'authenticated', 'authenticated', 'leader@example.edu',
    null,
    '2026-07-01 12:00:00+00',
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Lee Leader"}',
    '2026-07-01 12:00:00+00', '2026-07-01 12:00:00+00', '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa005',
    'authenticated', 'authenticated', 'expired-reviewer@example.edu',
    null,
    '2026-07-01 12:00:00+00',
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Evan Expired"}',
    '2026-07-01 12:00:00+00', '2026-07-01 12:00:00+00', '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa006',
    'authenticated', 'authenticated', 'vice-president@example.edu',
    null,
    '2026-07-01 12:00:00+00',
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Val Vice President"}',
    '2026-07-01 12:00:00+00', '2026-07-01 12:00:00+00', '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa007',
    'authenticated', 'authenticated', 'multi-role@example.edu',
    null,
    '2026-07-01 12:00:00+00',
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Mika Multi Role"}',
    '2026-07-01 12:00:00+00', '2026-07-01 12:00:00+00', '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa008',
    'authenticated', 'authenticated', 'expired-member@example.edu',
    null,
    '2026-07-01 12:00:00+00',
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Emery Expired Member"}',
    '2026-07-01 12:00:00+00', '2026-07-01 12:00:00+00', '', '', '', ''
  )
on conflict (id) do update
set email = excluded.email,
    encrypted_password = excluded.encrypted_password,
    raw_app_meta_data = excluded.raw_app_meta_data,
    raw_user_meta_data = excluded.raw_user_meta_data,
    updated_at = excluded.updated_at;

insert into auth.identities (
  id,
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
select
  auth_user.id,
  auth_user.id::text,
  auth_user.id,
  jsonb_build_object(
    'sub', auth_user.id::text,
    'email', auth_user.email,
    'email_verified', true,
    'phone_verified', false
  ),
  'email',
  '2026-07-01 12:00:00+00',
  '2026-07-01 12:00:00+00',
  '2026-07-01 12:00:00+00'
from auth.users auth_user
where auth_user.id in (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa004',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa005',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa006',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa007',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa008'
)
on conflict (provider_id, provider) do update
set identity_data = excluded.identity_data, updated_at = excluded.updated_at;

insert into public.profiles (id, email, full_name, status, created_at, updated_at)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001', 'admin@example.edu', 'Ada Administrator', 'active',
   '2026-07-01 12:00:00+00', '2026-07-01 12:00:00+00'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002', 'reviewer@example.edu', 'Riley Reviewer', 'active',
   '2026-07-01 12:00:00+00', '2026-07-01 12:00:00+00'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003', 'member@example.edu', 'Morgan Member', 'active',
   '2026-07-01 12:00:00+00', '2026-07-01 12:00:00+00'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa004', 'leader@example.edu', 'Lee Leader', 'active',
   '2026-07-01 12:00:00+00', '2026-07-01 12:00:00+00'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa005', 'expired-reviewer@example.edu', 'Evan Expired',
   'active', '2026-07-01 12:00:00+00', '2026-07-01 12:00:00+00'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa006', 'vice-president@example.edu',
   'Val Vice President', 'active', '2026-07-01 12:00:00+00',
   '2026-07-01 12:00:00+00'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa007', 'multi-role@example.edu', 'Mika Multi Role',
   'active', '2026-07-01 12:00:00+00', '2026-07-01 12:00:00+00'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa008', 'expired-member@example.edu',
   'Emery Expired Member', 'active', '2026-07-01 12:00:00+00',
   '2026-07-01 12:00:00+00')
on conflict (id) do update
set email = excluded.email, full_name = excluded.full_name, status = excluded.status,
    deactivated_at = null, deactivated_by_profile_id = null;

insert into public.school_years (
  id, label, start_date, end_date, default_target_hours, status,
  created_by_profile_id, created_at, updated_at
)
values (
  '10000000-0000-4000-8000-000000000001',
  '2026-2027', '2026-07-01', '2027-06-30', 20.00, 'active',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001',
  '2026-07-01 12:00:00+00', '2026-07-01 12:00:00+00'
)
on conflict (id) do update
set label = excluded.label, start_date = excluded.start_date, end_date = excluded.end_date,
    default_target_hours = excluded.default_target_hours, status = excluded.status,
    closed_at = null, closed_by_profile_id = null;

insert into public.school_year_memberships (
  id, profile_id, school_year_id, status, expiration_date, target_hours_override,
  created_by_profile_id, created_at, updated_at
)
values
  ('20000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001',
   '10000000-0000-4000-8000-000000000001', 'active', '2027-06-30', null,
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001', '2026-07-01 12:00:00+00',
   '2026-07-01 12:00:00+00'),
  ('20000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002',
   '10000000-0000-4000-8000-000000000001', 'active', '2027-06-30', null,
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001', '2026-07-01 12:00:00+00',
   '2026-07-01 12:00:00+00'),
  ('20000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003',
   '10000000-0000-4000-8000-000000000001', 'active', '2027-06-30', null,
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001', '2026-07-01 12:00:00+00',
   '2026-07-01 12:00:00+00'),
  ('20000000-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa004',
   '10000000-0000-4000-8000-000000000001', 'active', '2027-06-30', null,
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001', '2026-07-01 12:00:00+00',
   '2026-07-01 12:00:00+00'),
  ('20000000-0000-4000-8000-000000000005', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa005',
   '10000000-0000-4000-8000-000000000001', 'expired', '2026-08-01', null,
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001', '2026-07-01 12:00:00+00',
   '2026-08-02 12:00:00+00'),
  ('20000000-0000-4000-8000-000000000006', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa006',
   '10000000-0000-4000-8000-000000000001', 'active', '2027-06-30', null,
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001', '2026-07-01 12:00:00+00',
   '2026-07-01 12:00:00+00'),
  ('20000000-0000-4000-8000-000000000007', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa007',
   '10000000-0000-4000-8000-000000000001', 'active', '2027-06-30', null,
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001', '2026-07-01 12:00:00+00',
   '2026-07-01 12:00:00+00'),
  ('20000000-0000-4000-8000-000000000008', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa008',
   '10000000-0000-4000-8000-000000000001', 'expired', '2026-08-01', null,
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001', '2026-07-01 12:00:00+00',
   '2026-08-02 12:00:00+00')
on conflict (id) do update
set status = excluded.status, expiration_date = excluded.expiration_date,
    target_hours_override = excluded.target_hours_override;

insert into public.platform_access_grants (
  profile_id, access_level, granted_by_profile_id, granted_at
)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001', 'platform_owner',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001', '2026-07-01 12:00:00+00'
)
on conflict (profile_id) do update
set access_level = excluded.access_level,
    granted_by_profile_id = excluded.granted_by_profile_id;

insert into public.membership_roles (membership_id, role_id, assigned_by_profile_id)
select seeded.membership_id, role.id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001'::uuid
from (
  values
    ('20000000-0000-4000-8000-000000000001'::uuid, 'teacher_admin'),
    ('20000000-0000-4000-8000-000000000002'::uuid, 'member'),
    ('20000000-0000-4000-8000-000000000002'::uuid, 'committee_head'),
    ('20000000-0000-4000-8000-000000000003'::uuid, 'member'),
    ('20000000-0000-4000-8000-000000000004'::uuid, 'member'),
    ('20000000-0000-4000-8000-000000000004'::uuid, 'president_vice_president'),
    ('20000000-0000-4000-8000-000000000005'::uuid, 'member'),
    ('20000000-0000-4000-8000-000000000005'::uuid, 'committee_head'),
    ('20000000-0000-4000-8000-000000000006'::uuid, 'member'),
    ('20000000-0000-4000-8000-000000000006'::uuid, 'president_vice_president'),
    ('20000000-0000-4000-8000-000000000007'::uuid, 'member'),
    ('20000000-0000-4000-8000-000000000007'::uuid, 'committee_head'),
    ('20000000-0000-4000-8000-000000000007'::uuid, 'president_vice_president'),
    ('20000000-0000-4000-8000-000000000008'::uuid, 'member')
) as seeded(membership_id, role_key)
join public.roles role on role.role_key = seeded.role_key
on conflict (membership_id, role_id) do nothing;

insert into public.service_events (
  id, school_year_id, title, description, location, volunteer_audience,
  starts_at, ends_at, contact_name, contact_email, capacity,
  created_by_profile_id, created_by_membership_id, created_at, updated_at
)
values
  ('70000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001',
   'Fall Festival Setup & Welcome Team',
   'Arrange activity tables, welcome families at the main entrance, and reset the gym after the festival.',
   'Main gym and front entrance', 'All active NHS members',
   '2026-09-18 15:30:00', '2026-09-18 19:00:00',
   'Riley Reviewer', 'reviewer@example.edu', 2,
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002',
   '20000000-0000-4000-8000-000000000002',
   '2026-08-29 15:00:00+00', '2026-08-29 15:00:00+00'),
  ('70000000-0000-4000-8000-000000000002',
   '10000000-0000-4000-8000-000000000001',
   'Freshman Orientation Guides',
   'Guided incoming students and families between check-in, classrooms, and the auditorium.',
   'School auditorium lobby', 'Returning NHS members',
   '2026-08-12 08:00:00', '2026-08-12 11:30:00',
   'Ada Administrator', 'admin@example.edu', 6,
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001',
   '20000000-0000-4000-8000-000000000001',
   '2026-07-25 15:00:00+00', '2026-07-25 15:00:00+00')
on conflict (id) do update
set title = excluded.title,
    description = excluded.description,
    location = excluded.location,
    volunteer_audience = excluded.volunteer_audience,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    contact_name = excluded.contact_name,
    contact_email = excluded.contact_email,
    capacity = excluded.capacity,
    updated_at = excluded.updated_at;

insert into public.service_event_registrations (
  id, event_id, school_year_id, member_membership_id, status,
  joined_at, promoted_at, withdrawn_at, updated_at
)
overriding system value
values
  (-2001, '70000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000003', 'confirmed',
   '2026-08-29 16:00:00+00', null, null, '2026-08-29 16:00:00+00'),
  (-2002, '70000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000004', 'confirmed',
   '2026-08-29 16:05:00+00', null, null, '2026-08-29 16:05:00+00'),
  (-2003, '70000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000007', 'waitlisted',
   '2026-08-29 16:10:00+00', null, null, '2026-08-29 16:10:00+00')
on conflict on constraint service_event_registrations_event_member_unique do update
set status = excluded.status,
    joined_at = excluded.joined_at,
    promoted_at = excluded.promoted_at,
    withdrawn_at = excluded.withdrawn_at,
    updated_at = excluded.updated_at;

insert into public.service_categories (
  id, name, description, display_order, is_active, default_max_hours_per_request,
  created_by_profile_id
)
values
  ('30000000-0000-4000-8000-000000000001', 'Green Team',
   'Environmental service projects sponsored by the Green Team.', 0, true, null,
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001'),
  ('30000000-0000-4000-8000-000000000002', 'Peer Tutoring',
   'Approved peer tutoring and academic support.', 0, true, null,
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001'),
  ('30000000-0000-4000-8000-000000000003', 'Concessions',
   'Volunteer shifts supporting school concession operations.', 0, true, null,
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001'),
  ('30000000-0000-4000-8000-000000000004', 'Fundraising & Events',
   'Fundraising, setup, cleanup, and event support.', 0, true, null,
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001'),
  ('30000000-0000-4000-8000-000000000005', 'Community Service',
   'Service performed for community organizations.', 0, true, null,
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001')
on conflict (id) do update
set name = excluded.name, description = excluded.description,
    display_order = excluded.display_order, is_active = excluded.is_active,
    default_max_hours_per_request = excluded.default_max_hours_per_request;

insert into public.school_year_categories (
  school_year_id, category_id, is_available, display_order, max_hours_per_request,
  member_approved_hours_cap, created_by_profile_id
)
values
  ('10000000-0000-4000-8000-000000000001',
   '30000000-0000-4000-8000-000000000001', true, 0, null, null,
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001'),
  ('10000000-0000-4000-8000-000000000001',
   '30000000-0000-4000-8000-000000000002', true, 0, null, null,
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001'),
  ('10000000-0000-4000-8000-000000000001',
   '30000000-0000-4000-8000-000000000003', true, 0, null, null,
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001'),
  ('10000000-0000-4000-8000-000000000001',
   '30000000-0000-4000-8000-000000000004', true, 0, null, null,
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001'),
  ('10000000-0000-4000-8000-000000000001',
   '30000000-0000-4000-8000-000000000005', true, 0, null, null,
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001')
on conflict (school_year_id, category_id) do update
set is_available = excluded.is_available, display_order = excluded.display_order,
    max_hours_per_request = excluded.max_hours_per_request,
    member_approved_hours_cap = excluded.member_approved_hours_cap;

insert into public.invitations (
  id, email, full_name, school_year_id, status, expires_at,
  invited_by_membership_id, sent_at, send_count, created_at, updated_at
)
values (
  '50000000-0000-4000-8000-000000000001', 'invited@example.edu', 'Ivy Invited',
  '10000000-0000-4000-8000-000000000001', 'pending', '2027-06-01 12:00:00+00',
  '20000000-0000-4000-8000-000000000001', null, 0,
  '2026-08-01 12:00:00+00', '2026-08-01 12:00:00+00'
)
on conflict (id) do update
set status = 'pending', expires_at = excluded.expires_at, accepted_by_profile_id = null,
    accepted_at = null, revoked_at = null, revoked_by_membership_id = null,
    sent_at = null, send_count = 0;

insert into public.invitation_roles (invitation_id, role_id)
select '50000000-0000-4000-8000-000000000001', role.id
from public.roles role where role.role_key = 'member'
on conflict (invitation_id, role_id) do nothing;

select set_config('nhs.allow_hour_request_transition', 'on', true);

insert into public.hour_requests (
  id, member_membership_id, school_year_id, category_id,
  requested_approver_membership_id, committee_head_reviewer_membership_id,
  committee_head_approved_at, actual_reviewer_membership_id,
  title, description, service_date, hours, status, client_submission_key,
  revision, created_at, submitted_at, updated_at, decided_at, withdrawn_at
)
values
  ('40000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001',
   '30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002',
   '20000000-0000-4000-8000-000000000002', '2026-08-06 17:00:00+00',
   '20000000-0000-4000-8000-000000000001', 'Library Setup',
   'Prepared books and tables for the school library event.', '2026-08-05', 12.50,
   'approved', 'seed-member-approved', 1, '2026-08-05 18:00:00+00',
   '2026-08-05 18:05:00+00', '2026-08-06 18:00:00+00',
   '2026-08-06 18:00:00+00', null),
  ('40000000-0000-4000-8000-000000000002',
   '20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001',
   '30000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000002',
   null, null, null, 'Community Cleanup', 'Collected litter in a supervised park cleanup.',
   '2026-08-20', 3.25, 'pending', 'seed-member-pending', 1,
   '2026-08-20 18:00:00+00', '2026-08-20 18:05:00+00',
   '2026-08-20 18:05:00+00', null, null),
  ('40000000-0000-4000-8000-000000000003',
   '20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001',
   '30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002',
   null, null, null, 'Tutoring Draft', 'Draft entry for peer tutoring.', '2026-08-22', 2.00,
   'draft', 'seed-member-draft', 1, '2026-08-22 18:00:00+00', null,
   '2026-08-22 18:00:00+00', null, null),
  ('40000000-0000-4000-8000-000000000004',
   '20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001',
   '30000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000002',
   null, null, '20000000-0000-4000-8000-000000000002', 'Food Pantry',
   'Sorted pantry donations after school.', '2026-08-12', 1.50,
   'changes_requested', 'seed-member-changes', 1, '2026-08-12 18:00:00+00',
   '2026-08-12 18:05:00+00', '2026-08-13 18:00:00+00',
   '2026-08-13 18:00:00+00', null),
  ('40000000-0000-4000-8000-000000000005',
   '20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001',
   '30000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000002',
   '20000000-0000-4000-8000-000000000002', '2026-08-11 17:00:00+00',
   '20000000-0000-4000-8000-000000000001', 'Summer Community Program',
   'Supported a multi-day youth program.', '2026-08-10', 12.00,
   'approved', 'seed-leader-approved', 1, '2026-08-10 18:00:00+00',
   '2026-08-10 18:05:00+00', '2026-08-11 18:00:00+00',
   '2026-08-11 18:00:00+00', null)
on conflict (id) do nothing;

insert into public.hour_reviews (
  id,
  hour_request_id, school_year_id, action, actor_membership_id,
  reviewer_membership_id, previous_status, new_status,
  previous_requested_approver_membership_id, new_requested_approver_membership_id,
  comment, created_at
)
overriding system value
values
  (-1001, '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
   'submitted', '20000000-0000-4000-8000-000000000003', null, 'draft', 'pending',
   null, '20000000-0000-4000-8000-000000000002', null, '2026-08-05 18:05:00+00'),
  (-1002, '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
   'committee_approved', '20000000-0000-4000-8000-000000000002',
   '20000000-0000-4000-8000-000000000002', 'pending', 'pending',
   '20000000-0000-4000-8000-000000000002',
   '20000000-0000-4000-8000-000000000002', 'Verified by committee head.',
   '2026-08-06 17:00:00+00'),
  (-1006, '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
   'approved', '20000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001', 'pending', 'approved',
   '20000000-0000-4000-8000-000000000002',
   '20000000-0000-4000-8000-000000000002', 'Final teacher approval.',
   '2026-08-06 18:00:00+00'),
  (-1003, '40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
   'submitted', '20000000-0000-4000-8000-000000000003', null, 'draft', 'pending',
   null, '20000000-0000-4000-8000-000000000002', null, '2026-08-20 18:05:00+00'),
  (-1004, '40000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001',
   'changes_requested', '20000000-0000-4000-8000-000000000002',
   '20000000-0000-4000-8000-000000000002', 'pending', 'changes_requested',
   '20000000-0000-4000-8000-000000000002',
   '20000000-0000-4000-8000-000000000002',
   'Please add the supervising organization.', '2026-08-13 18:00:00+00'),
  (-1005, '40000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001',
   'committee_approved', '20000000-0000-4000-8000-000000000002',
   '20000000-0000-4000-8000-000000000002', 'pending', 'pending',
   '20000000-0000-4000-8000-000000000002',
   '20000000-0000-4000-8000-000000000002', 'Verified by committee head.',
   '2026-08-11 17:00:00+00'),
  (-1007, '40000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001',
   'approved', '20000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001', 'pending', 'approved',
   '20000000-0000-4000-8000-000000000002',
   '20000000-0000-4000-8000-000000000002', 'Final teacher approval.',
   '2026-08-11 18:00:00+00')
on conflict (id) do nothing;

insert into public.audit_events (
  id,
  actor_profile_id, actor_membership_id, action, entity_type, entity_id,
  school_year_id, metadata, occurred_at
)
overriding system value
values (
  -1001,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001',
  '20000000-0000-4000-8000-000000000001',
  'seed.loaded', 'school_year', '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '{"environment":"local","contains_real_credentials":false}',
  '2026-08-28 12:00:00+00'
)
on conflict (id) do nothing;

commit;
