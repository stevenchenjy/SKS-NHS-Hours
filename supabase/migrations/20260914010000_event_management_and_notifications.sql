begin;

-- School-local deadlines use the same New York wall clock as event schedules.
-- Deletion hides an event while preserving its audit and notification history.
alter table public.service_events
  add column signup_deadline timestamp without time zone,
  add column ended_at timestamptz,
  add column deleted_at timestamptz;
update public.service_events set signup_deadline = starts_at;
alter table public.service_events
  alter column signup_deadline set not null,
  add constraint service_events_deadline_order check (signup_deadline <= starts_at);

create function private.default_service_event_deadline()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.signup_deadline := coalesce(new.signup_deadline, new.starts_at);
  return new;
end;
$$;
create trigger service_events_default_deadline before insert on public.service_events
  for each row execute function private.default_service_event_deadline();
revoke all on function private.default_service_event_deadline() from public, anon, authenticated;

create table public.event_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_profile_id uuid not null references public.profiles(id) on delete restrict,
  event_id uuid not null references public.service_events(id) on delete restrict,
  kind text not null check (kind in (
    'event_updated', 'event_ended', 'event_deleted',
    'signup_confirmed', 'signup_waitlisted', 'signup_withdrawn', 'waitlist_promoted'
  )),
  title text not null,
  message text not null,
  changes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  read_at timestamptz
);
create index event_notifications_recipient_feed_idx
  on public.event_notifications(recipient_profile_id, created_at desc, id desc);
create index event_notifications_unread_idx
  on public.event_notifications(recipient_profile_id) where read_at is null;
create index event_notifications_event_idx on public.event_notifications(event_id);
alter table public.event_notifications enable row level security;
alter table public.event_notifications force row level security;
create policy event_notifications_select_own
  on public.event_notifications for select to authenticated
  using (recipient_profile_id = (select auth.uid()) and (select private.is_provisioned_profile()));
revoke all on public.event_notifications from public, anon, authenticated;
grant select on public.event_notifications to authenticated;

create or replace function private.can_manage_service_event(p_event_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_provisioned_profile() and exists (
    select 1 from public.service_events event
    where event.id = p_event_id and event.deleted_at is null
      and (private.current_actor_is_teacher_admin() or (
        event.created_by_profile_id = (select auth.uid())
        and private.membership_has_role(
          private.current_membership_id(event.school_year_id, true), 'committee_head', true
        )
      ))
  );
$$;

drop policy service_events_select_provisioned on public.service_events;
create policy service_events_select_provisioned on public.service_events
  for select to authenticated
  using (deleted_at is null and (select private.is_provisioned_profile()));

-- Notifications commit atomically with the event change, including recipients
-- on the waitlist. Only actual field changes produce an update notification.
create function private.notify_service_event_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  notification_kind text;
  notification_message text;
  changed_fields jsonb;
begin
  if old.deleted_at is null and new.deleted_at is not null then
    notification_kind := 'event_deleted';
    notification_message := 'The organizer deleted this event. Your signup has been cancelled.';
  elsif old.ended_at is null and new.ended_at is not null then
    notification_kind := 'event_ended';
    notification_message := 'The organizer ended this event. It is now in Past events and signups are closed.';
  else
    select coalesce(jsonb_object_agg(field.key, jsonb_build_object(
      'before', to_jsonb(old) -> field.key, 'after', field.value
    )), '{}'::jsonb) into changed_fields
    from jsonb_each(to_jsonb(new)) field
    where field.key in (
      'title', 'description', 'location', 'volunteer_audience', 'starts_at', 'ends_at',
      'signup_deadline', 'contact_name', 'contact_email', 'capacity'
    ) and field.value is distinct from to_jsonb(old) -> field.key;
    if changed_fields = '{}'::jsonb then return new; end if;
    notification_kind := 'event_updated';
    notification_message := 'The organizer updated an event you signed up for. Review the changes before attending.';
  end if;

  insert into public.event_notifications(recipient_profile_id, event_id, kind, title, message, changes)
  select membership.profile_id, new.id, notification_kind, new.title,
    notification_message, coalesce(changed_fields, '{}'::jsonb)
  from public.service_event_registrations registration
  join public.school_year_memberships membership on membership.id = registration.member_membership_id
  where registration.event_id = new.id and registration.status in ('confirmed', 'waitlisted');
  return new;
end;
$$;
create trigger service_event_change_notifications after update on public.service_events
  for each row execute function private.notify_service_event_change();

create function private.notify_service_event_registration()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  event_record public.service_events%rowtype;
  notification_kind text;
  notification_message text;
begin
  if tg_op = 'UPDATE' and old.status = new.status then return new; end if;
  select * into event_record from public.service_events where id = new.event_id;
  -- Deletion already sent one cancellation notice to every active registrant.
  if event_record.deleted_at is not null then return new; end if;
  if new.status = 'confirmed' and tg_op = 'UPDATE' and old.status = 'waitlisted' then
    notification_kind := 'waitlist_promoted';
    notification_message := 'A spot opened up. You have been moved from the waitlist to confirmed.';
  elsif new.status = 'confirmed' then
    notification_kind := 'signup_confirmed';
    notification_message := 'Your signup is confirmed. You have a spot in this event.';
  elsif new.status = 'waitlisted' then
    notification_kind := 'signup_waitlisted';
    notification_message := 'You have joined the waitlist. We will notify you here if a spot opens up.';
  else
    notification_kind := 'signup_withdrawn';
    notification_message := 'Your signup has been cancelled. You are no longer on the roster or waitlist.';
  end if;
  insert into public.event_notifications(recipient_profile_id, event_id, kind, title, message)
  select membership.profile_id, new.event_id, notification_kind, event_record.title, notification_message
  from public.school_year_memberships membership where membership.id = new.member_membership_id;
  return new;
end;
$$;
create trigger service_event_registration_notifications
  after insert or update on public.service_event_registrations
  for each row execute function private.notify_service_event_registration();

create function public.update_service_event(
  p_event_id uuid, p_expected_updated_at timestamptz,
  p_title text, p_description text, p_location text, p_volunteer_audience text,
  p_starts_at timestamp without time zone, p_ends_at timestamp without time zone,
  p_signup_deadline timestamp without time zone,
  p_contact_name text, p_contact_email text, p_capacity integer
)
returns public.service_events language plpgsql security definer set search_path = '' as $$
declare
  event_record public.service_events%rowtype;
  saved_event public.service_events%rowtype;
  year_record public.school_years%rowtype;
  confirmed_count integer;
  available_spots integer;
  promoted_record public.service_event_registrations%rowtype;
begin
  select * into event_record from public.service_events where id = p_event_id for update;
  if not private.can_manage_service_event(p_event_id) then
    raise exception 'Only the organizer or a teacher administrator can manage this event' using errcode = '42501';
  end if;
  if event_record.ended_at is not null or event_record.ends_at <= timezone('America/New_York', clock_timestamp()) then
    raise exception 'Past events cannot be edited' using errcode = '22023';
  end if;
  if p_expected_updated_at is distinct from event_record.updated_at then
    raise exception 'This event changed since you opened it. Reload before editing' using errcode = '40001';
  end if;
  select * into year_record from public.school_years where id = event_record.school_year_id;
  if year_record.status not in ('draft', 'active') or p_starts_at::date < year_record.start_date
    or p_ends_at::date > year_record.end_date then
    raise exception 'Event dates must be inside the selected school year' using errcode = '22023';
  end if;
  if p_ends_at <= timezone('America/New_York', clock_timestamp()) then
    raise exception 'The event must end in the future' using errcode = '22023';
  end if;
  if p_signup_deadline is null or p_signup_deadline > p_starts_at then
    raise exception 'Signup deadline must be at or before the event starts' using errcode = '22023';
  end if;
  select count(*)::integer into confirmed_count from public.service_event_registrations registration
    where registration.event_id = p_event_id and registration.status = 'confirmed';
  if p_capacity < confirmed_count then
    raise exception 'Capacity cannot be below the confirmed signup count' using errcode = '22023';
  end if;

  update public.service_events set title = btrim(p_title), description = btrim(p_description),
    location = btrim(p_location), volunteer_audience = btrim(p_volunteer_audience),
    starts_at = p_starts_at, ends_at = p_ends_at, signup_deadline = p_signup_deadline,
    contact_name = btrim(p_contact_name), contact_email = lower(btrim(p_contact_email)), capacity = p_capacity
    where id = p_event_id returning * into saved_event;

  -- Existing waitlisted volunteers keep their queue position when capacity grows.
  -- The deadline blocks new joins; existing waitlist promotions remain eligible.
  available_spots := p_capacity - confirmed_count;
  for promoted_record in
    select registration.* from public.service_event_registrations registration
    where registration.event_id = p_event_id and registration.status = 'waitlisted'
    order by registration.joined_at, registration.id limit available_spots for update
  loop
    update public.service_event_registrations set status = 'confirmed', promoted_at = clock_timestamp()
      where id = promoted_record.id;
    perform private.write_audit('service_event.waitlist_promoted', 'service_event_registration',
      promoted_record.id::text, event_record.school_year_id, null,
      jsonb_build_object('status', 'waitlisted'), jsonb_build_object('status', 'confirmed'),
      jsonb_build_object('event_id', p_event_id, 'automatic', true, 'reason', 'capacity_increased'));
  end loop;
  perform private.write_audit('service_event.updated', 'service_event', p_event_id::text,
    event_record.school_year_id, null, to_jsonb(event_record), to_jsonb(saved_event));
  return saved_event;
end;
$$;

create function public.close_service_event(p_event_id uuid, p_operation text, p_expected_updated_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare
  event_record public.service_events%rowtype;
  saved_event public.service_events%rowtype;
begin
  select * into event_record from public.service_events where id = p_event_id for update;
  if not private.can_manage_service_event(p_event_id) then
    raise exception 'Only the organizer or a teacher administrator can manage this event' using errcode = '42501';
  end if;
  if p_expected_updated_at is distinct from event_record.updated_at then
    raise exception 'This event changed since you opened it. Reload before editing' using errcode = '40001';
  end if;
  if p_operation = 'end' then
    if event_record.ended_at is not null or event_record.ends_at <= timezone('America/New_York', clock_timestamp()) then
      raise exception 'This event has already ended' using errcode = '22023';
    end if;
    update public.service_events set ended_at = clock_timestamp() where id = p_event_id returning * into saved_event;
  elsif p_operation = 'delete' then
    update public.service_events set deleted_at = clock_timestamp() where id = p_event_id returning * into saved_event;
    update public.service_event_registrations set status = 'withdrawn', withdrawn_at = clock_timestamp()
      where event_id = p_event_id and status in ('confirmed', 'waitlisted');
  else
    raise exception 'Invalid event operation' using errcode = '22023';
  end if;
  perform private.write_audit(
    case p_operation when 'end' then 'service_event.ended' else 'service_event.deleted' end,
    'service_event', p_event_id::text, event_record.school_year_id, null, to_jsonb(event_record), to_jsonb(saved_event)
  );
end;
$$;

create function public.list_event_notifications(p_limit integer default 30, p_offset integer default 0)
returns table(id uuid, event_id uuid, kind text, title text, message text, changes jsonb, created_at timestamptz, read_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_provisioned_profile() then
    raise exception 'A provisioned portal account is required' using errcode = '42501';
  end if;
  return query
  select notice.id, case when event.deleted_at is null then event.id else null end,
    notice.kind, notice.title, notice.message, notice.changes, notice.created_at, notice.read_at
  from public.event_notifications notice
  join public.service_events event on event.id = notice.event_id
  where notice.recipient_profile_id = (select auth.uid())
  order by notice.created_at desc, notice.id desc
  limit greatest(1, least(coalesce(p_limit, 30), 100)) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create function public.mark_event_notifications_read(p_notification_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_provisioned_profile() then
    raise exception 'A provisioned portal account is required' using errcode = '42501';
  end if;
  update public.event_notifications set read_at = clock_timestamp()
  where recipient_profile_id = (select auth.uid()) and read_at is null
    and (p_notification_id is null or id = p_notification_id);
end;
$$;

revoke all on function private.notify_service_event_change() from public, anon, authenticated;
revoke all on function private.notify_service_event_registration() from public, anon, authenticated;
revoke all on function public.update_service_event(uuid, timestamptz, text, text, text, text, timestamp, timestamp, timestamp, text, text, integer) from public, anon, authenticated;
revoke all on function public.close_service_event(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.list_event_notifications(integer, integer) from public, anon, authenticated;
revoke all on function public.mark_event_notifications_read(uuid) from public, anon, authenticated;
grant execute on function public.update_service_event(uuid, timestamptz, text, text, text, text, timestamp, timestamp, timestamp, text, text, integer) to authenticated;
grant execute on function public.close_service_event(uuid, text, timestamptz) to authenticated;
grant execute on function public.list_event_notifications(integer, integer) to authenticated;
grant execute on function public.mark_event_notifications_read(uuid) to authenticated;

-- Replace the old signature; callers omitting the deadline still default to start time.
drop function public.create_service_event(uuid, text, text, text, text, timestamp, timestamp, text, text, integer);
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
  p_capacity integer,
  p_signup_deadline timestamp without time zone default null
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

  if coalesce(p_signup_deadline, p_starts_at) > p_starts_at then
    raise exception 'Signup deadline must be at or before the event starts' using errcode = '22023';
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
    signup_deadline,
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
    coalesce(p_signup_deadline, p_starts_at),
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

  if event_record.id is null or event_record.deleted_at is not null then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;
  if event_record.ended_at is not null or event_record.ends_at <= timezone('America/New_York', clock_timestamp()) then
    raise exception 'This event has ended' using errcode = '22023';
  end if;

  if event_record.signup_deadline <= timezone('America/New_York', clock_timestamp()) then
    raise exception 'The signup deadline has passed' using errcode = '22023';
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

  if event_record.id is null or event_record.deleted_at is not null then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;
  if event_record.ended_at is not null or event_record.ends_at <= timezone('America/New_York', clock_timestamp()) then
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

drop function public.list_service_events(uuid);
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
    counts.confirmed_count,
    counts.waitlist_count,
    greatest(event.capacity::integer - counts.confirmed_count, 0),
    (event.ended_at is not null or event.ends_at <= timezone('America/New_York', statement_timestamp())),
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
    private.can_manage_service_event(event.id),
    event.signup_deadline,
    (event.ended_at is not null or event.ends_at <= timezone('America/New_York', statement_timestamp())
      or event.signup_deadline <= timezone('America/New_York', statement_timestamp())),
    event.ended_at,
    event.updated_at
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
  where event.deleted_at is null and (p_event_id is null or event.id = p_event_id)
  order by event.starts_at, event.id;
end;
$$;

revoke all on function public.create_service_event(uuid, text, text, text, text, timestamp, timestamp, text, text, integer, timestamp) from public, anon, authenticated;
grant execute on function public.create_service_event(uuid, text, text, text, text, timestamp, timestamp, text, text, integer, timestamp) to authenticated;
revoke all on function public.list_service_events(uuid) from public, anon, authenticated;
grant execute on function public.list_service_events(uuid) to authenticated;

commit;
