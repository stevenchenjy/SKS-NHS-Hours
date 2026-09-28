begin;

-- Extend the existing Admin-only recovery workflow to teacher targets.
-- Preserve its API, grants, recipient checks, locking, rate limits, and auditing.
create or replace function public.reserve_member_recovery_link(p_profile_id uuid)
returns table (
  attempt_id bigint,
  recipient_email text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_membership_id uuid;
  member_email text;
  member_school_year_id uuid;
  audit_id bigint;
begin
  actor_membership_id := private.require_teacher_admin();
  if p_profile_id is null then
    raise exception 'An active member or teacher account is required' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('member-recovery-actor:' || actor_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('member-recovery-target:' || p_profile_id::text, 0)
  );

  -- Global teachers do not need an annual membership. Keep Admin and owner
  -- accounts excluded even if they also have a legacy member role.
  select profile.email::text, eligible_membership.school_year_id
    into member_email, member_school_year_id
  from public.profiles profile
  join auth.users auth_user on auth_user.id = profile.id
  left join public.platform_access_grants grant_record on grant_record.profile_id = profile.id
  left join lateral (
    select membership.school_year_id
    from public.school_year_memberships membership
    where membership.profile_id = profile.id
      and private.membership_has_role(membership.id, 'member', true)
    order by membership.created_at desc
    limit 1
  ) eligible_membership on true
  where profile.id = p_profile_id
    and profile.status = 'active'
    and auth_user.email_confirmed_at is not null
    and lower(auth_user.email) = lower(profile.email::text)
    and (
      grant_record.access_level = 'teacher_admin'
      or (grant_record.profile_id is null and eligible_membership.school_year_id is not null)
    );

  if member_email is null then
    raise exception 'An active member or teacher account is required' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.audit_events event
    where event.action = 'account.recovery_link_requested'
      and event.entity_type = 'profile'
      and event.entity_id = p_profile_id::text
      and event.occurred_at > statement_timestamp() - interval '15 minutes'
  ) then
    raise exception 'A reset link was requested recently. Wait 15 minutes before generating another.'
      using errcode = 'P0001';
  end if;

  if (
    select count(*) from public.audit_events event
    where event.action = 'account.recovery_link_requested'
      and event.actor_profile_id = actor_id
      and event.occurred_at > statement_timestamp() - interval '1 hour'
  ) >= 10 then
    raise exception 'The hourly reset-link limit was reached. Try again later.'
      using errcode = 'P0001';
  end if;

  audit_id := private.write_audit(
    'account.recovery_link_requested', 'profile', p_profile_id::text,
    member_school_year_id, actor_membership_id
  );

  return query select audit_id, member_email;
end;
$$;

commit;
