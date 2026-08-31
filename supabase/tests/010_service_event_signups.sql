begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(22);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003","role":"authenticated","email":"member@example.edu"}',
  true
);

select extensions.throws_ok(
  $$
    select public.create_service_event(
      '10000000-0000-4000-8000-000000000001',
      'Unauthorized event',
      'Ordinary members may not publish volunteer opportunities.',
      'School cafeteria',
      'All NHS members',
      '2026-09-15 15:00',
      '2026-09-15 17:00',
      'Morgan Member',
      'member@example.edu',
      1
    )
  $$,
  '42501',
  'Only committee heads and teacher administrators may publish events',
  'ordinary members cannot publish events'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002","role":"authenticated","email":"reviewer@example.edu"}',
  true
);

select extensions.lives_ok(
  $$
    select public.create_service_event(
      '10000000-0000-4000-8000-000000000001',
      'Service event workflow test',
      'A capacity-one opportunity used to verify FIFO promotion.',
      'School cafeteria',
      'All active NHS members',
      '2026-09-15 15:00',
      '2026-09-15 17:00',
      'Riley Reviewer',
      'reviewer@example.edu',
      1
    )
  $$,
  'committee heads can publish events'
);
select extensions.is(
  (select count(*) from public.service_events where title = 'Service event workflow test'),
  1::bigint,
  'the published event is stored once'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003","role":"authenticated","email":"member@example.edu"}',
  true
);

select extensions.lives_ok(
  $$
    select public.signup_for_service_event(
      (select id from public.service_events where title = 'Service event workflow test')
    )
  $$,
  'the first member can sign up'
);
select extensions.is(
  (
    select status
    from public.service_event_registrations
    where event_id = (
      select id from public.service_events where title = 'Service event workflow test'
    )
  ),
  'confirmed'::text,
  'the first signup is confirmed'
);
select extensions.lives_ok(
  $$
    select public.signup_for_service_event(
      (select id from public.service_events where title = 'Service event workflow test')
    )
  $$,
  'repeating the same signup is idempotent'
);
select extensions.is(
  (
    select count(*)
    from public.service_event_registrations
    where event_id = (
      select id from public.service_events where title = 'Service event workflow test'
    )
  ),
  1::bigint,
  'an idempotent retry does not create another registration'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa004', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa004","role":"authenticated","email":"leader@example.edu"}',
  true
);

select extensions.lives_ok(
  $$
    select public.signup_for_service_event(
      (select id from public.service_events where title = 'Service event workflow test')
    )
  $$,
  'a second member can join the full event waitlist'
);
select extensions.is(
  (
    select my_registration_status
    from public.list_service_events(
      (select id from public.service_events where title = 'Service event workflow test')
    )
  ),
  'waitlisted'::text,
  'the second member sees their waitlisted status'
);
select extensions.is(
  (
    select my_waitlist_position
    from public.list_service_events(
      (select id from public.service_events where title = 'Service event workflow test')
    )
  ),
  1,
  'the second member sees position one on the FIFO waitlist'
);
select extensions.is(
  (
    select confirmed_count::text || ':' || waitlist_count::text || ':' || spots_remaining::text
    from public.list_service_events(
      (select id from public.service_events where title = 'Service event workflow test')
    )
  ),
  '1:1:0'::text,
  'the public listing reports capacity, waitlist demand, and remaining spots'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003","role":"authenticated","email":"member@example.edu"}',
  true
);

select extensions.is(
  (
    select count(*)
    from public.service_event_registrations
    where event_id = (
      select id from public.service_events where title = 'Service event workflow test'
    )
  ),
  1::bigint,
  'an ordinary member can read only their own registration row'
);
select extensions.is(
  (
    select count(*)
    from public.service_event_registrations
    where member_membership_id = '20000000-0000-4000-8000-000000000004'
  ),
  0::bigint,
  'an ordinary member cannot read another student signup'
);
select extensions.lives_ok(
  $$
    select public.drop_service_event_signup(
      (select id from public.service_events where title = 'Service event workflow test')
    )
  $$,
  'a confirmed member can drop their spot'
);
select extensions.is(
  (
    select confirmed_count::text || ':' || waitlist_count::text
    from public.list_service_events(
      (select id from public.service_events where title = 'Service event workflow test')
    )
  ),
  '1:0'::text,
  'dropping a confirmed spot automatically fills it from the waitlist'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa004', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa004","role":"authenticated","email":"leader@example.edu"}',
  true
);
select extensions.is(
  (
    select my_registration_status
    from public.list_service_events(
      (select id from public.service_events where title = 'Service event workflow test')
    )
  ),
  'confirmed'::text,
  'the first waiting member is automatically promoted'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002","role":"authenticated","email":"reviewer@example.edu"}',
  true
);
select extensions.is(
  (
    select count(*)
    from public.list_service_event_roster(
      (select id from public.service_events where title = 'Service event workflow test')
    )
  ),
  1::bigint,
  'the event organizer sees the active roster'
);
select extensions.is(
  (
    select member_membership_id
    from public.list_service_event_roster(
      (select id from public.service_events where title = 'Service event workflow test')
    )
  ),
  '20000000-0000-4000-8000-000000000004'::uuid,
  'the organizer roster contains the promoted member'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003","role":"authenticated","email":"member@example.edu"}',
  true
);
select extensions.throws_ok(
  $$
    select *
    from public.list_service_event_roster(
      (select id from public.service_events where title = 'Service event workflow test')
    )
  $$,
  '42501',
  'Only this event organizer or a teacher administrator can view its roster',
  'ordinary members cannot access an event roster'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa008', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa008","role":"authenticated","email":"expired-member@example.edu"}',
  true
);
select extensions.throws_ok(
  $$
    select public.signup_for_service_event(
      (select id from public.service_events where title = 'Service event workflow test')
    )
  $$,
  '42501',
  'An active member role is required to sign up',
  'expired members cannot sign up'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003","role":"authenticated","email":"member@example.edu"}',
  true
);
select extensions.throws_ok(
  $$
    insert into public.service_event_registrations (
      event_id,
      school_year_id,
      member_membership_id,
      status
    )
    values (
      (select id from public.service_events where title = 'Service event workflow test'),
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000003',
      'confirmed'
    )
  $$,
  '42501',
  'permission denied for table service_event_registrations',
  'authenticated users cannot bypass the atomic signup RPC'
);

reset role;
select extensions.is(
  (
    select count(*)
    from public.audit_events
    where entity_type in ('service_event', 'service_event_registration')
      and action like 'service_event.%'
  ),
  5::bigint,
  'publishing, signup, waitlist, promotion, and withdrawal are audited'
);

select * from extensions.finish();
rollback;
