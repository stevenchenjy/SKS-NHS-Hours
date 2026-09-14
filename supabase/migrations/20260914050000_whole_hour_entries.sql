begin;

-- Validate at RPC boundaries before numeric storage can round input.
-- Existing records and immutable history retain their original values.
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
  if p_hours is not null and (p_hours <= 0 or p_hours > 24 or mod(p_hours, 1) <> 0) then
    raise exception 'Hours must be a whole number from 1 to 24'
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
    if not private.is_committee_head_membership(
      p_requested_approver_membership_id,
      p_school_year_id
    ) then
      raise exception 'Requested approver is not an active committee head for this school year'
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
  if p_description is not null and length(btrim(p_description)) > 4000 then
    raise exception 'Description must not exceed 4000 characters' using errcode = '22023';
  end if;
  if p_service_date is null
    or p_service_date < year_record.start_date
    or p_service_date > year_record.end_date
    or p_service_date > current_date then
    raise exception 'Service date must be within the school year and not in the future'
      using errcode = '22023';
  end if;
  if p_hours is null or p_hours <= 0 or p_hours > 24 or mod(p_hours, 1) <> 0 then
    raise exception 'Hours must be a whole number from 1 to 24'
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
    raise exception 'Committee head approver is required' using errcode = '22023';
  end if;
  if p_require_open_year and not private.is_committee_head_membership(
    p_requested_approver_membership_id,
    p_school_year_id
  ) then
    raise exception 'Requested approver is not an active committee head for this school year'
      using errcode = '22023';
  end if;
end;
$$;


commit;
