begin;

-- Update policy guards, creation defaults, and progress views together.
create or replace function private.enforce_fixed_school_year_target()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.default_target_hours <> 35.00 then
    raise exception 'The annual service target is fixed at 35 approved hours'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function private.enforce_no_membership_target_override()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.target_hours_override is not null then
    raise exception 'Membership target overrides are disabled; the target is 35 approved hours'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.bootstrap_teacher_admin(
  p_user_id uuid,
  p_email text,
  p_full_name text,
  p_school_year_label text,
  p_start_date date,
  p_end_date date,
  p_default_target_hours numeric default 35.00,
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
  if exists (select 1 from public.platform_access_grants) then
    raise exception 'A global teacher administrator already exists' using errcode = '55000';
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
  set email = excluded.email,
      full_name = excluded.full_name,
      status = 'active',
      deactivated_at = null,
      deactivated_by_profile_id = null;

  insert into public.school_years (
    label, start_date, end_date, default_target_hours, status, created_by_profile_id
  )
  values (
    btrim(p_school_year_label), p_start_date, p_end_date, 35.00,
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

  insert into public.platform_access_grants (
    profile_id, access_level, granted_by_profile_id
  ) values (
    p_user_id, 'platform_owner', p_user_id
  );

  select membership.* into membership_record
  from public.school_year_memberships membership
  where membership.profile_id = p_user_id
    and membership.school_year_id = school_year_record.id;
  if membership_record.id is null then
    raise exception 'Teacher administrator attribution anchor was not created'
      using errcode = '55000';
  end if;

  perform private.write_audit(
    'teacher_admin.bootstrapped', 'school_year_membership', membership_record.id::text,
    school_year_record.id, membership_record.id, null,
    jsonb_build_object(
      'profile_id', p_user_id,
      'roles', array['teacher_admin'],
      'access_level', 'platform_owner',
      'default_target_hours', 35.00
    )
  );
  return membership_record;
end;
$$;

create or replace function public.create_school_year(
  p_label text,
  p_start_date date,
  p_end_date date,
  p_default_target_hours numeric default 35.00
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
  ) values (
    btrim(p_label), p_start_date, p_end_date, 35.00, 'draft', (select auth.uid())
  )
  returning * into year_record;
  perform private.write_audit(
    'school_year.created', 'school_year', year_record.id::text, year_record.id,
    administrator_membership_id, null,
    jsonb_build_object(
      'id', year_record.id,
      'label', year_record.label,
      'start_date', year_record.start_date,
      'end_date', year_record.end_date,
      'default_target_hours', 35.00,
      'status', year_record.status
    )
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
  year_record public.school_years%rowtype;
begin
  perform private.require_teacher_admin();
  select * into year_record from public.school_years where id = p_school_year_id;
  if not found then raise exception 'School year not found' using errcode = 'P0002'; end if;
  if p_default_target_hours <> 35.00 then
    raise exception 'The annual service target is fixed at 35 approved hours'
      using errcode = '23514';
  end if;
  return year_record;
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
  membership_record public.school_year_memberships%rowtype;
begin
  perform private.require_teacher_admin();
  select * into membership_record
  from public.school_year_memberships
  where id = p_membership_id;
  if not found then raise exception 'Membership not found' using errcode = 'P0002'; end if;
  if p_target_hours_override is not null then
    raise exception 'Membership target overrides are disabled; the target is 35 approved hours'
      using errcode = '23514';
  end if;
  return membership_record;
end;
$$;

create or replace view public.member_progress
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
  35.00::numeric(7, 2) as target_hours,
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
  greatest(35.00 - coalesce(request_summary.approved_hours, 0), 0)::numeric(12, 2)
    as remaining_hours,
  greatest(coalesce(request_summary.approved_hours, 0) - 35.00, 0)::numeric(12, 2)
    as over_goal_hours,
  request_summary.last_activity_at,
  round(coalesce(request_summary.approved_hours, 0) / 35.00 * 100, 2)::numeric(7, 2)
    as progress_percent,
  round(coalesce(request_summary.approved_hours, 0) / 35.00 * 100, 2)::numeric(7, 2)
    as actual_percentage
from public.school_year_memberships membership
join public.profiles profile on profile.id = membership.profile_id
join public.school_years school_year on school_year.id = membership.school_year_id
left join lateral (
  select array_agg(role.role_key order by role.display_order, role.role_key) as role_keys
  from public.membership_roles assignment
  join public.roles role on role.id = assignment.role_id
  where assignment.membership_id = membership.id
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
) request_summary on true
where private.is_service_member_membership(membership.id);

create or replace view public.school_year_summary
with (security_invoker = true)
as
select
  school_year.id as school_year_id,
  school_year.label::text as school_year_label,
  school_year.start_date,
  school_year.end_date,
  school_year.status,
  35.00::numeric(7, 2) as default_target_hours,
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
    and private.is_service_member_membership(membership.id)
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

alter table public.school_years alter column default_target_hours set default 35.00;
update public.school_years set default_target_hours = 35.00 where default_target_hours <> 35.00;

commit;
