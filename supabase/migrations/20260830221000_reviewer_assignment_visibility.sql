begin;

-- President / Vice President is a leadership role, not an approval role. The
-- fixed role definitions are intentionally immutable, so authorization is
-- narrowed here. An account that also holds Committee Head remains eligible.
create or replace function private.is_review_capable_membership(
  p_membership_id uuid,
  p_school_year_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.membership_is_active(p_membership_id)
    and exists (
      select 1
      from public.school_year_memberships membership
      join public.membership_roles membership_role on membership_role.membership_id = membership.id
      join public.roles role on role.id = membership_role.role_id
      where membership.id = p_membership_id
        and membership.school_year_id = p_school_year_id
        and role.role_key in ('committee_head', 'teacher_admin')
    );
$$;

-- Teachers may view every request. Other leaders may view only a pending
-- request assigned to their active membership, plus requests whose review
-- history they personally authored. Members retain access to their own work.
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
  request.requested_approver_membership_id = private.current_membership_id(
    request.school_year_id,
    true
  ) as assigned_to_current_user,
  greatest(current_date - request.submitted_at::date, 0) as days_pending
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
    private.current_actor_is_teacher_admin()
    or (
      private.current_actor_is_review_capable(request.school_year_id)
      and request.requested_approver_membership_id = private.current_membership_id(
        request.school_year_id,
        true
      )
    )
  );

-- A platform owner is a monitoring account, not an approver.  Keep it out of
-- the member-facing picker even when it also has an administrative anchor.
create or replace function public.list_eligible_reviewers(p_school_year_id uuid)
returns table (
  membership_id uuid,
  profile_id uuid,
  full_name text,
  role_keys text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_membership_id uuid;
begin
  caller_membership_id := private.current_membership_id(p_school_year_id, true);
  if caller_membership_id is null then
    raise exception 'An active membership in the school year is required'
      using errcode = '42501';
  end if;

  return query
  select
    membership.id,
    membership.profile_id,
    profile.full_name,
    array_agg(role.role_key order by role.display_order, role.role_key)
  from public.school_year_memberships membership
  join public.profiles profile on profile.id = membership.profile_id
  join public.membership_roles membership_role
    on membership_role.membership_id = membership.id
  join public.roles role on role.id = membership_role.role_id
  where membership.school_year_id = p_school_year_id
    and membership.id <> caller_membership_id
    and private.membership_is_active(membership.id)
    and not exists (
      select 1
      from public.platform_access_grants grant_row
      where grant_row.profile_id = membership.profile_id
        and grant_row.access_level = 'platform_owner'
    )
  group by membership.id, membership.profile_id, profile.full_name
  having bool_or(role.role_key in ('committee_head', 'teacher_admin'))
  order by lower(profile.full_name), membership.id;
end;
$$;

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
  if not private.is_review_capable_membership(
    reviewer_membership_id,
    request_record.school_year_id
  ) then
    raise exception 'An active review-capable role is required' using errcode = '42501';
  end if;
  if reviewer_membership_id = request_record.member_membership_id then
    raise exception 'A reviewer cannot process their own request' using errcode = '42501';
  end if;
  if not private.current_actor_is_teacher_admin()
    and reviewer_membership_id <> request_record.requested_approver_membership_id then
    raise exception 'This request is assigned to another reviewer' using errcode = '42501';
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
      'assigned_reviewer_processed',
      reviewer_membership_id = request_record.requested_approver_membership_id
    )
  );
  return request_record;
end;
$$;

-- A committee head can only reassign a request already assigned to them. A
-- teacher administrator retains the ability to reroute any pending request.
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

  reviewer_membership_id := private.current_membership_id(request_record.school_year_id, true);
  if not private.is_review_capable_membership(
    reviewer_membership_id,
    request_record.school_year_id
  ) then
    raise exception 'An active review-capable role is required' using errcode = '42501';
  end if;
  if reviewer_membership_id = request_record.member_membership_id then
    raise exception 'A reviewer cannot process their own request' using errcode = '42501';
  end if;
  if not private.current_actor_is_teacher_admin()
    and reviewer_membership_id <> request_record.requested_approver_membership_id then
    raise exception 'This request is assigned to another reviewer' using errcode = '42501';
  end if;
  if p_new_reviewer_membership_id = request_record.member_membership_id then
    raise exception 'A member cannot be assigned to review their own request'
      using errcode = '42501';
  end if;
  if not private.is_review_capable_membership(
    p_new_reviewer_membership_id,
    request_record.school_year_id
  ) then
    raise exception 'New approver is not an active reviewer for this school year'
      using errcode = '22023';
  end if;

  previous_approver_id := request_record.requested_approver_membership_id;
  perform set_config('nhs.allow_hour_request_transition', 'on', true);
  update public.hour_requests
  set requested_approver_membership_id = p_new_reviewer_membership_id
  where id = p_request_id and status = 'pending'
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
    jsonb_build_object('comment_supplied', nullif(btrim(p_comment), '') is not null)
  );
  return request_record;
end;
$$;

commit;
