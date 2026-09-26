begin;

create or replace function public.list_service_events(p_event_id uuid default null)
returns table (
  id uuid,
  school_year_id uuid,
  school_year_label text,
  title text,
  description text,
  location text,
  volunteer_audience text,
  starts_at timestamp without time zone,
  ends_at timestamp without time zone,
  contact_name text,
  contact_email text,
  capacity integer,
  organizer_name text,
  confirmed_count integer,
  waitlist_count integer,
  spots_remaining integer,
  is_expired boolean,
  my_registration_status text,
  my_waitlist_position integer,
  can_manage boolean,
  signup_deadline timestamp without time zone,
  is_signup_closed boolean,
  ended_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_provisioned_profile() then
    raise exception 'A provisioned portal account is required' using errcode = '42501';
  end if;

  return query
  select
    event.id,
    event.school_year_id,
    school_year.label::text,
    event.title,
    event.description,
    event.location,
    event.volunteer_audience,
    event.starts_at,
    event.ends_at,
    event.contact_name,
    event.contact_email::text,
    event.capacity::integer,
    organizer.full_name,
    case when visibility.is_expired and not visibility.can_manage then null::integer
      else counts.confirmed_count end,
    case when visibility.is_expired and not visibility.can_manage then null::integer
      else counts.waitlist_count end,
    case when visibility.is_expired and not visibility.can_manage then null::integer
      else greatest(event.capacity::integer - counts.confirmed_count, 0) end,
    visibility.is_expired,
    own_registration.status,
    case
      when own_registration.status = 'waitlisted'
        and (not visibility.is_expired or visibility.can_manage) then (
        select count(*)::integer
        from public.service_event_registrations queue_registration
        where queue_registration.event_id = event.id
          and queue_registration.status = 'waitlisted'
          and (queue_registration.joined_at, queue_registration.id)
            <= (own_registration.joined_at, own_registration.id)
      )
      else null
    end,
    visibility.can_manage,
    event.signup_deadline,
    (visibility.is_expired
      or event.signup_deadline <= timezone('America/New_York', statement_timestamp())),
    event.ended_at,
    event.updated_at
  from public.service_events event
  join public.school_years school_year on school_year.id = event.school_year_id
  join public.profiles organizer on organizer.id = event.created_by_profile_id
  cross join lateral (
    select
      (event.ended_at is not null
        or event.ends_at <= timezone('America/New_York', statement_timestamp())) as is_expired,
      private.can_manage_service_event(event.id) as can_manage
  ) visibility
  cross join lateral (
    select
      count(*) filter (where registration.status = 'confirmed')::integer as confirmed_count,
      count(*) filter (where registration.status = 'waitlisted')::integer as waitlist_count
    from public.service_event_registrations registration
    where registration.event_id = event.id
  ) counts
  left join lateral (
    select registration.id, registration.status, registration.joined_at
    from public.service_event_registrations registration
    join public.school_year_memberships membership
      on membership.id = registration.member_membership_id
    where registration.event_id = event.id
      and membership.profile_id = (select auth.uid())
    limit 1
  ) own_registration on true
  where event.deleted_at is null and (p_event_id is null or event.id = p_event_id)
  order by event.starts_at, event.id;
end;
$$;

commit;
