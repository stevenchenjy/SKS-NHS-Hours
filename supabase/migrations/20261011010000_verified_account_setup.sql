-- A hash is not evidence that the invitee chose a password: Auth may generate
-- a random temporary password during email confirmation. Keep durable proof of
-- a later password change or a real password-authenticated sign-in instead.
create table private.account_auth_milestones (
  auth_user_id uuid primary key references auth.users (id) on delete cascade,
  password_completed_at timestamptz not null default statement_timestamp()
);
alter table private.account_auth_milestones enable row level security;
alter table private.account_auth_milestones force row level security;
revoke all on private.account_auth_milestones from public, anon, authenticated;

create function private.record_verified_password_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.email_confirmed_at is not null
    and new.email_confirmed_at is not null
    and coalesce(new.encrypted_password, '') <> ''
    and new.encrypted_password is distinct from old.encrypted_password then
    insert into private.account_auth_milestones (auth_user_id)
    values (new.id) on conflict (auth_user_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.record_verified_password_change() from public, anon, authenticated;
create trigger record_verified_password_change
  after update of encrypted_password on auth.users
  for each row execute function private.record_verified_password_change();

create function public.record_password_sign_in()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null or not exists (
    select 1 from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) method
    where method ->> 'method' = 'password'
  ) or not exists (
    select 1 from auth.users account
    where account.id = actor_id and account.email_confirmed_at is not null
      and coalesce(account.encrypted_password, '') <> ''
  ) then
    raise exception 'A verified password sign-in is required' using errcode = '42501';
  end if;
  insert into private.account_auth_milestones (auth_user_id)
  values (actor_id) on conflict (auth_user_id) do nothing;
end;
$$;
revoke all on function public.record_password_sign_in() from public, anon;
grant execute on function public.record_password_sign_in() to authenticated;

drop function public.list_account_setup_status(uuid);
create function public.list_account_setup_status(p_school_year_id uuid)
returns table (
  email text,
  password_set boolean,
  first_portal_visit_at timestamptz,
  email_verified_at timestamptz,
  password_completed_at timestamptz,
  google_linked boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_teacher_admin();
  return query
  with account_emails as (
    select lower(profile.email::text) as email from public.profiles profile
    union
    select lower(invitation.email::text) from public.invitations invitation
    where invitation.school_year_id = p_school_year_id
  )
  select account.email,
    milestone.password_completed_at is not null,
    visit.first_visited_at,
    auth_user.email_confirmed_at,
    milestone.password_completed_at,
    exists (select 1 from auth.identities identity
      where identity.user_id = auth_user.id and identity.provider = 'google'
        and identity.identity_data ->> 'email_verified' = 'true')
  from account_emails account
  left join auth.users auth_user on lower(auth_user.email) = account.email
  left join private.account_auth_milestones milestone on milestone.auth_user_id = auth_user.id
  left join private.account_portal_visits visit on visit.profile_id = auth_user.id;
end;
$$;
revoke all on function public.list_account_setup_status(uuid) from public, anon;
grant execute on function public.list_account_setup_status(uuid) to authenticated;

-- Deliberately no historical backfill from hashes or portal visits. Older
-- accounts are "Not confirmed" until a password change or password sign-in.
