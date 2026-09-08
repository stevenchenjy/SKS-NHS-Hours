-- Avoid PL/pgSQL variable names that collide with registration columns.
-- Function signatures, row locks, and authorization checks remain unchanged.
begin;

create or replace function public.signup_for_service_event(p_event_id uuid)
returns public.service_event_registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_record public.service_events%rowtype;
  actor_membership_id uuid;
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

  actor_membership_id := private.current_membership_id(event_record.school_year_id, true);
  if actor_membership_id is null
    or not private.membership_has_role(actor_membership_id, 'member', true) then
    raise exception 'An active member role is required to sign up'
      using errcode = '42501';
  end if;

  select * into existing_registration
  from public.service_event_registrations registration
  where registration.event_id = event_record.id
    and registration.member_membership_id = actor_membership_id
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
    actor_membership_id,
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
    actor_membership_id,
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
  actor_membership_id uuid;
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

  actor_membership_id := private.current_membership_id(event_record.school_year_id, true);
  if actor_membership_id is null then
    raise exception 'An active membership is required' using errcode = '42501';
  end if;

  select * into registration_record
  from public.service_event_registrations registration
  where registration.event_id = event_record.id
    and registration.member_membership_id = actor_membership_id
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
        actor_membership_id,
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
    actor_membership_id,
    jsonb_build_object('status', previous_status),
    jsonb_build_object('status', 'withdrawn'),
    jsonb_build_object('event_id', registration_record.event_id)
  );

  return registration_record;
end;
$$;

commit;
