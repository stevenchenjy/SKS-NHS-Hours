begin;

create or replace function public.list_service_event_roster(p_event_id uuid)
returns table (
  registration_id bigint,
  member_membership_id uuid,
  full_name text,
  email text,
  status text,
  joined_at timestamptz,
  promoted_at timestamptz,
  waitlist_position integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (
    private.can_manage_service_event(p_event_id)
    or exists (
      select 1
      from public.service_events event
      where event.id = p_event_id
        and event.deleted_at is null
        and event.ended_at is null
        and event.ends_at > timezone('America/New_York', statement_timestamp())
        and private.membership_has_role(
          private.current_membership_id(event.school_year_id, true),
          'president_vice_president',
          true
        )
    )
  ) then
    raise exception 'Only an event manager or active school-year president can view its roster'
      using errcode = '42501';
  end if;

  return query
  select
    registration.id,
    registration.member_membership_id,
    profile.full_name,
    profile.email::text,
    registration.status,
    registration.joined_at,
    registration.promoted_at,
    case
      when registration.status = 'waitlisted' then (
        row_number() over (
          partition by registration.status
          order by registration.joined_at, registration.id
        )
      )::integer
      else null
    end
  from public.service_event_registrations registration
  join public.school_year_memberships membership
    on membership.id = registration.member_membership_id
  join public.profiles profile on profile.id = membership.profile_id
  where registration.event_id = p_event_id
    and registration.status in ('confirmed', 'waitlisted')
  order by
    case registration.status when 'confirmed' then 0 else 1 end,
    registration.joined_at,
    registration.id;
end;
$$;

commit;
