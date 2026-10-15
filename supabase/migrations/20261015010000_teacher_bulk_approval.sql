begin;

-- Keep retry receipts out of the public API. A receipt and its approvals commit
-- together, so a retry after a lost response returns the original decision.
create table private.teacher_approval_batches (
  actor_profile_id uuid not null references public.profiles(id),
  batch_id uuid not null,
  school_year_id uuid not null references public.school_years(id),
  requests jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (actor_profile_id, batch_id)
);

alter table private.teacher_approval_batches enable row level security;
alter table private.teacher_approval_batches force row level security;
revoke all on private.teacher_approval_batches from public, anon, authenticated, service_role;

create function public.bulk_approve_teacher_requests(
  p_school_year_id uuid,
  p_batch_id uuid,
  p_requests jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  reviewer_membership_id uuid;
  selection jsonb;
  selected_id uuid;
  selected_revision integer;
  selected_updated_at timestamptz;
  selected_ids uuid[] := '{}'::uuid[];
  request_record public.hour_requests%rowtype;
  previous_batch private.teacher_approval_batches%rowtype;
  outcome text;
  approved_count integer := 0;
  results jsonb := '[]'::jsonb;
  batch_result jsonb;
begin
  -- An Admin/owner attribution anchor also has a teacher role label. Only the
  -- specific global Teacher grant conveys approval authority.
  if private.current_actor_is_teacher_approver() is not true then
    raise exception 'Teacher approval access is required' using errcode = '42501';
  end if;
  if p_school_year_id is null or p_batch_id is null then
    raise exception 'A school year and batch ID are required' using errcode = '22023';
  end if;
  reviewer_membership_id := private.current_membership_id(p_school_year_id, true);
  if reviewer_membership_id is null then
    raise exception 'An active school-year teacher membership is required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_requests) is distinct from 'array' then
    raise exception 'Select between 1 and 50 requests' using errcode = '22023';
  end if;
  if jsonb_array_length(p_requests) not between 1 and 50 then
    raise exception 'Select between 1 and 50 requests' using errcode = '22023';
  end if;

  -- Validate the entire input before acquiring request locks or approving any
  -- row. Preserve the database timestamp's microseconds through this API.
  for selection in select value from jsonb_array_elements(p_requests)
  loop
    if jsonb_typeof(selection) is distinct from 'object' then
      raise exception 'Each selected request must include its ID, revision, and timestamp' using errcode = '22023';
    end if;
    if not (selection ?& array['requestId', 'expectedRevision', 'expectedUpdatedAt'])
      or (select count(*) from jsonb_object_keys(selection)) <> 3
      or jsonb_typeof(selection -> 'requestId') is distinct from 'string'
      or jsonb_typeof(selection -> 'expectedRevision') is distinct from 'number'
      or jsonb_typeof(selection -> 'expectedUpdatedAt') is distinct from 'string' then
      raise exception 'Each selected request must include its ID, revision, and timestamp' using errcode = '22023';
    end if;
    if (selection ->> 'requestId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (selection ->> 'expectedRevision') !~ '^[1-9][0-9]{0,9}$'
      or (selection ->> 'expectedUpdatedAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then
      raise exception 'A selected request has an invalid ID, revision, or timestamp' using errcode = '22023';
    end if;
    begin
      selected_id := (selection ->> 'requestId')::uuid;
      selected_revision := (selection ->> 'expectedRevision')::integer;
      selected_updated_at := (selection ->> 'expectedUpdatedAt')::timestamptz;
    exception
      when invalid_text_representation or invalid_datetime_format
        or datetime_field_overflow or numeric_value_out_of_range then
        raise exception 'A selected request has an invalid ID, revision, or timestamp' using errcode = '22023';
    end;
    if selected_id = any(selected_ids) then
      raise exception 'Select each request only once' using errcode = '22023';
    end if;
    selected_ids := array_append(selected_ids, selected_id);
  end loop;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'nhs.teacher_approval_batch:' || actor_id::text || ':' || p_batch_id::text, 0
  ));
  select * into previous_batch
  from private.teacher_approval_batches
  where actor_profile_id = actor_id and batch_id = p_batch_id;
  if found then
    if previous_batch.school_year_id <> p_school_year_id or previous_batch.requests <> p_requests then
      raise exception 'This batch ID was already used for a different selection' using errcode = '22023';
    end if;
    return previous_batch.result;
  end if;

  -- Overlapping batches take every selected, in-scope lock in the same order.
  -- The single-request RPC then reuses our lock and its canonical audit path.
  perform request.id
  from public.hour_requests request
  where request.id = any(selected_ids) and request.school_year_id = p_school_year_id
  order by request.id
  for update;

  for selection in select value from jsonb_array_elements(p_requests)
  loop
    selected_id := (selection ->> 'requestId')::uuid;
    selected_revision := (selection ->> 'expectedRevision')::integer;
    selected_updated_at := (selection ->> 'expectedUpdatedAt')::timestamptz;
    select * into request_record from public.hour_requests
    where id = selected_id and school_year_id = p_school_year_id;

    if not found or request_record.member_membership_id = reviewer_membership_id
      or request_record.status = 'draft' then
      outcome := 'not_eligible';
    elsif request_record.status <> 'pending' then
      outcome := 'already_processed';
    elsif request_record.committee_head_approved_at is null then
      outcome := 'not_eligible';
    elsif request_record.revision <> selected_revision
      or request_record.updated_at <> selected_updated_at then
      outcome := 'changed_since_selection';
    else
      -- Do not swallow unexpected failures: all approvals and the receipt must
      -- roll back together if the canonical workflow rejects a decision.
      perform public.review_hour_request(selected_id, 'approve', null);
      approved_count := approved_count + 1;
      outcome := 'approved';
    end if;
    results := results || jsonb_build_array(jsonb_build_object(
      'requestId', selected_id, 'outcome', outcome
    ));
  end loop;

  batch_result := jsonb_build_object(
    'batchId', p_batch_id, 'approvedCount', approved_count, 'results', results
  );
  insert into private.teacher_approval_batches (
    actor_profile_id, batch_id, school_year_id, requests, result
  ) values (actor_id, p_batch_id, p_school_year_id, p_requests, batch_result);

  perform private.write_audit(
    'hour_request.bulk_approved', 'teacher_approval_batch', p_batch_id::text,
    p_school_year_id, reviewer_membership_id, null, null,
    jsonb_build_object('batch_id', p_batch_id, 'selected_count', jsonb_array_length(p_requests),
      'approved_count', approved_count, 'results', results)
  );
  return batch_result;
end;
$$;

revoke all on function public.bulk_approve_teacher_requests(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.bulk_approve_teacher_requests(uuid, uuid, jsonb) to authenticated;

comment on function public.bulk_approve_teacher_requests(uuid, uuid, jsonb) is
  'Approve up to 50 unchanged teacher-stage selections; return per-request outcomes and recover the original result on a same-actor, same-payload batch retry.';

notify pgrst, 'reload schema';

commit;
