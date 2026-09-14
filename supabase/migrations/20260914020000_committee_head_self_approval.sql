begin;

-- Permit self-assignment and first-stage approval by an active committee head.
-- Keep hour_requests_actual_reviewer_not_self: final decisions still require
-- another reviewer, and approved hours still require the teacher-stage RPC.
alter table public.hour_requests
  drop constraint hour_requests_requested_reviewer_not_self,
  drop constraint hour_requests_committee_head_reviewer_not_self;

create or replace function private.validate_hour_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_record public.hour_requests%rowtype;
  actor_year_id uuid;
  reviewer_year_id uuid;
  actor_profile_id uuid;
  member_profile_id uuid;
begin
  select * into request_record
  from public.hour_requests
  where id = new.hour_request_id;
  if not found or request_record.school_year_id <> new.school_year_id then
    raise exception 'Review history must use the request school year' using errcode = '23514';
  end if;

  select school_year_id into actor_year_id
  from public.school_year_memberships
  where id = new.actor_membership_id;
  if new.action <> 'corrected' and actor_year_id <> new.school_year_id then
    raise exception 'Review actor must belong to the request school year' using errcode = '23514';
  end if;

  if new.reviewer_membership_id is not null then
    select school_year_id, profile_id into reviewer_year_id, actor_profile_id
    from public.school_year_memberships
    where id = new.reviewer_membership_id;
    select profile_id into member_profile_id
    from public.school_year_memberships
    where id = request_record.member_membership_id;
    if new.action <> 'corrected' and reviewer_year_id <> new.school_year_id then
      raise exception 'Reviewer must belong to the request school year' using errcode = '23514';
    end if;
    if new.reviewer_membership_id <> new.actor_membership_id then
      raise exception 'Reviewer must be the actor for a review event' using errcode = '23514';
    end if;
    if actor_profile_id = member_profile_id and (
      new.action = 'committee_approved'
      and new.previous_status = 'pending'
      and new.new_status = 'pending'
      and request_record.status = 'pending'
      and request_record.actual_reviewer_membership_id is null
      and new.reviewer_membership_id = request_record.requested_approver_membership_id
      and new.reviewer_membership_id = request_record.committee_head_reviewer_membership_id
      and private.is_committee_head_membership(new.reviewer_membership_id, new.school_year_id)
    ) is not true then
      raise exception 'Self-review history is limited to committee approval before teacher review'
        using errcode = '42501';
    end if;
  elsif new.actor_membership_id <> request_record.member_membership_id then
    raise exception 'Member workflow events must be created by the request owner'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

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
    and private.membership_is_active(membership.id)
    and not exists (
      select 1
      from public.platform_access_grants grant_row
      where grant_row.profile_id = membership.profile_id
    )
  group by membership.id, membership.profile_id, profile.full_name
  having bool_or(role.role_key = 'committee_head')
  order by lower(profile.full_name), membership.id;
end;
$$;

create or replace function private.assert_partial_request_values(
  p_school_year_id uuid,
  p_member_membership_id uuid,
  p_category_id uuid,
  p_requested_approver_membership_id uuid,
  p_title text,
  p_description text,
  p_service_date date,
  p_hours numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  year_record public.school_years%rowtype;
  category_active boolean;
  category_available boolean;
begin
  select * into year_record from public.school_years where id = p_school_year_id;
  if not found then
    raise exception 'School year does not exist' using errcode = '22023';
  end if;
  if not private.membership_is_active(p_member_membership_id)
    or not private.is_service_member_membership(p_member_membership_id) then
    raise exception 'Member does not have active access for this school year'
      using errcode = '42501';
  end if;

  if p_title is not null and length(btrim(p_title)) not between 1 and 160 then
    raise exception 'Title must contain 1 to 160 characters' using errcode = '22023';
  end if;
  if p_description is not null and length(btrim(p_description)) not between 1 and 4000 then
    raise exception 'Description must contain 1 to 4000 characters' using errcode = '22023';
  end if;
  if p_service_date is not null and (
    p_service_date < year_record.start_date
    or p_service_date > year_record.end_date
    or p_service_date > current_date
  ) then
    raise exception 'Service date must be within the school year and not in the future'
      using errcode = '22023';
  end if;
  if p_hours is not null and (p_hours <= 0 or p_hours > 24 or mod(p_hours, 0.25) <> 0) then
    raise exception 'Hours must be a positive quarter-hour value no greater than 24'
      using errcode = '22023';
  end if;

  if p_category_id is not null then
    select category.is_active, year_category.is_available
    into category_active, category_available
    from public.service_categories category
    join public.school_year_categories year_category
      on year_category.category_id = category.id
     and year_category.school_year_id = p_school_year_id
    where category.id = p_category_id;
    if not found or not category_active or not category_available then
      raise exception 'Category is not available for this school year' using errcode = '22023';
    end if;
  end if;

  if p_requested_approver_membership_id is not null then
    if not private.is_committee_head_membership(
      p_requested_approver_membership_id,
      p_school_year_id
    ) then
      raise exception 'Requested approver is not an active committee head for this school year'
        using errcode = '22023';
    end if;
  end if;
end;
$$;

create or replace function private.assert_request_values(
  p_school_year_id uuid,
  p_member_membership_id uuid,
  p_category_id uuid,
  p_requested_approver_membership_id uuid,
  p_title text,
  p_description text,
  p_service_date date,
  p_hours numeric,
  p_require_open_year boolean default true,
  p_require_available_category boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  year_record public.school_years%rowtype;
  category_active boolean;
  category_available boolean;
begin
  select * into year_record
  from public.school_years
  where id = p_school_year_id;
  if not found then
    raise exception 'School year does not exist' using errcode = '22023';
  end if;

  if p_require_open_year and (
    year_record.status <> 'active'
    or current_date < year_record.start_date
    or current_date > year_record.end_date
  ) then
    raise exception 'School year is not accepting submissions' using errcode = '55000';
  end if;
  if p_require_open_year and (
    not private.membership_is_active(p_member_membership_id)
    or not private.is_service_member_membership(p_member_membership_id)
  ) then
    raise exception 'Member does not have active access for this school year'
      using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.school_year_memberships membership
    where membership.id = p_member_membership_id
      and membership.school_year_id = p_school_year_id
  ) then
    raise exception 'Member membership belongs to a different school year'
      using errcode = '22023';
  end if;

  if length(btrim(coalesce(p_title, ''))) < 1 or length(btrim(p_title)) > 160 then
    raise exception 'Title is required and must not exceed 160 characters'
      using errcode = '22023';
  end if;
  if p_description is not null and length(btrim(p_description)) > 4000 then
    raise exception 'Description must not exceed 4000 characters' using errcode = '22023';
  end if;
  if p_service_date is null
    or p_service_date < year_record.start_date
    or p_service_date > year_record.end_date
    or p_service_date > current_date then
    raise exception 'Service date must be within the school year and not in the future'
      using errcode = '22023';
  end if;
  if p_hours is null or p_hours <= 0 or p_hours > 24 or mod(p_hours, 0.25) <> 0 then
    raise exception 'Hours must be a positive quarter-hour value no greater than 24'
      using errcode = '22023';
  end if;
  if p_category_id is null then
    raise exception 'Service category is required' using errcode = '22023';
  end if;

  select category.is_active, year_category.is_available
  into category_active, category_available
  from public.service_categories category
  join public.school_year_categories year_category
    on year_category.category_id = category.id
   and year_category.school_year_id = p_school_year_id
  where category.id = p_category_id;
  if not found then
    raise exception 'Category is not configured for this school year' using errcode = '22023';
  end if;
  if p_require_available_category and (not category_active or not category_available) then
    raise exception 'Category is not available for new submissions' using errcode = '55000';
  end if;

  if p_requested_approver_membership_id is null then
    raise exception 'Committee head approver is required' using errcode = '22023';
  end if;
  if p_require_open_year and not private.is_committee_head_membership(
    p_requested_approver_membership_id,
    p_school_year_id
  ) then
    raise exception 'Requested approver is not an active committee head for this school year'
      using errcode = '22023';
  end if;
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
    if not private.current_actor_is_teacher_admin() then
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
  if not private.current_actor_is_teacher_admin() then
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

comment on column public.hour_requests.committee_head_reviewer_membership_id is
  'Selected committee head who completed the first approval; may be the member. Teacher approval is still required.';

commit;
