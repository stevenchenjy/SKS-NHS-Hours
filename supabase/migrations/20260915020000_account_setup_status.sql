-- Portal visits are recorded after the authenticated portal mounts in the
-- browser, so invitation-link verification and page prefetches do not count.
create table private.account_portal_visits (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  first_visited_at timestamptz not null default statement_timestamp()
);

alter table private.account_portal_visits enable row level security;
alter table private.account_portal_visits force row level security;
revoke all on private.account_portal_visits from public, anon, authenticated;

create function public.record_portal_visit()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null or not (
    private.current_actor_is_teacher_admin()
    or exists (
      select 1 from public.school_year_memberships membership
      where membership.profile_id = actor_id
        and private.membership_has_role(membership.id, 'member', true)
    )
  ) then
    raise exception 'Active portal access is required' using errcode = '42501';
  end if;

  insert into private.account_portal_visits (profile_id)
  values (actor_id)
  on conflict (profile_id) do nothing;
end;
$$;

create function public.list_account_setup_status(p_school_year_id uuid)
returns table (
  email text,
  password_set boolean,
  first_portal_visit_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_teacher_admin();

  -- Return only a boolean derived from the stored credential. Never expose
  -- password hashes, tokens, or the authentication user record to the client.
  return query
  with account_emails as (
    select lower(profile.email::text) as email from public.profiles profile
    union
    select lower(invitation.email::text) from public.invitations invitation
    where invitation.school_year_id = p_school_year_id
  )
  select
    account.email,
    coalesce(auth_user.encrypted_password, '') <> '',
    visit.first_visited_at
  from account_emails account
  left join auth.users auth_user on auth_user.email = account.email
  left join private.account_portal_visits visit on visit.profile_id = auth_user.id;
end;
$$;

revoke all on function public.record_portal_visit() from public, anon;
revoke all on function public.list_account_setup_status(uuid) from public, anon;
grant execute on function public.record_portal_visit() to authenticated;
grant execute on function public.list_account_setup_status(uuid) to authenticated;
