-- Committee responsibilities belong to the school-year membership, not the
-- person's name or permanent profile.
alter table public.school_year_memberships
  add column committee_name text,
  add constraint school_year_memberships_committee_name_length
    check (committee_name is null or length(btrim(committee_name)) between 1 and 120);

update public.school_year_memberships membership
set committee_name = assignment.committee_name
from public.profiles profile,
     public.school_years school_year,
     (values
       ('aadyag2027@sks.org', 'Scholarship & Opportunities'),
       ('dungv2027@sks.org', 'Peer Tutoring'),
       ('izahc2027@sks.org', 'Fundraising and Events'),
       ('zixuann2027@sks.org', 'Community Service')
     ) as assignment(email, committee_name)
where membership.profile_id = profile.id
  and membership.school_year_id = school_year.id
  and school_year.label = '2026-2027'
  and lower(profile.email::text) = assignment.email;
