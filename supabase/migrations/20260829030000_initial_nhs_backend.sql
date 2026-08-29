begin;

create schema if not exists extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Static role definitions are intentionally data-driven while role assignments remain
-- year-bound through membership_roles.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  email extensions.citext not null,
  full_name text not null,
  status text not null default 'active',
  deactivated_at timestamptz,
  deactivated_by_profile_id uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint profiles_email_not_blank check (length(btrim(email::text)) between 3 and 320),
  constraint profiles_full_name_length check (length(btrim(full_name)) between 1 and 200),
  constraint profiles_status_valid check (status in ('active', 'inactive')),
  constraint profiles_deactivation_consistent check (
    (status = 'active' and deactivated_at is null)
    or (status = 'inactive' and deactivated_at is not null)
  )
);

create unique index profiles_email_unique_idx on public.profiles (lower(email::text));
create index profiles_status_idx on public.profiles (status, full_name);

create table public.school_years (
  id uuid primary key default gen_random_uuid(),
  label extensions.citext not null,
  start_date date not null,
  end_date date not null,
  default_target_hours numeric(7, 2) not null default 20.00,
  status text not null default 'draft',
  created_by_profile_id uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  closed_at timestamptz,
  closed_by_profile_id uuid references public.profiles (id) on delete restrict,
  constraint school_years_label_format check (label::text ~ '^[0-9]{4}-[0-9]{4}$'),
  constraint school_years_date_order check (start_date <= end_date),
  constraint school_years_target_nonnegative check (
    default_target_hours >= 0 and mod(default_target_hours, 0.25) = 0
  ),
  constraint school_years_status_valid check (status in ('draft', 'active', 'closed', 'archived')),
  constraint school_years_closed_fields_consistent check (
    (status in ('draft', 'active') and closed_at is null and closed_by_profile_id is null)
    or (status in ('closed', 'archived') and closed_at is not null)
  )
);

create unique index school_years_label_unique_idx on public.school_years (lower(label::text));
create index school_years_dates_idx on public.school_years (start_date, end_date);
create index school_years_status_idx on public.school_years (status);
create index school_years_created_by_profile_id_idx on public.school_years (created_by_profile_id);
create index school_years_closed_by_profile_id_idx on public.school_years (closed_by_profile_id);

create table public.school_year_memberships (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete restrict,
  school_year_id uuid not null references public.school_years (id) on delete restrict,
  status text not null default 'active',
  expiration_date date not null,
  target_hours_override numeric(7, 2),
  renewed_from_membership_id uuid references public.school_year_memberships (id) on delete restrict,
  created_by_profile_id uuid references public.profiles (id) on delete restrict,
  status_changed_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint school_year_memberships_profile_year_unique unique (profile_id, school_year_id),
  constraint school_year_memberships_id_year_unique unique (id, school_year_id),
  constraint school_year_memberships_status_valid check (
    status in ('active', 'expired', 'suspended', 'archived')
  ),
  constraint school_year_memberships_target_nonnegative check (
    target_hours_override is null
    or (target_hours_override >= 0 and mod(target_hours_override, 0.25) = 0)
  ),
  constraint school_year_memberships_not_self_renewed check (
    renewed_from_membership_id is null or renewed_from_membership_id <> id
  )
);

create index school_year_memberships_profile_id_idx
  on public.school_year_memberships (profile_id, school_year_id);
create index school_year_memberships_school_year_status_idx
  on public.school_year_memberships (school_year_id, status, expiration_date);
create index school_year_memberships_renewed_from_idx
  on public.school_year_memberships (renewed_from_membership_id)
  where renewed_from_membership_id is not null;
create index school_year_memberships_created_by_idx
  on public.school_year_memberships (created_by_profile_id)
  where created_by_profile_id is not null;

create table public.roles (
  id smallint generated always as identity primary key,
  role_key text not null unique,
  display_name text not null,
  is_review_capable boolean not null default false,
  is_teacher_admin boolean not null default false,
  display_order smallint not null default 0,
  created_at timestamptz not null default statement_timestamp(),
  constraint roles_key_valid check (
    role_key in ('member', 'committee_head', 'president', 'vice_president', 'teacher_admin')
  ),
  constraint roles_display_name_not_blank check (length(btrim(display_name)) between 1 and 100),
  constraint roles_teacher_admin_capability check (not is_teacher_admin or is_review_capable)
);

create table public.membership_roles (
  membership_id uuid not null references public.school_year_memberships (id) on delete restrict,
  role_id smallint not null references public.roles (id) on delete restrict,
  assigned_by_profile_id uuid references public.profiles (id) on delete restrict,
  assigned_at timestamptz not null default statement_timestamp(),
  primary key (membership_id, role_id)
);

create index membership_roles_role_id_idx on public.membership_roles (role_id, membership_id);
create index membership_roles_assigned_by_profile_id_idx
  on public.membership_roles (assigned_by_profile_id)
  where assigned_by_profile_id is not null;

create table public.service_categories (
  id uuid primary key default gen_random_uuid(),
  name extensions.citext not null,
  description text,
  display_order integer not null default 0,
  is_active boolean not null default true,
  default_max_hours_per_request numeric(7, 2),
  created_by_profile_id uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint service_categories_name_length check (length(btrim(name::text)) between 1 and 120),
  constraint service_categories_description_length check (
    description is null or length(description) <= 2000
  ),
  constraint service_categories_display_order_nonnegative check (display_order >= 0),
  constraint service_categories_default_request_cap_valid check (
    default_max_hours_per_request is null
    or (
      default_max_hours_per_request > 0
      and default_max_hours_per_request <= 24
      and mod(default_max_hours_per_request, 0.25) = 0
    )
  )
);

create unique index service_categories_active_name_unique_idx
  on public.service_categories (lower(name::text)) where is_active;
create index service_categories_active_order_idx
  on public.service_categories (is_active, display_order, name);
create index service_categories_created_by_profile_id_idx
  on public.service_categories (created_by_profile_id)
  where created_by_profile_id is not null;

-- Production reference data belongs in the migration rather than the synthetic
-- development seed.  Fixed identifiers keep exports, tests, and later
-- school-year mappings stable; no demo profile is attributed as the creator.
insert into public.service_categories (
  id, name, description, display_order, is_active,
  default_max_hours_per_request, created_by_profile_id
)
values
  (
    '30000000-0000-4000-8000-000000000001', 'Green Team',
    'Environmental service projects sponsored by the Green Team.',
    10, true, 12.50, null
  ),
  (
    '30000000-0000-4000-8000-000000000002', 'Peer Tutoring',
    'Approved peer tutoring and academic support.',
    20, true, 12.00, null
  ),
  (
    '30000000-0000-4000-8000-000000000003', 'Concessions',
    'Volunteer shifts supporting school concession operations.',
    30, true, 12.00, null
  ),
  (
    '30000000-0000-4000-8000-000000000004', 'Fundraising & Events',
    'Fundraising, setup, cleanup, and event support.',
    40, true, 12.00, null
  ),
  (
    '30000000-0000-4000-8000-000000000005', 'Community Service',
    'Service performed for community organizations.',
    50, true, 12.00, null
  )
on conflict (id) do update
set name = excluded.name,
    description = excluded.description,
    display_order = excluded.display_order,
    is_active = excluded.is_active,
    default_max_hours_per_request = excluded.default_max_hours_per_request;

create table public.school_year_categories (
  school_year_id uuid not null references public.school_years (id) on delete restrict,
  category_id uuid not null references public.service_categories (id) on delete restrict,
  is_available boolean not null default true,
  display_order integer not null default 0,
  max_hours_per_request numeric(7, 2),
  member_approved_hours_cap numeric(7, 2),
  created_by_profile_id uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (school_year_id, category_id),
  constraint school_year_categories_display_order_nonnegative check (display_order >= 0),
  constraint school_year_categories_request_cap_valid check (
    max_hours_per_request is null
    or (
      max_hours_per_request > 0
      and max_hours_per_request <= 24
      and mod(max_hours_per_request, 0.25) = 0
    )
  ),
  constraint school_year_categories_member_cap_valid check (
    member_approved_hours_cap is null
    or (member_approved_hours_cap > 0 and mod(member_approved_hours_cap, 0.25) = 0)
  )
);

create index school_year_categories_category_id_idx
  on public.school_year_categories (category_id, school_year_id);
create index school_year_categories_available_idx
  on public.school_year_categories (school_year_id, display_order, category_id)
  where is_available;
create index school_year_categories_created_by_idx
  on public.school_year_categories (created_by_profile_id)
  where created_by_profile_id is not null;

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  email extensions.citext not null,
  full_name text not null,
  school_year_id uuid not null references public.school_years (id) on delete restrict,
  status text not null default 'pending',
  expires_at timestamptz not null,
  invited_by_membership_id uuid not null references public.school_year_memberships (id) on delete restrict,
  accepted_by_profile_id uuid references public.profiles (id) on delete restrict,
  accepted_at timestamptz,
  revoked_at timestamptz,
  revoked_by_membership_id uuid references public.school_year_memberships (id) on delete restrict,
  sent_at timestamptz,
  send_count integer not null default 0,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint invitations_email_not_blank check (length(btrim(email::text)) between 3 and 320),
  constraint invitations_full_name_length check (length(btrim(full_name)) between 1 and 200),
  constraint invitations_status_valid check (status in ('pending', 'accepted', 'revoked', 'expired')),
  constraint invitations_send_count_nonnegative check (send_count >= 0),
  constraint invitations_send_metadata_consistent check (
    (send_count = 0 and sent_at is null)
    or (send_count > 0 and sent_at is not null and sent_at < expires_at)
  ),
  constraint invitations_status_fields_consistent check (
    (status = 'pending' and accepted_at is null and revoked_at is null)
    or (status = 'accepted' and accepted_at is not null and accepted_by_profile_id is not null and revoked_at is null)
    or (status = 'revoked' and revoked_at is not null and revoked_by_membership_id is not null and accepted_at is null)
    or (status = 'expired' and accepted_at is null and revoked_at is null)
  )
);

create unique index invitations_pending_email_year_unique_idx
  on public.invitations (lower(email::text), school_year_id) where status = 'pending';
create index invitations_school_year_status_idx
  on public.invitations (school_year_id, status, expires_at);
create index invitations_invited_by_idx on public.invitations (invited_by_membership_id);
create index invitations_accepted_by_idx
  on public.invitations (accepted_by_profile_id) where accepted_by_profile_id is not null;
create index invitations_revoked_by_idx
  on public.invitations (revoked_by_membership_id) where revoked_by_membership_id is not null;

create table public.invitation_roles (
  invitation_id uuid not null references public.invitations (id) on delete cascade,
  role_id smallint not null references public.roles (id) on delete restrict,
  primary key (invitation_id, role_id)
);

create index invitation_roles_role_id_idx on public.invitation_roles (role_id, invitation_id);

create table public.hour_requests (
  id uuid primary key default gen_random_uuid(),
  member_membership_id uuid not null,
  school_year_id uuid not null,
  category_id uuid,
  requested_approver_membership_id uuid,
  actual_reviewer_membership_id uuid,
  title text,
  description text,
  service_date date,
  hours numeric(7, 2),
  status text not null default 'draft',
  client_submission_key text,
  revision integer not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  submitted_at timestamptz,
  updated_at timestamptz not null default statement_timestamp(),
  decided_at timestamptz,
  withdrawn_at timestamptz,
  constraint hour_requests_member_year_fkey
    foreign key (member_membership_id, school_year_id)
    references public.school_year_memberships (id, school_year_id) on delete restrict,
  constraint hour_requests_category_year_fkey
    foreign key (school_year_id, category_id)
    references public.school_year_categories (school_year_id, category_id) on delete restrict,
  constraint hour_requests_requested_approver_year_fkey
    foreign key (requested_approver_membership_id, school_year_id)
    references public.school_year_memberships (id, school_year_id) on delete restrict,
  constraint hour_requests_actual_reviewer_year_fkey
    foreign key (actual_reviewer_membership_id, school_year_id)
    references public.school_year_memberships (id, school_year_id) on delete restrict,
  constraint hour_requests_status_valid check (
    status in ('draft', 'pending', 'changes_requested', 'approved', 'rejected', 'withdrawn')
  ),
  constraint hour_requests_title_length check (
    title is null or length(btrim(title)) between 1 and 160
  ),
  constraint hour_requests_description_length check (
    description is null or length(btrim(description)) between 1 and 4000
  ),
  constraint hour_requests_hours_valid check (
    hours is null or (hours > 0 and hours <= 24 and mod(hours, 0.25) = 0)
  ),
  constraint hour_requests_client_key_length check (
    client_submission_key is null or length(client_submission_key) between 8 and 200
  ),
  constraint hour_requests_revision_positive check (revision >= 1),
  constraint hour_requests_requested_reviewer_not_self check (
    requested_approver_membership_id is null
    or requested_approver_membership_id <> member_membership_id
  ),
  constraint hour_requests_actual_reviewer_not_self check (
    actual_reviewer_membership_id is null
    or actual_reviewer_membership_id <> member_membership_id
  ),
  constraint hour_requests_complete_when_not_draft check (
    status = 'draft'
    or (
      title is not null
      and description is not null
      and category_id is not null
      and service_date is not null
      and hours is not null
      and requested_approver_membership_id is not null
      and submitted_at is not null
    )
  ),
  constraint hour_requests_decision_fields_consistent check (
    (status in ('approved', 'rejected', 'changes_requested')
      and actual_reviewer_membership_id is not null and decided_at is not null)
    or (status not in ('approved', 'rejected', 'changes_requested')
      and actual_reviewer_membership_id is null and decided_at is null)
  ),
  constraint hour_requests_withdrawal_fields_consistent check (
    (status = 'withdrawn' and withdrawn_at is not null)
    or (status <> 'withdrawn' and withdrawn_at is null)
  ),
  constraint hour_requests_draft_submission_consistent check (
    status <> 'draft' or submitted_at is null
  )
);

create unique index hour_requests_member_client_key_unique_idx
  on public.hour_requests (member_membership_id, client_submission_key)
  where client_submission_key is not null;
create index hour_requests_member_status_updated_idx
  on public.hour_requests (member_membership_id, status, updated_at desc);
create index hour_requests_school_year_status_submitted_idx
  on public.hour_requests (school_year_id, status, submitted_at);
create index hour_requests_requested_approver_pending_idx
  on public.hour_requests (requested_approver_membership_id, submitted_at)
  where status = 'pending';
create index hour_requests_actual_reviewer_idx
  on public.hour_requests (actual_reviewer_membership_id, decided_at desc)
  where actual_reviewer_membership_id is not null;
create index hour_requests_category_status_idx
  on public.hour_requests (school_year_id, category_id, status, member_membership_id);
create index hour_requests_service_date_idx
  on public.hour_requests (school_year_id, service_date desc);

create table public.hour_reviews (
  id bigint generated always as identity primary key,
  hour_request_id uuid not null references public.hour_requests (id) on delete restrict,
  school_year_id uuid not null references public.school_years (id) on delete restrict,
  action text not null,
  actor_membership_id uuid not null references public.school_year_memberships (id) on delete restrict,
  reviewer_membership_id uuid references public.school_year_memberships (id) on delete restrict,
  previous_status text,
  new_status text,
  previous_requested_approver_membership_id uuid references public.school_year_memberships (id) on delete restrict,
  new_requested_approver_membership_id uuid references public.school_year_memberships (id) on delete restrict,
  comment text,
  created_at timestamptz not null default statement_timestamp(),
  constraint hour_reviews_action_valid check (
    action in (
      'submitted', 'resubmitted', 'approved', 'changes_requested', 'rejected',
      'reassigned', 'withdrawn', 'corrected'
    )
  ),
  constraint hour_reviews_previous_status_valid check (
    previous_status is null
    or previous_status in ('draft', 'pending', 'changes_requested', 'approved', 'rejected', 'withdrawn')
  ),
  constraint hour_reviews_new_status_valid check (
    new_status is null
    or new_status in ('draft', 'pending', 'changes_requested', 'approved', 'rejected', 'withdrawn')
  ),
  constraint hour_reviews_comment_length check (comment is null or length(comment) <= 4000),
  constraint hour_reviews_required_comment check (
    action not in ('changes_requested', 'rejected')
    or length(btrim(coalesce(comment, ''))) > 0
  ),
  constraint hour_reviews_reviewer_required check (
    (action in ('approved', 'changes_requested', 'rejected', 'reassigned', 'corrected')
      and reviewer_membership_id is not null)
    or (action in ('submitted', 'resubmitted', 'withdrawn') and reviewer_membership_id is null)
  )
);

create index hour_reviews_request_created_idx
  on public.hour_reviews (hour_request_id, created_at, id);
create index hour_reviews_school_year_created_idx
  on public.hour_reviews (school_year_id, created_at desc);
create index hour_reviews_actor_membership_idx
  on public.hour_reviews (actor_membership_id, created_at desc);
create index hour_reviews_reviewer_membership_idx
  on public.hour_reviews (reviewer_membership_id, created_at desc)
  where reviewer_membership_id is not null;

create table public.hour_request_corrections (
  id bigint generated always as identity primary key,
  hour_request_id uuid not null references public.hour_requests (id) on delete restrict,
  corrected_by_membership_id uuid not null references public.school_year_memberships (id) on delete restrict,
  reason text not null,
  before_values jsonb not null,
  after_values jsonb not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint hour_request_corrections_reason_length check (length(btrim(reason)) between 1 and 2000),
  constraint hour_request_corrections_before_object check (jsonb_typeof(before_values) = 'object'),
  constraint hour_request_corrections_after_object check (jsonb_typeof(after_values) = 'object'),
  constraint hour_request_corrections_changed check (before_values is distinct from after_values)
);

create index hour_request_corrections_request_created_idx
  on public.hour_request_corrections (hour_request_id, created_at, id);
create index hour_request_corrections_actor_idx
  on public.hour_request_corrections (corrected_by_membership_id, created_at desc);

create table public.audit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default statement_timestamp(),
  actor_profile_id uuid references public.profiles (id) on delete restrict,
  actor_membership_id uuid references public.school_year_memberships (id) on delete restrict,
  action text not null,
  entity_type text not null,
  entity_id text,
  school_year_id uuid references public.school_years (id) on delete restrict,
  old_values jsonb,
  new_values jsonb,
  metadata jsonb not null default '{}'::jsonb,
  constraint audit_events_action_format check (action ~ '^[a-z0-9_]+(\.[a-z0-9_]+)+$'),
  constraint audit_events_entity_type_format check (entity_type ~ '^[a-z0-9_]+$'),
  constraint audit_events_old_values_object check (
    old_values is null or jsonb_typeof(old_values) = 'object'
  ),
  constraint audit_events_new_values_object check (
    new_values is null or jsonb_typeof(new_values) = 'object'
  ),
  constraint audit_events_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index audit_events_occurred_at_idx on public.audit_events (occurred_at desc, id desc);
create index audit_events_actor_profile_idx
  on public.audit_events (actor_profile_id, occurred_at desc)
  where actor_profile_id is not null;
create index audit_events_actor_membership_idx
  on public.audit_events (actor_membership_id, occurred_at desc)
  where actor_membership_id is not null;
create index audit_events_entity_idx on public.audit_events (entity_type, entity_id, occurred_at desc);
create index audit_events_school_year_idx
  on public.audit_events (school_year_id, occurred_at desc)
  where school_year_id is not null;
create unique index audit_events_invitation_send_idempotency_unique_idx
  on public.audit_events (entity_id, (metadata ->> 'send_idempotency_key'))
  where entity_type = 'invitation'
    and action in ('invitation.sent', 'invitation.resent')
    and metadata ? 'send_idempotency_key';

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_by_profile_id uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint app_settings_key_format check (key ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint app_settings_description_length check (
    description is null or length(description) <= 1000
  )
);

create index app_settings_updated_by_profile_id_idx
  on public.app_settings (updated_by_profile_id)
  where updated_by_profile_id is not null;

insert into public.roles (
  role_key,
  display_name,
  is_review_capable,
  is_teacher_admin,
  display_order
)
values
  ('member', 'Member', false, false, 10),
  ('committee_head', 'Committee Head', true, false, 20),
  ('president', 'President', true, false, 30),
  ('vice_president', 'Vice President', true, false, 40),
  ('teacher_admin', 'Teacher Administrator', true, true, 50)
on conflict (role_key) do update
set
  display_name = excluded.display_name,
  is_review_capable = excluded.is_review_capable,
  is_teacher_admin = excluded.is_teacher_admin,
  display_order = excluded.display_order;

insert into public.app_settings (key, value, description)
values
  (
    'public_signup_enabled',
    'false'::jsonb,
    'Defense-in-depth application flag. Supabase Auth signup must also be disabled in config and hosted project settings.'
  ),
  (
    'allowed_email_domains',
    '[]'::jsonb,
    'Optional lowercase school email-domain allowlist. An empty list delegates domain policy to server configuration.'
  )
on conflict (key) do nothing;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create trigger school_years_set_updated_at
before update on public.school_years
for each row execute function private.set_updated_at();

create trigger school_year_memberships_set_updated_at
before update on public.school_year_memberships
for each row execute function private.set_updated_at();

create trigger service_categories_set_updated_at
before update on public.service_categories
for each row execute function private.set_updated_at();

create trigger school_year_categories_set_updated_at
before update on public.school_year_categories
for each row execute function private.set_updated_at();

create trigger invitations_set_updated_at
before update on public.invitations
for each row execute function private.set_updated_at();

create trigger hour_requests_set_updated_at
before update on public.hour_requests
for each row execute function private.set_updated_at();

create trigger app_settings_set_updated_at
before update on public.app_settings
for each row execute function private.set_updated_at();

create or replace function private.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid();
$$;

create or replace function private.membership_is_active(p_membership_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.school_year_memberships membership
    join public.school_years school_year on school_year.id = membership.school_year_id
    join public.profiles profile on profile.id = membership.profile_id
    where membership.id = p_membership_id
      and membership.status = 'active'
      and profile.status = 'active'
      and school_year.status = 'active'
      and current_date between school_year.start_date and school_year.end_date
      and current_date <= membership.expiration_date
  );
$$;

create or replace function private.membership_has_role(
  p_membership_id uuid,
  p_role_key text,
  p_require_active boolean default true
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (not p_require_active or private.membership_is_active(p_membership_id))
    and exists (
      select 1
      from public.membership_roles membership_role
      join public.roles role on role.id = membership_role.role_id
      where membership_role.membership_id = p_membership_id
        and role.role_key = p_role_key
    );
$$;

create or replace function private.current_membership_id(
  p_school_year_id uuid,
  p_require_active boolean default true
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select membership.id
  from public.school_year_memberships membership
  where membership.profile_id = auth.uid()
    and membership.school_year_id = p_school_year_id
    and (not p_require_active or private.membership_is_active(membership.id))
  limit 1;
$$;

create or replace function private.is_review_capable_membership(
  p_membership_id uuid,
  p_school_year_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.membership_is_active(p_membership_id)
    and exists (
      select 1
      from public.school_year_memberships membership
      join public.membership_roles membership_role on membership_role.membership_id = membership.id
      join public.roles role on role.id = membership_role.role_id
      where membership.id = p_membership_id
        and membership.school_year_id = p_school_year_id
        and role.is_review_capable
    );
$$;

create or replace function private.current_actor_is_review_capable(p_school_year_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    private.is_review_capable_membership(
      private.current_membership_id(p_school_year_id, true),
      p_school_year_id
    ),
    false
  );
$$;

create or replace function private.current_teacher_admin_membership_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select membership.id
  from public.school_year_memberships membership
  join public.membership_roles membership_role on membership_role.membership_id = membership.id
  join public.roles role on role.id = membership_role.role_id
  where membership.profile_id = auth.uid()
    and private.membership_is_active(membership.id)
    and role.is_teacher_admin
  order by membership.created_at desc
  limit 1;
$$;

create or replace function private.current_actor_is_teacher_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_teacher_admin_membership_id() is not null;
$$;

create or replace function private.can_view_membership(p_membership_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.school_year_memberships target_membership
    where target_membership.id = p_membership_id
      and (
        target_membership.profile_id = auth.uid()
        or private.current_actor_is_teacher_admin()
        or (
          private.membership_is_active(target_membership.id)
          and private.current_actor_is_review_capable(target_membership.school_year_id)
        )
      )
  );
$$;

create or replace function private.can_view_hour_request(p_hour_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.hour_requests request
    join public.school_year_memberships membership
      on membership.id = request.member_membership_id
    where request.id = p_hour_request_id
      and (
        membership.profile_id = auth.uid()
        or private.current_actor_is_teacher_admin()
        or (
          private.membership_is_active(membership.id)
          and private.current_actor_is_review_capable(request.school_year_id)
        )
      )
  );
$$;

create or replace function private.email_domain_allowed(p_email text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  allowed_domains jsonb;
  email_domain text;
begin
  select value into allowed_domains
  from public.app_settings
  where key = 'allowed_email_domains';

  if allowed_domains is null
    or jsonb_typeof(allowed_domains) <> 'array'
    or jsonb_array_length(allowed_domains) = 0 then
    return true;
  end if;

  email_domain := lower(split_part(p_email, '@', 2));
  return exists (
    select 1
    from jsonb_array_elements_text(allowed_domains) domain_name
    where lower(domain_name) = email_domain
  );
end;
$$;

create or replace function private.write_audit(
  p_action text,
  p_entity_type text,
  p_entity_id text default null,
  p_school_year_id uuid default null,
  p_actor_membership_id uuid default null,
  p_old_values jsonb default null,
  p_new_values jsonb default null,
  p_metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_id bigint;
  actor_profile_id uuid;
begin
  if p_actor_membership_id is not null then
    select profile_id into actor_profile_id
    from public.school_year_memberships
    where id = p_actor_membership_id;
  end if;
  actor_profile_id := coalesce(actor_profile_id, auth.uid());

  insert into public.audit_events (
    actor_profile_id,
    actor_membership_id,
    action,
    entity_type,
    entity_id,
    school_year_id,
    old_values,
    new_values,
    metadata
  )
  values (
    actor_profile_id,
    p_actor_membership_id,
    p_action,
    p_entity_type,
    p_entity_id,
    p_school_year_id,
    p_old_values,
    p_new_values,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into event_id;

  return event_id;
end;
$$;

create or replace function private.validate_membership_dates()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  year_start date;
  year_end date;
  source_profile_id uuid;
  source_year_id uuid;
begin
  select start_date, end_date
  into year_start, year_end
  from public.school_years
  where id = new.school_year_id;

  if year_start is null then
    raise exception 'School year does not exist' using errcode = '23503';
  end if;
  if new.expiration_date < year_start or new.expiration_date > year_end then
    raise exception 'Membership expiration date must fall within its school year'
      using errcode = '23514';
  end if;

  if new.renewed_from_membership_id is not null then
    select profile_id, school_year_id
    into source_profile_id, source_year_id
    from public.school_year_memberships
    where id = new.renewed_from_membership_id;
    if source_profile_id is null then
      raise exception 'Renewed-from membership does not exist' using errcode = '23503';
    end if;
    if source_profile_id <> new.profile_id or source_year_id = new.school_year_id then
      raise exception 'Renewal must reference the same profile in a different school year'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.status_changed_at := statement_timestamp();
  end if;
  return new;
end;
$$;

create trigger school_year_memberships_validate_dates
before insert or update on public.school_year_memberships
for each row execute function private.validate_membership_dates();

create or replace function private.prevent_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% records are immutable', tg_table_name using errcode = '55000';
end;
$$;

create trigger hour_reviews_immutable
before update or delete on public.hour_reviews
for each row execute function private.prevent_mutation();

create trigger hour_request_corrections_immutable
before update or delete on public.hour_request_corrections
for each row execute function private.prevent_mutation();

create trigger audit_events_immutable
before update or delete on public.audit_events
for each row execute function private.prevent_mutation();

create or replace function private.protect_hour_request()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  transition_allowed boolean := coalesce(
    current_setting('nhs.allow_hour_request_transition', true),
    ''
  ) = 'on';
  correction_allowed boolean := coalesce(
    current_setting('nhs.allow_approved_correction', true),
    ''
  ) = 'on';
begin
  if tg_op = 'DELETE' then
    raise exception 'Hour requests cannot be deleted' using errcode = '55000';
  end if;

  if tg_op = 'INSERT' and not transition_allowed then
    raise exception 'Hour requests must be created through an authorized function'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if old.status = 'approved' and not correction_allowed then
      raise exception 'Approved hour requests require the correction procedure'
        using errcode = '55000';
    end if;

    if not transition_allowed and (
      new.member_membership_id is distinct from old.member_membership_id
      or new.school_year_id is distinct from old.school_year_id
      or new.status is distinct from old.status
      or new.requested_approver_membership_id is distinct from old.requested_approver_membership_id
      or new.actual_reviewer_membership_id is distinct from old.actual_reviewer_membership_id
      or new.submitted_at is distinct from old.submitted_at
      or new.decided_at is distinct from old.decided_at
      or new.withdrawn_at is distinct from old.withdrawn_at
    ) then
      raise exception 'Protected hour-request fields require an authorized function'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger hour_requests_protect
before insert or update or delete on public.hour_requests
for each row execute function private.protect_hour_request();

create or replace function private.assert_request_values(
  p_school_year_id uuid,
  p_member_membership_id uuid,
  p_category_id uuid,
  p_requested_approver_membership_id uuid,
  p_title text,
  p_description text,
  p_service_date date,
  p_hours numeric,
  p_require_open_year boolean default true,
  p_require_available_category boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  year_record public.school_years%rowtype;
  request_cap numeric(7, 2);
  category_active boolean;
  category_available boolean;
begin
  select * into year_record
  from public.school_years
  where id = p_school_year_id;
  if not found then
    raise exception 'School year does not exist' using errcode = '22023';
  end if;

  if p_require_open_year and (
    year_record.status <> 'active'
    or current_date < year_record.start_date
    or current_date > year_record.end_date
  ) then
    raise exception 'School year is not accepting submissions' using errcode = '55000';
  end if;

  if p_require_open_year and not private.membership_is_active(p_member_membership_id) then
    raise exception 'Member does not have active access for this school year'
      using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.school_year_memberships membership
    where membership.id = p_member_membership_id
      and membership.school_year_id = p_school_year_id
  ) then
    raise exception 'Member membership belongs to a different school year'
      using errcode = '22023';
  end if;

  if length(btrim(coalesce(p_title, ''))) < 1 or length(btrim(p_title)) > 160 then
    raise exception 'Title is required and must not exceed 160 characters'
      using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_description, ''))) < 1 or length(btrim(p_description)) > 4000 then
    raise exception 'Description is required and must not exceed 4000 characters'
      using errcode = '22023';
  end if;
  if p_service_date is null
    or p_service_date < year_record.start_date
    or p_service_date > year_record.end_date
    or p_service_date > current_date then
    raise exception 'Service date must be within the school year and not in the future'
      using errcode = '22023';
  end if;
  if p_hours is null or p_hours <= 0 or p_hours > 24 or mod(p_hours, 0.25) <> 0 then
    raise exception 'Hours must be a positive quarter-hour value no greater than 24'
      using errcode = '22023';
  end if;
  if p_category_id is null then
    raise exception 'Service category is required' using errcode = '22023';
  end if;

  select
    category.is_active,
    year_category.is_available,
    coalesce(year_category.max_hours_per_request, category.default_max_hours_per_request)
  into category_active, category_available, request_cap
  from public.service_categories category
  join public.school_year_categories year_category
    on year_category.category_id = category.id
   and year_category.school_year_id = p_school_year_id
  where category.id = p_category_id;

  if not found then
    raise exception 'Category is not configured for this school year' using errcode = '22023';
  end if;
  if p_require_available_category and (not category_active or not category_available) then
    raise exception 'Category is not available for new submissions' using errcode = '55000';
  end if;
  if request_cap is not null and p_hours > request_cap then
    raise exception 'Hours exceed this category''s per-request cap' using errcode = '23514';
  end if;

  if p_requested_approver_membership_id is null then
    raise exception 'Requested approver is required' using errcode = '22023';
  end if;
  if p_require_open_year and not private.is_review_capable_membership(
    p_requested_approver_membership_id,
    p_school_year_id
  ) then
    raise exception 'Requested approver is not an active reviewer for this school year'
      using errcode = '22023';
  end if;
  if p_requested_approver_membership_id = p_member_membership_id then
    raise exception 'A member cannot review their own request' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.assert_category_approval_cap(
  p_member_membership_id uuid,
  p_school_year_id uuid,
  p_category_id uuid,
  p_hours numeric,
  p_exclude_hour_request_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  approved_cap numeric(7, 2);
  existing_hours numeric(12, 2);
begin
  select member_approved_hours_cap
  into approved_cap
  from public.school_year_categories
  where school_year_id = p_school_year_id
    and category_id = p_category_id;

  if approved_cap is null then
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'nhs.category_cap:' || p_member_membership_id::text || ':' || p_category_id::text,
      0
    )
  );

  select coalesce(sum(request.hours), 0)
  into existing_hours
  from public.hour_requests request
  where request.member_membership_id = p_member_membership_id
    and request.school_year_id = p_school_year_id
    and request.category_id = p_category_id
    and request.status = 'approved'
    and (p_exclude_hour_request_id is null or request.id <> p_exclude_hour_request_id);

  if existing_hours + p_hours > approved_cap then
    raise exception 'Approval would exceed the member category cap of % hours', approved_cap
      using errcode = '23514';
  end if;
end;
$$;

create or replace function private.other_teacher_admin_exists(
  p_school_year_id uuid,
  p_excluded_membership_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.school_year_memberships membership
    join public.school_years school_year on school_year.id = membership.school_year_id
    join public.profiles profile on profile.id = membership.profile_id
    join public.membership_roles membership_role on membership_role.membership_id = membership.id
    join public.roles role on role.id = membership_role.role_id
    where membership.school_year_id = p_school_year_id
      and membership.id <> p_excluded_membership_id
      and membership.status = 'active'
      and membership.expiration_date >= greatest(current_date, school_year.start_date)
      and profile.status = 'active'
      and role.is_teacher_admin
  );
$$;

create or replace function private.protect_last_teacher_admin_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_membership_id uuid := old.membership_id;
  old_school_year_id uuid;
  old_membership_status text;
  old_profile_status text;
  old_role_is_admin boolean;
  year_status text;
begin
  select
    membership.school_year_id,
    membership.status,
    profile.status,
    role.is_teacher_admin,
    school_year.status
  into
    old_school_year_id,
    old_membership_status,
    old_profile_status,
    old_role_is_admin,
    year_status
  from public.school_year_memberships membership
  join public.profiles profile on profile.id = membership.profile_id
  join public.roles role on role.id = old.role_id
  join public.school_years school_year on school_year.id = membership.school_year_id
  where membership.id = old_membership_id;

  if coalesce(old_role_is_admin, false)
    and old_membership_status = 'active'
    and old_profile_status = 'active'
    and year_status in ('draft', 'active') then
    perform pg_advisory_xact_lock(hashtextextended('nhs.last_admin:' || old_school_year_id::text, 0));
    if not private.other_teacher_admin_exists(old_school_year_id, old_membership_id) then
      raise exception 'Cannot remove the last teacher administrator for this school year'
        using errcode = '23514';
    end if;
  end if;

  return old;
end;
$$;

create trigger membership_roles_protect_last_admin
before delete on public.membership_roles
for each row execute function private.protect_last_teacher_admin_role();

create or replace function private.protect_last_teacher_admin_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  has_admin_role boolean;
  profile_status text;
  year_record public.school_years%rowtype;
  losing_admin boolean;
begin
  select exists (
    select 1
    from public.membership_roles membership_role
    join public.roles role on role.id = membership_role.role_id
    where membership_role.membership_id = old.id
      and role.is_teacher_admin
  ) into has_admin_role;

  if not has_admin_role then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  select status into profile_status from public.profiles where id = old.profile_id;
  select * into year_record from public.school_years where id = old.school_year_id;
  losing_admin := tg_op = 'DELETE'
    or (old.status = 'active' and new.status <> 'active')
    or (
      new.expiration_date < greatest(current_date, year_record.start_date)
      and old.expiration_date >= greatest(current_date, year_record.start_date)
    );

  if losing_admin
    and old.status = 'active'
    and profile_status = 'active'
    and year_record.status in ('draft', 'active') then
    perform pg_advisory_xact_lock(hashtextextended('nhs.last_admin:' || old.school_year_id::text, 0));
    if not private.other_teacher_admin_exists(old.school_year_id, old.id) then
      raise exception 'Cannot deactivate or shorten the last teacher administrator membership'
        using errcode = '23514';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger school_year_memberships_protect_last_admin
before update or delete on public.school_year_memberships
for each row execute function private.protect_last_teacher_admin_membership();

create or replace function private.protect_last_teacher_admin_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_membership record;
begin
  if old.status = 'active' and new.status = 'inactive' then
    for admin_membership in
      select distinct membership.id, membership.school_year_id
      from public.school_year_memberships membership
      join public.membership_roles membership_role on membership_role.membership_id = membership.id
      join public.roles role on role.id = membership_role.role_id
      join public.school_years school_year on school_year.id = membership.school_year_id
      where membership.profile_id = old.id
        and membership.status = 'active'
        and role.is_teacher_admin
        and school_year.status in ('draft', 'active')
      order by membership.school_year_id, membership.id
    loop
      perform pg_advisory_xact_lock(
        hashtextextended('nhs.last_admin:' || admin_membership.school_year_id::text, 0)
      );
      if not private.other_teacher_admin_exists(
        admin_membership.school_year_id,
        admin_membership.id
      ) then
        raise exception 'Cannot deactivate the last teacher administrator profile'
          using errcode = '23514';
      end if;
    end loop;
  end if;
  return new;
end;
$$;

create trigger profiles_protect_last_admin
before update on public.profiles
for each row execute function private.protect_last_teacher_admin_profile();

create or replace function private.prevent_hard_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% records must be archived rather than deleted', tg_table_name
    using errcode = '55000';
end;
$$;

create trigger profiles_prevent_delete
before delete on public.profiles
for each row execute function private.prevent_hard_delete();

create trigger school_years_prevent_delete
before delete on public.school_years
for each row execute function private.prevent_hard_delete();

create trigger school_year_memberships_prevent_delete
before delete on public.school_year_memberships
for each row execute function private.prevent_hard_delete();

create trigger service_categories_prevent_delete
before delete on public.service_categories
for each row execute function private.prevent_hard_delete();

create trigger school_year_categories_prevent_delete
before delete on public.school_year_categories
for each row execute function private.prevent_hard_delete();

create trigger invitations_prevent_delete
before delete on public.invitations
for each row execute function private.prevent_hard_delete();

create or replace function private.prevent_role_definition_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Role definitions are fixed; change membership role assignments instead'
    using errcode = '55000';
end;
$$;

create trigger roles_fixed_definitions
before update or delete on public.roles
for each row execute function private.prevent_role_definition_mutation();

create or replace function private.validate_hour_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_record public.hour_requests%rowtype;
  actor_year_id uuid;
  reviewer_year_id uuid;
  actor_profile_id uuid;
  member_profile_id uuid;
begin
  select * into request_record
  from public.hour_requests
  where id = new.hour_request_id;
  if not found or request_record.school_year_id <> new.school_year_id then
    raise exception 'Review history must use the request school year' using errcode = '23514';
  end if;

  select school_year_id into actor_year_id
  from public.school_year_memberships
  where id = new.actor_membership_id;
  if new.action <> 'corrected' and actor_year_id <> new.school_year_id then
    raise exception 'Review actor must belong to the request school year' using errcode = '23514';
  end if;

  if new.reviewer_membership_id is not null then
    select school_year_id, profile_id into reviewer_year_id, actor_profile_id
    from public.school_year_memberships
    where id = new.reviewer_membership_id;
    select profile_id into member_profile_id
    from public.school_year_memberships
    where id = request_record.member_membership_id;
    if new.action <> 'corrected' and reviewer_year_id <> new.school_year_id then
      raise exception 'Reviewer must belong to the request school year' using errcode = '23514';
    end if;
    if new.reviewer_membership_id <> new.actor_membership_id then
      raise exception 'Reviewer must be the actor for a review event' using errcode = '23514';
    end if;
    if actor_profile_id = member_profile_id then
      raise exception 'A member cannot review their own request' using errcode = '42501';
    end if;
  elsif new.actor_membership_id <> request_record.member_membership_id then
    raise exception 'Member workflow events must be created by the request owner'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger hour_reviews_validate
before insert on public.hour_reviews
for each row execute function private.validate_hour_review();

create or replace function private.assert_partial_request_values(
  p_school_year_id uuid,
  p_member_membership_id uuid,
  p_category_id uuid,
  p_requested_approver_membership_id uuid,
  p_title text,
  p_description text,
  p_service_date date,
  p_hours numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  year_record public.school_years%rowtype;
  category_active boolean;
  category_available boolean;
  request_cap numeric(7, 2);
begin
  select * into year_record from public.school_years where id = p_school_year_id;
  if not found then
    raise exception 'School year does not exist' using errcode = '22023';
  end if;
  if not private.membership_is_active(p_member_membership_id) then
    raise exception 'Member does not have active access for this school year'
      using errcode = '42501';
  end if;

  if p_title is not null and length(btrim(p_title)) not between 1 and 160 then
    raise exception 'Title must contain 1 to 160 characters' using errcode = '22023';
  end if;
  if p_description is not null and length(btrim(p_description)) not between 1 and 4000 then
    raise exception 'Description must contain 1 to 4000 characters' using errcode = '22023';
  end if;
  if p_service_date is not null and (
    p_service_date < year_record.start_date
    or p_service_date > year_record.end_date
    or p_service_date > current_date
  ) then
    raise exception 'Service date must be within the school year and not in the future'
      using errcode = '22023';
  end if;
  if p_hours is not null and (p_hours <= 0 or p_hours > 24 or mod(p_hours, 0.25) <> 0) then
    raise exception 'Hours must be a positive quarter-hour value no greater than 24'
      using errcode = '22023';
  end if;

  if p_category_id is not null then
    select
      category.is_active,
      year_category.is_available,
      coalesce(year_category.max_hours_per_request, category.default_max_hours_per_request)
    into category_active, category_available, request_cap
    from public.service_categories category
    join public.school_year_categories year_category
      on year_category.category_id = category.id
     and year_category.school_year_id = p_school_year_id
    where category.id = p_category_id;
    if not found or not category_active or not category_available then
      raise exception 'Category is not available for this school year' using errcode = '22023';
    end if;
    if p_hours is not null and request_cap is not null and p_hours > request_cap then
      raise exception 'Hours exceed this category''s per-request cap' using errcode = '23514';
    end if;
  end if;

  if p_requested_approver_membership_id is not null then
    if p_requested_approver_membership_id = p_member_membership_id then
      raise exception 'A member cannot review their own request' using errcode = '42501';
    end if;
    if not private.is_review_capable_membership(
      p_requested_approver_membership_id,
      p_school_year_id
    ) then
      raise exception 'Requested approver is not an active reviewer for this school year'
        using errcode = '22023';
    end if;
  end if;
end;
$$;

create or replace function public.create_hour_request_draft(
  p_school_year_id uuid,
  p_title text default null,
  p_description text default null,
  p_category_id uuid default null,
  p_service_date date default null,
  p_hours numeric default null,
  p_requested_approver_membership_id uuid default null,
  p_client_submission_key text default null
)
returns public.hour_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_membership_id uuid;
  created_request public.hour_requests%rowtype;
  was_inserted boolean := false;
begin
  actor_membership_id := private.current_membership_id(p_school_year_id, true);
  if actor_membership_id is null then
    raise exception 'An active school-year membership is required' using errcode = '42501';
  end if;
  if not private.membership_has_role(actor_membership_id, 'member', true) then
    raise exception 'The member role is required to create hour requests' using errcode = '42501';
  end if;

  perform private.assert_partial_request_values(
    p_school_year_id,
    actor_membership_id,
    p_category_id,
    p_requested_approver_membership_id,
    p_title,
    p_description,
    p_service_date,
    p_hours
  );

  perform set_config('nhs.allow_hour_request_transition', 'on', true);
  insert into public.hour_requests (
    member_membership_id,
    school_year_id,
    category_id,
    requested_approver_membership_id,
    title,
    description,
    service_date,
    hours,
    client_submission_key
  )
  values (
    actor_membership_id,
    p_school_year_id,
    p_category_id,
    p_requested_approver_membership_id,
    nullif(btrim(p_title), ''),
    nullif(btrim(p_description), ''),
    p_service_date,
    p_hours,
    nullif(btrim(p_client_submission_key), '')
  )
  on conflict (member_membership_id, client_submission_key)
    where client_submission_key is not null
  do nothing
  returning * into created_request;

  was_inserted := created_request.id is not null;

  if created_request.id is null and p_client_submission_key is not null then
    select * into created_request
    from public.hour_requests
    where member_membership_id = actor_membership_id
      and client_submission_key = btrim(p_client_submission_key);
  end if;

  if created_request.id is null then
    raise exception 'Unable to create hour-request draft' using errcode = '40001';
  end if;

  if was_inserted then
    perform private.write_audit(
      'hour_request.draft_created',
      'hour_request',
      created_request.id::text,
      p_school_year_id,
      actor_membership_id,
      null,
      jsonb_build_object('status', 'draft')
    );
  end if;

  return created_request;
end;
$$;

create or replace function public.save_hour_request_draft(
  p_request_id uuid,
  p_expected_revision integer,
  p_title text,
  p_description text,
  p_category_id uuid,
  p_service_date date,
  p_hours numeric,
  p_requested_approver_membership_id uuid
)
returns public.hour_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_record public.hour_requests%rowtype;
  old_values jsonb;
begin
  select * into request_record
  from public.hour_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception 'Hour request not found' using errcode = 'P0002';
  end if;
  if p_expected_revision is null or request_record.revision <> p_expected_revision then
    raise exception 'Request revision is stale' using errcode = '40001';
  end if;
  if request_record.member_membership_id <> private.current_membership_id(
    request_record.school_year_id,
    true
  ) then
    raise exception 'Only the request owner may edit this request' using errcode = '42501';
  end if;
  if request_record.status not in ('draft', 'changes_requested') then
    raise exception 'Only drafts and changes-requested entries can be edited'
      using errcode = '55000';
  end if;

  perform private.assert_partial_request_values(
    request_record.school_year_id,
    request_record.member_membership_id,
    p_category_id,
    p_requested_approver_membership_id,
    p_title,
    p_description,
    p_service_date,
    p_hours
  );

  old_values := jsonb_build_object(
    'title', request_record.title,
    'description', request_record.description,
    'category_id', request_record.category_id,
    'service_date', request_record.service_date,
    'hours', request_record.hours,
    'requested_approver_membership_id', request_record.requested_approver_membership_id
  );

  perform set_config('nhs.allow_hour_request_transition', 'on', true);
  update public.hour_requests
  set
    title = nullif(btrim(p_title), ''),
    description = nullif(btrim(p_description), ''),
    category_id = p_category_id,
    service_date = p_service_date,
    hours = p_hours,
    requested_approver_membership_id = p_requested_approver_membership_id,
    revision = revision + 1
  where id = p_request_id
  returning * into request_record;

  perform private.write_audit(
    'hour_request.draft_saved',
    'hour_request',
    request_record.id::text,
    request_record.school_year_id,
    request_record.member_membership_id,
    old_values,
    jsonb_build_object(
      'title', request_record.title,
      'description', request_record.description,
      'category_id', request_record.category_id,
      'service_date', request_record.service_date,
      'hours', request_record.hours,
      'requested_approver_membership_id', request_record.requested_approver_membership_id,
      'revision', request_record.revision
    )
  );
  return request_record;
end;
$$;

create or replace function public.submit_hour_request(
  p_request_id uuid,
  p_expected_revision integer
)
returns public.hour_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_record public.hour_requests%rowtype;
  previous_status text;
  event_action text;
begin
  select * into request_record
  from public.hour_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception 'Hour request not found' using errcode = 'P0002';
  end if;
  if p_expected_revision is null or request_record.revision <> p_expected_revision then
    raise exception 'Request revision is stale' using errcode = '40001';
  end if;
  if request_record.member_membership_id <> private.current_membership_id(
    request_record.school_year_id,
    true
  ) then
    raise exception 'Only the request owner may submit this request' using errcode = '42501';
  end if;
  if request_record.status not in ('draft', 'changes_requested') then
    raise exception 'Request is not eligible for submission' using errcode = '55000';
  end if;

  perform private.assert_request_values(
    request_record.school_year_id,
    request_record.member_membership_id,
    request_record.category_id,
    request_record.requested_approver_membership_id,
    request_record.title,
    request_record.description,
    request_record.service_date,
    request_record.hours,
    true,
    true
  );

  previous_status := request_record.status;
  event_action := case when previous_status = 'draft' then 'submitted' else 'resubmitted' end;
  perform set_config('nhs.allow_hour_request_transition', 'on', true);
  update public.hour_requests
  set
    status = 'pending',
    submitted_at = statement_timestamp(),
    actual_reviewer_membership_id = null,
    decided_at = null,
    withdrawn_at = null,
    revision = case when previous_status = 'changes_requested' then revision + 1 else revision end
  where id = p_request_id
  returning * into request_record;

  insert into public.hour_reviews (
    hour_request_id,
    school_year_id,
    action,
    actor_membership_id,
    previous_status,
    new_status,
    new_requested_approver_membership_id
  )
  values (
    request_record.id,
    request_record.school_year_id,
    event_action,
    request_record.member_membership_id,
    previous_status,
    'pending',
    request_record.requested_approver_membership_id
  );

  perform private.write_audit(
    'hour_request.' || event_action,
    'hour_request',
    request_record.id::text,
    request_record.school_year_id,
    request_record.member_membership_id,
    jsonb_build_object('status', previous_status),
    jsonb_build_object(
      'status', 'pending',
      'revision', request_record.revision,
      'requested_approver_membership_id', request_record.requested_approver_membership_id
    )
  );

  return request_record;
end;
$$;

create or replace function public.withdraw_hour_request(
  p_request_id uuid,
  p_comment text default null
)
returns public.hour_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_record public.hour_requests%rowtype;
begin
  select * into request_record
  from public.hour_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception 'Hour request not found' using errcode = 'P0002';
  end if;
  if request_record.member_membership_id <> private.current_membership_id(
    request_record.school_year_id,
    true
  ) then
    raise exception 'Only the request owner may withdraw this request' using errcode = '42501';
  end if;
  if request_record.status <> 'pending' then
    raise exception 'Only a pending request can be withdrawn' using errcode = '55000';
  end if;
  if p_comment is not null and length(p_comment) > 4000 then
    raise exception 'Comment must not exceed 4000 characters' using errcode = '22023';
  end if;

  perform set_config('nhs.allow_hour_request_transition', 'on', true);
  update public.hour_requests
  set status = 'withdrawn', withdrawn_at = statement_timestamp()
  where id = p_request_id
  returning * into request_record;

  insert into public.hour_reviews (
    hour_request_id,
    school_year_id,
    action,
    actor_membership_id,
    previous_status,
    new_status,
    previous_requested_approver_membership_id,
    new_requested_approver_membership_id,
    comment
  )
  values (
    request_record.id,
    request_record.school_year_id,
    'withdrawn',
    request_record.member_membership_id,
    'pending',
    'withdrawn',
    request_record.requested_approver_membership_id,
    request_record.requested_approver_membership_id,
    nullif(btrim(p_comment), '')
  );

  perform private.write_audit(
    'hour_request.withdrawn',
    'hour_request',
    request_record.id::text,
    request_record.school_year_id,
    request_record.member_membership_id,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', 'withdrawn'),
    jsonb_build_object('comment_supplied', nullif(btrim(p_comment), '') is not null)
  );
  return request_record;
end;
$$;

create or replace function public.review_hour_request(
  p_request_id uuid,
  p_action text,
  p_comment text default null
)
returns public.hour_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_record public.hour_requests%rowtype;
  reviewer_membership_id uuid;
  new_status text;
  review_action text;
begin
  if p_action not in ('approve', 'request_changes', 'reject') then
    raise exception 'Review action must be approve, request_changes, or reject'
      using errcode = '22023';
  end if;
  if p_action in ('request_changes', 'reject')
    and length(btrim(coalesce(p_comment, ''))) = 0 then
    raise exception 'A reviewer comment is required for this action' using errcode = '22023';
  end if;
  if p_comment is not null and length(p_comment) > 4000 then
    raise exception 'Comment must not exceed 4000 characters' using errcode = '22023';
  end if;

  select * into request_record
  from public.hour_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception 'Hour request not found' using errcode = 'P0002';
  end if;
  if request_record.status <> 'pending' then
    raise exception 'Request is no longer pending' using errcode = '40001';
  end if;

  reviewer_membership_id := private.current_membership_id(request_record.school_year_id, true);
  if not private.is_review_capable_membership(
    reviewer_membership_id,
    request_record.school_year_id
  ) then
    raise exception 'An active review-capable role is required' using errcode = '42501';
  end if;
  if reviewer_membership_id = request_record.member_membership_id then
    raise exception 'A reviewer cannot process their own request' using errcode = '42501';
  end if;

  if p_action = 'approve' then
    new_status := 'approved';
    review_action := 'approved';
    perform private.assert_category_approval_cap(
      request_record.member_membership_id,
      request_record.school_year_id,
      request_record.category_id,
      request_record.hours,
      request_record.id
    );
  elsif p_action = 'request_changes' then
    new_status := 'changes_requested';
    review_action := 'changes_requested';
  else
    new_status := 'rejected';
    review_action := 'rejected';
  end if;

  perform set_config('nhs.allow_hour_request_transition', 'on', true);
  update public.hour_requests
  set
    status = new_status,
    actual_reviewer_membership_id = reviewer_membership_id,
    decided_at = statement_timestamp()
  where id = p_request_id
    and status = 'pending'
  returning * into request_record;
  if not found then
    raise exception 'Request was processed concurrently' using errcode = '40001';
  end if;

  insert into public.hour_reviews (
    hour_request_id,
    school_year_id,
    action,
    actor_membership_id,
    reviewer_membership_id,
    previous_status,
    new_status,
    previous_requested_approver_membership_id,
    new_requested_approver_membership_id,
    comment
  )
  values (
    request_record.id,
    request_record.school_year_id,
    review_action,
    reviewer_membership_id,
    reviewer_membership_id,
    'pending',
    new_status,
    request_record.requested_approver_membership_id,
    request_record.requested_approver_membership_id,
    nullif(btrim(p_comment), '')
  );

  perform private.write_audit(
    'hour_request.' || review_action,
    'hour_request',
    request_record.id::text,
    request_record.school_year_id,
    reviewer_membership_id,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object(
      'status', new_status,
      'actual_reviewer_membership_id', reviewer_membership_id,
      'hours', request_record.hours
    ),
    jsonb_build_object('assigned_reviewer_processed', reviewer_membership_id = request_record.requested_approver_membership_id)
  );
  return request_record;
end;
$$;

create or replace function public.reassign_hour_request(
  p_request_id uuid,
  p_new_reviewer_membership_id uuid,
  p_comment text default null
)
returns public.hour_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_record public.hour_requests%rowtype;
  reviewer_membership_id uuid;
  previous_approver_id uuid;
begin
  if p_comment is not null and length(p_comment) > 4000 then
    raise exception 'Comment must not exceed 4000 characters' using errcode = '22023';
  end if;
  select * into request_record
  from public.hour_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception 'Hour request not found' using errcode = 'P0002';
  end if;
  if request_record.status <> 'pending' then
    raise exception 'Only pending requests can be reassigned' using errcode = '40001';
  end if;

  reviewer_membership_id := private.current_membership_id(request_record.school_year_id, true);
  if not private.is_review_capable_membership(
    reviewer_membership_id,
    request_record.school_year_id
  ) then
    raise exception 'An active review-capable role is required' using errcode = '42501';
  end if;
  if reviewer_membership_id = request_record.member_membership_id then
    raise exception 'A reviewer cannot process their own request' using errcode = '42501';
  end if;
  if p_new_reviewer_membership_id = request_record.member_membership_id then
    raise exception 'A member cannot be assigned to review their own request'
      using errcode = '42501';
  end if;
  if not private.is_review_capable_membership(
    p_new_reviewer_membership_id,
    request_record.school_year_id
  ) then
    raise exception 'New approver is not an active reviewer for this school year'
      using errcode = '22023';
  end if;

  previous_approver_id := request_record.requested_approver_membership_id;
  perform set_config('nhs.allow_hour_request_transition', 'on', true);
  update public.hour_requests
  set requested_approver_membership_id = p_new_reviewer_membership_id
  where id = p_request_id and status = 'pending'
  returning * into request_record;
  if not found then
    raise exception 'Request was processed concurrently' using errcode = '40001';
  end if;

  insert into public.hour_reviews (
    hour_request_id,
    school_year_id,
    action,
    actor_membership_id,
    reviewer_membership_id,
    previous_status,
    new_status,
    previous_requested_approver_membership_id,
    new_requested_approver_membership_id,
    comment
  )
  values (
    request_record.id,
    request_record.school_year_id,
    'reassigned',
    reviewer_membership_id,
    reviewer_membership_id,
    'pending',
    'pending',
    previous_approver_id,
    p_new_reviewer_membership_id,
    nullif(btrim(p_comment), '')
  );

  perform private.write_audit(
    'hour_request.reassigned',
    'hour_request',
    request_record.id::text,
    request_record.school_year_id,
    reviewer_membership_id,
    jsonb_build_object('requested_approver_membership_id', previous_approver_id),
    jsonb_build_object('requested_approver_membership_id', p_new_reviewer_membership_id),
    jsonb_build_object('comment_supplied', nullif(btrim(p_comment), '') is not null)
  );
  return request_record;
end;
$$;

create or replace function public.correct_approved_request(
  p_request_id uuid,
  p_title text,
  p_description text,
  p_category_id uuid,
  p_service_date date,
  p_hours numeric,
  p_reason text
)
returns public.hour_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_record public.hour_requests%rowtype;
  administrator_membership_id uuid;
  administrator_profile_id uuid;
  member_profile_id uuid;
  before_values jsonb;
  after_values jsonb;
begin
  administrator_membership_id := private.current_teacher_admin_membership_id();
  if administrator_membership_id is null then
    raise exception 'An active teacher administrator is required' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 or length(p_reason) > 2000 then
    raise exception 'A correction reason is required and must not exceed 2000 characters'
      using errcode = '22023';
  end if;

  select * into request_record
  from public.hour_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception 'Hour request not found' using errcode = 'P0002';
  end if;
  if request_record.status <> 'approved' then
    raise exception 'Only approved requests use the correction procedure'
      using errcode = '55000';
  end if;

  select profile_id into administrator_profile_id
  from public.school_year_memberships
  where id = administrator_membership_id;
  select profile_id into member_profile_id
  from public.school_year_memberships
  where id = request_record.member_membership_id;
  if administrator_profile_id = member_profile_id then
    raise exception 'An administrator cannot correct their own hour request'
      using errcode = '42501';
  end if;

  perform private.assert_request_values(
    request_record.school_year_id,
    request_record.member_membership_id,
    p_category_id,
    request_record.requested_approver_membership_id,
    p_title,
    p_description,
    p_service_date,
    p_hours,
    false,
    false
  );
  perform private.assert_category_approval_cap(
    request_record.member_membership_id,
    request_record.school_year_id,
    p_category_id,
    p_hours,
    request_record.id
  );

  before_values := jsonb_build_object(
    'title', request_record.title,
    'description', request_record.description,
    'category_id', request_record.category_id,
    'service_date', request_record.service_date,
    'hours', request_record.hours
  );
  after_values := jsonb_build_object(
    'title', btrim(p_title),
    'description', btrim(p_description),
    'category_id', p_category_id,
    'service_date', p_service_date,
    'hours', p_hours
  );
  if before_values = after_values then
    raise exception 'Correction must change at least one approved value' using errcode = '22023';
  end if;

  perform set_config('nhs.allow_hour_request_transition', 'on', true);
  perform set_config('nhs.allow_approved_correction', 'on', true);
  update public.hour_requests
  set
    title = btrim(p_title),
    description = btrim(p_description),
    category_id = p_category_id,
    service_date = p_service_date,
    hours = p_hours,
    revision = revision + 1
  where id = p_request_id and status = 'approved'
  returning * into request_record;
  if not found then
    raise exception 'Approved request was changed concurrently' using errcode = '40001';
  end if;

  insert into public.hour_request_corrections (
    hour_request_id,
    corrected_by_membership_id,
    reason,
    before_values,
    after_values
  )
  values (
    request_record.id,
    administrator_membership_id,
    btrim(p_reason),
    before_values,
    after_values
  );

  insert into public.hour_reviews (
    hour_request_id,
    school_year_id,
    action,
    actor_membership_id,
    reviewer_membership_id,
    previous_status,
    new_status,
    previous_requested_approver_membership_id,
    new_requested_approver_membership_id,
    comment
  )
  values (
    request_record.id,
    request_record.school_year_id,
    'corrected',
    administrator_membership_id,
    administrator_membership_id,
    'approved',
    'approved',
    request_record.requested_approver_membership_id,
    request_record.requested_approver_membership_id,
    btrim(p_reason)
  );

  perform private.write_audit(
    'hour_request.corrected',
    'hour_request',
    request_record.id::text,
    request_record.school_year_id,
    administrator_membership_id,
    before_values,
    after_values,
    jsonb_build_object('reason', btrim(p_reason), 'revision', request_record.revision)
  );
  return request_record;
end;
$$;

create or replace function private.require_teacher_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  administrator_membership_id uuid;
begin
  administrator_membership_id := private.current_teacher_admin_membership_id();
  if administrator_membership_id is null then
    raise exception 'An active teacher administrator is required' using errcode = '42501';
  end if;
  return administrator_membership_id;
end;
$$;

create or replace function public.bootstrap_teacher_admin(
  p_user_id uuid,
  p_email text,
  p_full_name text,
  p_school_year_label text,
  p_start_date date,
  p_end_date date,
  p_default_target_hours numeric default 20.00,
  p_expiration_date date default null
)
returns public.school_year_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  school_year_record public.school_years%rowtype;
  membership_record public.school_year_memberships%rowtype;
  normalized_email text := lower(btrim(p_email));
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Bootstrap is restricted to the service role' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('nhs.bootstrap_teacher_admin', 0));
  if exists (
    select 1
    from public.membership_roles membership_role
    join public.roles role on role.id = membership_role.role_id
    where role.is_teacher_admin
  ) then
    raise exception 'A teacher administrator already exists' using errcode = '55000';
  end if;
  if length(normalized_email) not between 3 and 320
    or position('@' in normalized_email) < 2
    or not private.email_domain_allowed(normalized_email) then
    raise exception 'Email address is invalid or not allowed' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_full_name, ''))) not between 1 and 200 then
    raise exception 'Full name is required and must not exceed 200 characters'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from auth.users auth_user
    where auth_user.id = p_user_id
      and lower(auth_user.email) = normalized_email
  ) then
    raise exception 'The matching Auth user must be created through the Admin API first'
      using errcode = '22023';
  end if;

  insert into public.profiles (id, email, full_name)
  values (p_user_id, normalized_email, btrim(p_full_name))
  on conflict (id) do update
  set email = excluded.email, full_name = excluded.full_name, status = 'active',
      deactivated_at = null, deactivated_by_profile_id = null;

  insert into public.school_years (
    label, start_date, end_date, default_target_hours, status, created_by_profile_id
  )
  values (
    btrim(p_school_year_label), p_start_date, p_end_date, p_default_target_hours,
    case when current_date between p_start_date and p_end_date then 'active' else 'draft' end,
    p_user_id
  )
  on conflict ((lower(label::text))) do update
  set label = excluded.label
  returning * into school_year_record;

  if school_year_record.start_date <> p_start_date
    or school_year_record.end_date <> p_end_date then
    raise exception 'Existing school-year label has different dates' using errcode = '23514';
  end if;

  insert into public.school_year_memberships (
    profile_id, school_year_id, status, expiration_date, created_by_profile_id
  )
  values (
    p_user_id,
    school_year_record.id,
    'active',
    coalesce(p_expiration_date, p_end_date),
    p_user_id
  )
  returning * into membership_record;

  insert into public.membership_roles (membership_id, role_id, assigned_by_profile_id)
  select membership_record.id, role.id, p_user_id
  from public.roles role
  where role.role_key in ('member', 'teacher_admin');

  perform private.write_audit(
    'teacher_admin.bootstrapped',
    'school_year_membership',
    membership_record.id::text,
    school_year_record.id,
    membership_record.id,
    null,
    jsonb_build_object('profile_id', p_user_id, 'roles', array['member', 'teacher_admin'])
  );
  return membership_record;
end;
$$;

create or replace function public.create_school_year(
  p_label text,
  p_start_date date,
  p_end_date date,
  p_default_target_hours numeric default 20.00
)
returns public.school_years
language plpgsql
security definer
set search_path = ''
as $$
declare
  administrator_membership_id uuid;
  year_record public.school_years%rowtype;
begin
  administrator_membership_id := private.require_teacher_admin();
  insert into public.school_years (
    label, start_date, end_date, default_target_hours, status, created_by_profile_id
  )
  values (
    btrim(p_label), p_start_date, p_end_date, p_default_target_hours, 'draft', auth.uid()
  )
  returning * into year_record;
  perform private.write_audit(
    'school_year.created', 'school_year', year_record.id::text, year_record.id,
    administrator_membership_id, null, to_jsonb(year_record)
  );
  return year_record;
end;
$$;

create or replace function public.activate_school_year(p_school_year_id uuid)
returns public.school_years
language plpgsql
security definer
set search_path = ''
as $$
declare
  administrator_membership_id uuid;
  year_record public.school_years%rowtype;
begin
  administrator_membership_id := private.require_teacher_admin();
  perform pg_advisory_xact_lock(hashtextextended('nhs.school_year:' || p_school_year_id::text, 0));
  select * into year_record from public.school_years where id = p_school_year_id for update;
  if not found then
    raise exception 'School year not found' using errcode = 'P0002';
  end if;
  if year_record.status <> 'draft' then
    raise exception 'Only a draft school year can be activated' using errcode = '55000';
  end if;
  if not exists (
    select 1
    from public.school_year_memberships membership
    join public.profiles profile on profile.id = membership.profile_id
    join public.membership_roles membership_role on membership_role.membership_id = membership.id
    join public.roles role on role.id = membership_role.role_id
    where membership.school_year_id = p_school_year_id
      and membership.status = 'active'
      and membership.expiration_date >= year_record.start_date
      and profile.status = 'active'
      and role.is_teacher_admin
  ) then
    raise exception 'At least one active teacher administrator must be assigned before activation'
      using errcode = '23514';
  end if;
  update public.school_years set status = 'active' where id = p_school_year_id returning * into year_record;
  perform private.write_audit(
    'school_year.activated', 'school_year', year_record.id::text, year_record.id,
    administrator_membership_id, jsonb_build_object('status', 'draft'),
    jsonb_build_object('status', 'active')
  );
  return year_record;
end;
$$;

create or replace function public.close_school_year(p_school_year_id uuid)
returns public.school_years
language plpgsql
security definer
set search_path = ''
as $$
declare
  administrator_membership_id uuid;
  year_record public.school_years%rowtype;
  previous_status text;
begin
  administrator_membership_id := private.require_teacher_admin();
  select * into year_record from public.school_years where id = p_school_year_id for update;
  if not found then
    raise exception 'School year not found' using errcode = 'P0002';
  end if;
  if year_record.status not in ('draft', 'active') then
    raise exception 'School year is already closed or archived' using errcode = '55000';
  end if;
  previous_status := year_record.status;
  update public.school_years
  set status = 'closed', closed_at = statement_timestamp(), closed_by_profile_id = auth.uid()
  where id = p_school_year_id
  returning * into year_record;
  perform private.write_audit(
    'school_year.closed', 'school_year', year_record.id::text, year_record.id,
    administrator_membership_id, jsonb_build_object('status', previous_status),
    jsonb_build_object('status', 'closed')
  );
  return year_record;
end;
$$;

create or replace function public.set_school_year_target(
  p_school_year_id uuid,
  p_default_target_hours numeric
)
returns public.school_years
language plpgsql
security definer
set search_path = ''
as $$
declare
  administrator_membership_id uuid;
  year_record public.school_years%rowtype;
  old_target numeric(7, 2);
begin
  administrator_membership_id := private.require_teacher_admin();
  if p_default_target_hours < 0 or mod(p_default_target_hours, 0.25) <> 0 then
    raise exception 'School-year target must be a nonnegative quarter-hour value'
      using errcode = '22023';
  end if;
  select * into year_record from public.school_years where id = p_school_year_id for update;
  if not found then raise exception 'School year not found' using errcode = 'P0002'; end if;
  if year_record.status not in ('draft', 'active') then
    raise exception 'Closed school-year targets cannot be changed' using errcode = '55000';
  end if;
  old_target := year_record.default_target_hours;
  update public.school_years set default_target_hours = p_default_target_hours
  where id = p_school_year_id returning * into year_record;
  perform private.write_audit(
    'school_year.target_updated', 'school_year', year_record.id::text, year_record.id,
    administrator_membership_id, jsonb_build_object('default_target_hours', old_target),
    jsonb_build_object('default_target_hours', p_default_target_hours)
  );
  return year_record;
end;
$$;

create or replace function public.renew_memberships(
  p_school_year_id uuid,
  p_renewals jsonb
)
returns table (membership_id uuid, profile_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  administrator_membership_id uuid;
  target_year public.school_years%rowtype;
  renewal_item jsonb;
  target_profile_id uuid;
  source_membership_id uuid;
  target_membership public.school_year_memberships%rowtype;
  requested_roles text[];
  expiration_date_value date;
  target_override numeric(7, 2);
begin
  administrator_membership_id := private.require_teacher_admin();
  if jsonb_typeof(p_renewals) <> 'array' or jsonb_array_length(p_renewals) = 0 then
    raise exception 'Renewals must be a non-empty JSON array' using errcode = '22023';
  end if;
  select * into target_year from public.school_years where id = p_school_year_id for update;
  if not found or target_year.status not in ('draft', 'active') then
    raise exception 'Target school year must be draft or active' using errcode = '55000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('nhs.renewals:' || p_school_year_id::text, 0));

  for renewal_item in select value from jsonb_array_elements(p_renewals)
  loop
    if jsonb_typeof(renewal_item) <> 'object' then
      raise exception 'Each renewal must be a JSON object' using errcode = '22023';
    end if;
    target_profile_id := (renewal_item ->> 'profile_id')::uuid;
    if not exists (
      select 1 from public.profiles profile
      where profile.id = target_profile_id and profile.status = 'active'
    ) then
      raise exception 'Renewal profile % is missing or inactive', target_profile_id
        using errcode = '22023';
    end if;
    expiration_date_value := coalesce(
      (renewal_item ->> 'expiration_date')::date,
      target_year.end_date
    );
    target_override := case
      when renewal_item ? 'target_hours_override'
        and renewal_item -> 'target_hours_override' <> 'null'::jsonb
      then (renewal_item ->> 'target_hours_override')::numeric
      else null
    end;
    select prior.id into source_membership_id
    from public.school_year_memberships prior
    join public.school_years prior_year on prior_year.id = prior.school_year_id
    where prior.profile_id = target_profile_id
      and prior.school_year_id <> p_school_year_id
    order by prior_year.start_date desc
    limit 1;

    if renewal_item ? 'role_keys' then
      if jsonb_typeof(renewal_item -> 'role_keys') <> 'array' then
        raise exception 'role_keys must be an array' using errcode = '22023';
      end if;
      select array_agg(distinct role_key order by role_key)
      into requested_roles
      from (
        select jsonb_array_elements_text(renewal_item -> 'role_keys') as role_key
        union all select 'member'
      ) roles_input;
    elsif source_membership_id is not null then
      select array_agg(role.role_key order by role.role_key)
      into requested_roles
      from public.membership_roles membership_role
      join public.roles role on role.id = membership_role.role_id
      where membership_role.membership_id = source_membership_id;
      requested_roles := array_append(coalesce(requested_roles, '{}'::text[]), 'member');
    else
      requested_roles := array['member'];
    end if;

    if exists (
      select 1 from unnest(requested_roles) as requested_role(role_key)
      where not exists (
        select 1 from public.roles role where role.role_key = requested_role.role_key
      )
    ) then
      raise exception 'Renewal contains an unknown role' using errcode = '22023';
    end if;

    insert into public.school_year_memberships (
      profile_id, school_year_id, status, expiration_date, target_hours_override,
      renewed_from_membership_id, created_by_profile_id
    )
    values (
      target_profile_id, p_school_year_id, 'active', expiration_date_value, target_override,
      source_membership_id, auth.uid()
    )
    on conflict on constraint school_year_memberships_profile_year_unique do update
    set status = 'active', expiration_date = excluded.expiration_date,
        target_hours_override = excluded.target_hours_override,
        renewed_from_membership_id = coalesce(
          public.school_year_memberships.renewed_from_membership_id,
          excluded.renewed_from_membership_id
        )
    returning * into target_membership;

    insert into public.membership_roles (membership_id, role_id, assigned_by_profile_id)
    select target_membership.id, role.id, auth.uid()
    from public.roles role
    where role.role_key = any(requested_roles)
    on conflict on constraint membership_roles_pkey do nothing;

    delete from public.membership_roles membership_role
    using public.roles role
    where membership_role.membership_id = target_membership.id
      and role.id = membership_role.role_id
      and not (role.role_key = any(requested_roles));

    perform private.write_audit(
      'membership.renewed', 'school_year_membership', target_membership.id::text,
      p_school_year_id, administrator_membership_id,
      null,
      jsonb_build_object(
        'profile_id', target_profile_id,
        'expiration_date', expiration_date_value,
        'target_hours_override', target_override,
        'role_keys', requested_roles,
        'renewed_from_membership_id', source_membership_id
      )
    );
    membership_id := target_membership.id;
    profile_id := target_profile_id;
    return next;
  end loop;
end;
$$;

create or replace function public.set_membership_status(
  p_membership_id uuid,
  p_status text
)
returns public.school_year_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  administrator_membership_id uuid;
  membership_record public.school_year_memberships%rowtype;
  previous_status text;
begin
  administrator_membership_id := private.require_teacher_admin();
  if p_status not in ('active', 'expired', 'suspended', 'archived') then
    raise exception 'Invalid membership status' using errcode = '22023';
  end if;
  select * into membership_record
  from public.school_year_memberships where id = p_membership_id for update;
  if not found then raise exception 'Membership not found' using errcode = 'P0002'; end if;
  previous_status := membership_record.status;
  update public.school_year_memberships set status = p_status
  where id = p_membership_id returning * into membership_record;
  perform private.write_audit(
    'membership.status_changed', 'school_year_membership', membership_record.id::text,
    membership_record.school_year_id, administrator_membership_id,
    jsonb_build_object('status', previous_status), jsonb_build_object('status', p_status)
  );
  return membership_record;
end;
$$;

create or replace function public.set_membership_target(
  p_membership_id uuid,
  p_target_hours_override numeric
)
returns public.school_year_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  administrator_membership_id uuid;
  membership_record public.school_year_memberships%rowtype;
  old_target numeric(7, 2);
begin
  administrator_membership_id := private.require_teacher_admin();
  if p_target_hours_override is not null and (
    p_target_hours_override < 0 or mod(p_target_hours_override, 0.25) <> 0
  ) then
    raise exception 'Target must be null or a nonnegative quarter-hour value'
      using errcode = '22023';
  end if;
  select * into membership_record
  from public.school_year_memberships where id = p_membership_id for update;
  if not found then raise exception 'Membership not found' using errcode = 'P0002'; end if;
  old_target := membership_record.target_hours_override;
  update public.school_year_memberships set target_hours_override = p_target_hours_override
  where id = p_membership_id returning * into membership_record;
  perform private.write_audit(
    'membership.target_updated', 'school_year_membership', membership_record.id::text,
    membership_record.school_year_id, administrator_membership_id,
    jsonb_build_object('target_hours_override', old_target),
    jsonb_build_object('target_hours_override', p_target_hours_override)
  );
  return membership_record;
end;
$$;

create or replace function public.set_profile_status(
  p_profile_id uuid,
  p_status text
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  administrator_membership_id uuid;
  profile_record public.profiles%rowtype;
  previous_status text;
begin
  administrator_membership_id := private.require_teacher_admin();
  if p_status not in ('active', 'inactive') then
    raise exception 'Invalid profile status' using errcode = '22023';
  end if;
  select * into profile_record from public.profiles where id = p_profile_id for update;
  if not found then raise exception 'Profile not found' using errcode = 'P0002'; end if;
  previous_status := profile_record.status;
  update public.profiles
  set status = p_status,
      deactivated_at = case when p_status = 'inactive' then statement_timestamp() else null end,
      deactivated_by_profile_id = case when p_status = 'inactive' then auth.uid() else null end
  where id = p_profile_id
  returning * into profile_record;
  perform private.write_audit(
    'profile.status_changed', 'profile', profile_record.id::text, null,
    administrator_membership_id, jsonb_build_object('status', previous_status),
    jsonb_build_object('status', p_status)
  );
  return profile_record;
end;
$$;

create or replace function public.assign_membership_role(
  p_membership_id uuid,
  p_role_key text
)
returns public.membership_roles
language plpgsql
security definer
set search_path = ''
as $$
declare
  administrator_membership_id uuid;
  role_id_value smallint;
  assignment public.membership_roles%rowtype;
  school_year_id_value uuid;
begin
  administrator_membership_id := private.require_teacher_admin();
  select id into role_id_value from public.roles where role_key = p_role_key;
  if role_id_value is null then raise exception 'Unknown role' using errcode = '22023'; end if;
  select school_year_id into school_year_id_value
  from public.school_year_memberships where id = p_membership_id;
  if school_year_id_value is null then raise exception 'Membership not found' using errcode = 'P0002'; end if;
  insert into public.membership_roles (membership_id, role_id, assigned_by_profile_id)
  values (p_membership_id, role_id_value, auth.uid())
  on conflict (membership_id, role_id) do update
  set assigned_by_profile_id = public.membership_roles.assigned_by_profile_id
  returning * into assignment;
  perform private.write_audit(
    'role.assigned', 'school_year_membership', p_membership_id::text,
    school_year_id_value, administrator_membership_id, null,
    jsonb_build_object('role_key', p_role_key)
  );
  return assignment;
end;
$$;

create or replace function public.remove_membership_role(
  p_membership_id uuid,
  p_role_key text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  administrator_membership_id uuid;
  role_id_value smallint;
  school_year_id_value uuid;
  removed_count integer;
begin
  administrator_membership_id := private.require_teacher_admin();
  if p_role_key = 'member' then
    raise exception 'The baseline member role cannot be removed' using errcode = '23514';
  end if;
  select id into role_id_value from public.roles where role_key = p_role_key;
  if role_id_value is null then raise exception 'Unknown role' using errcode = '22023'; end if;
  select school_year_id into school_year_id_value
  from public.school_year_memberships where id = p_membership_id;
  if school_year_id_value is null then raise exception 'Membership not found' using errcode = 'P0002'; end if;
  delete from public.membership_roles
  where membership_id = p_membership_id and role_id = role_id_value;
  get diagnostics removed_count = row_count;
  if removed_count > 0 then
    perform private.write_audit(
      'role.removed', 'school_year_membership', p_membership_id::text,
      school_year_id_value, administrator_membership_id,
      jsonb_build_object('role_key', p_role_key), null
    );
  end if;
  return removed_count > 0;
end;
$$;

create or replace function public.create_invitation(
  p_email text,
  p_full_name text,
  p_school_year_id uuid,
  p_role_keys text[] default array['member'],
  p_expires_at timestamptz default statement_timestamp() + interval '7 days'
)
returns public.invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  administrator_membership_id uuid;
  invitation_record public.invitations%rowtype;
  normalized_email text := lower(btrim(p_email));
  normalized_roles text[];
begin
  administrator_membership_id := private.require_teacher_admin();
  if not private.email_domain_allowed(normalized_email)
    or length(normalized_email) not between 3 and 320
    or position('@' in normalized_email) < 2 then
    raise exception 'Email address is invalid or not allowed' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_full_name, ''))) not between 1 and 200 then
    raise exception 'Full name is required and must not exceed 200 characters'
      using errcode = '22023';
  end if;
  if p_expires_at <= statement_timestamp() then
    raise exception 'Invitation expiration must be in the future' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.school_years
    where id = p_school_year_id and status in ('draft', 'active')
  ) then
    raise exception 'School year is not open for invitations' using errcode = '55000';
  end if;
  select array_agg(distinct role_key order by role_key)
  into normalized_roles
  from (
    select unnest(coalesce(p_role_keys, '{}'::text[])) as role_key
    union all select 'member'
  ) role_input;
  if exists (
    select 1 from unnest(normalized_roles) as requested_role(role_key)
    where not exists (
      select 1 from public.roles role where role.role_key = requested_role.role_key
    )
  ) then
    raise exception 'Invitation contains an unknown role' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.profiles profile where lower(profile.email::text) = normalized_email
  ) then
    raise exception 'An account already exists for this email' using errcode = '23505';
  end if;

  insert into public.invitations (
    email, full_name, school_year_id, expires_at, invited_by_membership_id
  )
  values (
    normalized_email, btrim(p_full_name), p_school_year_id, p_expires_at,
    administrator_membership_id
  )
  returning * into invitation_record;
  insert into public.invitation_roles (invitation_id, role_id)
  select invitation_record.id, role.id from public.roles role
  where role.role_key = any(normalized_roles);
  perform private.write_audit(
    'invitation.created', 'invitation', invitation_record.id::text, p_school_year_id,
    administrator_membership_id, null,
    jsonb_build_object(
      'email', normalized_email, 'role_keys', normalized_roles, 'expires_at', p_expires_at
    )
  );
  return invitation_record;
end;
$$;

-- Phase one of invitation delivery validates the current business record and
-- exposes only the fields required by the server-side Auth call.  It deliberately
-- does not mutate send metadata, expiry, or audit history because the external
-- provider has not accepted the request yet.
create or replace function public.prepare_invitation_send(p_invitation_id uuid)
returns table (
  invitation_id uuid,
  email text,
  full_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  administrator_membership_id uuid;
begin
  administrator_membership_id := private.require_teacher_admin();

  return query
  select invitation.id, invitation.email::text, invitation.full_name
  from public.invitations invitation
  join public.school_years school_year on school_year.id = invitation.school_year_id
  where invitation.id = p_invitation_id
    and invitation.status = 'pending'
    and school_year.status in ('draft', 'active');

  if not found then
    if not exists (
      select 1 from public.invitations invitation where invitation.id = p_invitation_id
    ) then
      raise exception 'Invitation not found' using errcode = 'P0002';
    end if;
    raise exception 'Only a pending invitation for an open school year can be sent'
      using errcode = '55000';
  end if;
end;
$$;

-- Phase two is called only after Supabase Auth accepts the corresponding send.
-- The invitation row lock serializes acknowledgements.  The app-generated UUID
-- is retained in immutable audit metadata so transport retries are idempotent,
-- while separate accepted provider calls each advance the factual send count.
create or replace function public.record_invitation_send_success(
  p_invitation_id uuid,
  p_send_idempotency_key uuid,
  p_expires_at timestamptz
)
returns public.invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  administrator_membership_id uuid;
  invitation_record public.invitations%rowtype;
  prior_send_event public.audit_events%rowtype;
  prior_values jsonb;
  send_accepted_at timestamptz;
  audit_action text;
begin
  administrator_membership_id := private.require_teacher_admin();

  if p_send_idempotency_key is null then
    raise exception 'Send idempotency key is required' using errcode = '22023';
  end if;

  select * into invitation_record
  from public.invitations where id = p_invitation_id for update;
  if not found then raise exception 'Invitation not found' using errcode = 'P0002'; end if;

  select audit_event.* into prior_send_event
  from public.audit_events audit_event
  where audit_event.entity_type = 'invitation'
    and audit_event.entity_id = p_invitation_id::text
    and audit_event.action in ('invitation.sent', 'invitation.resent')
    and audit_event.metadata ->> 'send_idempotency_key' = p_send_idempotency_key::text
  order by audit_event.id
  limit 1;

  if found then
    if (prior_send_event.metadata ->> 'requested_expires_at')::timestamptz
      is distinct from p_expires_at then
      raise exception 'Send idempotency key was already used with a different expiration'
        using errcode = '22023';
    end if;
    return invitation_record;
  end if;

  -- Capture the acknowledgement time only after acquiring the invitation row
  -- lock so contending successful sends cannot move sent_at backwards.
  send_accepted_at := clock_timestamp();
  if p_expires_at is null or p_expires_at <= send_accepted_at then
    raise exception 'Invitation expiration must be in the future' using errcode = '22023';
  end if;
  if p_expires_at > send_accepted_at + interval '7 days 5 minutes' then
    raise exception 'Invitation expiration cannot exceed seven days'
      using errcode = '22023';
  end if;

  if invitation_record.status <> 'pending' then
    raise exception 'Only pending invitations can record a successful send'
      using errcode = '55000';
  end if;
  if not exists (
    select 1 from public.school_years school_year
    where school_year.id = invitation_record.school_year_id
      and school_year.status in ('draft', 'active')
  ) then
    raise exception 'Invitation school year is no longer open' using errcode = '55000';
  end if;

  prior_values := jsonb_build_object(
    'sent_at', invitation_record.sent_at,
    'send_count', invitation_record.send_count,
    'expires_at', invitation_record.expires_at
  );
  audit_action := case
    when invitation_record.send_count = 0 then 'invitation.sent'
    else 'invitation.resent'
  end;

  update public.invitations
  set sent_at = send_accepted_at,
      expires_at = greatest(expires_at, p_expires_at),
      send_count = send_count + 1
  where id = p_invitation_id returning * into invitation_record;

  perform private.write_audit(
    audit_action, 'invitation', invitation_record.id::text,
    invitation_record.school_year_id, administrator_membership_id, prior_values,
    jsonb_build_object(
      'sent_at', invitation_record.sent_at,
      'send_count', invitation_record.send_count,
      'expires_at', invitation_record.expires_at
    ),
    jsonb_build_object(
      'provider', 'supabase_auth',
      'send_idempotency_key', p_send_idempotency_key,
      'requested_expires_at', p_expires_at
    )
  );
  return invitation_record;
end;
$$;

create or replace function public.revoke_invitation(p_invitation_id uuid)
returns public.invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  administrator_membership_id uuid;
  invitation_record public.invitations%rowtype;
begin
  administrator_membership_id := private.require_teacher_admin();
  select * into invitation_record
  from public.invitations where id = p_invitation_id for update;
  if not found then raise exception 'Invitation not found' using errcode = 'P0002'; end if;
  if invitation_record.status <> 'pending' then
    raise exception 'Only pending invitations can be revoked' using errcode = '55000';
  end if;
  update public.invitations
  set status = 'revoked', revoked_at = statement_timestamp(),
      revoked_by_membership_id = administrator_membership_id
  where id = p_invitation_id returning * into invitation_record;
  perform private.write_audit(
    'invitation.revoked', 'invitation', invitation_record.id::text,
    invitation_record.school_year_id, administrator_membership_id,
    jsonb_build_object('status', 'pending'), jsonb_build_object('status', 'revoked')
  );
  return invitation_record;
end;
$$;

create or replace function public.claim_invitation(p_invitation_id uuid default null)
returns public.school_year_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation_record public.invitations%rowtype;
  membership_record public.school_year_memberships%rowtype;
  caller_email text;
  resolved_invitation_id uuid;
  eligible_invitation_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  caller_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  if caller_email = '' then
    select lower(email) into caller_email from auth.users where id = auth.uid();
  end if;
  if p_invitation_id is null then
    select count(*)::integer, min(invitation.id::text)::uuid
    into eligible_invitation_count, resolved_invitation_id
    from public.invitations invitation
    where lower(invitation.email::text) = caller_email
      and invitation.status = 'pending'
      and invitation.expires_at > statement_timestamp();
    if eligible_invitation_count = 0 then
      raise exception 'No eligible invitation was found for the authenticated email'
        using errcode = 'P0002';
    elsif eligible_invitation_count > 1 then
      raise exception 'Multiple eligible invitations exist; an invitation ID is required'
        using errcode = '21000';
    end if;
  else
    resolved_invitation_id := p_invitation_id;
  end if;
  select * into invitation_record
  from public.invitations where id = resolved_invitation_id for update;
  if not found then raise exception 'Invitation not found' using errcode = 'P0002'; end if;
  if invitation_record.status <> 'pending'
    or invitation_record.expires_at <= statement_timestamp() then
    raise exception 'Invitation is no longer valid' using errcode = '55000';
  end if;
  if lower(invitation_record.email::text) <> caller_email then
    raise exception 'Invitation email does not match the authenticated user'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from auth.users auth_user
    where auth_user.id = auth.uid() and lower(auth_user.email) = caller_email
  ) then
    raise exception 'Authenticated user record is missing' using errcode = '42501';
  end if;

  insert into public.profiles (id, email, full_name)
  values (auth.uid(), caller_email, invitation_record.full_name)
  on conflict (id) do update
  set email = excluded.email, full_name = excluded.full_name;
  insert into public.school_year_memberships (
    profile_id, school_year_id, status, expiration_date, created_by_profile_id
  )
  select auth.uid(), school_year.id, 'active', school_year.end_date,
         (select profile_id from public.school_year_memberships
          where id = invitation_record.invited_by_membership_id)
  from public.school_years school_year
  where school_year.id = invitation_record.school_year_id
    and school_year.status in ('draft', 'active')
  on conflict (profile_id, school_year_id) do update
  set status = 'active'
  returning * into membership_record;
  if membership_record.id is null then
    raise exception 'Invitation school year is no longer open' using errcode = '55000';
  end if;
  insert into public.membership_roles (membership_id, role_id, assigned_by_profile_id)
  select membership_record.id, invitation_role.role_id,
         (select profile_id from public.school_year_memberships
          where id = invitation_record.invited_by_membership_id)
  from public.invitation_roles invitation_role
  where invitation_role.invitation_id = invitation_record.id
  on conflict (membership_id, role_id) do nothing;
  update public.invitations
  set status = 'accepted', accepted_by_profile_id = auth.uid(), accepted_at = statement_timestamp()
  where id = invitation_record.id;
  perform private.write_audit(
    'invitation.accepted', 'invitation', invitation_record.id::text,
    invitation_record.school_year_id, membership_record.id,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', 'accepted', 'profile_id', auth.uid())
  );
  return membership_record;
end;
$$;

create or replace function public.upsert_service_category(
  p_name text,
  p_description text,
  p_display_order integer,
  p_is_active boolean,
  p_default_max_hours_per_request numeric,
  p_category_id uuid default null
)
returns public.service_categories
language plpgsql
security definer
set search_path = ''
as $$
declare
  administrator_membership_id uuid;
  category_record public.service_categories%rowtype;
  old_values jsonb;
begin
  administrator_membership_id := private.require_teacher_admin();
  if p_category_id is null then
    insert into public.service_categories (
      name, description, display_order, is_active, default_max_hours_per_request,
      created_by_profile_id
    )
    values (
      btrim(p_name), nullif(btrim(p_description), ''), p_display_order, p_is_active,
      p_default_max_hours_per_request, auth.uid()
    )
    returning * into category_record;
    perform private.write_audit(
      'category.created', 'service_category', category_record.id::text, null,
      administrator_membership_id, null, to_jsonb(category_record)
    );
  else
    select to_jsonb(category) into old_values
    from public.service_categories category where category.id = p_category_id for update;
    if not found then raise exception 'Service category not found' using errcode = 'P0002'; end if;
    update public.service_categories
    set name = btrim(p_name), description = nullif(btrim(p_description), ''),
        display_order = p_display_order, is_active = p_is_active,
        default_max_hours_per_request = p_default_max_hours_per_request
    where id = p_category_id returning * into category_record;
    perform private.write_audit(
      'category.updated', 'service_category', category_record.id::text, null,
      administrator_membership_id, old_values, to_jsonb(category_record)
    );
  end if;
  return category_record;
end;
$$;

create or replace function public.set_school_year_category(
  p_school_year_id uuid,
  p_category_id uuid,
  p_is_available boolean,
  p_display_order integer,
  p_max_hours_per_request numeric default null,
  p_member_approved_hours_cap numeric default null
)
returns public.school_year_categories
language plpgsql
security definer
set search_path = ''
as $$
declare
  administrator_membership_id uuid;
  year_category_record public.school_year_categories%rowtype;
  old_values jsonb;
begin
  administrator_membership_id := private.require_teacher_admin();
  select to_jsonb(year_category) into old_values
  from public.school_year_categories year_category
  where year_category.school_year_id = p_school_year_id
    and year_category.category_id = p_category_id;
  insert into public.school_year_categories (
    school_year_id, category_id, is_available, display_order, max_hours_per_request,
    member_approved_hours_cap, created_by_profile_id
  )
  values (
    p_school_year_id, p_category_id, p_is_available, p_display_order,
    p_max_hours_per_request, p_member_approved_hours_cap, auth.uid()
  )
  on conflict (school_year_id, category_id) do update
  set is_available = excluded.is_available,
      display_order = excluded.display_order,
      max_hours_per_request = excluded.max_hours_per_request,
      member_approved_hours_cap = excluded.member_approved_hours_cap
  returning * into year_category_record;
  perform private.write_audit(
    case when old_values is null then 'school_year_category.created'
         else 'school_year_category.updated' end,
    'school_year_category', p_school_year_id::text || ':' || p_category_id::text,
    p_school_year_id, administrator_membership_id, old_values,
    to_jsonb(year_category_record)
  );
  return year_category_record;
end;
$$;

create or replace function public.set_app_setting(p_key text, p_value jsonb)
returns public.app_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  administrator_membership_id uuid;
  setting_record public.app_settings%rowtype;
  old_value jsonb;
begin
  administrator_membership_id := private.require_teacher_admin();
  if p_key = 'public_signup_enabled' and p_value <> 'false'::jsonb then
    raise exception 'Public signup cannot be enabled through the application database'
      using errcode = '42501';
  end if;
  if p_key = 'allowed_email_domains' and jsonb_typeof(p_value) <> 'array' then
    raise exception 'Allowed email domains must be a JSON array' using errcode = '22023';
  end if;
  select value into old_value from public.app_settings where key = p_key for update;
  insert into public.app_settings (key, value, updated_by_profile_id)
  values (p_key, p_value, auth.uid())
  on conflict (key) do update
  set value = excluded.value, updated_by_profile_id = excluded.updated_by_profile_id
  returning * into setting_record;
  perform private.write_audit(
    'setting.updated', 'app_setting', p_key, null, administrator_membership_id,
    jsonb_build_object('value', old_value), jsonb_build_object('value', p_value)
  );
  return setting_record;
end;
$$;

create or replace function public.record_export(
  p_school_year_id uuid,
  p_format text default 'csv',
  p_row_count integer default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  administrator_membership_id uuid;
begin
  administrator_membership_id := private.require_teacher_admin();
  if p_format not in ('csv', 'xlsx', 'json') then
    raise exception 'Unsupported export format' using errcode = '22023';
  end if;
  if p_row_count is not null and p_row_count < 0 then
    raise exception 'Export row count cannot be negative' using errcode = '22023';
  end if;
  return private.write_audit(
    'export.generated', 'export', p_school_year_id::text, p_school_year_id,
    administrator_membership_id, null, null,
    jsonb_build_object('format', p_format, 'row_count', p_row_count)
  );
end;
$$;

-- Members need a deliberately narrow directory for choosing an approver.  This
-- security-definer function avoids exposing profile email addresses or relying
-- on the broader profile RLS policy, while still requiring a current membership
-- in the requested school year.
create or replace function public.list_eligible_reviewers(p_school_year_id uuid)
returns table (
  membership_id uuid,
  profile_id uuid,
  full_name text,
  role_keys text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_membership_id uuid;
begin
  caller_membership_id := private.current_membership_id(p_school_year_id, true);
  if caller_membership_id is null then
    raise exception 'An active membership in the school year is required'
      using errcode = '42501';
  end if;

  return query
  select
    membership.id,
    membership.profile_id,
    profile.full_name,
    array_agg(role.role_key order by role.display_order, role.role_key)
  from public.school_year_memberships membership
  join public.profiles profile on profile.id = membership.profile_id
  join public.membership_roles membership_role
    on membership_role.membership_id = membership.id
  join public.roles role on role.id = membership_role.role_id
  where membership.school_year_id = p_school_year_id
    and membership.id <> caller_membership_id
    and private.membership_is_active(membership.id)
  group by membership.id, membership.profile_id, profile.full_name
  having bool_or(role.is_review_capable)
  order by lower(profile.full_name), membership.id;
end;
$$;

create view public.member_progress
with (security_invoker = true)
as
select
  membership.id as membership_id,
  membership.profile_id,
  membership.school_year_id,
  school_year.label::text as school_year_label,
  profile.full_name,
  profile.email::text as email,
  membership.status as membership_status,
  membership.expiration_date,
  membership.target_hours_override,
  coalesce(membership.target_hours_override, school_year.default_target_hours)::numeric(7, 2)
    as target_hours,
  coalesce(role_summary.role_keys, '{}'::text[]) as role_keys,
  coalesce(request_summary.approved_count, 0) as approved_count,
  coalesce(request_summary.pending_count, 0) as pending_count,
  coalesce(request_summary.changes_requested_count, 0) as changes_requested_count,
  coalesce(request_summary.rejected_count, 0) as rejected_count,
  coalesce(request_summary.draft_count, 0) as draft_count,
  coalesce(request_summary.withdrawn_count, 0) as withdrawn_count,
  coalesce(request_summary.approved_hours, 0)::numeric(12, 2) as approved_hours,
  coalesce(request_summary.pending_hours, 0)::numeric(12, 2) as pending_hours,
  coalesce(request_summary.changes_requested_hours, 0)::numeric(12, 2)
    as changes_requested_hours,
  coalesce(request_summary.rejected_hours, 0)::numeric(12, 2) as rejected_hours,
  coalesce(request_summary.withdrawn_hours, 0)::numeric(12, 2) as withdrawn_hours,
  coalesce(request_summary.draft_hours, 0)::numeric(12, 2) as draft_hours,
  greatest(
    coalesce(membership.target_hours_override, school_year.default_target_hours)
      - coalesce(request_summary.approved_hours, 0),
    0
  )::numeric(12, 2) as remaining_hours,
  greatest(
    coalesce(request_summary.approved_hours, 0)
      - coalesce(membership.target_hours_override, school_year.default_target_hours),
    0
  )::numeric(12, 2) as over_goal_hours,
  request_summary.last_activity_at,
  case
    when coalesce(membership.target_hours_override, school_year.default_target_hours) = 0 then 0.00
    else round(
      coalesce(request_summary.approved_hours, 0)
        / coalesce(membership.target_hours_override, school_year.default_target_hours) * 100,
      2
    )
  end::numeric(7, 2) as progress_percent,
  case
    when coalesce(membership.target_hours_override, school_year.default_target_hours) = 0 then 0.00
    else round(
      coalesce(request_summary.approved_hours, 0)
        / coalesce(membership.target_hours_override, school_year.default_target_hours) * 100,
      2
    )
  end::numeric(7, 2) as actual_percentage
from public.school_year_memberships membership
join public.profiles profile on profile.id = membership.profile_id
join public.school_years school_year on school_year.id = membership.school_year_id
left join lateral (
  select array_agg(role.role_key order by role.display_order, role.role_key) as role_keys
  from public.membership_roles membership_role
  join public.roles role on role.id = membership_role.role_id
  where membership_role.membership_id = membership.id
) role_summary on true
left join lateral (
  select
    count(*) filter (where request.status = 'approved')::bigint as approved_count,
    count(*) filter (where request.status = 'pending')::bigint as pending_count,
    count(*) filter (where request.status = 'changes_requested')::bigint
      as changes_requested_count,
    count(*) filter (where request.status = 'rejected')::bigint as rejected_count,
    count(*) filter (where request.status = 'draft')::bigint as draft_count,
    count(*) filter (where request.status = 'withdrawn')::bigint as withdrawn_count,
    sum(request.hours) filter (where request.status = 'approved') as approved_hours,
    sum(request.hours) filter (where request.status = 'pending') as pending_hours,
    sum(request.hours) filter (where request.status = 'changes_requested')
      as changes_requested_hours,
    sum(request.hours) filter (where request.status = 'rejected') as rejected_hours,
    sum(request.hours) filter (where request.status = 'withdrawn') as withdrawn_hours,
    sum(request.hours) filter (where request.status = 'draft') as draft_hours,
    max(request.updated_at) as last_activity_at
  from public.hour_requests request
  where request.member_membership_id = membership.id
) request_summary on true;

create view public.pending_review_queue
with (security_invoker = true)
as
select
  request.id,
  request.member_membership_id,
  request.school_year_id,
  request.category_id,
  request.requested_approver_membership_id,
  request.actual_reviewer_membership_id,
  request.title,
  request.description,
  request.service_date,
  request.hours,
  request.status,
  request.client_submission_key,
  request.revision,
  request.created_at,
  request.submitted_at,
  request.updated_at,
  request.decided_at,
  request.withdrawn_at,
  member_membership.profile_id as member_profile_id,
  member_profile.full_name as member_name,
  member_profile.email::text as member_email,
  category.name::text as category_name,
  approver_membership.profile_id as requested_approver_profile_id,
  approver_profile.full_name as requested_approver_name,
  request.requested_approver_membership_id = private.current_membership_id(
    request.school_year_id,
    true
  ) as assigned_to_current_user,
  greatest(current_date - request.submitted_at::date, 0) as days_pending
from public.hour_requests request
join public.school_year_memberships member_membership
  on member_membership.id = request.member_membership_id
join public.profiles member_profile on member_profile.id = member_membership.profile_id
join public.service_categories category on category.id = request.category_id
join public.school_year_memberships approver_membership
  on approver_membership.id = request.requested_approver_membership_id
join public.profiles approver_profile on approver_profile.id = approver_membership.profile_id
where request.status = 'pending'
  and (
    private.current_actor_is_review_capable(request.school_year_id)
    or private.current_actor_is_teacher_admin()
  );

create view public.category_totals
with (security_invoker = true)
as
select
  membership.id as member_membership_id,
  membership.profile_id,
  membership.school_year_id,
  year_category.category_id,
  category.name::text as category_name,
  year_category.member_approved_hours_cap,
  coalesce(sum(request.hours) filter (where request.status = 'approved'), 0)::numeric(12, 2)
    as approved_hours,
  coalesce(sum(request.hours) filter (where request.status = 'pending'), 0)::numeric(12, 2)
    as pending_hours,
  case when year_category.member_approved_hours_cap is null then null
       else greatest(
         year_category.member_approved_hours_cap
           - coalesce(sum(request.hours) filter (where request.status = 'approved'), 0),
         0
       )::numeric(12, 2)
  end as remaining_category_hours
from public.school_year_memberships membership
join public.school_year_categories year_category
  on year_category.school_year_id = membership.school_year_id
join public.service_categories category on category.id = year_category.category_id
left join public.hour_requests request
  on request.member_membership_id = membership.id
 and request.category_id = year_category.category_id
group by membership.id, membership.profile_id, membership.school_year_id,
  year_category.category_id, category.name, year_category.member_approved_hours_cap;

create view public.school_year_summary
with (security_invoker = true)
as
select
  school_year.id as school_year_id,
  school_year.label::text as school_year_label,
  school_year.start_date,
  school_year.end_date,
  school_year.status,
  school_year.default_target_hours,
  coalesce(membership_summary.member_count, 0) as member_count,
  coalesce(membership_summary.active_member_count, 0) as active_member_count,
  coalesce(request_summary.approved_request_count, 0) as approved_request_count,
  coalesce(request_summary.pending_request_count, 0) as pending_request_count,
  coalesce(request_summary.changes_requested_count, 0) as changes_requested_count,
  coalesce(request_summary.rejected_request_count, 0) as rejected_request_count,
  coalesce(request_summary.approved_hours, 0)::numeric(14, 2) as approved_hours,
  coalesce(request_summary.pending_hours, 0)::numeric(14, 2) as pending_hours
from public.school_years school_year
left join lateral (
  select
    count(*)::bigint as member_count,
    count(*) filter (
      where membership.status = 'active'
        and membership.expiration_date >= current_date
    )::bigint as active_member_count
  from public.school_year_memberships membership
  where membership.school_year_id = school_year.id
) membership_summary on true
left join lateral (
  select
    count(*) filter (where request.status = 'approved')::bigint as approved_request_count,
    count(*) filter (where request.status = 'pending')::bigint as pending_request_count,
    count(*) filter (where request.status = 'changes_requested')::bigint
      as changes_requested_count,
    count(*) filter (where request.status = 'rejected')::bigint as rejected_request_count,
    sum(request.hours) filter (where request.status = 'approved') as approved_hours,
    sum(request.hours) filter (where request.status = 'pending') as pending_hours
  from public.hour_requests request
  where request.school_year_id = school_year.id
) request_summary on true
where private.current_actor_is_teacher_admin();

create view public.export_service_records
with (security_invoker = true)
as
select
  request.id as request_id,
  request.school_year_id,
  school_year.label::text as school_year_label,
  membership.id as member_membership_id,
  profile.id as member_profile_id,
  profile.full_name as member_name,
  profile.email::text as member_email,
  category.id as category_id,
  category.name::text as category_name,
  request.title,
  request.description,
  request.service_date,
  request.hours,
  request.status,
  request.revision,
  request.requested_approver_membership_id,
  requested_profile.full_name as requested_approver_name,
  request.actual_reviewer_membership_id,
  actual_profile.full_name as actual_reviewer_name,
  latest_review.comment as latest_review_comment,
  request.created_at,
  request.submitted_at,
  request.decided_at,
  request.withdrawn_at
from public.hour_requests request
join public.school_years school_year on school_year.id = request.school_year_id
join public.school_year_memberships membership on membership.id = request.member_membership_id
join public.profiles profile on profile.id = membership.profile_id
left join public.service_categories category on category.id = request.category_id
left join public.school_year_memberships requested_membership
  on requested_membership.id = request.requested_approver_membership_id
left join public.profiles requested_profile on requested_profile.id = requested_membership.profile_id
left join public.school_year_memberships actual_membership
  on actual_membership.id = request.actual_reviewer_membership_id
left join public.profiles actual_profile on actual_profile.id = actual_membership.profile_id
left join lateral (
  select review.comment
  from public.hour_reviews review
  where review.hour_request_id = request.id
    and review.reviewer_membership_id is not null
    and review.comment is not null
  order by review.created_at desc, review.id desc
  limit 1
) latest_review on true
where private.current_actor_is_teacher_admin();

create or replace function private.is_provisioned_profile()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.status = 'active'
  );
$$;

create or replace function private.can_view_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (
      p_profile_id = auth.uid()
      and exists (select 1 from public.profiles profile where profile.id = auth.uid())
    )
    or (
      private.is_provisioned_profile()
      and (
        private.current_actor_is_teacher_admin()
        or exists (
        select 1
        from public.school_year_memberships target_membership
        where target_membership.profile_id = p_profile_id
          and private.membership_is_active(target_membership.id)
          and private.current_actor_is_review_capable(target_membership.school_year_id)
        )
      )
    );
$$;

create or replace function private.can_view_school_year(p_school_year_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.school_year_memberships membership
      where membership.profile_id = auth.uid()
        and membership.school_year_id = p_school_year_id
    )
    or (
      private.is_provisioned_profile()
      and private.current_actor_is_teacher_admin()
    );
$$;

alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.school_years enable row level security;
alter table public.school_years force row level security;
alter table public.school_year_memberships enable row level security;
alter table public.school_year_memberships force row level security;
alter table public.roles enable row level security;
alter table public.roles force row level security;
alter table public.membership_roles enable row level security;
alter table public.membership_roles force row level security;
alter table public.service_categories enable row level security;
alter table public.service_categories force row level security;
alter table public.school_year_categories enable row level security;
alter table public.school_year_categories force row level security;
alter table public.invitations enable row level security;
alter table public.invitations force row level security;
alter table public.invitation_roles enable row level security;
alter table public.invitation_roles force row level security;
alter table public.hour_requests enable row level security;
alter table public.hour_requests force row level security;
alter table public.hour_reviews enable row level security;
alter table public.hour_reviews force row level security;
alter table public.hour_request_corrections enable row level security;
alter table public.hour_request_corrections force row level security;
alter table public.audit_events enable row level security;
alter table public.audit_events force row level security;
alter table public.app_settings enable row level security;
alter table public.app_settings force row level security;

create policy profiles_select_authorized
on public.profiles for select to authenticated
using (private.can_view_profile(id));

create policy school_years_select_authorized
on public.school_years for select to authenticated
using (private.can_view_school_year(id));

create policy school_year_memberships_select_authorized
on public.school_year_memberships for select to authenticated
using (private.can_view_membership(id));

create policy roles_select_provisioned
on public.roles for select to authenticated
using (private.is_provisioned_profile());

create policy membership_roles_select_authorized
on public.membership_roles for select to authenticated
using (private.can_view_membership(membership_id));

create policy service_categories_select_provisioned
on public.service_categories for select to authenticated
using (private.is_provisioned_profile());

create policy school_year_categories_select_authorized
on public.school_year_categories for select to authenticated
using (private.can_view_school_year(school_year_id));

create policy invitations_select_teacher_admin
on public.invitations for select to authenticated
using (private.current_actor_is_teacher_admin());

create policy invitation_roles_select_teacher_admin
on public.invitation_roles for select to authenticated
using (private.current_actor_is_teacher_admin());

create policy hour_requests_select_authorized
on public.hour_requests for select to authenticated
using (private.can_view_hour_request(id));

create policy hour_reviews_select_authorized
on public.hour_reviews for select to authenticated
using (private.can_view_hour_request(hour_request_id));

create policy hour_request_corrections_select_authorized
on public.hour_request_corrections for select to authenticated
using (private.can_view_hour_request(hour_request_id));

create policy audit_events_select_teacher_admin
on public.audit_events for select to authenticated
using (private.current_actor_is_teacher_admin());

create policy app_settings_select_teacher_admin
on public.app_settings for select to authenticated
using (private.current_actor_is_teacher_admin());

revoke all on schema private from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant usage on schema public to authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_provisioned_profile() to authenticated;
grant execute on function private.can_view_profile(uuid) to authenticated;
grant execute on function private.can_view_school_year(uuid) to authenticated;
grant execute on function private.can_view_membership(uuid) to authenticated;
grant execute on function private.can_view_hour_request(uuid) to authenticated;
grant execute on function private.current_actor_is_teacher_admin() to authenticated;
grant execute on function private.current_actor_is_review_capable(uuid) to authenticated;
grant execute on function private.current_membership_id(uuid, boolean) to authenticated;
grant select on table
  public.profiles,
  public.school_years,
  public.school_year_memberships,
  public.roles,
  public.membership_roles,
  public.service_categories,
  public.school_year_categories,
  public.invitations,
  public.invitation_roles,
  public.hour_requests,
  public.hour_reviews,
  public.hour_request_corrections,
  public.audit_events,
  public.app_settings,
  public.member_progress,
  public.pending_review_queue,
  public.category_totals,
  public.school_year_summary,
  public.export_service_records
to authenticated;

grant execute on function public.create_hour_request_draft(
  uuid, text, text, uuid, date, numeric, uuid, text
) to authenticated;
grant execute on function public.save_hour_request_draft(
  uuid, integer, text, text, uuid, date, numeric, uuid
) to authenticated;
grant execute on function public.submit_hour_request(uuid, integer) to authenticated;
grant execute on function public.withdraw_hour_request(uuid, text) to authenticated;
grant execute on function public.review_hour_request(uuid, text, text) to authenticated;
grant execute on function public.reassign_hour_request(uuid, uuid, text) to authenticated;
grant execute on function public.correct_approved_request(
  uuid, text, text, uuid, date, numeric, text
) to authenticated;
grant execute on function public.create_school_year(text, date, date, numeric) to authenticated;
grant execute on function public.activate_school_year(uuid) to authenticated;
grant execute on function public.close_school_year(uuid) to authenticated;
grant execute on function public.set_school_year_target(uuid, numeric) to authenticated;
grant execute on function public.renew_memberships(uuid, jsonb) to authenticated;
grant execute on function public.set_membership_status(uuid, text) to authenticated;
grant execute on function public.set_membership_target(uuid, numeric) to authenticated;
grant execute on function public.set_profile_status(uuid, text) to authenticated;
grant execute on function public.assign_membership_role(uuid, text) to authenticated;
grant execute on function public.remove_membership_role(uuid, text) to authenticated;
grant execute on function public.create_invitation(
  text, text, uuid, text[], timestamptz
) to authenticated;
grant execute on function public.prepare_invitation_send(uuid) to authenticated;
grant execute on function public.record_invitation_send_success(
  uuid, uuid, timestamptz
) to authenticated;
grant execute on function public.revoke_invitation(uuid) to authenticated;
grant execute on function public.claim_invitation(uuid) to authenticated;
grant execute on function public.upsert_service_category(
  text, text, integer, boolean, numeric, uuid
) to authenticated;
grant execute on function public.set_school_year_category(
  uuid, uuid, boolean, integer, numeric, numeric
) to authenticated;
grant execute on function public.set_app_setting(text, jsonb) to authenticated;
grant execute on function public.record_export(uuid, text, integer) to authenticated;
grant execute on function public.list_eligible_reviewers(uuid) to authenticated;
grant execute on function public.bootstrap_teacher_admin(
  uuid, text, text, text, date, date, numeric, date
) to service_role;

commit;
