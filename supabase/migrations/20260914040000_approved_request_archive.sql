begin;

-- Approval remains the authoritative status so approved hours still count.
-- This view provides an archive without changing or deleting request history.
create view public.approved_request_archive
with (security_invoker = true)
as
select request.id, request.school_year_id, request.title, request.hours,
  request.service_date, request.status, request.decided_at,
  request.requested_approver_membership_id,
  member_profile.full_name as member_name,
  category.name::text as category_name,
  approver_profile.full_name as requested_approver_name,
  reviewer_profile.full_name as actual_reviewer_name
from public.hour_requests request
join public.school_year_memberships member_membership on member_membership.id = request.member_membership_id
join public.profiles member_profile on member_profile.id = member_membership.profile_id
join public.service_categories category on category.id = request.category_id
join public.school_year_memberships approver_membership on approver_membership.id = request.requested_approver_membership_id
join public.profiles approver_profile on approver_profile.id = approver_membership.profile_id
join public.school_year_memberships reviewer_membership on reviewer_membership.id = request.actual_reviewer_membership_id
join public.profiles reviewer_profile on reviewer_profile.id = reviewer_membership.profile_id
where request.status = 'approved';

grant select on public.approved_request_archive to authenticated;
comment on view public.approved_request_archive is
  'Completed approvals, shared across authorized reviewers under the underlying row-level policies.';
commit;
