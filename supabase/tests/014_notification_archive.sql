begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(8);

-- Interleave read and unread rows to verify filtering happens before pagination.
delete from public.event_notifications;
insert into public.event_notifications (id, recipient_profile_id, event_id, kind, title, message, created_at, read_at)
select ('eeeeeeee-eeee-4eee-8eee-' || lpad(n::text, 12, '0'))::uuid,
  case when n = 4 then 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002'::uuid
    else 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003'::uuid end,
  (select id from public.service_events limit 1), 'event_updated', 'Archive test ' || n, 'Test update',
  now() - n * interval '1 minute', case when n = 2 then now() else null end
from generate_series(1, 4) n;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003","role":"authenticated"}', true);
select extensions.is((select count(*) from public.list_event_notifications(30, 0, false)), 2::bigint, 'New contains only own unread notifications');
select extensions.is((select count(*) from public.list_event_notifications(30, 0, true)), 1::bigint, 'Archive contains only own read notifications');
select extensions.is((select count(*) from public.list_event_notifications(30, 0)), 3::bigint, 'Legacy callers still receive both states');
select extensions.is((select title from public.list_event_notifications(1, 1, false)), 'Archive test 3', 'Filter is applied before pagination');
select public.mark_event_notifications_read('eeeeeeee-eeee-4eee-8eee-000000000001');
select extensions.is((select count(*) from public.list_event_notifications(30, 0, false)), 1::bigint, 'Marking read removes notification from New');
select extensions.is((select count(*) from public.list_event_notifications(30, 0, true)), 2::bigint, 'Marking read preserves notification in Archive');
select public.mark_event_notifications_read(null);
select extensions.is((select count(*) from public.list_event_notifications(30, 0, false)), 0::bigint, 'Bulk archive clears own New view');
reset role;
select extensions.is((select read_at from public.event_notifications where id = 'eeeeeeee-eeee-4eee-8eee-000000000004'), null::timestamptz, 'Bulk archive leaves other recipients unread');
select * from extensions.finish();
rollback;
