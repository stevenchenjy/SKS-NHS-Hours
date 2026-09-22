begin;

-- Progress totals must not depend on which individual requests a leader can
-- review. Keep the view security-invoker for roster visibility, and elevate
-- only the aggregate after checking the caller's existing membership access.
create or replace function private.member_request_summary(p_membership_id uuid)
returns table (
  approved_count bigint,
  pending_count bigint,
  changes_requested_count bigint,
  rejected_count bigint,
  draft_count bigint,
  withdrawn_count bigint,
  approved_hours numeric,
  pending_hours numeric,
  changes_requested_hours numeric,
  rejected_hours numeric,
  withdrawn_hours numeric,
  draft_hours numeric,
  last_activity_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce(private.can_view_membership(p_membership_id), false)
    or not coalesce(private.is_service_member_membership(p_membership_id), false) then
    return;
  end if;

  return query
  select
    count(*) filter (where request.status = 'approved')::bigint as approved_count,
    count(*) filter (where request.status = 'pending')::bigint as pending_count,
    count(*) filter (where request.status = 'changes_requested')::bigint
      as changes_requested_count,
    count(*) filter (where request.status = 'rejected')::bigint as rejected_count,
    count(*) filter (where request.status = 'draft')::bigint as draft_count,
    count(*) filter (where request.status = 'withdrawn')::bigint as withdrawn_count,
    sum(request.hours) filter (where request.status = 'approved') as approved_hours,
    sum(request.hours) filter (where request.status = 'pending') as pending_hours,
    sum(request.hours) filter (where request.status = 'changes_requested')
      as changes_requested_hours,
    sum(request.hours) filter (where request.status = 'rejected') as rejected_hours,
    sum(request.hours) filter (where request.status = 'withdrawn') as withdrawn_hours,
    sum(request.hours) filter (where request.status = 'draft') as draft_hours,
    max(request.updated_at) as last_activity_at
  from public.hour_requests request
  where request.member_membership_id = p_membership_id;
end;
$$;

revoke all on function private.member_request_summary(uuid) from public, anon, service_role;
grant execute on function private.member_request_summary(uuid) to authenticated;

create or replace view public.member_progress
with (security_invoker = true)
as
select
  membership.id as membership_id,
  membership.profile_id,
  membership.school_year_id,
  school_year.label::text as school_year_label,
  profile.full_name,
  profile.email::text as email,
  membership.status as membership_status,
  membership.expiration_date,
  membership.target_hours_override,
  35.00::numeric(7, 2) as target_hours,
  coalesce(role_summary.role_keys, '{}'::text[]) as role_keys,
  coalesce(request_summary.approved_count, 0) as approved_count,
  coalesce(request_summary.pending_count, 0) as pending_count,
  coalesce(request_summary.changes_requested_count, 0) as changes_requested_count,
  coalesce(request_summary.rejected_count, 0) as rejected_count,
  coalesce(request_summary.draft_count, 0) as draft_count,
  coalesce(request_summary.withdrawn_count, 0) as withdrawn_count,
  coalesce(request_summary.approved_hours, 0)::numeric(12, 2) as approved_hours,
  coalesce(request_summary.pending_hours, 0)::numeric(12, 2) as pending_hours,
  coalesce(request_summary.changes_requested_hours, 0)::numeric(12, 2)
    as changes_requested_hours,
  coalesce(request_summary.rejected_hours, 0)::numeric(12, 2) as rejected_hours,
  coalesce(request_summary.withdrawn_hours, 0)::numeric(12, 2) as withdrawn_hours,
  coalesce(request_summary.draft_hours, 0)::numeric(12, 2) as draft_hours,
  greatest(35.00 - coalesce(request_summary.approved_hours, 0), 0)::numeric(12, 2)
    as remaining_hours,
  greatest(coalesce(request_summary.approved_hours, 0) - 35.00, 0)::numeric(12, 2)
    as over_goal_hours,
  request_summary.last_activity_at,
  round(coalesce(request_summary.approved_hours, 0) / 35.00 * 100, 2)::numeric(7, 2)
    as progress_percent,
  round(coalesce(request_summary.approved_hours, 0) / 35.00 * 100, 2)::numeric(7, 2)
    as actual_percentage
from public.school_year_memberships membership
join public.profiles profile on profile.id = membership.profile_id
join public.school_years school_year on school_year.id = membership.school_year_id
left join lateral (
  select array_agg(role.role_key order by role.display_order, role.role_key) as role_keys
  from public.membership_roles assignment
  join public.roles role on role.id = assignment.role_id
  where assignment.membership_id = membership.id
) role_summary on true
left join lateral private.member_request_summary(membership.id) request_summary on true
where private.is_service_member_membership(membership.id);

comment on function private.member_request_summary(uuid) is
  'Complete request totals for an authorized service membership; exposes no request details.';

commit;
