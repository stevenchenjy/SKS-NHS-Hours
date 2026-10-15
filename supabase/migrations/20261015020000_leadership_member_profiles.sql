begin;

-- Member-profile pages join profiles, yearly memberships, role assignments,
-- progress, and requests. Leadership's existing request access alone cannot
-- satisfy those joins after approval capability was narrowed to committee heads.
-- Retain the existing active-target rule and add read access only to service
-- members in the President / Vice President's own active school year.
create or replace function private.can_view_membership(p_membership_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.school_year_memberships target_membership
    where target_membership.id = p_membership_id
      and (
        target_membership.profile_id = auth.uid()
        or private.current_actor_is_teacher_admin()
        or (
          private.membership_is_active(target_membership.id)
          and (
            private.current_actor_is_review_capable(target_membership.school_year_id)
            or (
              private.is_service_member_membership(target_membership.id)
              and private.membership_has_role(
                private.current_membership_id(target_membership.school_year_id, true),
                'president_vice_president', true
              )
            )
          )
        )
      )
  );
$$;

create or replace function private.can_view_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (
      p_profile_id = auth.uid()
      and exists (select 1 from public.profiles profile where profile.id = auth.uid())
    )
    or (
      private.is_provisioned_profile()
      and (
        private.current_actor_is_teacher_admin()
        or exists (
          select 1
          from public.school_year_memberships target_membership
          where target_membership.profile_id = p_profile_id
            and private.membership_is_active(target_membership.id)
            and (
              private.current_actor_is_review_capable(target_membership.school_year_id)
              or (
                private.is_service_member_membership(target_membership.id)
                and private.membership_has_role(
                  private.current_membership_id(target_membership.school_year_id, true),
                  'president_vice_president', true
                )
              )
            )
        )
      )
    );
$$;

notify pgrst, 'reload schema';

commit;
