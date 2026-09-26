begin;

-- Reserve a recovery-link attempt before contacting Auth. The per-actor and
-- per-member locks make the limits effective across concurrent requests.
create function public.reserve_member_recovery_link(p_profile_id uuid)
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
    raise exception 'An active member account is required' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('member-recovery-actor:' || actor_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('member-recovery-target:' || p_profile_id::text, 0)
  );

  select profile.email::text, membership.school_year_id
    into member_email, member_school_year_id
  from public.profiles profile
  join auth.users auth_user on auth_user.id = profile.id
  join public.school_year_memberships membership on membership.profile_id = profile.id
  where profile.id = p_profile_id
    and profile.status = 'active'
    and auth_user.email_confirmed_at is not null
    and lower(auth_user.email) = lower(profile.email::text)
    and not exists (
      select 1 from public.platform_access_grants grant_record
      where grant_record.profile_id = profile.id
    )
    and private.membership_has_role(membership.id, 'member', true)
  order by membership.created_at desc
  limit 1;

  if member_email is null then
    raise exception 'An active member account is required' using errcode = '22023';
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

-- The outcome is recorded with the server's secret-key client. A browser
-- session cannot claim that a link was successfully generated.
create function public.complete_member_recovery_link(p_attempt_id bigint, p_succeeded boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_event public.audit_events%rowtype;
begin
  if p_attempt_id is null or p_succeeded is null then
    raise exception 'A recovery attempt and outcome are required' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('member-recovery-attempt:' || p_attempt_id::text, 0)
  );

  select * into request_event
  from public.audit_events event
  where event.id = p_attempt_id
    and event.action = 'account.recovery_link_requested'
    and event.entity_type = 'profile';

  if not found then
    raise exception 'Recovery attempt not found' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.audit_events event
    where event.action in ('account.recovery_link_generated', 'account.recovery_link_failed')
      and event.metadata ->> 'attempt_id' = p_attempt_id::text
  ) then
    raise exception 'Recovery attempt already completed' using errcode = '23505';
  end if;

  perform private.write_audit(
    case when p_succeeded then 'account.recovery_link_generated'
      else 'account.recovery_link_failed' end,
    'profile', request_event.entity_id, request_event.school_year_id,
    request_event.actor_membership_id,
    null, null, jsonb_build_object('attempt_id', p_attempt_id)
  );
end;
$$;

create unique index audit_events_recovery_attempt_completion_unique_idx
  on public.audit_events ((metadata ->> 'attempt_id'))
  where action in ('account.recovery_link_generated', 'account.recovery_link_failed');

revoke all on function public.reserve_member_recovery_link(uuid) from public, anon, service_role;
revoke all on function public.complete_member_recovery_link(bigint, boolean) from public, anon, authenticated;
grant execute on function public.reserve_member_recovery_link(uuid) to authenticated;
grant execute on function public.complete_member_recovery_link(bigint, boolean) to service_role;

commit;
