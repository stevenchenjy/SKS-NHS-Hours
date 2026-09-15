-- Add the new committee to the reference categories used by hour request forms.
insert into public.service_categories (
  id, name, description, display_order, is_active,
  default_max_hours_per_request, created_by_profile_id
)
values (
  '30000000-0000-4000-8000-000000000006', 'Scholarship & Opportunities',
  'Service supporting scholarship and opportunity initiatives.',
  60, true, null, null
)
on conflict (id) do update
set name = excluded.name,
    description = excluded.description,
    is_active = excluded.is_active,
    default_max_hours_per_request = excluded.default_max_hours_per_request;

-- Make it selectable in current and upcoming years without changing closed history.
insert into public.school_year_categories (
  school_year_id, category_id, is_available, display_order,
  max_hours_per_request, member_approved_hours_cap, created_by_profile_id
)
select
  id, '30000000-0000-4000-8000-000000000006', true, 0, null, null, null
from public.school_years
where status in ('active', 'draft')
on conflict (school_year_id, category_id) do update
set is_available = excluded.is_available;
