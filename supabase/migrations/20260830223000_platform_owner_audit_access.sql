begin;

-- Audit records include sensitive administrative activity. Only the platform
-- owner may read them; ordinary teacher administrators retain no direct or UI
-- access.
drop policy if exists audit_events_select_teacher_admin on public.audit_events;

create policy audit_events_select_platform_owner
on public.audit_events for select to authenticated
using (private.current_actor_is_platform_owner());

commit;
