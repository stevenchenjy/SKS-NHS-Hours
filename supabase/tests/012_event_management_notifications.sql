begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

create temp table managed_event_context (id uuid, original_version timestamptz, notification_id uuid);
grant all on managed_event_context to authenticated;
create function pg_temp.event_id() returns uuid language sql as $$ select id from managed_event_context $$;
create function pg_temp.actor(p_suffix text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa00' || p_suffix, true)::text;
$$;
create function pg_temp.edit_event(p_capacity integer, p_location text default 'Gym', p_deadline timestamp default '2026-10-19 15:00')
returns public.service_events language sql as $$
  select public.update_service_event(
    pg_temp.event_id(), (select updated_at from public.service_events where id = pg_temp.event_id()),
    'Managed event test', 'Sort books', p_location, 'NHS members',
    '2026-10-20 15:00', '2026-10-20 17:00', p_deadline, 'Riley', 'reviewer@example.edu', p_capacity
  );
$$;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select pg_temp.actor('2');
insert into managed_event_context(id, original_version)
select id, updated_at from public.create_service_event(
  '10000000-0000-4000-8000-000000000001', 'Managed event test', 'Sort books', 'Library', 'NHS members',
  '2026-10-20 15:00', '2026-10-20 17:00', 'Riley', 'reviewer@example.edu', 1, '2026-10-19 15:00'
);
select extensions.is((select signup_deadline::text from public.service_events where id = pg_temp.event_id()),
  '2026-10-19 15:00:00', 'publisher saves a signup cutoff');
select extensions.throws_ok($$select pg_temp.edit_event(1, 'Library', '2026-10-21 15:00')$$,
  '22023', 'Signup deadline must be at or before the event starts', 'deadline cannot be after start');

select pg_temp.actor('3');
select extensions.is((select status from public.signup_for_service_event(pg_temp.event_id())), 'confirmed', 'first member confirmed');
select extensions.throws_ok($$select pg_temp.edit_event(2)$$,
  '42501', 'Only the organizer or a teacher administrator can manage this event', 'member cannot edit another event');
select extensions.throws_ok($$select public.close_service_event(pg_temp.event_id(), 'end', (select original_version from managed_event_context))$$,
  '42501', 'Only the organizer or a teacher administrator can manage this event', 'member cannot end another event');
select extensions.throws_ok($$select public.close_service_event(pg_temp.event_id(), 'delete', (select original_version from managed_event_context))$$,
  '42501', 'Only the organizer or a teacher administrator can manage this event', 'member cannot delete another event');
select extensions.throws_ok($$update public.service_events set capacity=100 where id=pg_temp.event_id()$$,
  '42501', 'permission denied for table service_events', 'direct edits cannot bypass authorization');
select pg_temp.actor('4');
select extensions.is((select status from public.signup_for_service_event(pg_temp.event_id())), 'waitlisted', 'second member joins waitlist');
select pg_temp.actor('2');
select extensions.lives_ok($$select pg_temp.edit_event(2)$$, 'publisher can edit and increase capacity');
select extensions.is((select count(*) from public.list_service_event_roster(pg_temp.event_id()) where status='confirmed'), 2::bigint,
  'capacity increase promotes existing waitlist');
select extensions.throws_ok($$select pg_temp.edit_event(1)$$,
  '22023', 'Capacity cannot be below the confirmed signup count', 'capacity reductions protect confirmed signups');
select extensions.throws_ok($$select public.update_service_event(pg_temp.event_id(), '2000-01-01+00',
  'Managed event test', 'Sort books', 'Gym', 'NHS members', '2026-10-20 15:00', '2026-10-20 17:00',
  '2026-10-19 15:00', 'Riley', 'reviewer@example.edu', 2)$$,
  '40001', 'This event changed since you opened it. Reload before editing', 'stale form cannot overwrite newer changes');
select extensions.lives_ok($$select pg_temp.edit_event(2)$$, 'saving unchanged details is allowed');

select pg_temp.actor('3');
select extensions.is((select count(*) from public.event_notifications where event_id=pg_temp.event_id() and kind='event_updated'), 1::bigint,
  'one edit notification, no duplicate for unchanged save');
select extensions.is((select changes->'location'->>'before' from public.event_notifications where event_id=pg_temp.event_id() and kind='event_updated'),
  'Library', 'notification stores original location');
select extensions.is((select changes->'location'->>'after' from public.event_notifications where event_id=pg_temp.event_id() and kind='event_updated'),
  'Gym', 'notification stores updated location');
update managed_event_context set notification_id=(select id from public.event_notifications where event_id=pg_temp.event_id() and kind='event_updated');
select extensions.throws_ok($$insert into public.event_notifications(recipient_profile_id,event_id,kind,title,message)
  values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa004',pg_temp.event_id(),'event_updated','Forged','Forged')$$,
  '42501', 'permission denied for table event_notifications', 'members cannot forge system messages');
select pg_temp.actor('4');
select extensions.is((select count(*) from public.event_notifications where event_id=pg_temp.event_id() and kind='event_updated'), 1::bigint,
  'waitlisted volunteers receive edit notifications');
select extensions.is((select count(*) from public.event_notifications where event_id=pg_temp.event_id() and kind='waitlist_promoted'), 1::bigint,
  'promoted volunteer receives status notification');
select extensions.is((select count(*) from public.event_notifications where id=(select notification_id from managed_event_context)), 0::bigint,
  'recipient cannot read someone else notification');
select public.mark_event_notifications_read((select notification_id from managed_event_context));
select pg_temp.actor('3');
select extensions.ok((select read_at is null from public.event_notifications where id=(select notification_id from managed_event_context)),
  'recipient cannot mark someone else notification read');
select public.mark_event_notifications_read((select notification_id from managed_event_context));
select extensions.ok((select read_at is not null from public.event_notifications where id=(select notification_id from managed_event_context)),
  'recipient can mark their notification read');
select public.mark_event_notifications_read();
select extensions.is((select count(*) from public.event_notifications where read_at is null), 0::bigint, 'mark all read affects own inbox');

select pg_temp.actor('2');
select pg_temp.edit_event(2, 'Gym', timezone('America/New_York', clock_timestamp()) - interval '1 second');
select pg_temp.actor('7');
select extensions.throws_ok($$select public.signup_for_service_event(pg_temp.event_id())$$,
  '22023', 'The signup deadline has passed', 'database rejects late signup from a stale page');
select extensions.ok((select is_signup_closed from public.list_service_events(pg_temp.event_id())), 'closed signup state comes from database clock');
select pg_temp.actor('3');
select extensions.lives_ok($$select public.drop_service_event_signup(pg_temp.event_id())$$, 'volunteer can withdraw after deadline');
select pg_temp.actor('2');
select public.close_service_event(pg_temp.event_id(), 'end', (select updated_at from public.service_events where id=pg_temp.event_id()));
select extensions.ok((select is_expired from public.list_service_events(pg_temp.event_id())), 'ending moves event to Past immediately');
select extensions.is((select count(*) from public.list_service_event_roster(pg_temp.event_id())), 1::bigint, 'ending retains roster');
select extensions.throws_ok($$select pg_temp.edit_event(2)$$, '22023', 'Past events cannot be edited', 'ended event cannot be edited');
select pg_temp.actor('4');
select extensions.is((select count(*) from public.event_notifications where event_id=pg_temp.event_id() and kind='event_ended'), 1::bigint, 'ending notifies remaining volunteer');
select pg_temp.actor('3');
select extensions.is((select count(*) from public.event_notifications where event_id=pg_temp.event_id() and kind='event_ended'), 0::bigint, 'withdrawn volunteers excluded from later event updates');
select pg_temp.actor('7');
select extensions.throws_ok($$select public.signup_for_service_event(pg_temp.event_id())$$, '22023', 'This event has ended', 'cannot sign up to manually ended event');

select pg_temp.actor('1');
select extensions.lives_ok($$select public.close_service_event(pg_temp.event_id(), 'delete', (select updated_at from public.service_events where id=pg_temp.event_id()))$$,
  'teacher administrator can delete an ended event');
select extensions.is((select count(*) from public.list_service_events(pg_temp.event_id())), 0::bigint, 'deleted event absent from both lists');
select extensions.is((select count(*) from public.service_events where id=pg_temp.event_id()), 0::bigint, 'RLS hides deleted event');
select pg_temp.actor('4');
select extensions.is((select count(*) from public.event_notifications where event_id=pg_temp.event_id() and kind='event_deleted'), 1::bigint,
  'deletion notifies remaining registrants');
select extensions.ok(not exists(select 1 from public.list_event_notifications(100,0) where title='Managed event test' and event_id is not null),
  'notification history survives deletion without broken event links');
select extensions.throws_ok($$select public.signup_for_service_event(pg_temp.event_id())$$, 'P0002', 'Event not found', 'deleted event cannot accept signups');
reset role;
select extensions.is((select count(*) from public.service_event_registrations where event_id=pg_temp.event_id() and status<>'withdrawn'), 0::bigint,
  'delete cancels every remaining signup without waitlist promotion');
select extensions.ok(exists(select 1 from public.audit_events where entity_id=pg_temp.event_id()::text and action='service_event.deleted'), 'deletion is audited');

select * from extensions.finish();
rollback;
