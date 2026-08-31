begin;

-- Volunteer opportunities use a capacity-first roster. Active members are
-- confirmed until capacity is reached, then placed on a FIFO waitlist. Every
-- signup/drop operation locks the event row so concurrent requests cannot
-- oversubscribe an event or promote more than one waiting member.
create table public.service_events (
  id uuid primary key default gen_random_uuid(),
  school_year_id uuid not null references public.school_years (id) on delete restrict,
  title text not null,
  description text not null,
  location text not null,
  volunteer_audience text not null,
  starts_at timestamp without time zone not null,
  ends_at timestamp without time zone not null,
  contact_name text not null,
  contact_email extensions.citext not null,
  capacity smallint not null,
  created_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  created_by_membership_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint service_events_id_year_unique unique (id, school_year_id),
  constraint service_events_creator_membership_year_fkey
    foreign key (created_by_membership_id, school_year_id)
    references public.school_year_memberships (id, school_year_id) on delete restrict,
  constraint service_events_title_length
    check (length(btrim(title)) between 1 and 160),
  constraint service_events_description_length
    check (length(btrim(description)) between 1 and 5000),
  constraint service_events_location_length
    check (length(btrim(location)) between 1 and 300),
  constraint service_events_audience_length
    check (length(btrim(volunteer_audience)) between 1 and 500),
  constraint service_events_contact_name_length
    check (length(btrim(contact_name)) between 1 and 200),
  constraint service_events_contact_email_valid check (
    length(btrim(contact_email::text)) between 3 and 320
    and contact_email::text ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint service_events_capacity_valid check (capacity between 1 and 500),
  constraint service_events_time_order check (starts_at < ends_at)
);

create index service_events_school_year_starts_idx
  on public.service_events (school_year_id, starts_at desc);
create index service_events_timeline_idx
  on public.service_events (ends_at, starts_at);
create index service_events_creator_profile_idx
  on public.service_events (created_by_profile_id, starts_at desc);
create index service_events_creator_membership_idx
  on public.service_events (created_by_membership_id);

create table public.service_event_registrations (
  id bigint generated always as identity primary key,
  event_id uuid not null,
  school_year_id uuid not null,
  member_membership_id uuid not null,
  status text not null,
  joined_at timestamptz not null default statement_timestamp(),
  promoted_at timestamptz,
  withdrawn_at timestamptz,
  updated_at timestamptz not null default statement_timestamp(),
  constraint service_event_registrations_event_member_unique
    unique (event_id, member_membership_id),
  constraint service_event_registrations_event_year_fkey
    foreign key (event_id, school_year_id)
    references public.service_events (id, school_year_id) on delete restrict,
  constraint service_event_registrations_member_year_fkey
    foreign key (member_membership_id, school_year_id)
    references public.school_year_memberships (id, school_year_id) on delete restrict,
  constraint service_event_registrations_status_valid
    check (status in ('confirmed', 'waitlisted', 'withdrawn')),
  constraint service_event_registrations_withdrawal_consistent check (
    (status in ('confirmed', 'waitlisted') and withdrawn_at is null)
    or (status = 'withdrawn' and withdrawn_at is not null)
  ),
  constraint service_event_registrations_promotion_consistent check (
    promoted_at is null or status in ('confirmed', 'withdrawn')
  )
);

create index service_event_registrations_event_queue_idx
  on public.service_event_registrations (event_id, status, joined_at, id);
create index service_event_registrations_member_status_idx
  on public.service_event_registrations (member_membership_id, status, event_id);
create index service_event_registrations_school_year_idx
  on public.service_event_registrations (school_year_id, event_id);

create trigger service_events_set_updated_at
before update on public.service_events
for each row execute function private.set_updated_at();

create trigger service_event_registrations_set_updated_at
before update on public.service_event_registrations
for each row execute function private.set_updated_at();

create or replace function private.can_manage_service_event(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.service_events event
    where event.id = p_event_id
      and (
        event.created_by_profile_id = (select auth.uid())
        or private.current_actor_is_teacher_admin()
      )
  );
$$;

create or replace function public.create_service_event(
  p_school_year_id uuid,
  p_title text,
  p_description text,
  p_location text,
  p_volunteer_audience text,
  p_starts_at timestamp without time zone,
  p_ends_at timestamp without time zone,
  p_contact_name text,
  p_contact_email text,
  p_capacity integer
)
returns public.service_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_membership_id uuid;
  school_year_record public.school_years%rowtype;
  created_event public.service_events%rowtype;
begin
  select * into school_year_record
  from public.school_years
  where id = p_school_year_id;

  if school_year_record.id is null or school_year_record.status not in ('draft', 'active') then
    raise exception 'Events require a current school year' using errcode = '22023';
  end if;

  if private.current_actor_is_teacher_admin() then
    actor_membership_id := private.current_teacher_admin_membership_id(
      p_school_year_id,
      false
    );
  else
    actor_membership_id := private.current_membership_id(p_school_year_id, true);
  end if;

  if actor_membership_id is null or not (
    private.current_actor_is_teacher_admin()
    or private.membership_has_role(actor_membership_id, 'committee_head', true)
  ) then
    raise exception 'Only committee heads and teacher administrators may publish events'
      using errcode = '42501';
  end if;

  if p_starts_at::date < school_year_record.start_date
    or p_ends_at::date > school_year_record.end_date then
    raise exception 'Event dates must be inside the selected school year'
      using errcode = '22023';
  end if;

  if p_ends_at <= timezone('America/New_York', statement_timestamp()) then
    raise exception 'New events must end in the future' using errcode = '22023';
  end if;

  insert into public.service_events (
    school_year_id,
    title,
    description,
    location,
    volunteer_audience,
    starts_at,
    ends_at,
    contact_name,
    contact_email,
    capacity,
    created_by_profile_id,
    created_by_membership_id
  )
  values (
    p_school_year_id,
    btrim(p_title),
    btrim(p_description),
    btrim(p_location),
    btrim(p_volunteer_audience),
    p_starts_at,
    p_ends_at,
    btrim(p_contact_name),
    lower(btrim(p_contact_email)),
    p_capacity,
    (select auth.uid()),
    actor_membership_id
  )
  returning * into created_event;

  perform private.write_audit(
    'service_event.published',
    'service_event',
    created_event.id::text,
    created_event.school_year_id,
    actor_membership_id,
    null,
    jsonb_build_object(
      'title', created_event.title,
      'starts_at', created_event.starts_at,
      'ends_at', created_event.ends_at,
      'location', created_event.location,
      'capacity', created_event.capacity
    )
  );

  return created_event;
end;
$$;

create or replace function public.signup_for_service_event(p_event_id uuid)
returns public.service_event_registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_record public.service_events%rowtype;
  member_membership_id uuid;
  existing_registration public.service_event_registrations%rowtype;
  saved_registration public.service_event_registrations%rowtype;
  confirmed_count integer;
  next_status text;
begin
  select * into event_record
  from public.service_events
  where id = p_event_id
  for update;

  if event_record.id is null then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;
  if event_record.ends_at <= timezone('America/New_York', statement_timestamp()) then
    raise exception 'This event has ended' using errcode = '22023';
  end if;

  member_membership_id := private.current_membership_id(event_record.school_year_id, true);
  if member_membership_id is null
    or not private.membership_has_role(member_membership_id, 'member', true) then
    raise exception 'An active member role is required to sign up'
      using errcode = '42501';
  end if;

  select * into existing_registration
  from public.service_event_registrations registration
  where registration.event_id = event_record.id
    and registration.member_membership_id = member_membership_id
  for update;

  if existing_registration.status in ('confirmed', 'waitlisted') then
    return existing_registration;
  end if;

  select count(*)::integer into confirmed_count
  from public.service_event_registrations registration
  where registration.event_id = event_record.id
    and registration.status = 'confirmed';

  next_status := case
    when confirmed_count < event_record.capacity then 'confirmed'
    else 'waitlisted'
  end;

  insert into public.service_event_registrations (
    event_id,
    school_year_id,
    member_membership_id,
    status
  )
  values (
    event_record.id,
    event_record.school_year_id,
    member_membership_id,
    next_status
  )
  on conflict on constraint service_event_registrations_event_member_unique
  do update set
    status = excluded.status,
    joined_at = statement_timestamp(),
    promoted_at = null,
    withdrawn_at = null
  returning * into saved_registration;

  perform private.write_audit(
    case
      when next_status = 'confirmed' then 'service_event.signup_confirmed'
      else 'service_event.waitlist_joined'
    end,
    'service_event_registration',
    saved_registration.id::text,
    saved_registration.school_year_id,
    member_membership_id,
    case
      when existing_registration.id is null then null
      else jsonb_build_object('status', existing_registration.status)
    end,
    jsonb_build_object('status', saved_registration.status),
    jsonb_build_object('event_id', saved_registration.event_id)
  );

  return saved_registration;
end;
$$;

create or replace function public.drop_service_event_signup(p_event_id uuid)
returns public.service_event_registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_record public.service_events%rowtype;
  member_membership_id uuid;
  registration_record public.service_event_registrations%rowtype;
  promoted_registration public.service_event_registrations%rowtype;
  previous_status text;
begin
  select * into event_record
  from public.service_events
  where id = p_event_id
  for update;

  if event_record.id is null then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;
  if event_record.ends_at <= timezone('America/New_York', statement_timestamp()) then
    raise exception 'This event has ended' using errcode = '22023';
  end if;

  member_membership_id := private.current_membership_id(event_record.school_year_id, true);
  if member_membership_id is null then
    raise exception 'An active membership is required' using errcode = '42501';
  end if;

  select * into registration_record
  from public.service_event_registrations registration
  where registration.event_id = event_record.id
    and registration.member_membership_id = member_membership_id
    and registration.status in ('confirmed', 'waitlisted')
  for update;

  if registration_record.id is null then
    raise exception 'No active signup was found' using errcode = 'P0002';
  end if;

  previous_status := registration_record.status;

  update public.service_event_registrations
  set status = 'withdrawn',
      withdrawn_at = statement_timestamp()
  where id = registration_record.id
  returning * into registration_record;

  if previous_status = 'confirmed' then
    select registration.* into promoted_registration
    from public.service_event_registrations registration
    where registration.event_id = event_record.id
      and registration.status = 'waitlisted'
    order by registration.joined_at, registration.id
    for update
    limit 1;

    if promoted_registration.id is not null then
      update public.service_event_registrations
      set status = 'confirmed',
          promoted_at = statement_timestamp()
      where id = promoted_registration.id
      returning * into promoted_registration;

      perform private.write_audit(
        'service_event.waitlist_promoted',
        'service_event_registration',
        promoted_registration.id::text,
        promoted_registration.school_year_id,
        member_membership_id,
        jsonb_build_object('status', 'waitlisted'),
        jsonb_build_object('status', 'confirmed'),
        jsonb_build_object(
          'event_id', promoted_registration.event_id,
          'automatic', true
        )
      );
    end if;
  end if;

  perform private.write_audit(
    'service_event.signup_withdrawn',
    'service_event_registration',
    registration_record.id::text,
    registration_record.school_year_id,
    member_membership_id,
    jsonb_build_object('status', previous_status),
    jsonb_build_object('status', 'withdrawn'),
    jsonb_build_object('event_id', registration_record.event_id)
  );

  return registration_record;
end;
$$;

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
  can_manage boolean
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
    counts.confirmed_count,
    counts.waitlist_count,
    greatest(event.capacity::integer - counts.confirmed_count, 0),
    event.ends_at < timezone('America/New_York', statement_timestamp()),
    own_registration.status,
    case
      when own_registration.status = 'waitlisted' then (
        select count(*)::integer
        from public.service_event_registrations queue_registration
        where queue_registration.event_id = event.id
          and queue_registration.status = 'waitlisted'
          and (queue_registration.joined_at, queue_registration.id)
            <= (own_registration.joined_at, own_registration.id)
      )
      else null
    end,
    event.created_by_profile_id = (select auth.uid())
      or private.current_actor_is_teacher_admin()
  from public.service_events event
  join public.school_years school_year on school_year.id = event.school_year_id
  join public.profiles organizer on organizer.id = event.created_by_profile_id
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
  where p_event_id is null or event.id = p_event_id
  order by event.starts_at, event.id;
end;
$$;

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
  if not private.can_manage_service_event(p_event_id) then
    raise exception 'Only this event organizer or a teacher administrator can view its roster'
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

alter table public.service_events enable row level security;
alter table public.service_events force row level security;
alter table public.service_event_registrations enable row level security;
alter table public.service_event_registrations force row level security;

create policy service_events_select_provisioned
on public.service_events for select to authenticated
using (private.is_provisioned_profile());

create policy service_event_registrations_select_authorized
on public.service_event_registrations for select to authenticated
using (
  exists (
    select 1
    from public.school_year_memberships membership
    where membership.id = member_membership_id
      and membership.profile_id = (select auth.uid())
  )
  or private.can_manage_service_event(event_id)
);

revoke all on table public.service_events from anon, authenticated;
revoke all on table public.service_event_registrations from anon, authenticated;
revoke all on sequence public.service_event_registrations_id_seq from anon, authenticated;
revoke all on function private.can_manage_service_event(uuid) from public, anon, authenticated;
revoke all on function public.create_service_event(
  uuid, text, text, text, text, timestamp without time zone,
  timestamp without time zone, text, text, integer
) from public, anon, authenticated;
revoke all on function public.signup_for_service_event(uuid) from public, anon, authenticated;
revoke all on function public.drop_service_event_signup(uuid) from public, anon, authenticated;
revoke all on function public.list_service_events(uuid) from public, anon, authenticated;
revoke all on function public.list_service_event_roster(uuid) from public, anon, authenticated;

grant select on table public.service_events to authenticated;
grant select on table public.service_event_registrations to authenticated;
grant execute on function private.can_manage_service_event(uuid) to authenticated;
grant execute on function public.create_service_event(
  uuid, text, text, text, text, timestamp without time zone,
  timestamp without time zone, text, text, integer
) to authenticated;
grant execute on function public.signup_for_service_event(uuid) to authenticated;
grant execute on function public.drop_service_event_signup(uuid) to authenticated;
grant execute on function public.list_service_events(uuid) to authenticated;
grant execute on function public.list_service_event_roster(uuid) to authenticated;

commit;
