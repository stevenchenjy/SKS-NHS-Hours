begin;

-- Presidents / Vice Presidents can read the full service log for their active
-- school year. Teachers, Admins, and the platform owner retain global read
-- access. Review and mutation authorization remains in the existing RPCs.
create or replace function private.can_view_hour_request(p_hour_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.hour_requests request
    join public.school_year_memberships member_membership
      on member_membership.id = request.member_membership_id
    where request.id = p_hour_request_id
      and (
        member_membership.profile_id = auth.uid()
        or private.current_actor_is_teacher_admin()
        or exists (
          select 1
          from public.school_year_memberships leader_membership
          join public.membership_roles assignment
            on assignment.membership_id = leader_membership.id
          join public.roles leader_role on leader_role.id = assignment.role_id
          where leader_membership.profile_id = auth.uid()
            and leader_membership.school_year_id = request.school_year_id
            and private.membership_is_active(leader_membership.id)
            and leader_role.role_key = 'president_vice_president'
        )
        or (
          request.status = 'pending'
          and request.requested_approver_membership_id = private.current_membership_id(
            request.school_year_id,
            true
          )
          and private.current_actor_is_review_capable(request.school_year_id)
        )
        or exists (
          select 1
          from public.hour_reviews review
          join public.school_year_memberships reviewer_membership
            on reviewer_membership.id = review.reviewer_membership_id
          where review.hour_request_id = request.id
            and reviewer_membership.profile_id = auth.uid()
        )
      )
  );
$$;

commit;
