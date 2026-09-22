begin;

-- Admin manages the portal. Teacher is an approver and event manager. The
-- singleton platform_owner remains protected but has the same Admin workspace.
alter table public.platform_access_grants drop constraint platform_access_grants_level_valid;
alter table public.platform_access_grants add constraint platform_access_grants_level_valid
  check (access_level in ('teacher_admin', 'admin', 'platform_owner'));

create function private.current_actor_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.current_platform_access_level() in ('admin', 'platform_owner'), false);
$$;

create function private.current_actor_is_teacher_approver()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.current_platform_access_level() = 'teacher_admin', false);
$$;

revoke all on function private.current_actor_is_admin() from public, anon, service_role;
revoke all on function private.current_actor_is_teacher_approver() from public, anon, service_role;
grant execute on function private.current_actor_is_admin() to authenticated;
grant execute on function private.current_actor_is_teacher_approver() to authenticated;


create or replace function private.current_actor_is_teacher_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    private.current_platform_access_level() in ('teacher_admin', 'admin', 'platform_owner'),
    false
  );
$$;

comment on function private.current_actor_is_teacher_admin() is
  'Legacy staff-access predicate for teachers and admins; use the specific admin or teacher-approver predicate for actions.';

create or replace function private.require_teacher_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  administrator_membership_id uuid;
begin
  if not private.current_actor_is_admin() then
    raise exception 'Admin access is required'
      using errcode = '42501';
  end if;
  administrator_membership_id := private.current_teacher_admin_membership_id();
  if administrator_membership_id is null then
    raise exception 'Admin attribution anchor is missing'
      using errcode = '55000';
  end if;
  return administrator_membership_id;
end;
$$;

comment on function private.require_teacher_admin() is
  'Legacy administrative RPC guard. Requires Admin; teachers have no account or system-management authority.';

create or replace function public.review_hour_request(
  p_request_id uuid,
  p_action text,
  p_comment text default null
)
returns public.hour_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_record public.hour_requests%rowtype;
  reviewer_membership_id uuid;
  new_status text;
  review_action text;
begin
  if private.current_actor_is_admin() then
    raise exception 'Admin accounts do not approve service hours' using errcode = '42501';
  end if;
  if p_action not in ('approve', 'request_changes', 'reject') then
    raise exception 'Review action must be approve, request_changes, or reject'
      using errcode = '22023';
  end if;
  if p_action in ('request_changes', 'reject')
    and length(btrim(coalesce(p_comment, ''))) = 0 then
    raise exception 'A reviewer comment is required for this action' using errcode = '22023';
  end if;
  if p_comment is not null and length(p_comment) > 4000 then
    raise exception 'Comment must not exceed 4000 characters' using errcode = '22023';
  end if;

  select * into request_record
  from public.hour_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception 'Hour request not found' using errcode = 'P0002';
  end if;
  if request_record.status <> 'pending' then
    raise exception 'Request is no longer pending' using errcode = '40001';
  end if;

  reviewer_membership_id := private.current_membership_id(request_record.school_year_id, true);
  if reviewer_membership_id is null then
    raise exception 'An active reviewer membership is required' using errcode = '42501';
  end if;
  -- A selected committee head may approve their own first stage only. Other
  -- decisions and the final teacher stage still require a different person.
  if reviewer_membership_id = request_record.member_membership_id and (
    p_action = 'approve'
    and request_record.committee_head_approved_at is null
    and reviewer_membership_id = request_record.requested_approver_membership_id
    and private.is_committee_head_membership(
      reviewer_membership_id,
      request_record.school_year_id
    )
  ) is not true then
    raise exception 'Self-review is limited to the selected committee-head approval'
      using errcode = '42501';
  end if;

  if request_record.committee_head_approved_at is null then
    if not private.is_committee_head_membership(
      reviewer_membership_id,
      request_record.school_year_id
    ) then
      raise exception 'The selected committee head must complete the first approval'
        using errcode = '42501';
    end if;
    if reviewer_membership_id <> request_record.requested_approver_membership_id then
      raise exception 'This request is assigned to another committee head'
        using errcode = '42501';
    end if;

    if p_action = 'approve' then
      perform set_config('nhs.allow_hour_request_transition', 'on', true);
      update public.hour_requests
      set
        committee_head_reviewer_membership_id = reviewer_membership_id,
        committee_head_approved_at = statement_timestamp()
      where id = p_request_id
        and status = 'pending'
        and committee_head_approved_at is null
      returning * into request_record;
      if not found then
        raise exception 'Request was processed concurrently' using errcode = '40001';
      end if;

      insert into public.hour_reviews (
        hour_request_id,
        school_year_id,
        action,
        actor_membership_id,
        reviewer_membership_id,
        previous_status,
        new_status,
        previous_requested_approver_membership_id,
        new_requested_approver_membership_id,
        comment
      )
      values (
        request_record.id,
        request_record.school_year_id,
        'committee_approved',
        reviewer_membership_id,
        reviewer_membership_id,
        'pending',
        'pending',
        request_record.requested_approver_membership_id,
        request_record.requested_approver_membership_id,
        nullif(btrim(p_comment), '')
      );

      perform private.write_audit(
        'hour_request.committee_approved',
        'hour_request',
        request_record.id::text,
        request_record.school_year_id,
        reviewer_membership_id,
        jsonb_build_object('status', 'pending', 'approval_stage', 'committee_head'),
        jsonb_build_object(
          'status', 'pending',
          'approval_stage', 'teacher',
          'committee_head_reviewer_membership_id', reviewer_membership_id
        )
      );
      return request_record;
    end if;
  else
    if not private.current_actor_is_teacher_approver() then
      raise exception 'An active teacher administrator must complete the final approval'
        using errcode = '42501';
    end if;
  end if;

  if p_action = 'approve' then
    new_status := 'approved';
    review_action := 'approved';
    perform private.assert_category_approval_cap(
      request_record.member_membership_id,
      request_record.school_year_id,
      request_record.category_id,
      request_record.hours,
      request_record.id
    );
  elsif p_action = 'request_changes' then
    new_status := 'changes_requested';
    review_action := 'changes_requested';
  else
    new_status := 'rejected';
    review_action := 'rejected';
  end if;

  perform set_config('nhs.allow_hour_request_transition', 'on', true);
  update public.hour_requests
  set
    status = new_status,
    actual_reviewer_membership_id = reviewer_membership_id,
    decided_at = statement_timestamp()
  where id = p_request_id
    and status = 'pending'
  returning * into request_record;
  if not found then
    raise exception 'Request was processed concurrently' using errcode = '40001';
  end if;

  insert into public.hour_reviews (
    hour_request_id,
    school_year_id,
    action,
    actor_membership_id,
    reviewer_membership_id,
    previous_status,
    new_status,
    previous_requested_approver_membership_id,
    new_requested_approver_membership_id,
    comment
  )
  values (
    request_record.id,
    request_record.school_year_id,
    review_action,
    reviewer_membership_id,
    reviewer_membership_id,
    'pending',
    new_status,
    request_record.requested_approver_membership_id,
    request_record.requested_approver_membership_id,
    nullif(btrim(p_comment), '')
  );

  perform private.write_audit(
    'hour_request.' || review_action,
    'hour_request',
    request_record.id::text,
    request_record.school_year_id,
    reviewer_membership_id,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object(
      'status', new_status,
      'actual_reviewer_membership_id', reviewer_membership_id,
      'hours', request_record.hours
    ),
    jsonb_build_object(
      'approval_stage',
      case
        when request_record.committee_head_approved_at is null then 'committee_head'
        else 'teacher'
      end
    )
  );
  return request_record;
end;
$$;

create or replace function public.reassign_hour_request(
  p_request_id uuid,
  p_new_reviewer_membership_id uuid,
  p_comment text default null
)
returns public.hour_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_record public.hour_requests%rowtype;
  reviewer_membership_id uuid;
  previous_approver_id uuid;
begin
  if p_comment is not null and length(p_comment) > 4000 then
    raise exception 'Comment must not exceed 4000 characters' using errcode = '22023';
  end if;

  select * into request_record
  from public.hour_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception 'Hour request not found' using errcode = 'P0002';
  end if;
  if request_record.status <> 'pending' then
    raise exception 'Only pending requests can be reassigned' using errcode = '40001';
  end if;
  if request_record.committee_head_approved_at is not null then
    raise exception 'Teacher approval is shared and cannot be reassigned'
      using errcode = '55000';
  end if;
  if not private.current_actor_is_admin() then
    raise exception 'A teacher administrator is required to reassign a committee-head approval'
      using errcode = '42501';
  end if;

  reviewer_membership_id := private.current_membership_id(request_record.school_year_id, true);
  if reviewer_membership_id is null then
    raise exception 'A teacher administrator attribution membership is required'
      using errcode = '42501';
  end if;
  if not private.is_committee_head_membership(
    p_new_reviewer_membership_id,
    request_record.school_year_id
  ) then
    raise exception 'New approver is not an active committee head for this school year'
      using errcode = '22023';
  end if;

  previous_approver_id := request_record.requested_approver_membership_id;
  perform set_config('nhs.allow_hour_request_transition', 'on', true);
  update public.hour_requests
  set requested_approver_membership_id = p_new_reviewer_membership_id
  where id = p_request_id
    and status = 'pending'
    and committee_head_approved_at is null
  returning * into request_record;
  if not found then
    raise exception 'Request was processed concurrently' using errcode = '40001';
  end if;

  insert into public.hour_reviews (
    hour_request_id, school_year_id, action, actor_membership_id,
    reviewer_membership_id, previous_status, new_status,
    previous_requested_approver_membership_id,
    new_requested_approver_membership_id, comment
  ) values (
    request_record.id, request_record.school_year_id, 'reassigned',
    reviewer_membership_id, reviewer_membership_id, 'pending', 'pending',
    previous_approver_id, p_new_reviewer_membership_id, nullif(btrim(p_comment), '')
  );

  perform private.write_audit(
    'hour_request.reassigned', 'hour_request', request_record.id::text,
    request_record.school_year_id, reviewer_membership_id,
    jsonb_build_object('requested_approver_membership_id', previous_approver_id),
    jsonb_build_object('requested_approver_membership_id', p_new_reviewer_membership_id),
    jsonb_build_object('approval_stage', 'committee_head')
  );
  return request_record;
end;
$$;

create or replace function public.correct_approved_request(
  p_request_id uuid,
  p_title text,
  p_description text,
  p_category_id uuid,
  p_service_date date,
  p_hours numeric,
  p_reason text
)
returns public.hour_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_record public.hour_requests%rowtype;
  administrator_membership_id uuid;
  member_profile_id uuid;
  before_values jsonb;
  after_values jsonb;
begin
  if not private.current_actor_is_admin() then
    raise exception 'An active global teacher administrator is required'
      using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 or length(p_reason) > 2000 then
    raise exception 'A correction reason is required and must not exceed 2000 characters'
      using errcode = '22023';
  end if;

  select * into request_record
  from public.hour_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception 'Hour request not found' using errcode = 'P0002';
  end if;
  if request_record.status <> 'approved' then
    raise exception 'Only approved requests use the correction procedure'
      using errcode = '55000';
  end if;

  administrator_membership_id := private.current_teacher_admin_membership_id(
    request_record.school_year_id,
    false
  );
  if administrator_membership_id is null then
    raise exception 'Teacher administrator attribution anchor is missing'
      using errcode = '55000';
  end if;
  select profile_id into member_profile_id
  from public.school_year_memberships
  where id = request_record.member_membership_id;
  if (select auth.uid()) = member_profile_id then
    raise exception 'An administrator cannot correct their own hour request'
      using errcode = '42501';
  end if;

  perform private.assert_request_values(
    request_record.school_year_id,
    request_record.member_membership_id,
    p_category_id,
    request_record.requested_approver_membership_id,
    p_title,
    p_description,
    p_service_date,
    p_hours,
    false,
    false
  );

  before_values := jsonb_build_object(
    'title', request_record.title,
    'description', request_record.description,
    'category_id', request_record.category_id,
    'service_date', request_record.service_date,
    'hours', request_record.hours
  );
  after_values := jsonb_build_object(
    'title', btrim(p_title),
    'description', btrim(p_description),
    'category_id', p_category_id,
    'service_date', p_service_date,
    'hours', p_hours
  );
  if before_values = after_values then
    raise exception 'Correction must change at least one approved value' using errcode = '22023';
  end if;

  perform set_config('nhs.allow_hour_request_transition', 'on', true);
  perform set_config('nhs.allow_approved_correction', 'on', true);
  update public.hour_requests
  set title = btrim(p_title),
      description = btrim(p_description),
      category_id = p_category_id,
      service_date = p_service_date,
      hours = p_hours,
      revision = revision + 1
  where id = p_request_id and status = 'approved'
  returning * into request_record;
  if not found then
    raise exception 'Approved request was changed concurrently' using errcode = '40001';
  end if;

  insert into public.hour_request_corrections (
    hour_request_id, corrected_by_membership_id, reason, before_values, after_values
  ) values (
    request_record.id, administrator_membership_id, btrim(p_reason), before_values, after_values
  );
  insert into public.hour_reviews (
    hour_request_id, school_year_id, action, actor_membership_id,
    reviewer_membership_id, previous_status, new_status,
    previous_requested_approver_membership_id,
    new_requested_approver_membership_id, comment
  ) values (
    request_record.id, request_record.school_year_id, 'corrected',
    administrator_membership_id, administrator_membership_id,
    'approved', 'approved', request_record.requested_approver_membership_id,
    request_record.requested_approver_membership_id, btrim(p_reason)
  );
  perform private.write_audit(
    'hour_request.corrected', 'hour_request', request_record.id::text,
    request_record.school_year_id, administrator_membership_id,
    before_values, after_values,
    jsonb_build_object('reason', btrim(p_reason), 'revision', request_record.revision)
  );
  return request_record;
end;
$$;

create or replace function public.grant_teacher_admin(p_profile_id uuid)
returns public.platform_access_grants
language plpgsql
security definer
set search_path = ''
as $$
declare
  administrator_membership_id uuid;
  grant_record public.platform_access_grants%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('nhs.platform_access', 0));
  perform private.require_teacher_admin();
  administrator_membership_id := private.require_teacher_admin();
  perform 1
  from public.school_years school_year
  order by school_year.id
  for share;
  perform 1
  from public.profiles
  where id = p_profile_id and status = 'active'
  for update;
  if not found then
    raise exception 'An active profile is required' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.school_year_memberships membership
    join public.membership_roles assignment on assignment.membership_id = membership.id
    join public.roles role on role.id = assignment.role_id
    where membership.profile_id = p_profile_id and role.role_key = 'member'
  ) or exists (
    select 1
    from public.hour_requests request
    join public.school_year_memberships membership
      on membership.id = request.member_membership_id
    where membership.profile_id = p_profile_id
  ) then
    raise exception 'Use a separate account for a global teacher administrator'
      using errcode = '23514';
  end if;
  insert into public.platform_access_grants (
    profile_id, access_level, granted_by_profile_id
  ) values (
    p_profile_id, 'teacher_admin', (select auth.uid())
  )
  on conflict (profile_id) do update
  set access_level = public.platform_access_grants.access_level
  returning * into grant_record;
  perform private.ensure_teacher_admin_anchors(p_profile_id, null);
  perform private.write_audit(
    'teacher_admin.granted', 'profile', p_profile_id::text, null,
    administrator_membership_id, null,
    jsonb_build_object('access_level', grant_record.access_level)
  );
  return grant_record;
end;
$$;

create or replace function public.revoke_teacher_admin(p_profile_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  administrator_membership_id uuid;
  target_access_level text;
  removed_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('nhs.platform_access', 0));
  perform private.require_teacher_admin();
  administrator_membership_id := private.require_teacher_admin();
  select access_level into target_access_level
  from public.platform_access_grants
  where profile_id = p_profile_id
  for update;
  if target_access_level is null then return false; end if;
  if target_access_level = 'platform_owner' then
    raise exception 'Transfer platform ownership before revoking this account'
      using errcode = '23514';
  end if;
  if target_access_level = 'admin' then
    raise exception 'Admin access cannot be revoked through the teacher action' using errcode = '23514';
  end if;
  perform set_config('nhs.allow_platform_access_change', 'on', true);
  delete from public.platform_access_grants where profile_id = p_profile_id;
  get diagnostics removed_count = row_count;
  delete from public.membership_roles assignment
  using public.school_year_memberships membership,
        public.roles role
  where assignment.membership_id = membership.id
    and membership.profile_id = p_profile_id
    and assignment.role_id = role.id
    and role.role_key = 'teacher_admin';
  update public.school_year_memberships
  set status = 'archived'
  where profile_id = p_profile_id;
  perform private.write_audit(
    'teacher_admin.revoked', 'profile', p_profile_id::text, null,
    administrator_membership_id,
    jsonb_build_object('access_level', target_access_level), null
  );
  return removed_count > 0;
end;
$$;

create or replace function public.create_invitation(
  p_email text,
  p_full_name text,
  p_school_year_id uuid,
  p_role_keys text[] default array['member'],
  p_expires_at timestamptz default statement_timestamp() + interval '7 days'
)
returns public.invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  administrator_membership_id uuid;
  invitation_record public.invitations%rowtype;
  normalized_email text := lower(btrim(p_email));
  requested_roles text[];
  normalized_roles text[];
  is_teacher_admin_invitation boolean;
begin
  administrator_membership_id := private.require_teacher_admin();
  if not private.email_domain_allowed(normalized_email)
    or length(normalized_email) not between 3 and 320
    or position('@' in normalized_email) < 2 then
    raise exception 'Email address is invalid or not allowed' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_full_name, ''))) not between 1 and 200 then
    raise exception 'Full name is required and must not exceed 200 characters'
      using errcode = '22023';
  end if;
  if p_expires_at <= statement_timestamp() then
    raise exception 'Invitation expiration must be in the future' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.school_years
    where id = p_school_year_id and status in ('draft', 'active')
  ) then
    raise exception 'School year is not open for invitations' using errcode = '55000';
  end if;

  select coalesce(array_agg(distinct role_key order by role_key), '{}'::text[])
  into requested_roles
  from unnest(coalesce(p_role_keys, '{}'::text[])) as role_input(role_key)
  where nullif(btrim(role_key), '') is not null;
  is_teacher_admin_invitation := 'teacher_admin' = any(requested_roles);

  if is_teacher_admin_invitation then
    perform pg_advisory_xact_lock(hashtextextended('nhs.platform_access', 0));
    perform private.require_teacher_admin();
    if cardinality(requested_roles) <> 1 then
      raise exception 'Teacher administrator must be the invitation''s only role'
        using errcode = '23514';
    end if;
    normalized_roles := array['teacher_admin'];
  else
    select array_agg(distinct role_key order by role_key)
    into normalized_roles
    from (
      select unnest(requested_roles) as role_key
      union all select 'member'
    ) normalized;
    if exists (
      select 1 from unnest(normalized_roles) as requested_role(role_key)
      where requested_role.role_key not in (
        'member', 'committee_head', 'president_vice_president'
      )
    ) then
      raise exception 'Invitation contains an unknown role' using errcode = '22023';
    end if;
  end if;

  if exists (
    select 1 from unnest(normalized_roles) as requested_role(role_key)
    where not exists (
      select 1 from public.roles role where role.role_key = requested_role.role_key
    )
  ) then
    raise exception 'Invitation contains an unknown role' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.profiles profile where lower(profile.email::text) = normalized_email
  ) then
    raise exception 'An account already exists for this email' using errcode = '23505';
  end if;

  insert into public.invitations (
    email, full_name, school_year_id, expires_at, invited_by_membership_id
  ) values (
    normalized_email, btrim(p_full_name), p_school_year_id, p_expires_at,
    administrator_membership_id
  )
  returning * into invitation_record;
  insert into public.invitation_roles (invitation_id, role_id)
  select invitation_record.id, role.id
  from public.roles role
  where role.role_key = any(normalized_roles);
  perform private.write_audit(
    'invitation.created', 'invitation', invitation_record.id::text, p_school_year_id,
    administrator_membership_id, null,
    jsonb_build_object(
      'email', normalized_email,
      'role_keys', normalized_roles,
      'expires_at', p_expires_at,
      'global_access', is_teacher_admin_invitation
    )
  );
  return invitation_record;
end;
$$;

create or replace function public.prepare_invitation_send(p_invitation_id uuid)
returns table (
  invitation_id uuid,
  email text,
  full_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  administrator_invitation boolean;
begin
  perform private.require_teacher_admin();

  select exists (
    select 1
    from public.invitation_roles assignment
    join public.roles role on role.id = assignment.role_id
    where assignment.invitation_id = p_invitation_id
      and role.role_key = 'teacher_admin'
  ) into administrator_invitation;
  if administrator_invitation then
    perform pg_advisory_xact_lock(hashtextextended('nhs.platform_access', 0));
    perform private.require_teacher_admin();
  end if;

  return query
  select invitation.id, invitation.email::text, invitation.full_name
  from public.invitations invitation
  join public.school_years school_year on school_year.id = invitation.school_year_id
  where invitation.id = p_invitation_id
    and invitation.status = 'pending'
    and (
      administrator_invitation
      or school_year.status in ('draft', 'active')
    );

  if not found then
    if not exists (
      select 1 from public.invitations invitation where invitation.id = p_invitation_id
    ) then
      raise exception 'Invitation not found' using errcode = 'P0002';
    end if;
    raise exception 'Only a pending invitation for an open school year can be sent'
      using errcode = '55000';
  end if;
end;
$$;

create or replace function public.record_invitation_send_success(
  p_invitation_id uuid,
  p_send_idempotency_key uuid,
  p_expires_at timestamptz
)
returns public.invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  administrator_membership_id uuid;
  administrator_invitation boolean;
  invitation_record public.invitations%rowtype;
  prior_send_event public.audit_events%rowtype;
  prior_values jsonb;
  send_accepted_at timestamptz;
  audit_action text;
begin
  administrator_membership_id := private.require_teacher_admin();

  if p_send_idempotency_key is null then
    raise exception 'Send idempotency key is required' using errcode = '22023';
  end if;

  select * into invitation_record
  from public.invitations where id = p_invitation_id for update;
  if not found then raise exception 'Invitation not found' using errcode = 'P0002'; end if;

  select exists (
    select 1
    from public.invitation_roles assignment
    join public.roles role on role.id = assignment.role_id
    where assignment.invitation_id = invitation_record.id
      and role.role_key = 'teacher_admin'
  ) into administrator_invitation;
  if administrator_invitation then
    perform pg_advisory_xact_lock(hashtextextended('nhs.platform_access', 0));
    perform private.require_teacher_admin();
  end if;

  select audit_event.* into prior_send_event
  from public.audit_events audit_event
  where audit_event.entity_type = 'invitation'
    and audit_event.entity_id = p_invitation_id::text
    and audit_event.action in ('invitation.sent', 'invitation.resent')
    and audit_event.metadata ->> 'send_idempotency_key' = p_send_idempotency_key::text
  order by audit_event.id
  limit 1;

  if found then
    if (prior_send_event.metadata ->> 'requested_expires_at')::timestamptz
      is distinct from p_expires_at then
      raise exception 'Send idempotency key was already used with a different expiration'
        using errcode = '22023';
    end if;
    return invitation_record;
  end if;

  send_accepted_at := clock_timestamp();
  if p_expires_at is null or p_expires_at <= send_accepted_at then
    raise exception 'Invitation expiration must be in the future' using errcode = '22023';
  end if;
  if p_expires_at > send_accepted_at + interval '7 days 5 minutes' then
    raise exception 'Invitation expiration cannot exceed seven days'
      using errcode = '22023';
  end if;

  if invitation_record.status <> 'pending' then
    raise exception 'Only pending invitations can record a successful send'
      using errcode = '55000';
  end if;
  if not administrator_invitation and not exists (
    select 1 from public.school_years school_year
    where school_year.id = invitation_record.school_year_id
      and school_year.status in ('draft', 'active')
  ) then
    raise exception 'Invitation school year is no longer open' using errcode = '55000';
  end if;

  prior_values := jsonb_build_object(
    'sent_at', invitation_record.sent_at,
    'send_count', invitation_record.send_count,
    'expires_at', invitation_record.expires_at
  );
  audit_action := case
    when invitation_record.send_count = 0 then 'invitation.sent'
    else 'invitation.resent'
  end;

  update public.invitations
  set sent_at = send_accepted_at,
      expires_at = greatest(expires_at, p_expires_at),
      send_count = send_count + 1
  where id = p_invitation_id returning * into invitation_record;

  perform private.write_audit(
    audit_action, 'invitation', invitation_record.id::text,
    invitation_record.school_year_id, administrator_membership_id, prior_values,
    jsonb_build_object(
      'sent_at', invitation_record.sent_at,
      'send_count', invitation_record.send_count,
      'expires_at', invitation_record.expires_at
    ),
    jsonb_build_object(
      'provider', 'supabase_auth',
      'send_idempotency_key', p_send_idempotency_key,
      'requested_expires_at', p_expires_at
    )
  );
  return invitation_record;
end;
$$;

create or replace function public.revoke_invitation(p_invitation_id uuid)
returns public.invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  administrator_membership_id uuid;
  administrator_invitation boolean;
  invitation_record public.invitations%rowtype;
begin
  administrator_membership_id := private.require_teacher_admin();
  select * into invitation_record
  from public.invitations where id = p_invitation_id for update;
  if not found then raise exception 'Invitation not found' using errcode = 'P0002'; end if;

  select exists (
    select 1
    from public.invitation_roles assignment
    join public.roles role on role.id = assignment.role_id
    where assignment.invitation_id = invitation_record.id
      and role.role_key = 'teacher_admin'
  ) into administrator_invitation;
  if administrator_invitation then
    perform pg_advisory_xact_lock(hashtextextended('nhs.platform_access', 0));
    perform private.require_teacher_admin();
  end if;

  if invitation_record.status <> 'pending' then
    raise exception 'Only pending invitations can be revoked' using errcode = '55000';
  end if;
  update public.invitations
  set status = 'revoked', revoked_at = statement_timestamp(),
      revoked_by_membership_id = administrator_membership_id
  where id = p_invitation_id returning * into invitation_record;
  perform private.write_audit(
    'invitation.revoked', 'invitation', invitation_record.id::text,
    invitation_record.school_year_id, administrator_membership_id,
    jsonb_build_object('status', 'pending'), jsonb_build_object('status', 'revoked')
  );
  return invitation_record;
end;
$$;

create or replace function public.set_profile_status(
  p_profile_id uuid,
  p_status text
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  administrator_membership_id uuid;
  profile_record public.profiles%rowtype;
  previous_status text;
  target_access_level text;
begin
  administrator_membership_id := private.require_teacher_admin();
  if p_status not in ('active', 'inactive') then
    raise exception 'Invalid profile status' using errcode = '22023';
  end if;
  select * into profile_record from public.profiles where id = p_profile_id for update;
  if not found then raise exception 'Profile not found' using errcode = 'P0002'; end if;
  select access_level into target_access_level
  from public.platform_access_grants
  where profile_id = p_profile_id;
  if target_access_level is not null and not private.current_actor_is_admin() then
    raise exception 'Only the platform owner may change a global administrator profile'
      using errcode = '42501';
  end if;
  previous_status := profile_record.status;
  update public.profiles
  set status = p_status,
      deactivated_at = case when p_status = 'inactive' then statement_timestamp() else null end,
      deactivated_by_profile_id = case when p_status = 'inactive' then (select auth.uid()) else null end
  where id = p_profile_id
  returning * into profile_record;
  perform private.write_audit(
    'profile.status_changed', 'profile', profile_record.id::text, null,
    administrator_membership_id, jsonb_build_object('status', previous_status),
    jsonb_build_object('status', p_status)
  );
  return profile_record;
end;
$$;

create or replace function public.grant_admin(p_profile_id uuid)
returns public.platform_access_grants
language plpgsql
security definer
set search_path = ''
as $$
declare
  administrator_membership_id uuid;
  grant_record public.platform_access_grants%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('nhs.platform_access', 0));
  perform private.require_platform_owner();
  administrator_membership_id := private.require_teacher_admin();
  perform 1
  from public.school_years school_year
  order by school_year.id
  for share;
  perform 1
  from public.profiles
  where id = p_profile_id and status = 'active'
  for update;
  if not found then
    raise exception 'An active profile is required' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.school_year_memberships membership
    join public.membership_roles assignment on assignment.membership_id = membership.id
    join public.roles role on role.id = assignment.role_id
    where membership.profile_id = p_profile_id and role.role_key = 'member'
  ) or exists (
    select 1
    from public.hour_requests request
    join public.school_year_memberships membership
      on membership.id = request.member_membership_id
    where membership.profile_id = p_profile_id
  ) then
    raise exception 'Use a separate account for a global teacher administrator'
      using errcode = '23514';
  end if;
  insert into public.platform_access_grants (
    profile_id, access_level, granted_by_profile_id
  ) values (
    p_profile_id, 'admin', (select auth.uid())
  )
  on conflict (profile_id) do update
  set access_level = case when public.platform_access_grants.access_level = 'platform_owner'
    then 'platform_owner' else 'admin' end
  returning * into grant_record;
  perform private.ensure_teacher_admin_anchors(p_profile_id, null);
  perform private.write_audit(
    'admin.granted', 'profile', p_profile_id::text, null,
    administrator_membership_id, null,
    jsonb_build_object('access_level', grant_record.access_level)
  );
  return grant_record;
end;
$$;

revoke all on function public.grant_admin(uuid) from public, anon, service_role;
grant execute on function public.grant_admin(uuid) to authenticated;

create or replace view public.pending_review_queue
with (security_invoker = true)
as
select
  request.id,
  request.member_membership_id,
  request.school_year_id,
  request.category_id,
  request.requested_approver_membership_id,
  request.actual_reviewer_membership_id,
  request.title,
  request.description,
  request.service_date,
  request.hours,
  request.status,
  request.client_submission_key,
  request.revision,
  request.created_at,
  request.submitted_at,
  request.updated_at,
  request.decided_at,
  request.withdrawn_at,
  member_membership.profile_id as member_profile_id,
  member_profile.full_name as member_name,
  member_profile.email::text as member_email,
  category.name::text as category_name,
  approver_membership.profile_id as requested_approver_profile_id,
  approver_profile.full_name as requested_approver_name,
  case
    when request.committee_head_approved_at is null then
      request.requested_approver_membership_id = private.current_membership_id(
        request.school_year_id,
        true
      )
    else private.current_actor_is_teacher_approver()
  end as assigned_to_current_user,
  greatest(
    current_date - coalesce(request.committee_head_approved_at, request.submitted_at)::date,
    0
  ) as days_pending,
  request.committee_head_reviewer_membership_id,
  request.committee_head_approved_at,
  case
    when request.committee_head_approved_at is null then 'committee_head'
    else 'teacher'
  end as approval_stage,
  coalesce(request.committee_head_approved_at, request.submitted_at) as waiting_since
from public.hour_requests request
join public.school_year_memberships member_membership
  on member_membership.id = request.member_membership_id
join public.profiles member_profile on member_profile.id = member_membership.profile_id
join public.service_categories category on category.id = request.category_id
join public.school_year_memberships approver_membership
  on approver_membership.id = request.requested_approver_membership_id
join public.profiles approver_profile on approver_profile.id = approver_membership.profile_id
where request.status = 'pending'
  and (
    (
      private.current_actor_is_teacher_approver()
      and (
        request.committee_head_approved_at is not null
        or not private.is_committee_head_membership(
          request.requested_approver_membership_id,
          request.school_year_id
        )
      )
    )
    or (
      request.committee_head_approved_at is null
      and private.is_committee_head_membership(
        private.current_membership_id(request.school_year_id, true),
        request.school_year_id
      )
      and request.requested_approver_membership_id = private.current_membership_id(
        request.school_year_id,
        true
      )
    )
  );

create or replace view public.export_service_records
with (security_invoker = true)
as
select
  request.id as request_id,
  request.school_year_id,
  school_year.label::text as school_year_label,
  membership.id as member_membership_id,
  profile.id as member_profile_id,
  profile.full_name as member_name,
  profile.email::text as member_email,
  category.id as category_id,
  category.name::text as category_name,
  request.title,
  request.description,
  request.service_date,
  request.hours,
  request.status,
  request.revision,
  request.requested_approver_membership_id,
  requested_profile.full_name as requested_approver_name,
  request.actual_reviewer_membership_id,
  actual_profile.full_name as actual_reviewer_name,
  latest_review.comment as latest_review_comment,
  request.created_at,
  request.submitted_at,
  request.decided_at,
  request.withdrawn_at
from public.hour_requests request
join public.school_years school_year on school_year.id = request.school_year_id
join public.school_year_memberships membership on membership.id = request.member_membership_id
join public.profiles profile on profile.id = membership.profile_id
left join public.service_categories category on category.id = request.category_id
left join public.school_year_memberships requested_membership
  on requested_membership.id = request.requested_approver_membership_id
left join public.profiles requested_profile on requested_profile.id = requested_membership.profile_id
left join public.school_year_memberships actual_membership
  on actual_membership.id = request.actual_reviewer_membership_id
left join public.profiles actual_profile on actual_profile.id = actual_membership.profile_id
left join lateral (
  select review.comment
  from public.hour_reviews review
  where review.hour_request_id = request.id
    and review.reviewer_membership_id is not null
    and review.comment is not null
  order by review.created_at desc, review.id desc
  limit 1
) latest_review on true
where private.current_actor_is_admin();

alter policy invitations_select_teacher_admin on public.invitations
  using (private.current_actor_is_admin());
alter policy invitation_roles_select_teacher_admin on public.invitation_roles
  using (private.current_actor_is_admin());
alter policy app_settings_select_teacher_admin on public.app_settings
  using (private.current_actor_is_admin());
alter policy audit_events_select_platform_owner on public.audit_events
  using (private.current_actor_is_admin());

create or replace function public.claim_invitation(p_invitation_id uuid default null)
returns public.school_year_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation_record public.invitations%rowtype;
  membership_record public.school_year_memberships%rowtype;
  caller_email text;
  resolved_invitation_id uuid;
  eligible_invitation_count integer;
  administrator_invitation boolean;
  inviter_profile_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  caller_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  if caller_email = '' then
    select lower(email) into caller_email
    from auth.users where id = (select auth.uid());
  end if;
  if p_invitation_id is null then
    select count(*)::integer, min(invitation.id::text)::uuid
    into eligible_invitation_count, resolved_invitation_id
    from public.invitations invitation
    where lower(invitation.email::text) = caller_email
      and invitation.status = 'pending'
      and invitation.expires_at > statement_timestamp();
    if eligible_invitation_count = 0 then
      raise exception 'No eligible invitation was found for the authenticated email'
        using errcode = 'P0002';
    elsif eligible_invitation_count > 1 then
      raise exception 'Multiple eligible invitations exist; an invitation ID is required'
        using errcode = '21000';
    end if;
  else
    resolved_invitation_id := p_invitation_id;
  end if;

  select * into invitation_record
  from public.invitations where id = resolved_invitation_id for update;
  if not found then raise exception 'Invitation not found' using errcode = 'P0002'; end if;
  if invitation_record.status <> 'pending'
    or invitation_record.expires_at <= statement_timestamp() then
    raise exception 'Invitation is no longer valid' using errcode = '55000';
  end if;
  if lower(invitation_record.email::text) <> caller_email then
    raise exception 'Invitation email does not match the authenticated user'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from auth.users auth_user
    where auth_user.id = (select auth.uid()) and lower(auth_user.email) = caller_email
  ) then
    raise exception 'Authenticated user record is missing' using errcode = '42501';
  end if;

  select exists (
    select 1
    from public.invitation_roles assignment
    join public.roles role on role.id = assignment.role_id
    where assignment.invitation_id = invitation_record.id
      and role.role_key = 'teacher_admin'
  ) into administrator_invitation;
  if administrator_invitation and exists (
    select 1
    from public.invitation_roles assignment
    join public.roles role on role.id = assignment.role_id
    where assignment.invitation_id = invitation_record.id
      and role.role_key <> 'teacher_admin'
  ) then
    raise exception 'Teacher-administrator invitation contains incompatible roles'
      using errcode = '23514';
  end if;

  select profile_id into inviter_profile_id
  from public.school_year_memberships
  where id = invitation_record.invited_by_membership_id;

  if administrator_invitation then
    perform pg_advisory_xact_lock(hashtextextended('nhs.platform_access', 0));
    perform 1
    from public.school_years school_year
    order by school_year.id
    for share;
    select grant_row.profile_id into inviter_profile_id
    from public.platform_access_grants grant_row
    join public.profiles profile on profile.id = grant_row.profile_id
    where grant_row.access_level = 'platform_owner'
      and profile.status = 'active'
    for share of grant_row;
    if inviter_profile_id is null then
      raise exception 'The administrator invitation is no longer authorized'
        using errcode = '42501';
    end if;
  end if;

  insert into public.profiles (id, email, full_name)
  values ((select auth.uid()), caller_email, invitation_record.full_name)
  on conflict (id) do update
  set email = excluded.email, full_name = excluded.full_name;

  if administrator_invitation then
    if exists (
      select 1
      from public.school_year_memberships membership
      join public.membership_roles assignment on assignment.membership_id = membership.id
      join public.roles role on role.id = assignment.role_id
      where membership.profile_id = (select auth.uid())
        and role.role_key = 'member'
    ) or exists (
      select 1
      from public.hour_requests request
      join public.school_year_memberships membership
        on membership.id = request.member_membership_id
      where membership.profile_id = (select auth.uid())
    ) then
      raise exception 'Use a separate account for a global teacher administrator'
        using errcode = '23514';
    end if;
    insert into public.platform_access_grants (
      profile_id, access_level, granted_by_profile_id
    ) values (
      (select auth.uid()), 'teacher_admin', inviter_profile_id
    )
    on conflict (profile_id) do nothing;
    -- An invited teacher may have been promoted to Admin before first login.
    -- Accepting the original invitation must preserve that existing grant.
    select membership.* into membership_record
    from public.school_year_memberships membership
    where membership.profile_id = (select auth.uid())
      and membership.school_year_id = invitation_record.school_year_id;
  else
    insert into public.school_year_memberships (
      profile_id, school_year_id, status, expiration_date,
      target_hours_override, created_by_profile_id
    )
    select (select auth.uid()), school_year.id, 'active', school_year.end_date,
           null, inviter_profile_id
    from public.school_years school_year
    where school_year.id = invitation_record.school_year_id
      and school_year.status in ('draft', 'active')
    on conflict (profile_id, school_year_id) do update
    set status = 'active', target_hours_override = null
    returning * into membership_record;
    if membership_record.id is null then
      raise exception 'Invitation school year is no longer open' using errcode = '55000';
    end if;
    insert into public.membership_roles (membership_id, role_id, assigned_by_profile_id)
    select membership_record.id, assignment.role_id, inviter_profile_id
    from public.invitation_roles assignment
    join public.roles role on role.id = assignment.role_id
    where assignment.invitation_id = invitation_record.id
      and role.role_key <> 'teacher_admin'
    on conflict (membership_id, role_id) do nothing;
  end if;

  if membership_record.id is null then
    raise exception 'Invitation did not create an access record' using errcode = '55000';
  end if;
  update public.invitations
  set status = 'accepted', accepted_by_profile_id = (select auth.uid()),
      accepted_at = statement_timestamp()
  where id = invitation_record.id;
  perform private.write_audit(
    'invitation.accepted', 'invitation', invitation_record.id::text,
    invitation_record.school_year_id, membership_record.id,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object(
      'status', 'accepted',
      'profile_id', (select auth.uid()),
      'global_access', administrator_invitation
    )
  );
  return membership_record;
end;
$$;

commit;
