begin;

-- Teacher-administrator authority is global.  School-year memberships remain as
-- attribution anchors because request/review history deliberately references a
-- same-year membership, but those anchors are not NHS member records.
create table public.platform_access_grants (
  profile_id uuid primary key references public.profiles (id) on delete restrict,
  access_level text not null,
  granted_by_profile_id uuid references public.profiles (id) on delete restrict,
  granted_at timestamptz not null default statement_timestamp(),
  constraint platform_access_grants_level_valid check (
    access_level in ('teacher_admin', 'platform_owner')
  )
);

create unique index platform_access_grants_single_owner_idx
  on public.platform_access_grants ((access_level))
  where access_level = 'platform_owner';
create index platform_access_grants_granted_by_idx
  on public.platform_access_grants (granted_by_profile_id)
  where granted_by_profile_id is not null;

-- Consolidate the two equivalent leadership choices before rebuilding the
-- fixed role-definition guard.  Inserts precede deletes so all assignments are
-- retained, and ON CONFLICT makes multi-role rows collapse safely.
drop trigger if exists roles_fixed_definitions on public.roles;
alter table public.roles drop constraint if exists roles_key_valid;
alter table public.roles
  add constraint roles_key_valid check (
    role_key in (
      'member', 'committee_head', 'president', 'vice_president',
      'president_vice_president', 'teacher_admin'
    )
  );

insert into public.roles (
  role_key, display_name, is_review_capable, is_teacher_admin, display_order
)
values (
  'president_vice_president', 'President / Vice President', true, false, 30
)
on conflict (role_key) do update
set display_name = excluded.display_name,
    is_review_capable = excluded.is_review_capable,
    is_teacher_admin = excluded.is_teacher_admin,
    display_order = excluded.display_order;

insert into public.membership_roles (membership_id, role_id, assigned_by_profile_id, assigned_at)
select
  assignment.membership_id,
  combined_role.id,
  (array_agg(
    assignment.assigned_by_profile_id
    order by assignment.assigned_at, assignment.role_id
  ))[1],
  min(assignment.assigned_at)
from public.membership_roles assignment
join public.roles old_role on old_role.id = assignment.role_id
cross join public.roles combined_role
where old_role.role_key in ('president', 'vice_president')
  and combined_role.role_key = 'president_vice_president'
group by assignment.membership_id, combined_role.id
on conflict (membership_id, role_id) do nothing;

insert into public.invitation_roles (invitation_id, role_id)
select distinct assignment.invitation_id, combined_role.id
from public.invitation_roles assignment
join public.roles old_role on old_role.id = assignment.role_id
cross join public.roles combined_role
where old_role.role_key in ('president', 'vice_president')
  and combined_role.role_key = 'president_vice_president'
on conflict (invitation_id, role_id) do nothing;

delete from public.membership_roles assignment
using public.roles old_role
where assignment.role_id = old_role.id
  and old_role.role_key in ('president', 'vice_president');

delete from public.invitation_roles assignment
using public.roles old_role
where assignment.role_id = old_role.id
  and old_role.role_key in ('president', 'vice_president');

delete from public.roles
where role_key in ('president', 'vice_president');

alter table public.roles drop constraint roles_key_valid;
alter table public.roles
  add constraint roles_key_valid check (
    role_key in (
      'member', 'committee_head', 'president_vice_president', 'teacher_admin'
    )
  );

update public.roles
set display_order = case role_key
  when 'member' then 10
  when 'committee_head' then 20
  when 'president_vice_president' then 30
  when 'teacher_admin' then 40
  else display_order
end;

create trigger roles_fixed_definitions
before update or delete on public.roles
for each row execute function private.prevent_role_definition_mutation();

-- Backfill every legacy teacher administrator as a global administrator.  The
-- oldest assignment is deterministically promoted to the one platform owner;
-- no deployment-specific identity or email is embedded in the migration.
insert into public.platform_access_grants (
  profile_id, access_level, granted_by_profile_id, granted_at
)
select
  legacy.profile_id,
  'teacher_admin',
  legacy.profile_id,
  legacy.first_assigned_at
from (
  select
    membership.profile_id,
    min(assignment.assigned_at) as first_assigned_at,
    bool_or(
      profile.status = 'active'
      and membership.status = 'active'
      and school_year.status in ('draft', 'active')
      and membership.expiration_date >= greatest(current_date, school_year.start_date)
    ) as is_current
  from public.school_year_memberships membership
  join public.membership_roles assignment on assignment.membership_id = membership.id
  join public.roles role on role.id = assignment.role_id
  join public.profiles profile on profile.id = membership.profile_id
  join public.school_years school_year on school_year.id = membership.school_year_id
  where role.role_key = 'teacher_admin'
  group by membership.profile_id
) legacy
on conflict (profile_id) do nothing;

with oldest_administrator as (
  select grant_row.profile_id
  from public.platform_access_grants grant_row
  join (
    select
      membership.profile_id,
      bool_or(profile.status = 'active') as is_active_profile,
      bool_or(
        profile.status = 'active'
        and membership.status = 'active'
        and school_year.status in ('draft', 'active')
        and membership.expiration_date >= greatest(current_date, school_year.start_date)
      ) as is_current
    from public.school_year_memberships membership
    join public.membership_roles assignment on assignment.membership_id = membership.id
    join public.roles role on role.id = assignment.role_id
    join public.profiles profile on profile.id = membership.profile_id
    join public.school_years school_year on school_year.id = membership.school_year_id
    where role.role_key = 'teacher_admin'
    group by membership.profile_id
  ) legacy on legacy.profile_id = grant_row.profile_id
  order by
    legacy.is_current desc,
    legacy.is_active_profile desc,
    grant_row.granted_at,
    grant_row.profile_id
  limit 1
)
update public.platform_access_grants grant_row
set access_level = 'platform_owner'
from oldest_administrator oldest
where grant_row.profile_id = oldest.profile_id;

-- A global administrator's existing memberships become teacher-only anchors.
-- Keeping their identifiers preserves all immutable review/audit references.
delete from public.membership_roles assignment
using public.school_year_memberships membership,
      public.platform_access_grants grant_row,
      public.roles role
where assignment.membership_id = membership.id
  and membership.profile_id = grant_row.profile_id
  and assignment.role_id = role.id
  and role.role_key <> 'teacher_admin';

update public.school_year_memberships membership
set target_hours_override = null,
    status = 'active',
    expiration_date = school_year.end_date
from public.platform_access_grants grant_row,
     public.school_years school_year
where membership.profile_id = grant_row.profile_id
  and school_year.id = membership.school_year_id;

insert into public.school_year_memberships (
  profile_id, school_year_id, status, expiration_date,
  target_hours_override, created_by_profile_id
)
select
  grant_row.profile_id,
  school_year.id,
  'active',
  school_year.end_date,
  null,
  coalesce(grant_row.granted_by_profile_id, grant_row.profile_id)
from public.platform_access_grants grant_row
cross join public.school_years school_year
on conflict on constraint school_year_memberships_profile_year_unique do update
set status = 'active',
    expiration_date = excluded.expiration_date,
    target_hours_override = null;

insert into public.membership_roles (membership_id, role_id, assigned_by_profile_id)
select
  membership.id,
  role.id,
  coalesce(grant_row.granted_by_profile_id, grant_row.profile_id)
from public.school_year_memberships membership
join public.platform_access_grants grant_row on grant_row.profile_id = membership.profile_id
cross join public.roles role
where role.role_key = 'teacher_admin'
on conflict (membership_id, role_id) do nothing;

-- Pending administrator invitations are global and exclusive as well.
delete from public.invitation_roles assignment
using public.roles role
where assignment.role_id = role.id
  and role.role_key <> 'teacher_admin'
  and exists (
    select 1
    from public.invitation_roles administrator_assignment
    join public.roles administrator_role on administrator_role.id = administrator_assignment.role_id
    where administrator_assignment.invitation_id = assignment.invitation_id
      and administrator_role.role_key = 'teacher_admin'
  );

-- Targets and category limits/order are fixed policy, not configurable state.
-- Correct the one staging year that was provisioned two days before the
-- operator-supplied September 1 boundary.  The narrow old/new date predicate
-- keeps synthetic and independently configured environments untouched.
update public.school_years
set start_date = date '2026-09-01',
    status = case
      when current_date < date '2026-09-01' and status = 'active' then 'draft'
      else status
    end
where lower(label::text) = '2026-2027'
  and start_date = date '2026-08-30'
  and end_date = date '2027-09-01';

update public.school_years set default_target_hours = 20.00;
update public.school_year_memberships set target_hours_override = null;
update public.service_categories
set display_order = 0,
    default_max_hours_per_request = null;
update public.school_year_categories
set display_order = 0,
    max_hours_per_request = null,
    member_approved_hours_cap = null;

create or replace function private.current_platform_access_level()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select grant_row.access_level
  from public.platform_access_grants grant_row
  join public.profiles profile on profile.id = grant_row.profile_id
  where grant_row.profile_id = (select auth.uid())
    and profile.status = 'active'
  limit 1;
$$;

create or replace function private.current_actor_is_teacher_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    private.current_platform_access_level() in ('teacher_admin', 'platform_owner'),
    false
  );
$$;

create or replace function private.current_actor_is_platform_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_platform_access_level() = 'platform_owner', false);
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
  join public.membership_roles assignment on assignment.membership_id = membership.id
  join public.roles role on role.id = assignment.role_id
  join public.school_years school_year on school_year.id = membership.school_year_id
  where membership.profile_id = (select auth.uid())
    and private.current_actor_is_teacher_admin()
    and role.role_key = 'teacher_admin'
  order by
    (school_year.status = 'active') desc,
    school_year.start_date desc,
    membership.created_at desc
  limit 1;
$$;

create or replace function private.current_teacher_admin_membership_id(
  p_school_year_id uuid,
  p_require_active boolean default false
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select membership.id
  from public.school_year_memberships membership
  join public.membership_roles assignment on assignment.membership_id = membership.id
  join public.roles role on role.id = assignment.role_id
  where membership.profile_id = (select auth.uid())
    and membership.school_year_id = p_school_year_id
    and private.current_actor_is_teacher_admin()
    and role.role_key = 'teacher_admin'
    and (not p_require_active or private.membership_is_active(membership.id))
  limit 1;
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
  if not private.current_actor_is_teacher_admin() then
    raise exception 'An active global teacher administrator is required'
      using errcode = '42501';
  end if;
  administrator_membership_id := private.current_teacher_admin_membership_id();
  if administrator_membership_id is null then
    raise exception 'Teacher administrator attribution anchor is missing'
      using errcode = '55000';
  end if;
  return administrator_membership_id;
end;
$$;

create or replace function private.require_platform_owner()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.current_actor_is_platform_owner() then
    raise exception 'The platform owner is required' using errcode = '42501';
  end if;
  return (select auth.uid());
end;
$$;

create or replace function private.is_service_member_membership(p_membership_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.school_year_memberships membership
    join public.membership_roles assignment on assignment.membership_id = membership.id
    join public.roles role on role.id = assignment.role_id
    where membership.id = p_membership_id
      and role.role_key = 'member'
      and not exists (
        select 1
        from public.platform_access_grants grant_row
        where grant_row.profile_id = membership.profile_id
      )
  );
$$;

create or replace function private.current_actor_is_review_capable(p_school_year_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_actor_is_teacher_admin()
    or coalesce(
      private.is_review_capable_membership(
        private.current_membership_id(p_school_year_id, true),
        p_school_year_id
      ),
      false
    );
$$;

create or replace function private.ensure_teacher_admin_anchors(
  p_profile_id uuid,
  p_school_year_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  grant_actor uuid;
begin
  if not exists (
    select 1 from public.platform_access_grants
    where profile_id = p_profile_id
  ) then
    raise exception 'Global teacher-administrator grant is required'
      using errcode = '23514';
  end if;

  select coalesce(granted_by_profile_id, profile_id)
  into grant_actor
  from public.platform_access_grants
  where profile_id = p_profile_id;

  insert into public.school_year_memberships (
    profile_id, school_year_id, status, expiration_date,
    target_hours_override, created_by_profile_id
  )
  select
    p_profile_id, school_year.id, 'active', school_year.end_date, null, grant_actor
  from public.school_years school_year
  where p_school_year_id is null or school_year.id = p_school_year_id
  on conflict on constraint school_year_memberships_profile_year_unique do update
  set status = 'active',
      expiration_date = excluded.expiration_date,
      target_hours_override = null;

  delete from public.membership_roles assignment
  using public.school_year_memberships membership,
        public.roles role
  where assignment.membership_id = membership.id
    and membership.profile_id = p_profile_id
    and (p_school_year_id is null or membership.school_year_id = p_school_year_id)
    and assignment.role_id = role.id
    and role.role_key <> 'teacher_admin';

  insert into public.membership_roles (membership_id, role_id, assigned_by_profile_id)
  select membership.id, role.id, grant_actor
  from public.school_year_memberships membership
  cross join public.roles role
  where membership.profile_id = p_profile_id
    and (p_school_year_id is null or membership.school_year_id = p_school_year_id)
    and role.role_key = 'teacher_admin'
  on conflict (membership_id, role_id) do nothing;
end;
$$;

create or replace function private.platform_access_create_anchors()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.ensure_teacher_admin_anchors(new.profile_id, null);
  return new;
end;
$$;

-- Take the platform lock and all existing year locks before a grant insert can
-- acquire profile/member foreign-key locks.  This gives grant, renewal, and
-- role operations one consistent year -> profile -> membership order.
create or replace function private.serialize_platform_access_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('nhs.platform_access', 0));
  perform 1
  from public.school_years school_year
  order by school_year.id
  for share;
  return new;
end;
$$;

create trigger platform_access_grants_serialize_insert
before insert on public.platform_access_grants
for each row execute function private.serialize_platform_access_insert();

create trigger platform_access_grants_create_anchors
after insert on public.platform_access_grants
for each row execute function private.platform_access_create_anchors();

create or replace function private.school_year_create_admin_anchors()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  administrator record;
begin
  for administrator in
    select profile_id from public.platform_access_grants order by profile_id
  loop
    perform private.ensure_teacher_admin_anchors(administrator.profile_id, new.id);
  end loop;
  return new;
end;
$$;

-- A school-year insert takes the same lock before its row exists.  Concurrent
-- school-year and global-grant inserts therefore cannot each miss the other in
-- their AFTER triggers.
create or replace function private.serialize_school_year_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('nhs.platform_access', 0));
  return new;
end;
$$;

create trigger school_years_serialize_platform_access
before insert on public.school_years
for each row execute function private.serialize_school_year_insert();

create trigger school_years_create_admin_anchors
after insert on public.school_years
for each row execute function private.school_year_create_admin_anchors();

create or replace function private.enforce_membership_role_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_profile_id uuid;
  target_role_key text;
  has_global_access boolean;
begin
  select profile_id into target_profile_id
  from public.school_year_memberships
  where id = new.membership_id;
  select role_key into target_role_key from public.roles where id = new.role_id;
  select exists (
    select 1 from public.platform_access_grants where profile_id = target_profile_id
  ) into has_global_access;

  if has_global_access and target_role_key <> 'teacher_admin' then
    raise exception 'Global teacher administrators cannot hold member or leadership roles'
      using errcode = '23514';
  end if;
  if not has_global_access and target_role_key = 'teacher_admin' then
    raise exception 'Teacher-administrator roles require a global access grant'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger membership_roles_enforce_global_scope
before insert or update on public.membership_roles
for each row execute function private.enforce_membership_role_scope();

-- The old last-admin protections were year-bound.  Global grants now own that
-- invariant; membership anchors themselves are never the authority source.
drop trigger if exists membership_roles_protect_last_admin on public.membership_roles;
drop trigger if exists school_year_memberships_protect_last_admin
  on public.school_year_memberships;
drop trigger if exists profiles_protect_last_admin on public.profiles;

create or replace function private.protect_platform_access_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  remaining_active_administrators integer;
begin
  if current_setting('nhs.allow_platform_access_change', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'UPDATE' and new.access_level = old.access_level then
    return new;
  end if;
  if old.access_level = 'platform_owner' then
    raise exception 'Transfer platform ownership before changing the owner grant'
      using errcode = '23514';
  end if;

  select count(*)::integer into remaining_active_administrators
  from public.platform_access_grants grant_row
  join public.profiles profile on profile.id = grant_row.profile_id
  where grant_row.profile_id <> old.profile_id
    and profile.status = 'active';
  if remaining_active_administrators = 0 then
    raise exception 'Cannot remove the final active global administrator'
      using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger platform_access_grants_protect_last
before update or delete on public.platform_access_grants
for each row execute function private.protect_platform_access_grant();

create or replace function private.protect_last_teacher_admin_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_access_level text;
  remaining_active_administrators integer;
begin
  if old.status = 'active' and new.status = 'inactive' then
    select access_level into target_access_level
    from public.platform_access_grants
    where profile_id = old.id;
    if target_access_level = 'platform_owner' then
      raise exception 'Transfer platform ownership before deactivating the owner profile'
        using errcode = '23514';
    end if;
    if target_access_level = 'teacher_admin' then
      select count(*)::integer into remaining_active_administrators
      from public.platform_access_grants grant_row
      join public.profiles profile on profile.id = grant_row.profile_id
      where grant_row.profile_id <> old.id
        and profile.status = 'active';
      if remaining_active_administrators = 0 then
        raise exception 'Cannot deactivate the final active global administrator'
          using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_protect_last_admin
before update on public.profiles
for each row execute function private.protect_last_teacher_admin_profile();

create or replace function private.enforce_fixed_school_year_target()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.default_target_hours <> 20.00 then
    raise exception 'The annual service target is fixed at 20 approved hours'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger school_years_enforce_fixed_target
before insert or update on public.school_years
for each row execute function private.enforce_fixed_school_year_target();

create or replace function private.enforce_no_membership_target_override()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.target_hours_override is not null then
    raise exception 'Membership target overrides are disabled; the target is 20 approved hours'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger school_year_memberships_enforce_fixed_target
before insert or update on public.school_year_memberships
for each row execute function private.enforce_no_membership_target_override();

create or replace function private.neutralize_service_category_policy()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.display_order := 0;
  new.default_max_hours_per_request := null;
  return new;
end;
$$;

create trigger service_categories_neutralize_policy
before insert or update on public.service_categories
for each row execute function private.neutralize_service_category_policy();

create or replace function private.neutralize_school_year_category_policy()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.display_order := 0;
  new.max_hours_per_request := null;
  new.member_approved_hours_cap := null;
  return new;
end;
$$;

create trigger school_year_categories_neutralize_policy
before insert or update on public.school_year_categories
for each row execute function private.neutralize_school_year_category_policy();

-- Request validation retains the universal 24-hour and quarter-hour sanity
-- checks, but no category-specific request or approved-total caps.
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
begin
  select * into year_record from public.school_years where id = p_school_year_id;
  if not found then
    raise exception 'School year does not exist' using errcode = '22023';
  end if;
  if not private.membership_is_active(p_member_membership_id)
    or not private.is_service_member_membership(p_member_membership_id) then
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
    select category.is_active, year_category.is_available
    into category_active, category_available
    from public.service_categories category
    join public.school_year_categories year_category
      on year_category.category_id = category.id
     and year_category.school_year_id = p_school_year_id
    where category.id = p_category_id;
    if not found or not category_active or not category_available then
      raise exception 'Category is not available for this school year' using errcode = '22023';
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
  if p_require_open_year and (
    not private.membership_is_active(p_member_membership_id)
    or not private.is_service_member_membership(p_member_membership_id)
  ) then
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

  select category.is_active, year_category.is_available
  into category_active, category_available
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
begin
  -- Category totals remain reportable, but neither per-request ordering nor
  -- per-member category limits are policy.  The universal 24-hour request
  -- sanity check is enforced by the request validators above.
  return;
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
  ) or not private.is_service_member_membership(request_record.member_membership_id) then
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
    hour_request_id, school_year_id, action, actor_membership_id,
    previous_status, new_status, previous_requested_approver_membership_id,
    new_requested_approver_membership_id, comment
  )
  values (
    request_record.id, request_record.school_year_id, 'withdrawn',
    request_record.member_membership_id, 'pending', 'withdrawn',
    request_record.requested_approver_membership_id,
    request_record.requested_approver_membership_id,
    nullif(btrim(p_comment), '')
  );

  perform private.write_audit(
    'hour_request.withdrawn', 'hour_request', request_record.id::text,
    request_record.school_year_id, request_record.member_membership_id,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', 'withdrawn'),
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
  member_profile_id uuid;
  before_values jsonb;
  after_values jsonb;
begin
  if not private.current_actor_is_teacher_admin() then
    raise exception 'An active global teacher administrator is required'
      using errcode = '42501';
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

  administrator_membership_id := private.current_teacher_admin_membership_id(
    request_record.school_year_id,
    false
  );
  if administrator_membership_id is null then
    raise exception 'Teacher administrator attribution anchor is missing'
      using errcode = '55000';
  end if;
  select profile_id into member_profile_id
  from public.school_year_memberships
  where id = request_record.member_membership_id;
  if (select auth.uid()) = member_profile_id then
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
  set title = btrim(p_title),
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
    hour_request_id, corrected_by_membership_id, reason, before_values, after_values
  ) values (
    request_record.id, administrator_membership_id, btrim(p_reason), before_values, after_values
  );
  insert into public.hour_reviews (
    hour_request_id, school_year_id, action, actor_membership_id,
    reviewer_membership_id, previous_status, new_status,
    previous_requested_approver_membership_id,
    new_requested_approver_membership_id, comment
  ) values (
    request_record.id, request_record.school_year_id, 'corrected',
    administrator_membership_id, administrator_membership_id,
    'approved', 'approved', request_record.requested_approver_membership_id,
    request_record.requested_approver_membership_id, btrim(p_reason)
  );
  perform private.write_audit(
    'hour_request.corrected', 'hour_request', request_record.id::text,
    request_record.school_year_id, administrator_membership_id,
    before_values, after_values,
    jsonb_build_object('reason', btrim(p_reason), 'revision', request_record.revision)
  );
  return request_record;
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
    btrim(p_school_year_label), p_start_date, p_end_date, 20.00,
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
      'default_target_hours', 20.00
    )
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
  ) values (
    btrim(p_label), p_start_date, p_end_date, 20.00, 'draft', (select auth.uid())
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
      'default_target_hours', 20.00,
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
  if p_default_target_hours <> 20.00 then
    raise exception 'The annual service target is fixed at 20 approved hours'
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
    raise exception 'Membership target overrides are disabled; the target is 20 approved hours'
      using errcode = '23514';
  end if;
  return membership_record;
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
  selected_access_role text;
begin
  administrator_membership_id := private.require_teacher_admin();
  if jsonb_typeof(p_renewals) <> 'array' or jsonb_array_length(p_renewals) = 0 then
    raise exception 'Accounts must be a non-empty JSON array' using errcode = '22023';
  end if;

  select * into target_year
  from public.school_years
  where id = p_school_year_id
  for update;
  if not found or target_year.status not in ('draft', 'active') then
    raise exception 'Target school year must be draft or active' using errcode = '55000';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('nhs.destination-access:' || p_school_year_id::text, 0)
  );

  for renewal_item in select value from jsonb_array_elements(p_renewals)
  loop
    if jsonb_typeof(renewal_item) <> 'object'
      or nullif(btrim(renewal_item ->> 'profile_id'), '') is null then
      raise exception 'Each account must be an object with a profile_id'
        using errcode = '22023';
    end if;
    begin
      target_profile_id := (renewal_item ->> 'profile_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'Each account profile_id must be a UUID' using errcode = '22023';
    end;

    perform 1
    from public.profiles profile
    where profile.id = target_profile_id
      and profile.status = 'active'
    for update;
    if not found then
      raise exception 'Account profile % is missing or inactive', target_profile_id
        using errcode = '22023';
    end if;

    if exists (
      select 1
      from public.platform_access_grants grant_row
      where grant_row.profile_id = target_profile_id
    ) or exists (
      select 1
      from public.school_year_memberships membership
      join public.membership_roles assignment on assignment.membership_id = membership.id
      join public.roles role on role.id = assignment.role_id
      where membership.profile_id = target_profile_id
        and role.role_key = 'teacher_admin'
    ) then
      raise exception 'Global teacher administrators cannot receive school-year member access'
        using errcode = '23514';
    end if;

    if not (renewal_item ? 'role_keys')
      or jsonb_typeof(renewal_item -> 'role_keys') <> 'array'
      or jsonb_array_length(renewal_item -> 'role_keys') = 0 then
      raise exception 'role_keys must be a non-empty array' using errcode = '22023';
    end if;

    if exists (
      select 1
      from jsonb_array_elements_text(renewal_item -> 'role_keys') role_input(role_key)
      where role_input.role_key not in (
        'member', 'committee_head', 'president_vice_president'
      )
    ) then
      raise exception 'School-year access contains an unsupported role'
        using errcode = '22023';
    end if;

    select case
      when bool_or(role_input.role_key = 'president_vice_president')
        then 'president_vice_president'
      when bool_or(role_input.role_key = 'committee_head') then 'committee_head'
      else 'member'
    end
    into selected_access_role
    from jsonb_array_elements_text(renewal_item -> 'role_keys') role_input(role_key);

    if (
      select count(distinct role_input.role_key)
      from jsonb_array_elements_text(renewal_item -> 'role_keys') role_input(role_key)
      where role_input.role_key in ('committee_head', 'president_vice_president')
    ) > 1 then
      raise exception 'Choose only one school-year leadership access level'
        using errcode = '23514';
    end if;

    requested_roles := case
      when selected_access_role = 'member' then array['member']::text[]
      else array['member', selected_access_role]::text[]
    end;

    select prior.id into source_membership_id
    from public.school_year_memberships prior
    join public.school_years prior_year on prior_year.id = prior.school_year_id
    where prior.profile_id = target_profile_id
      and prior.school_year_id <> p_school_year_id
    order by prior_year.start_date desc, prior.created_at desc, prior.id
    limit 1;

    insert into public.school_year_memberships (
      profile_id,
      school_year_id,
      status,
      expiration_date,
      target_hours_override,
      renewed_from_membership_id,
      created_by_profile_id
    ) values (
      target_profile_id,
      p_school_year_id,
      'active',
      target_year.end_date,
      null,
      source_membership_id,
      (select auth.uid())
    )
    on conflict on constraint school_year_memberships_profile_year_unique do update
    set status = 'active',
        expiration_date = excluded.expiration_date,
        target_hours_override = null,
        renewed_from_membership_id = coalesce(
          public.school_year_memberships.renewed_from_membership_id,
          excluded.renewed_from_membership_id
        )
    returning * into target_membership;

    delete from public.membership_roles assignment
    where assignment.membership_id = target_membership.id;

    insert into public.membership_roles (
      membership_id,
      role_id,
      assigned_by_profile_id
    )
    select target_membership.id, role.id, (select auth.uid())
    from public.roles role
    where role.role_key = any(requested_roles);

    if (
      select count(*)
      from public.membership_roles assignment
      where assignment.membership_id = target_membership.id
    ) <> cardinality(requested_roles) then
      raise exception 'Required school-year roles are not configured'
        using errcode = '55000';
    end if;

    perform private.write_audit(
      'membership.renewed',
      'school_year_membership',
      target_membership.id::text,
      p_school_year_id,
      administrator_membership_id,
      null,
      jsonb_build_object(
        'operation', 'destination_access_set',
        'profile_id', target_profile_id,
        'expiration_date', target_year.end_date,
        'target_hours_override', null,
        'role_keys', requested_roles,
        'renewed_from_membership_id', target_membership.renewed_from_membership_id
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
  target_profile_id uuid;
  target_school_year_id uuid;
  previous_status text;
begin
  administrator_membership_id := private.require_teacher_admin();
  if p_status not in ('active', 'expired', 'suspended', 'archived') then
    raise exception 'Invalid membership status' using errcode = '22023';
  end if;

  select profile_id, school_year_id
  into target_profile_id, target_school_year_id
  from public.school_year_memberships
  where id = p_membership_id;
  if not found then raise exception 'Membership not found' using errcode = 'P0002'; end if;

  -- Lock in the same year -> profile -> membership order as destination-access
  -- assignment.  Closing a year or renewing an account therefore serializes
  -- cleanly with status changes instead of leaving a stale "active" row.
  perform 1
  from public.school_years school_year
  where school_year.id = target_school_year_id
  for share;
  perform 1
  from public.profiles profile
  where profile.id = target_profile_id
  for update;
  select * into membership_record
  from public.school_year_memberships
  where id = p_membership_id
  for update;
  if not found then raise exception 'Membership not found' using errcode = 'P0002'; end if;
  if exists (
    select 1
    from public.platform_access_grants grant_row
    where grant_row.profile_id = membership_record.profile_id
  ) then
    raise exception 'Teacher-administrator access is global and cannot be changed by year'
      using errcode = '23514';
  end if;
  if not exists (
    select 1
    from public.school_years school_year
    join public.profiles profile on profile.id = membership_record.profile_id
    where school_year.id = membership_record.school_year_id
      and school_year.status in ('draft', 'active')
      and profile.status = 'active'
      and membership_record.expiration_date >= greatest(current_date, school_year.start_date)
  ) then
    raise exception 'Historical or expired school-year access is read-only; assign access in an open school year'
      using errcode = '23514';
  end if;
  previous_status := membership_record.status;
  update public.school_year_memberships
  set status = p_status
  where id = p_membership_id
  returning * into membership_record;
  perform private.write_audit(
    'membership.status_changed', 'school_year_membership', membership_record.id::text,
    membership_record.school_year_id, administrator_membership_id,
    jsonb_build_object('status', previous_status), jsonb_build_object('status', p_status)
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
  target_access_level text;
begin
  administrator_membership_id := private.require_teacher_admin();
  if p_status not in ('active', 'inactive') then
    raise exception 'Invalid profile status' using errcode = '22023';
  end if;
  select * into profile_record from public.profiles where id = p_profile_id for update;
  if not found then raise exception 'Profile not found' using errcode = 'P0002'; end if;
  select access_level into target_access_level
  from public.platform_access_grants
  where profile_id = p_profile_id;
  if target_access_level is not null and not private.current_actor_is_platform_owner() then
    raise exception 'Only the platform owner may change a global administrator profile'
      using errcode = '42501';
  end if;
  previous_status := profile_record.status;
  update public.profiles
  set status = p_status,
      deactivated_at = case when p_status = 'inactive' then statement_timestamp() else null end,
      deactivated_by_profile_id = case when p_status = 'inactive' then (select auth.uid()) else null end
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
  membership_record public.school_year_memberships%rowtype;
  school_year_id_value uuid;
  target_profile_id uuid;
begin
  administrator_membership_id := private.require_teacher_admin();
  if p_role_key = 'teacher_admin' then
    raise exception 'Teacher-administrator access is global; use the global administrator workflow'
      using errcode = '23514';
  end if;
  select id into role_id_value
  from public.roles
  where role_key = p_role_key
    and role_key in ('member', 'committee_head', 'president_vice_president');
  if role_id_value is null then raise exception 'Unknown role' using errcode = '22023'; end if;
  select school_year_id, profile_id into school_year_id_value, target_profile_id
  from public.school_year_memberships where id = p_membership_id;
  if not found then raise exception 'Membership not found' using errcode = 'P0002'; end if;
  perform 1
  from public.school_years school_year
  where school_year.id = school_year_id_value
  for share;
  perform 1 from public.profiles where id = target_profile_id for update;
  select * into membership_record
  from public.school_year_memberships
  where id = p_membership_id
  for update;
  if not found then raise exception 'Membership not found' using errcode = 'P0002'; end if;
  if exists (
    select 1 from public.platform_access_grants where profile_id = target_profile_id
  ) then
    raise exception 'Global teacher administrators cannot hold school-year roles'
      using errcode = '23514';
  end if;
  if not exists (
    select 1
    from public.school_years school_year
    join public.profiles profile on profile.id = membership_record.profile_id
    where school_year.id = membership_record.school_year_id
      and school_year.status in ('draft', 'active')
      and profile.status = 'active'
      and membership_record.status = 'active'
      and membership_record.expiration_date >= greatest(current_date, school_year.start_date)
  ) then
    raise exception 'Historical or expired school-year roles are read-only; assign access in an open school year'
      using errcode = '23514';
  end if;
  if p_role_key <> 'member'
    and not private.membership_has_role(p_membership_id, 'member', false) then
    raise exception 'Leadership roles require the member role' using errcode = '23514';
  end if;
  insert into public.membership_roles (membership_id, role_id, assigned_by_profile_id)
  values (p_membership_id, role_id_value, (select auth.uid()))
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
  membership_record public.school_year_memberships%rowtype;
  school_year_id_value uuid;
  target_profile_id uuid;
  removed_count integer;
begin
  administrator_membership_id := private.require_teacher_admin();
  if p_role_key = 'member' then
    raise exception 'The baseline member role cannot be removed' using errcode = '23514';
  end if;
  if p_role_key = 'teacher_admin' then
    raise exception 'Teacher-administrator access is global; use the global administrator workflow'
      using errcode = '23514';
  end if;
  select id into role_id_value
  from public.roles
  where role_key = p_role_key
    and role_key in ('committee_head', 'president_vice_president');
  if role_id_value is null then raise exception 'Unknown role' using errcode = '22023'; end if;
  select school_year_id, profile_id into school_year_id_value, target_profile_id
  from public.school_year_memberships where id = p_membership_id;
  if not found then raise exception 'Membership not found' using errcode = 'P0002'; end if;
  perform 1
  from public.school_years school_year
  where school_year.id = school_year_id_value
  for share;
  perform 1 from public.profiles where id = target_profile_id for update;
  select * into membership_record
  from public.school_year_memberships
  where id = p_membership_id
  for update;
  if not found then raise exception 'Membership not found' using errcode = 'P0002'; end if;
  if exists (
    select 1 from public.platform_access_grants where profile_id = target_profile_id
  ) then
    raise exception 'Global teacher administrators cannot hold school-year roles'
      using errcode = '23514';
  end if;
  if not exists (
    select 1
    from public.school_years school_year
    join public.profiles profile on profile.id = membership_record.profile_id
    where school_year.id = membership_record.school_year_id
      and school_year.status in ('draft', 'active')
      and profile.status = 'active'
      and membership_record.status = 'active'
      and membership_record.expiration_date >= greatest(current_date, school_year.start_date)
  ) then
    raise exception 'Historical or expired school-year roles are read-only; assign access in an open school year'
      using errcode = '23514';
  end if;
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

create or replace function public.grant_teacher_admin(p_profile_id uuid)
returns public.platform_access_grants
language plpgsql
security definer
set search_path = ''
as $$
declare
  administrator_membership_id uuid;
  grant_record public.platform_access_grants%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('nhs.platform_access', 0));
  perform private.require_platform_owner();
  administrator_membership_id := private.require_teacher_admin();
  perform 1
  from public.school_years school_year
  order by school_year.id
  for share;
  perform 1
  from public.profiles
  where id = p_profile_id and status = 'active'
  for update;
  if not found then
    raise exception 'An active profile is required' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.school_year_memberships membership
    join public.membership_roles assignment on assignment.membership_id = membership.id
    join public.roles role on role.id = assignment.role_id
    where membership.profile_id = p_profile_id and role.role_key = 'member'
  ) or exists (
    select 1
    from public.hour_requests request
    join public.school_year_memberships membership
      on membership.id = request.member_membership_id
    where membership.profile_id = p_profile_id
  ) then
    raise exception 'Use a separate account for a global teacher administrator'
      using errcode = '23514';
  end if;
  insert into public.platform_access_grants (
    profile_id, access_level, granted_by_profile_id
  ) values (
    p_profile_id, 'teacher_admin', (select auth.uid())
  )
  on conflict (profile_id) do update
  set access_level = public.platform_access_grants.access_level
  returning * into grant_record;
  perform private.ensure_teacher_admin_anchors(p_profile_id, null);
  perform private.write_audit(
    'teacher_admin.granted', 'profile', p_profile_id::text, null,
    administrator_membership_id, null,
    jsonb_build_object('access_level', grant_record.access_level)
  );
  return grant_record;
end;
$$;

create or replace function public.revoke_teacher_admin(p_profile_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  administrator_membership_id uuid;
  target_access_level text;
  removed_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('nhs.platform_access', 0));
  perform private.require_platform_owner();
  administrator_membership_id := private.require_teacher_admin();
  select access_level into target_access_level
  from public.platform_access_grants
  where profile_id = p_profile_id
  for update;
  if target_access_level is null then return false; end if;
  if target_access_level = 'platform_owner' then
    raise exception 'Transfer platform ownership before revoking this account'
      using errcode = '23514';
  end if;
  perform set_config('nhs.allow_platform_access_change', 'on', true);
  delete from public.platform_access_grants where profile_id = p_profile_id;
  get diagnostics removed_count = row_count;
  delete from public.membership_roles assignment
  using public.school_year_memberships membership,
        public.roles role
  where assignment.membership_id = membership.id
    and membership.profile_id = p_profile_id
    and assignment.role_id = role.id
    and role.role_key = 'teacher_admin';
  update public.school_year_memberships
  set status = 'archived'
  where profile_id = p_profile_id;
  perform private.write_audit(
    'teacher_admin.revoked', 'profile', p_profile_id::text, null,
    administrator_membership_id,
    jsonb_build_object('access_level', target_access_level), null
  );
  return removed_count > 0;
end;
$$;

create or replace function public.transfer_platform_owner(p_profile_id uuid)
returns public.platform_access_grants
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_owner_id uuid;
  administrator_membership_id uuid;
  grant_record public.platform_access_grants%rowtype;
  target_profile public.profiles%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('nhs.platform_access', 0));
  previous_owner_id := private.require_platform_owner();
  administrator_membership_id := private.require_teacher_admin();
  if p_profile_id = previous_owner_id then
    select * into grant_record
    from public.platform_access_grants where profile_id = p_profile_id;
    return grant_record;
  end if;
  select * into target_profile
  from public.profiles
  where id = p_profile_id
  for update;
  if not found or target_profile.status <> 'active' then
    raise exception 'Ownership can transfer only to an active global teacher administrator'
      using errcode = '22023';
  end if;
  perform 1
  from public.platform_access_grants grant_row
  where grant_row.profile_id = p_profile_id
    and grant_row.access_level = 'teacher_admin'
  for update;
  if not found then
    raise exception 'Ownership can transfer only to an active global teacher administrator'
      using errcode = '22023';
  end if;
  perform set_config('nhs.allow_platform_access_change', 'on', true);
  update public.platform_access_grants
  set access_level = 'teacher_admin'
  where profile_id = previous_owner_id;
  update public.platform_access_grants
  set access_level = 'platform_owner'
  where profile_id = p_profile_id
  returning * into grant_record;
  perform private.write_audit(
    'platform_owner.transferred', 'profile', p_profile_id::text, null,
    administrator_membership_id,
    jsonb_build_object('profile_id', previous_owner_id),
    jsonb_build_object('profile_id', p_profile_id)
  );
  return grant_record;
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
  requested_roles text[];
  normalized_roles text[];
  is_teacher_admin_invitation boolean;
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

  select coalesce(array_agg(distinct role_key order by role_key), '{}'::text[])
  into requested_roles
  from unnest(coalesce(p_role_keys, '{}'::text[])) as role_input(role_key)
  where nullif(btrim(role_key), '') is not null;
  is_teacher_admin_invitation := 'teacher_admin' = any(requested_roles);

  if is_teacher_admin_invitation then
    perform pg_advisory_xact_lock(hashtextextended('nhs.platform_access', 0));
    perform private.require_platform_owner();
    if cardinality(requested_roles) <> 1 then
      raise exception 'Teacher administrator must be the invitation''s only role'
        using errcode = '23514';
    end if;
    normalized_roles := array['teacher_admin'];
  else
    select array_agg(distinct role_key order by role_key)
    into normalized_roles
    from (
      select unnest(requested_roles) as role_key
      union all select 'member'
    ) normalized;
    if exists (
      select 1 from unnest(normalized_roles) as requested_role(role_key)
      where requested_role.role_key not in (
        'member', 'committee_head', 'president_vice_president'
      )
    ) then
      raise exception 'Invitation contains an unknown role' using errcode = '22023';
    end if;
  end if;

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
  ) values (
    normalized_email, btrim(p_full_name), p_school_year_id, p_expires_at,
    administrator_membership_id
  )
  returning * into invitation_record;
  insert into public.invitation_roles (invitation_id, role_id)
  select invitation_record.id, role.id
  from public.roles role
  where role.role_key = any(normalized_roles);
  perform private.write_audit(
    'invitation.created', 'invitation', invitation_record.id::text, p_school_year_id,
    administrator_membership_id, null,
    jsonb_build_object(
      'email', normalized_email,
      'role_keys', normalized_roles,
      'expires_at', p_expires_at,
      'global_access', is_teacher_admin_invitation
    )
  );
  return invitation_record;
end;
$$;

-- Invitation delivery remains a two-phase provider workflow.  Teacher-admin
-- invitations are global, so only the platform owner may operate them and a
-- later school-year close does not invalidate their resend metadata.
create or replace function public.prepare_invitation_send(p_invitation_id uuid)
returns table (
  invitation_id uuid,
  email text,
  full_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  administrator_invitation boolean;
begin
  perform private.require_teacher_admin();

  select exists (
    select 1
    from public.invitation_roles assignment
    join public.roles role on role.id = assignment.role_id
    where assignment.invitation_id = p_invitation_id
      and role.role_key = 'teacher_admin'
  ) into administrator_invitation;
  if administrator_invitation then
    perform pg_advisory_xact_lock(hashtextextended('nhs.platform_access', 0));
    perform private.require_platform_owner();
  end if;

  return query
  select invitation.id, invitation.email::text, invitation.full_name
  from public.invitations invitation
  join public.school_years school_year on school_year.id = invitation.school_year_id
  where invitation.id = p_invitation_id
    and invitation.status = 'pending'
    and (
      administrator_invitation
      or school_year.status in ('draft', 'active')
    );

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
  administrator_invitation boolean;
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

  select exists (
    select 1
    from public.invitation_roles assignment
    join public.roles role on role.id = assignment.role_id
    where assignment.invitation_id = invitation_record.id
      and role.role_key = 'teacher_admin'
  ) into administrator_invitation;
  if administrator_invitation then
    perform pg_advisory_xact_lock(hashtextextended('nhs.platform_access', 0));
    perform private.require_platform_owner();
  end if;

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
  if not administrator_invitation and not exists (
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
  administrator_invitation boolean;
  invitation_record public.invitations%rowtype;
begin
  administrator_membership_id := private.require_teacher_admin();
  select * into invitation_record
  from public.invitations where id = p_invitation_id for update;
  if not found then raise exception 'Invitation not found' using errcode = 'P0002'; end if;

  select exists (
    select 1
    from public.invitation_roles assignment
    join public.roles role on role.id = assignment.role_id
    where assignment.invitation_id = invitation_record.id
      and role.role_key = 'teacher_admin'
  ) into administrator_invitation;
  if administrator_invitation then
    perform pg_advisory_xact_lock(hashtextextended('nhs.platform_access', 0));
    perform private.require_platform_owner();
  end if;

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
  administrator_invitation boolean;
  inviter_profile_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  caller_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  if caller_email = '' then
    select lower(email) into caller_email
    from auth.users where id = (select auth.uid());
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
    where auth_user.id = (select auth.uid()) and lower(auth_user.email) = caller_email
  ) then
    raise exception 'Authenticated user record is missing' using errcode = '42501';
  end if;

  select exists (
    select 1
    from public.invitation_roles assignment
    join public.roles role on role.id = assignment.role_id
    where assignment.invitation_id = invitation_record.id
      and role.role_key = 'teacher_admin'
  ) into administrator_invitation;
  if administrator_invitation and exists (
    select 1
    from public.invitation_roles assignment
    join public.roles role on role.id = assignment.role_id
    where assignment.invitation_id = invitation_record.id
      and role.role_key <> 'teacher_admin'
  ) then
    raise exception 'Teacher-administrator invitation contains incompatible roles'
      using errcode = '23514';
  end if;

  select profile_id into inviter_profile_id
  from public.school_year_memberships
  where id = invitation_record.invited_by_membership_id;

  if administrator_invitation then
    perform pg_advisory_xact_lock(hashtextextended('nhs.platform_access', 0));
    perform 1
    from public.school_years school_year
    order by school_year.id
    for share;
    select grant_row.profile_id into inviter_profile_id
    from public.platform_access_grants grant_row
    join public.profiles profile on profile.id = grant_row.profile_id
    where grant_row.access_level = 'platform_owner'
      and profile.status = 'active'
    for share of grant_row;
    if inviter_profile_id is null then
      raise exception 'The administrator invitation is no longer authorized'
        using errcode = '42501';
    end if;
  end if;

  insert into public.profiles (id, email, full_name)
  values ((select auth.uid()), caller_email, invitation_record.full_name)
  on conflict (id) do update
  set email = excluded.email, full_name = excluded.full_name;

  if administrator_invitation then
    if exists (
      select 1
      from public.school_year_memberships membership
      join public.membership_roles assignment on assignment.membership_id = membership.id
      join public.roles role on role.id = assignment.role_id
      where membership.profile_id = (select auth.uid())
        and role.role_key = 'member'
    ) or exists (
      select 1
      from public.hour_requests request
      join public.school_year_memberships membership
        on membership.id = request.member_membership_id
      where membership.profile_id = (select auth.uid())
    ) then
      raise exception 'Use a separate account for a global teacher administrator'
        using errcode = '23514';
    end if;
    insert into public.platform_access_grants (
      profile_id, access_level, granted_by_profile_id
    ) values (
      (select auth.uid()), 'teacher_admin', inviter_profile_id
    );
    select membership.* into membership_record
    from public.school_year_memberships membership
    where membership.profile_id = (select auth.uid())
      and membership.school_year_id = invitation_record.school_year_id;
  else
    insert into public.school_year_memberships (
      profile_id, school_year_id, status, expiration_date,
      target_hours_override, created_by_profile_id
    )
    select (select auth.uid()), school_year.id, 'active', school_year.end_date,
           null, inviter_profile_id
    from public.school_years school_year
    where school_year.id = invitation_record.school_year_id
      and school_year.status in ('draft', 'active')
    on conflict (profile_id, school_year_id) do update
    set status = 'active', target_hours_override = null
    returning * into membership_record;
    if membership_record.id is null then
      raise exception 'Invitation school year is no longer open' using errcode = '55000';
    end if;
    insert into public.membership_roles (membership_id, role_id, assigned_by_profile_id)
    select membership_record.id, assignment.role_id, inviter_profile_id
    from public.invitation_roles assignment
    join public.roles role on role.id = assignment.role_id
    where assignment.invitation_id = invitation_record.id
      and role.role_key <> 'teacher_admin'
    on conflict (membership_id, role_id) do nothing;
  end if;

  if membership_record.id is null then
    raise exception 'Invitation did not create an access record' using errcode = '55000';
  end if;
  update public.invitations
  set status = 'accepted', accepted_by_profile_id = (select auth.uid()),
      accepted_at = statement_timestamp()
  where id = invitation_record.id;
  perform private.write_audit(
    'invitation.accepted', 'invitation', invitation_record.id::text,
    invitation_record.school_year_id, membership_record.id,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object(
      'status', 'accepted',
      'profile_id', (select auth.uid()),
      'global_access', administrator_invitation
    )
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
      name, description, display_order, is_active,
      default_max_hours_per_request, created_by_profile_id
    ) values (
      btrim(p_name), nullif(btrim(p_description), ''), 0, p_is_active,
      null, (select auth.uid())
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
    set name = btrim(p_name),
        description = nullif(btrim(p_description), ''),
        display_order = 0,
        is_active = p_is_active,
        default_max_hours_per_request = null
    where id = p_category_id
    returning * into category_record;
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
    school_year_id, category_id, is_available, display_order,
    max_hours_per_request, member_approved_hours_cap, created_by_profile_id
  ) values (
    p_school_year_id, p_category_id, p_is_available, 0,
    null, null, (select auth.uid())
  )
  on conflict (school_year_id, category_id) do update
  set is_available = excluded.is_available,
      display_order = 0,
      max_hours_per_request = null,
      member_approved_hours_cap = null
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
  20.00::numeric(7, 2) as target_hours,
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
  greatest(20.00 - coalesce(request_summary.approved_hours, 0), 0)::numeric(12, 2)
    as remaining_hours,
  greatest(coalesce(request_summary.approved_hours, 0) - 20.00, 0)::numeric(12, 2)
    as over_goal_hours,
  request_summary.last_activity_at,
  round(coalesce(request_summary.approved_hours, 0) / 20.00 * 100, 2)::numeric(7, 2)
    as progress_percent,
  round(coalesce(request_summary.approved_hours, 0) / 20.00 * 100, 2)::numeric(7, 2)
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

create or replace view public.category_totals
with (security_invoker = true)
as
select
  membership.id as member_membership_id,
  membership.profile_id,
  membership.school_year_id,
  year_category.category_id,
  category.name::text as category_name,
  null::numeric(7, 2) as member_approved_hours_cap,
  coalesce(sum(request.hours) filter (where request.status = 'approved'), 0)::numeric(12, 2)
    as approved_hours,
  coalesce(sum(request.hours) filter (where request.status = 'pending'), 0)::numeric(12, 2)
    as pending_hours,
  null::numeric(12, 2) as remaining_category_hours
from public.school_year_memberships membership
join public.school_year_categories year_category
  on year_category.school_year_id = membership.school_year_id
join public.service_categories category on category.id = year_category.category_id
left join public.hour_requests request
  on request.member_membership_id = membership.id
 and request.category_id = year_category.category_id
where private.is_service_member_membership(membership.id)
group by membership.id, membership.profile_id, membership.school_year_id,
  year_category.category_id, category.name;

create or replace view public.school_year_summary
with (security_invoker = true)
as
select
  school_year.id as school_year_id,
  school_year.label::text as school_year_label,
  school_year.start_date,
  school_year.end_date,
  school_year.status,
  20.00::numeric(7, 2) as default_target_hours,
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

alter table public.platform_access_grants enable row level security;
alter table public.platform_access_grants force row level security;

create policy platform_access_grants_select_authorized
on public.platform_access_grants for select to authenticated
using (
  profile_id = (select auth.uid())
  or private.current_actor_is_teacher_admin()
);

revoke all on table public.platform_access_grants from anon, authenticated;
grant select on table public.platform_access_grants to authenticated;

revoke all on function private.current_platform_access_level()
  from public, anon, authenticated;
revoke all on function private.current_actor_is_platform_owner()
  from public, anon, authenticated;
revoke all on function private.current_teacher_admin_membership_id(uuid, boolean)
  from public, anon, authenticated;
revoke all on function private.require_platform_owner()
  from public, anon, authenticated;
revoke all on function private.is_service_member_membership(uuid)
  from public, anon, authenticated;
revoke all on function private.ensure_teacher_admin_anchors(uuid, uuid)
  from public, anon, authenticated;
revoke all on function private.platform_access_create_anchors()
  from public, anon, authenticated;
revoke all on function private.serialize_platform_access_insert()
  from public, anon, authenticated;
revoke all on function private.school_year_create_admin_anchors()
  from public, anon, authenticated;
revoke all on function private.serialize_school_year_insert()
  from public, anon, authenticated;
revoke all on function private.enforce_membership_role_scope()
  from public, anon, authenticated;
revoke all on function private.protect_platform_access_grant()
  from public, anon, authenticated;
revoke all on function private.enforce_fixed_school_year_target()
  from public, anon, authenticated;
revoke all on function private.enforce_no_membership_target_override()
  from public, anon, authenticated;
revoke all on function private.neutralize_service_category_policy()
  from public, anon, authenticated;
revoke all on function private.neutralize_school_year_category_policy()
  from public, anon, authenticated;

-- These predicates are referenced by caller-safe RLS/views.
grant execute on function private.current_actor_is_platform_owner() to authenticated;
grant execute on function private.is_service_member_membership(uuid) to authenticated;

revoke all on function public.grant_teacher_admin(uuid)
  from public, anon, authenticated;
revoke all on function public.revoke_teacher_admin(uuid)
  from public, anon, authenticated;
revoke all on function public.transfer_platform_owner(uuid)
  from public, anon, authenticated;
grant execute on function public.grant_teacher_admin(uuid) to authenticated;
grant execute on function public.revoke_teacher_admin(uuid) to authenticated;
grant execute on function public.transfer_platform_owner(uuid) to authenticated;

-- CREATE OR REPLACE preserves ACLs, but restate the invitation boundary so a
-- future baseline change cannot accidentally reopen these security-definer RPCs.
revoke all on function public.prepare_invitation_send(uuid)
  from public, anon, authenticated;
revoke all on function public.record_invitation_send_success(uuid, uuid, timestamp with time zone)
  from public, anon, authenticated;
revoke all on function public.revoke_invitation(uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_invitation_send(uuid) to authenticated;
grant execute on function public.record_invitation_send_success(uuid, uuid, timestamp with time zone)
  to authenticated;
grant execute on function public.revoke_invitation(uuid) to authenticated;

-- Reassert the original privilege boundary for the replaced bootstrap.  CREATE
-- OR REPLACE normally preserves it; these statements make that property explicit.
revoke all on function public.bootstrap_teacher_admin(
  uuid, text, text, text, date, date, numeric, date
) from public, anon, authenticated;
grant execute on function public.bootstrap_teacher_admin(
  uuid, text, text, text, date, date, numeric, date
) to service_role;

commit;
