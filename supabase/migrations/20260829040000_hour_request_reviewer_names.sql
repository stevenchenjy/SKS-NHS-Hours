begin;

create or replace function public.get_hour_request_reviewer_names(
  p_request_id uuid
)
returns table (
  requested_approver_name text,
  actual_reviewer_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  -- Match the hour_requests SELECT policy exactly. Returning no row for both
  -- unauthorized and unknown IDs avoids disclosing whether a request exists.
  if auth.uid() is null
    or not coalesce(private.can_view_hour_request(p_request_id), false) then
    return;
  end if;

  return query
  select
    requested_profile.full_name,
    actual_profile.full_name
  from public.hour_requests request
  left join public.school_year_memberships requested_membership
    on requested_membership.id = request.requested_approver_membership_id
   and requested_membership.school_year_id = request.school_year_id
  left join public.profiles requested_profile
    on requested_profile.id = requested_membership.profile_id
  left join public.school_year_memberships actual_membership
    on actual_membership.id = request.actual_reviewer_membership_id
   and actual_membership.school_year_id = request.school_year_id
  left join public.profiles actual_profile
    on actual_profile.id = actual_membership.profile_id
  where request.id = p_request_id;
end;
$function$;

comment on function public.get_hour_request_reviewer_names(uuid) is
  'Returns only reviewer display names for an hour request the caller may already view.';

revoke all on function public.get_hour_request_reviewer_names(uuid)
from public, anon, authenticated;
grant execute on function public.get_hour_request_reviewer_names(uuid)
to authenticated;

commit;
