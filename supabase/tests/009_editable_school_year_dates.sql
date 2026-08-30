begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(9);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001","role":"authenticated","email":"admin@example.edu"}',
  true
);

select extensions.lives_ok(
  $$
    select public.update_school_year_dates(
      '10000000-0000-4000-8000-000000000001',
      date '2026-09-01',
      date '2027-09-01'
    )
  $$,
  'a teacher administrator can edit school-year dates'
);
select extensions.is(
  (select start_date from public.school_years where id = '10000000-0000-4000-8000-000000000001'),
  date '2026-09-01',
  'the start date is updated'
);
select extensions.is(
  (select end_date from public.school_years where id = '10000000-0000-4000-8000-000000000001'),
  date '2027-09-01',
  'the end date is updated'
);
select extensions.is(
  (
    select expiration_date
    from public.school_year_memberships
    where id = '20000000-0000-4000-8000-000000000003'
  ),
  date '2027-09-01',
  'automatically year-bound membership expiration follows the new end date'
);
select extensions.is(
  (
    select expiration_date
    from public.school_year_memberships
    where id = '20000000-0000-4000-8000-000000000008'
  ),
  date '2026-08-01',
  'an intentionally shortened membership expiration remains unchanged'
);
select extensions.ok(
  exists (
    select 1
    from public.audit_events
    where action = 'school_year.dates_updated'
      and school_year_id = '10000000-0000-4000-8000-000000000001'
  ),
  'the date change is audited'
);
select extensions.throws_ok(
  $$
    select public.update_school_year_dates(
      '10000000-0000-4000-8000-000000000001',
      date '2026-09-01',
      date '2026-08-31'
    )
  $$,
  '22023',
  'The school-year end date must be after its start date',
  'the end date must follow the start date'
);
select extensions.throws_ok(
  $$
    select public.update_school_year_dates(
      '10000000-0000-4000-8000-000000000001',
      date '2025-09-01',
      date '2026-09-01'
    )
  $$,
  '22023',
  'School-year dates must match the years in its label',
  'dates must match the school-year label'
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
    select public.update_school_year_dates(
      '10000000-0000-4000-8000-000000000001',
      date '2026-09-01',
      date '2027-09-01'
    )
  $$,
  '42501',
  'An active global teacher administrator is required',
  'ordinary members cannot edit school-year dates'
);

select * from extensions.finish();
rollback;
