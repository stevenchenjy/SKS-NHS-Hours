begin;

-- A real teacher is distinct from the platform owner used for administration.
insert into auth.users (id, email, aud, role, email_confirmed_at)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009', 'teacher@example.edu',
  'authenticated', 'authenticated', statement_timestamp());
insert into public.profiles (id, email, full_name)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009', 'teacher@example.edu', 'Terry Teacher');
insert into public.platform_access_grants (profile_id, access_level, granted_by_profile_id)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009', 'teacher_admin', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001');


create extension if not exists pgtap with schema extensions;
select extensions.plan(36);

create function pg_temp.self_request_id() returns uuid language sql as $$
  select current_setting('test.self_request_id')::uuid;
$$;

create function pg_temp.act_as(p_profile_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_profile_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_profile_id, 'role', 'authenticated'
  )::text, true);
end;
$$;

select extensions.ok(
  exists (select 1 from pg_constraint where conname = 'hour_requests_actual_reviewer_not_self'),
  'the final-reviewer self-review constraint remains enforced'
);

set local role authenticated;
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002');
select set_config('test.self_approved_before', (
  select approved_hours::text from public.member_progress
  where membership_id = '20000000-0000-4000-8000-000000000002'
), true);
select extensions.ok(
  exists (
    select 1 from public.list_eligible_reviewers('10000000-0000-4000-8000-000000000001')
    where membership_id = '20000000-0000-4000-8000-000000000002'
  ),
  'an active committee head can select themselves'
);
select extensions.lives_ok($$
  select set_config('test.self_request_id', (
    select id::text from public.create_hour_request_draft(
      p_school_year_id => '10000000-0000-4000-8000-000000000001',
      p_title => 'Committee Head Self Approval',
      p_description => 'A transaction-local test of teacher approval after self approval.',
      p_category_id => '30000000-0000-4000-8000-000000000005',
      p_service_date => current_date,
      p_hours => 2,
      p_requested_approver_membership_id => '20000000-0000-4000-8000-000000000002',
      p_client_submission_key => 'committee-head-self-approval'
    )
  ), true)
$$, 'a committee head can create a draft assigned to themselves');
select extensions.lives_ok($$
  select public.save_hour_request_draft(
    pg_temp.self_request_id(), 1, 'Committee Head Self Approval',
    'Updated before submission.', '30000000-0000-4000-8000-000000000005',
    current_date, 2, '20000000-0000-4000-8000-000000000002'
  )
$$, 'an edited draft also accepts the member as committee head');
select extensions.lives_ok($$
  select public.submit_hour_request(pg_temp.self_request_id(),
    (select revision from public.hour_requests where id = pg_temp.self_request_id()))
$$, 'self-assigned hours can be submitted for committee approval');
select extensions.ok((
  select status = 'pending' and committee_head_approved_at is null
    and actual_reviewer_membership_id is null
  from public.hour_requests where id = pg_temp.self_request_id()
), 'submission alone does not approve either stage');
select extensions.ok(
  exists (select 1 from public.pending_review_queue where id = pg_temp.self_request_id()),
  'the committee head sees their own request in their queue'
);
select extensions.throws_ok($$
  select public.review_hour_request(pg_temp.self_request_id(), 'request_changes', 'Change it')
$$, '42501', 'Self-review is limited to the selected committee-head approval',
  'self review cannot request changes');
select extensions.throws_ok($$
  select public.review_hour_request(pg_temp.self_request_id(), 'reject', 'Reject it')
$$, '42501', 'Self-review is limited to the selected committee-head approval',
  'self review cannot reject the request');

select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009');
select extensions.ok(
  not exists (select 1 from public.pending_review_queue where id = pg_temp.self_request_id()),
  'teachers do not receive the request before committee approval'
);
select extensions.throws_ok($$
  select public.review_hour_request(pg_temp.self_request_id(), 'approve')
$$, '42501', 'The selected committee head must complete the first approval',
  'a teacher cannot skip the self-assigned committee stage');
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001');
select public.remove_membership_role('20000000-0000-4000-8000-000000000002', 'committee_head');
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002');
select extensions.throws_ok($$
  select public.review_hour_request(pg_temp.self_request_id(), 'approve')
$$, '42501', 'Self-review is limited to the selected committee-head approval',
  'losing the committee-head role removes self-approval authority immediately');
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001');
select public.assign_membership_role('20000000-0000-4000-8000-000000000002', 'committee_head');
select extensions.lives_ok($$
  select public.reassign_hour_request(pg_temp.self_request_id(),
    '20000000-0000-4000-8000-000000000007')
$$, 'an admin can assign another committee head');
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002');
select extensions.throws_ok($$
  select public.review_hour_request(pg_temp.self_request_id(), 'approve')
$$, '42501', 'Self-review is limited to the selected committee-head approval',
  'a committee head cannot self-approve a request assigned to somebody else');
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001');
select extensions.lives_ok($$
  select public.reassign_hour_request(pg_temp.self_request_id(),
    '20000000-0000-4000-8000-000000000002')
$$, 'an admin can assign a committee head their own first-stage request');

select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa007');
select extensions.throws_ok($$
  select public.review_hour_request(pg_temp.self_request_id(), 'approve')
$$, '42501', 'This request is assigned to another committee head',
  'another committee head cannot take over the selected self-approval');
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa005');
select extensions.throws_ok($$
  select public.review_hour_request(pg_temp.self_request_id(), 'approve')
$$, '42501', 'An active reviewer membership is required',
  'an expired committee head still cannot review');

select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002');
select extensions.lives_ok($$
  select public.review_hour_request(pg_temp.self_request_id(), 'approve')
$$, 'the selected committee head can approve their own first stage');
select extensions.ok((
  select status = 'pending'
    and committee_head_reviewer_membership_id = member_membership_id
    and committee_head_approved_at is not null
    and actual_reviewer_membership_id is null and decided_at is null
  from public.hour_requests where id = pg_temp.self_request_id()
), 'self approval records the committee stage and keeps the request pending');
select extensions.is((
  select count(*) from public.hour_reviews
  where hour_request_id = pg_temp.self_request_id() and action = 'committee_approved'
    and reviewer_membership_id = '20000000-0000-4000-8000-000000000002'
), 1::bigint, 'self approval records one attributed review-history entry');
select extensions.is((
  select approved_hours from public.member_progress
  where membership_id = '20000000-0000-4000-8000-000000000002'
), current_setting('test.self_approved_before')::numeric,
  'self-approved hours do not count towards approved progress');
select extensions.ok(
  not exists (select 1 from public.pending_review_queue where id = pg_temp.self_request_id()),
  'the request leaves the committee-head queue after self approval'
);
select extensions.throws_ok($$
  select public.review_hour_request(pg_temp.self_request_id(), 'approve')
$$, '42501', 'Self-review is limited to the selected committee-head approval',
  'the submitter cannot give final approval or duplicate the first approval');
select extensions.throws_ok($$
  update public.hour_requests set status = 'approved' where id = pg_temp.self_request_id()
$$, '42501', 'permission denied for table hour_requests',
  'the submitter cannot bypass final approval with a direct update');

select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003');
select extensions.throws_ok($$
  select public.create_hour_request_draft(
    '10000000-0000-4000-8000-000000000001', 'Member Self Approval', null,
    '30000000-0000-4000-8000-000000000005', current_date, 1,
    '20000000-0000-4000-8000-000000000003', 'ordinary-member-self-approval'
  )
$$, '22023', 'Requested approver is not an active committee head for this school year',
  'an ordinary member cannot select themselves as a committee head');
select extensions.throws_ok($$
  select public.review_hour_request(pg_temp.self_request_id(), 'approve')
$$, '42501', 'An active teacher administrator must complete the final approval',
  'an ordinary member cannot give final approval');

select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009');
select extensions.ok(
  exists (select 1 from public.pending_review_queue
    where id = pg_temp.self_request_id() and approval_stage = 'teacher'),
  'teachers receive self-approved requests in their final queue'
);
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001');
select extensions.ok(
  exists (select 1 from public.audit_events where entity_id = pg_temp.self_request_id()::text
    and action = 'hour_request.committee_approved'),
  'self approval remains visible in the audit trail'
);
select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009');
select extensions.lives_ok($$
  select public.review_hour_request(pg_temp.self_request_id(), 'request_changes', 'Clarify the activity')
$$, 'a teacher can return self-approved hours for changes');

select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002');
select extensions.lives_ok($$
  select public.save_hour_request_draft(
    pg_temp.self_request_id(),
    (select revision from public.hour_requests where id = pg_temp.self_request_id()),
    'Committee Head Self Approval', 'Clarified the activity.',
    '30000000-0000-4000-8000-000000000005', current_date, 2,
    '20000000-0000-4000-8000-000000000002'
  )
$$, 'the committee head can edit their returned request while selecting themselves');
select extensions.lives_ok($$
  select public.submit_hour_request(pg_temp.self_request_id(),
    (select revision from public.hour_requests where id = pg_temp.self_request_id()))
$$, 'the committee head can resubmit returned hours');
select extensions.ok((
  select status = 'pending' and committee_head_approved_at is null
    and committee_head_reviewer_membership_id is null and actual_reviewer_membership_id is null
  from public.hour_requests where id = pg_temp.self_request_id()
), 'resubmission requires fresh committee and teacher approvals');
select extensions.lives_ok($$
  select public.review_hour_request(pg_temp.self_request_id(), 'approve')
$$, 'the committee head can repeat the first stage after resubmission');

select pg_temp.act_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009');
select extensions.lives_ok($$
  select public.review_hour_request(pg_temp.self_request_id(), 'approve')
$$, 'a teacher can give final approval to a self-approved request');
select extensions.ok((
  select status = 'approved'
    and committee_head_reviewer_membership_id = member_membership_id
    and actual_reviewer_membership_id = (select id from public.school_year_memberships where profile_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa009' and school_year_id = '10000000-0000-4000-8000-000000000001')
    and decided_at is not null
  from public.hour_requests where id = pg_temp.self_request_id()
), 'the final decision records a different teacher');
select extensions.is((
  select approved_hours from public.member_progress
  where membership_id = '20000000-0000-4000-8000-000000000002'
), current_setting('test.self_approved_before')::numeric + 2,
  'the two hours count only after teacher approval');

select * from extensions.finish();
rollback;
