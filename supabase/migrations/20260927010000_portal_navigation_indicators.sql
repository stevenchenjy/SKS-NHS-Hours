begin;

-- A visit clears only the navigation hint. Notification read/archive state is
-- separate and remains under the member's control in the inbox.
create table private.portal_navigation_seen (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  events_seen_at timestamptz,
  notifications_seen_at timestamptz
);
alter table private.portal_navigation_seen enable row level security;
alter table private.portal_navigation_seen force row level security;
revoke all on private.portal_navigation_seen from public, anon, authenticated;

-- Existing content predates this feature; do not label it as newly published.
insert into private.portal_navigation_seen (profile_id, events_seen_at, notifications_seen_at)
select profile.id, statement_timestamp(), statement_timestamp()
from public.profiles profile;

create index service_events_new_activity_idx
  on public.service_events (created_at desc)
  where deleted_at is null and ended_at is null;

create function public.get_portal_navigation_indicators()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  events_since timestamptz;
  notifications_since timestamptz;
begin
  if actor_id is null or not private.is_provisioned_profile() then
    raise exception 'A provisioned portal account is required' using errcode = '42501';
  end if;

  select coalesce(seen.events_seen_at, profile.created_at),
    coalesce(seen.notifications_seen_at, profile.created_at)
  into events_since, notifications_since
  from public.profiles profile
  left join private.portal_navigation_seen seen on seen.profile_id = profile.id
  where profile.id = actor_id;

  return jsonb_build_object(
    'events', exists (
      select 1 from public.service_events event
      where event.deleted_at is null and event.ended_at is null
        and event.ends_at > timezone('America/New_York', statement_timestamp())
        and event.created_by_profile_id <> actor_id
        and event.created_at > events_since
    ),
    'notifications', exists (
      select 1 from public.event_notifications notice
      where notice.recipient_profile_id = actor_id and notice.read_at is null
        and notice.created_at > notifications_since
    )
  );
end;
$$;

create function public.mark_portal_navigation_seen(p_section text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  viewed_at timestamptz := clock_timestamp();
begin
  if actor_id is null or not private.is_provisioned_profile() then
    raise exception 'A provisioned portal account is required' using errcode = '42501';
  end if;
  if p_section not in ('events', 'notifications') or p_section is null then
    raise exception 'Invalid navigation section' using errcode = '22023';
  end if;

  insert into private.portal_navigation_seen (
    profile_id, events_seen_at, notifications_seen_at
  ) values (
    actor_id,
    case when p_section = 'events' then viewed_at end,
    case when p_section = 'notifications' then viewed_at end
  )
  on conflict (profile_id) do update set
    events_seen_at = case when p_section = 'events'
      then greatest(private.portal_navigation_seen.events_seen_at, excluded.events_seen_at)
      else private.portal_navigation_seen.events_seen_at end,
    notifications_seen_at = case when p_section = 'notifications'
      then greatest(private.portal_navigation_seen.notifications_seen_at, excluded.notifications_seen_at)
      else private.portal_navigation_seen.notifications_seen_at end;
end;
$$;

revoke all on function public.get_portal_navigation_indicators() from public, anon, authenticated;
revoke all on function public.mark_portal_navigation_seen(text) from public, anon, authenticated;
grant execute on function public.get_portal_navigation_indicators() to authenticated;
grant execute on function public.mark_portal_navigation_seen(text) to authenticated;

commit;
