-- School-year access is governed by the configured dates, so administrators
-- do not need a manual close operation. Keep the legacy status values for
-- historical compatibility while reopening any current or future year that
-- was closed prematurely.
update public.school_years
set status = case
      when current_date between start_date and end_date then 'active'
      else 'draft'
    end,
    closed_at = null,
    closed_by_profile_id = null
where status = 'closed'
  and end_date >= current_date;

create or replace function public.update_school_year_dates(
  p_school_year_id uuid,
  p_start_date date,
  p_end_date date
)
returns public.school_years
language plpgsql
security definer
set search_path = ''
as $$
declare
  administrator_membership_id uuid;
  year_record public.school_years%rowtype;
  previous_values jsonb;
  next_status text;
begin
  administrator_membership_id := private.require_teacher_admin();
  perform pg_advisory_xact_lock(
    hashtextextended('nhs.school_year:' || p_school_year_id::text, 0)
  );

  select * into year_record
  from public.school_years
  where id = p_school_year_id
  for update;

  if not found then
    raise exception 'School year not found' using errcode = 'P0002';
  end if;
  if year_record.status = 'archived' then
    raise exception 'Archived school-year dates are read-only' using errcode = '55000';
  end if;
  if p_start_date is null or p_end_date is null or p_start_date >= p_end_date then
    raise exception 'The school-year end date must be after its start date'
      using errcode = '22023';
  end if;
  if extract(year from p_start_date)::integer
       <> split_part(year_record.label::text, '-', 1)::integer
    or extract(year from p_end_date)::integer
       <> split_part(year_record.label::text, '-', 2)::integer then
    raise exception 'School-year dates must match the years in its label'
      using errcode = '22023';
  end if;

  previous_values := jsonb_build_object(
    'start_date', year_record.start_date,
    'end_date', year_record.end_date,
    'status', year_record.status
  );
  next_status := case
    when year_record.status = 'closed'
      and current_date between p_start_date and p_end_date then 'active'
    when year_record.status = 'closed' then 'draft'
    else year_record.status
  end;

  update public.school_years
  set start_date = p_start_date,
      end_date = p_end_date,
      status = next_status,
      closed_at = case when next_status = 'closed' then closed_at else null end,
      closed_by_profile_id = case
        when next_status = 'closed' then closed_by_profile_id
        else null
      end
  where id = p_school_year_id
  returning * into year_record;

  -- Only move memberships whose expiration was automatically tied to the
  -- prior year end. Deliberately shortened or already-expired access stays put.
  -- The year row is updated first so an extended expiration remains inside
  -- the date range enforced by the membership validation trigger.
  update public.school_year_memberships
  set expiration_date = p_end_date
  where school_year_id = p_school_year_id
    and expiration_date = (previous_values ->> 'end_date')::date;

  perform private.write_audit(
    'school_year.dates_updated',
    'school_year',
    year_record.id::text,
    year_record.id,
    administrator_membership_id,
    previous_values,
    jsonb_build_object(
      'start_date', year_record.start_date,
      'end_date', year_record.end_date,
      'status', year_record.status
    )
  );

  return year_record;
end;
$$;

revoke all on function public.update_school_year_dates(uuid, date, date) from public;
grant execute on function public.update_school_year_dates(uuid, date, date) to authenticated;
