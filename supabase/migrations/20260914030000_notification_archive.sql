begin;

-- Read notifications form the archive. Filter before pagination so new and
-- archived pages remain complete even when their timestamps are interleaved.
-- Omitting the filter preserves the existing RPC's all-notifications behavior.
drop function public.list_event_notifications(integer, integer);
create function public.list_event_notifications(
  p_limit integer default 30,
  p_offset integer default 0,
  p_archived boolean default null
)
returns table(id uuid, event_id uuid, kind text, title text, message text, changes jsonb, created_at timestamptz, read_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_provisioned_profile() then
    raise exception 'A provisioned portal account is required' using errcode = '42501';
  end if;
  return query
  select notice.id, case when event.deleted_at is null then event.id else null end,
    notice.kind, notice.title, notice.message, notice.changes, notice.created_at, notice.read_at
  from public.event_notifications notice
  join public.service_events event on event.id = notice.event_id
  where notice.recipient_profile_id = (select auth.uid())
    and (p_archived is null or (notice.read_at is not null) = p_archived)
  order by notice.created_at desc, notice.id desc
  limit greatest(1, least(coalesce(p_limit, 30), 100)) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.list_event_notifications(integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.list_event_notifications(integer, integer, boolean) to authenticated;

commit;
