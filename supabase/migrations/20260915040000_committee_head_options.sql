-- Ordinary members can see reviewer choices without gaining access to the
-- underlying school-year membership records.
create function public.list_committee_head_options(p_school_year_id uuid)
returns table (
  membership_id uuid,
  profile_id uuid,
  full_name text,
  role_keys text[],
  committee_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select reviewer.membership_id, reviewer.profile_id, reviewer.full_name,
         reviewer.role_keys, membership.committee_name
  from public.list_eligible_reviewers(p_school_year_id) reviewer
  join public.school_year_memberships membership on membership.id = reviewer.membership_id;
$$;

revoke all on function public.list_committee_head_options(uuid) from public, anon;
grant execute on function public.list_committee_head_options(uuid) to authenticated;
