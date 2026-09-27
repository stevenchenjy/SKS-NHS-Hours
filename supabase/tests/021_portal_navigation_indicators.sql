begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(14);

create temp table navigation_event (id uuid);
grant all on navigation_event to authenticated;
create function pg_temp.actor(p_suffix text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa00' || p_suffix, true)::text;
$$;
create function pg_temp.publish_event(p_title text) returns uuid language sql as $$
  select id from public.create_service_event(
    '10000000-0000-4000-8000-000000000001', p_title, 'Set up supplies', 'Library',
    'NHS members',
    timezone('America/New_York', clock_timestamp()) + interval '7 days',
    timezone('America/New_York', clock_timestamp()) + interval '7 days 2 hours',
    'Riley', 'reviewer@example.edu', 1,
    timezone('America/New_York', clock_timestamp()) + interval '6 days'
  );
$$;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select pg_temp.actor('2');
select public.mark_portal_navigation_seen('events');
select pg_temp.actor('3');
select public.mark_portal_navigation_seen('events');
select public.mark_portal_navigation_seen('notifications');
select pg_temp.actor('4');
select public.mark_portal_navigation_seen('events');
select public.mark_portal_navigation_seen('notifications');
select pg_temp.actor('2');
insert into navigation_event select pg_temp.publish_event('Navigation indicator test');
select extensions.is((public.get_portal_navigation_indicators()->>'events')::boolean,
  false, 'publisher does not get a new-event dot for their own event');

select pg_temp.actor('3');
select extensions.is((public.get_portal_navigation_indicators()->>'events')::boolean,
  true, 'member sees a dot for a newly published event');
select extensions.is((public.get_portal_navigation_indicators()->>'notifications')::boolean,
  false, 'new event does not raise the notification dot');
select public.mark_portal_navigation_seen('events');
select extensions.is((public.get_portal_navigation_indicators()->>'events')::boolean,
  false, 'opening Events clears its dot');
select extensions.is((select status from public.signup_for_service_event((select id from navigation_event))),
  'confirmed', 'signup creates a notification for the member');
select extensions.is((public.get_portal_navigation_indicators()->>'notifications')::boolean,
  true, 'new unread notification raises its own dot');

select pg_temp.actor('2');
select pg_temp.publish_event('Another navigation indicator test');
select pg_temp.actor('3');
select extensions.is((public.get_portal_navigation_indicators()->>'events')::boolean,
  true, 'a later event raises the Events dot again');
select public.mark_portal_navigation_seen('notifications');
select extensions.is((public.get_portal_navigation_indicators()->>'notifications')::boolean,
  false, 'opening Notifications clears its dot');
select extensions.is((public.get_portal_navigation_indicators()->>'events')::boolean,
  true, 'opening Notifications does not clear the Events dot');
select extensions.ok((select count(*) > 0 from public.event_notifications
  where recipient_profile_id = (select auth.uid()) and read_at is null),
  'opening Notifications does not archive unread messages');
select extensions.throws_ok($$select public.mark_portal_navigation_seen('admin')$$,
  '22023', 'Invalid navigation section', 'unknown sections are rejected');

select pg_temp.actor('4');
select extensions.is((public.get_portal_navigation_indicators()->>'events')::boolean,
  true, 'one member opening Events does not clear another member’s dot');

reset role;
select extensions.ok(not has_table_privilege('authenticated', 'private.portal_navigation_seen', 'SELECT'),
  'members cannot directly inspect navigation timestamps');
select extensions.ok(not has_function_privilege('anon', 'public.get_portal_navigation_indicators()', 'EXECUTE'),
  'anonymous callers cannot query navigation indicators');
select * from extensions.finish();
rollback;
